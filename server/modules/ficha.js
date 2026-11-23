import { db, nowIso, uid, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir, exigirAlguno } from '../lib/permissions.js';
import { requireUser } from './auth.js';

const TIPOS_PEDIDO = ['ecografia', 'colposcopia', 'biopsia', 'laboratorio'];
const ESTADOS_PEDIDO = ['pendiente', 'con_resultado', 'sin_resultado'];

function limpiar(valor, max = 500) {
  return String(valor ?? '').trim().slice(0, max);
}

function parsearDatos(valor) {
  if (!valor) return null;
  try {
    const datos = JSON.parse(valor);
    return datos && typeof datos === 'object' ? datos : null;
  } catch {
    return null;
  }
}

function serializarDatos(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (!texto) return null;
    return texto.slice(0, 100000);
  }
  try {
    return JSON.stringify(valor).slice(0, 100000);
  } catch {
    throw new HttpError(400, 'Los datos del pedido no son válidos');
  }
}

function pacienteDe(id) {
  const paciente = db
    .prepare('SELECT id, nombres, apellidos, cedula FROM patients WHERE id = ? AND activo = 1')
    .get(id);
  if (!paciente) throw new HttpError(404, 'Paciente no encontrada');
  return paciente;
}

function medicoValido(valor) {
  const id = limpiar(valor, 60);
  if (!id) return null;
  const medico = db
    .prepare("SELECT id FROM users WHERE id = ? AND rol = 'medico' AND activo = 1")
    .get(id);
  if (!medico) throw new HttpError(400, 'El médico seleccionado no es válido');
  return medico.id;
}

function fechaValida(valor, mensaje = 'La fecha no es válida') {
  const fecha = limpiar(valor, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new HttpError(400, mensaje);
  return fecha;
}

export function routes(router) {
  // -------------------------------------------------------------------------
  // Recetas de la paciente (lista resumida para la ficha)
  // -------------------------------------------------------------------------
  router.get('/api/patients/:id/recetas', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);
    pacienteDe(ctx.params.id);

    return db
      .prepare(
        `SELECT pr.id, pr.numero, pr.fecha, pr.estado, pr.anulada_en, pr.diagnostico, pr.cie10,
                pr.record_id,
                (SELECT GROUP_CONCAT(pi.medicamento, ' · ')
                   FROM prescription_items pi
                  WHERE pi.prescription_id = pr.id) AS medicamentos_texto
         FROM prescriptions pr
         WHERE pr.patient_id = ?
         ORDER BY pr.fecha DESC, pr.creado_en DESC`
      )
      .all(ctx.params.id)
      .map((fila) => ({
        id: fila.id,
        numero: fila.numero,
        fecha: fila.fecha,
        estado: fila.estado,
        anulada: Boolean(fila.anulada_en),
        anuladaEn: fila.anulada_en,
        diagnostico: fila.diagnostico || '',
        cie: fila.cie10 || '',
        recordId: fila.record_id,
        medicamentos: fila.medicamentos_texto ? fila.medicamentos_texto.split(' · ') : [],
        medicamentosTexto: fila.medicamentos_texto || '',
      }));
  });

  // -------------------------------------------------------------------------
  // Resumen de consultas anteriores (para la pestaña Historia)
  // -------------------------------------------------------------------------
  router.get('/api/patients/:id/historia-resumen', (ctx) => {
    const user = requireUser(ctx);
    exigirAlguno(user, [PERMISOS.HISTORIAS_RESUMEN, PERMISOS.HISTORIAS_VER]);
    pacienteDe(ctx.params.id);

    return db
      .prepare(
        `SELECT cr.id, cr.fecha, cr.motivo_consulta, cr.diagnostico,
                a.motivo AS cita_motivo, a.estado AS cita_estado,
                u.nombre AS medico_nombre,
                (SELECT GROUP_CONCAT(COALESCE(d.cie10, '') ||
                                     CASE WHEN d.descripcion IS NOT NULL AND d.descripcion != ''
                                          THEN ' ' || d.descripcion ELSE '' END, ' · ')
                   FROM clinical_diagnoses d
                  WHERE d.record_id = cr.id) AS diagnosticos_texto
         FROM clinical_records cr
         LEFT JOIN appointments a ON a.id = cr.appointment_id
         LEFT JOIN users u ON u.id = cr.medico_id
         WHERE cr.patient_id = ?
         ORDER BY cr.fecha DESC`
      )
      .all(ctx.params.id)
      .map((fila) => ({
        id: fila.id,
        fecha: fila.fecha,
        motivo: fila.motivo_consulta || fila.cita_motivo || '',
        diagnostico: fila.diagnostico || '',
        cie: fila.diagnosticos_texto || '',
        medico: fila.medico_nombre || '',
        citaEstado: fila.cita_estado || '',
      }));
  });

  // -------------------------------------------------------------------------
  // Nota aclaratoria (addenda) sobre una consulta finalizada
  // -------------------------------------------------------------------------
  router.post('/api/clinical-records/:id/addenda', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const historia = db
      .prepare(
        `SELECT cr.id, a.estado AS cita_estado
         FROM clinical_records cr
         LEFT JOIN appointments a ON a.id = cr.appointment_id
         WHERE cr.id = ?`
      )
      .get(ctx.params.id);
    if (!historia) throw new HttpError(404, 'Historia clínica no encontrada');
    if (historia.cita_estado !== 'atendida') {
      throw new HttpError(
        409,
        'La consulta debe estar finalizada para registrar una nota aclaratoria'
      );
    }

    const texto = limpiar(ctx.body?.texto, 5000);
    if (texto.length < 5) {
      throw new HttpError(400, 'Escribe el texto de la nota aclaratoria');
    }

    const id = uid();
    const creadoEn = nowIso();
    db.prepare(
      `INSERT INTO clinical_addenda (id, record_id, texto, usuario_id, creado_en)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, historia.id, texto, user.id, creadoEn);

    audit(user.id, 'addenda_creada', 'clinical_records', historia.id, null);
    ctx.ok({ id, creadoEn, usuario: user.nombre }, 201);
  });

  // -------------------------------------------------------------------------
  // Pedidos de exámenes (ecografía, colposcopia, biopsia, laboratorio)
  // -------------------------------------------------------------------------
  router.get('/api/patients/:id/pedidos', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);
    pacienteDe(ctx.params.id);

    return db
      .prepare(
        `SELECT po.*, u.nombre AS medico_nombre
         FROM clinical_orders po
         LEFT JOIN users u ON u.id = po.medico_id
         WHERE po.patient_id = ?
         ORDER BY po.fecha DESC, po.numero DESC`
      )
      .all(ctx.params.id)
      .map((fila) => ({
        ...fila,
        datos: parsearDatos(fila.datos),
      }));
  });

  router.post('/api/patients/:id/pedidos', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);
    const paciente = pacienteDe(ctx.params.id);

    const tipo = limpiar(ctx.body?.tipo, 40).toLowerCase();
    if (!TIPOS_PEDIDO.includes(tipo)) throw new HttpError(400, 'Tipo de pedido no válido');
    const fecha = fechaValida(ctx.body?.fecha, 'La fecha del pedido no es válida');
    const datos = serializarDatos(ctx.body?.datos);

    let recordId = null;
    if (ctx.body?.recordId) {
      const registro = db
        .prepare('SELECT id, patient_id FROM clinical_records WHERE id = ?')
        .get(String(ctx.body.recordId));
      if (!registro) throw new HttpError(400, 'La consulta seleccionada no existe');
      if (registro.patient_id !== paciente.id) {
        throw new HttpError(400, 'La consulta no corresponde a la paciente');
      }
      recordId = registro.id;
    }

    const medicoId =
      medicoValido(ctx.body?.medicoId) ||
      db
        .prepare(
          `SELECT id FROM users WHERE rol = 'medico' AND activo = 1
           ORDER BY nombre COLLATE NOCASE LIMIT 1`
        )
        .get()?.id ||
      (user.rol === 'medico' ? user.id : null);

    const id = uid();
    const ts = nowIso();
    let numero = 0;

    tx(() => {
      numero = db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM clinical_orders').get().n;
      db.prepare(
        `INSERT INTO clinical_orders
           (id, numero, patient_id, record_id, tipo, fecha, datos, estado, medico_id,
            creado_por, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?)`
      ).run(
        id,
        numero,
        paciente.id,
        recordId,
        tipo,
        fecha,
        datos,
        medicoId,
        user.id,
        ts,
        ts
      );
    });

    audit(user.id, 'pedido_creado', 'clinical_orders', id, {
      patientId: paciente.id,
      tipo,
      numero,
    });
    ctx.ok({ id, numero }, 201);
  });

  router.get('/api/pedidos/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const pedido = db
      .prepare(
        `SELECT po.*, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
                p.fecha_nacimiento, p.telefono, p.direccion,
                u.nombre AS medico_nombre, u.cedula AS medico_cedula,
                u.especialidad AS medico_especialidad, u.senecit AS medico_senecit
         FROM clinical_orders po
         JOIN patients p ON p.id = po.patient_id
         LEFT JOIN users u ON u.id = po.medico_id
         WHERE po.id = ?`
      )
      .get(ctx.params.id);
    if (!pedido) throw new HttpError(404, 'Pedido no encontrado');

    return {
      ...pedido,
      datos: parsearDatos(pedido.datos),
      paciente: {
        id: pedido.patient_id,
        nombres: pedido.nombres,
        apellidos: pedido.apellidos,
        cedula: pedido.paciente_cedula,
        fechaNacimiento: pedido.fecha_nacimiento,
        telefono: pedido.telefono,
        direccion: pedido.direccion,
      },
      medico: pedido.medico_nombre
        ? {
            nombre: pedido.medico_nombre,
            cedula: pedido.medico_cedula || '',
            especialidad: pedido.medico_especialidad || '',
            senecit: pedido.medico_senecit || '',
          }
        : null,
    };
  });

  router.put('/api/pedidos/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const actual = db.prepare('SELECT id FROM clinical_orders WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Pedido no encontrado');

    const estado = limpiar(ctx.body?.estado, 40).toLowerCase();
    if (!ESTADOS_PEDIDO.includes(estado)) throw new HttpError(400, 'Estado del pedido no válido');

    db.prepare('UPDATE clinical_orders SET estado = ?, actualizado_en = ? WHERE id = ?').run(
      estado,
      nowIso(),
      actual.id
    );
    audit(user.id, 'pedido_actualizado', 'clinical_orders', actual.id, { estado });
    ctx.ok({ ok: true });
  });
}
