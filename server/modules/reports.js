import { db, nowIso } from '../db/index.js';
import { audit } from '../lib/audit.js';
import {
  MODULOS_SISTEMA,
  TIPOS_ACCION,
  moduloDe,
  tipoAccionDe,
} from '../lib/auditTaxonomy.js';
import { HttpError } from '../lib/http.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { cerrarSesionesTiempoReal } from '../lib/sessionEvents.js';
import { requireUser } from './auth.js';

const ZONA = 'America/Guayaquil';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAVES_DETALLE = {
  sesionUnica: 'Sesión única',
  sesionesCerradas: 'Sesiones cerradas',
  sesiones: 'Sesiones',
  version: 'Versión',
  fechaHora: 'Fecha y hora',
  motivo: 'Motivo',
  estado: 'Estado',
  tipo: 'Tipo',
  nombre: 'Nombre',
  cedula: 'Cédula',
  usuario: 'Usuario',
  cantidad: 'Cantidad',
  archivos: 'Archivos',
  plantilla: 'Plantilla',
  codigo: 'Código',
  destino: 'Destino',
  habilitado: 'Habilitado',
  auto: 'Automático',
  telefono: 'Teléfono',
  correo: 'Correo',
  duracion: 'Duración',
  examen: 'Examen',
  titulo: 'Título',
  mime: 'Tipo de archivo',
  tamano: 'Tamaño',
  enviado: 'Enviado',
  error: 'Error',
  items: 'Elementos',
};
const CLAVES_IGNORADAS = new Set([
  'id',
  'patientId',
  'appointmentId',
  'recordId',
  'examId',
  'templateId',
  'medicoId',
  'userId',
  'sessionId',
  'versionId',
  'documentId',
  'conversationId',
  'signatureId',
  'shareId',
  'fechaHora',
  'nombre',
  'titulo',
  'cedula',
]);
const ETIQUETAS_CONFIG = {
  centro: 'Centro médico',
  logo: 'Logo',
  pie: 'Pie de página',
  alertas: 'Alertas',
  agenda: 'Agenda',
  whatsapp: 'WhatsApp',
  demo: 'Modo DEMO',
  firmas: 'Firmas',
  migracion: 'Migración',
};

function fechaActual() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ZONA });
}

function fechaHumana(valor) {
  if (!valor) return '';
  const texto = String(valor);
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return texto;
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(texto);
  return fecha.toLocaleString('es-EC', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(soloFecha ? {} : { hour: '2-digit', minute: '2-digit' }),
  });
}

function paciente(fila) {
  if (!fila) return '';
  return `${fila.nombres || ''} ${fila.apellidos || ''}`.trim();
}

function pacienteConCedula(fila) {
  if (!fila) return '';
  return `${paciente(fila)}${fila.cedula ? ` · C.I. ${fila.cedula}` : ''}`;
}

function detalleObjeto(detalle) {
  if (!detalle) return {};
  try {
    const datos = JSON.parse(detalle);
    return datos && typeof datos === 'object' ? datos : {};
  } catch {
    return {};
  }
}

function detalleLegible(detalle) {
  const datos = detalleObjeto(detalle);
  const partes = [];
  for (const [clave, valor] of Object.entries(datos)) {
    if (CLAVES_IGNORADAS.has(clave)) continue;
    if (typeof valor === 'string' && UUID.test(valor)) continue;
    if (valor === null || valor === undefined || valor === '') continue;
    const texto =
      typeof valor === 'boolean'
        ? valor
          ? 'sí'
          : 'no'
        : typeof valor === 'object'
          ? JSON.stringify(valor)
          : String(valor);
    partes.push(`${CLAVES_DETALLE[clave] || clave}: ${texto}`);
  }
  return partes.join(' · ').slice(0, 300);
}

function marcadores(cantidad) {
  return new Array(cantidad).fill('?').join(', ');
}

function mapa(ids, sql, transformar = (fila) => fila) {
  const lista = [...ids];
  if (!lista.length) return new Map();
  const filas = db.prepare(sql(marcadores(lista.length))).all(...lista);
  return new Map(filas.map((fila) => [fila.id, transformar(fila)]));
}

function enriquecerEventos(eventos) {
  const ids = {
    patients: new Set(),
    appointments: new Set(),
    clinical_records: new Set(),
    clinical_exams: new Set(),
    clinical_attachments: new Set(),
    documents: new Set(),
    prescriptions: new Set(),
    crm_tasks: new Set(),
    crm_messages: new Set(),
    users: new Set(),
    templates: new Set(),
    migration_runs: new Set(),
    patient_share_links: new Set(),
  };

  const detalles = eventos.map((evento) => detalleObjeto(evento.detalle));
  eventos.forEach((evento, indice) => {
    if (ids[evento.entidad] && evento.entidad_id) {
      ids[evento.entidad].add(evento.entidad_id);
    }
    const detalle = detalles[indice];
    if (detalle.patientId) ids.patients.add(detalle.patientId);
    if (detalle.appointmentId) ids.appointments.add(detalle.appointmentId);
    if (detalle.recordId) ids.clinical_records.add(detalle.recordId);
    if (detalle.examId) ids.clinical_exams.add(detalle.examId);
    if (detalle.templateId) ids.templates.add(detalle.templateId);
    if (detalle.userId) ids.users.add(detalle.userId);
  });

  const pacientes = mapa(
    ids.patients,
    (m) => `SELECT id, nombres, apellidos, cedula FROM patients WHERE id IN (${m})`
  );
  const citas = mapa(
    ids.appointments,
    (m) => `SELECT a.id, a.fecha_hora, a.estado, p.nombres, p.apellidos, p.cedula
            FROM appointments a JOIN patients p ON p.id = a.patient_id
            WHERE a.id IN (${m})`
  );
  const consultas = mapa(
    ids.clinical_records,
    (m) => `SELECT cr.id, cr.fecha, p.nombres, p.apellidos, p.cedula
            FROM clinical_records cr JOIN patients p ON p.id = cr.patient_id
            WHERE cr.id IN (${m})`
  );
  const examenes = mapa(
    ids.clinical_exams,
    (m) => `SELECT ce.id, ce.nombre, ce.record_id, p.nombres, p.apellidos, p.cedula
            FROM clinical_exams ce
            JOIN clinical_records cr ON cr.id = ce.record_id
            JOIN patients p ON p.id = cr.patient_id
            WHERE ce.id IN (${m})`
  );
  const adjuntos = mapa(
    ids.clinical_attachments,
    (m) => `SELECT ca.id, ca.nombre, ca.exam_id, ce.nombre AS examen_nombre,
                   p.nombres, p.apellidos, p.cedula
            FROM clinical_attachments ca
            LEFT JOIN clinical_exams ce ON ce.id = ca.exam_id
            LEFT JOIN clinical_records cr ON cr.id = ca.record_id
            LEFT JOIN patients p ON p.id = cr.patient_id
            WHERE ca.id IN (${m})`
  );
  const documentos = mapa(
    ids.documents,
    (m) => `SELECT d.id, d.titulo, d.codigo, p.nombres, p.apellidos, p.cedula
            FROM documents d JOIN patients p ON p.id = d.patient_id
            WHERE d.id IN (${m})`
  );
  const recetas = mapa(
    ids.prescriptions,
    (m) => `SELECT pr.id, pr.fecha, pr.hora, p.nombres, p.apellidos, p.cedula
            FROM prescriptions pr JOIN patients p ON p.id = pr.patient_id
            WHERE pr.id IN (${m})`
  );
  const tareas = mapa(
    ids.crm_tasks,
    (m) => `SELECT t.id, t.tipo, t.motivo, p.nombres, p.apellidos, p.cedula
            FROM crm_tasks t JOIN patients p ON p.id = t.patient_id
            WHERE t.id IN (${m})`
  );
  const mensajes = mapa(
    ids.crm_messages,
    (m) => `SELECT msg.id, msg.contenido, p.nombres, p.apellidos, p.cedula
            FROM crm_messages msg JOIN patients p ON p.id = msg.patient_id
            WHERE msg.id IN (${m})`
  );
  const usuarios = mapa(
    ids.users,
    (m) => `SELECT id, nombre, rol FROM users WHERE id IN (${m})`
  );
  const plantillas = mapa(
    ids.templates,
    (m) => `SELECT id, nombre FROM templates WHERE id IN (${m})`
  );
  const migraciones = mapa(
    ids.migration_runs,
    (m) => `SELECT id, nombre_archivo FROM migration_runs WHERE id IN (${m})`
  );
  const enlaces = mapa(
    ids.patient_share_links,
    (m) => `SELECT l.id, p.nombres, p.apellidos, p.cedula
            FROM patient_share_links l JOIN patients p ON p.id = l.patient_id
            WHERE l.id IN (${m})`
  );

  function textoPaciente(fila) {
    return pacienteConCedula(fila);
  }

  function pacienteDe(evento, detalle) {
    const id = evento.entidad_id;
    if (evento.entidad === 'patients' && pacientes.has(id)) return pacientes.get(id);
    if (detalle.patientId && pacientes.has(detalle.patientId)) {
      return pacientes.get(detalle.patientId);
    }
    if (evento.entidad === 'appointments' && citas.has(id)) return citas.get(id);
    if (evento.entidad === 'clinical_records' && consultas.has(id)) return consultas.get(id);
    if (evento.entidad === 'clinical_exams' && examenes.has(id)) return examenes.get(id);
    if (evento.entidad === 'clinical_attachments' && adjuntos.has(id)) return adjuntos.get(id);
    if (evento.entidad === 'documents' && documentos.has(id)) return documentos.get(id);
    if (evento.entidad === 'prescriptions' && recetas.has(id)) return recetas.get(id);
    if (evento.entidad === 'crm_tasks' && tareas.has(id)) return tareas.get(id);
    if (evento.entidad === 'crm_messages' && mensajes.has(id)) return mensajes.get(id);
    if (evento.entidad === 'patient_share_links' && enlaces.has(id)) return enlaces.get(id);
    return null;
  }

  function referencia(evento, detalle) {
    const id = evento.entidad_id;
    const accion = evento.accion;

    if (['login', 'logout', 'login_fallido', 'login_ambiguo'].includes(accion)) {
      return '';
    }

    if (evento.entidad === 'appointments' && citas.has(id)) {
      const cita = citas.get(id);
      return `${textoPaciente(cita)} · Cita ${fechaHumana(cita.fecha_hora)}`;
    }
    if (evento.entidad === 'clinical_records' && consultas.has(id)) {
      const consulta = consultas.get(id);
      return `${textoPaciente(consulta)} · Consulta ${fechaHumana(consulta.fecha)}`;
    }
    if (evento.entidad === 'clinical_exams' && examenes.has(id)) {
      const examen = examenes.get(id);
      return `Examen: ${examen.nombre} · ${textoPaciente(examen)}`;
    }
    if (evento.entidad === 'clinical_attachments' && adjuntos.has(id)) {
      const adjunto = adjuntos.get(id);
      return `Archivo: ${adjunto.nombre}${
        adjunto.examen_nombre ? ` · Examen: ${adjunto.examen_nombre}` : ''
      } · ${textoPaciente(adjunto)}`;
    }
    if (evento.entidad === 'documents' && documentos.has(id)) {
      const documento = documentos.get(id);
      return `Documento: ${documento.titulo}${
        documento.codigo ? ` · ${documento.codigo}` : ''
      } · ${textoPaciente(documento)}`;
    }
    if (evento.entidad === 'prescriptions' && recetas.has(id)) {
      const receta = recetas.get(id);
      return `Receta · ${textoPaciente(receta)} · ${fechaHumana(
        `${receta.fecha}T${receta.hora || '00:00'}`
      )}`;
    }
    if (evento.entidad === 'crm_tasks' && tareas.has(id)) {
      const tarea = tareas.get(id);
      return `${tarea.tipo || 'Solicitud'}: ${tarea.motivo} · ${textoPaciente(tarea)}`;
    }
    if (evento.entidad === 'crm_messages' && mensajes.has(id)) {
      const mensaje = mensajes.get(id);
      return `Mensaje: ${String(mensaje.contenido || '').slice(0, 90)} · ${textoPaciente(
        mensaje
      )}`;
    }
    if (evento.entidad === 'patients' && pacientes.has(id)) {
      return textoPaciente(pacientes.get(id));
    }
    if (evento.entidad === 'users' && usuarios.has(id)) {
      const usuario = usuarios.get(id);
      if (accion === 'perfil_actualizado' || accion === 'password_cambiada' ||
          accion === 'password_restablecida' ||
          accion === 'firma_medico_guardada' || accion === 'firma_medico_eliminada' ||
          accion === 'foto_actualizada' || accion === 'foto_eliminada') {
        return '';
      }
      return `Usuario: ${usuario.nombre}${usuario.rol ? ` · ${usuario.rol}` : ''}`;
    }
    if (evento.entidad === 'templates' && plantillas.has(id)) {
      return `Plantilla: ${plantillas.get(id).nombre}`;
    }
    if (evento.entidad === 'migration_runs' && migraciones.has(id)) {
      return `Archivo: ${migraciones.get(id).nombre_archivo || 'migración'}`;
    }
    if (evento.entidad === 'patient_share_links' && enlaces.has(id)) {
      return `Enlace de documentos · ${textoPaciente(enlaces.get(id))}`;
    }
    if (evento.entidad === 'settings') {
      return `Configuración: ${ETIQUETAS_CONFIG[id] || id || 'sistema'}`;
    }

    // Entidades eliminadas: se intenta reconstruir con el detalle guardado.
    const nombre = detalle.nombre || detalle.titulo || detalle.motivo;
    const pacienteDetalle =
      (detalle.patientId && pacientes.get(detalle.patientId)) ||
      (detalle.recordId && consultas.get(detalle.recordId)) ||
      (detalle.appointmentId && citas.get(detalle.appointmentId)) ||
      (detalle.examId && examenes.get(detalle.examId));

    if (nombre) {
      return `${nombre}${pacienteDetalle ? ` · ${textoPaciente(pacienteDetalle)}` : ''}`;
    }
    if (pacienteDetalle) return textoPaciente(pacienteDetalle);
    return '';
  }

  return eventos.map((evento, indice) => ({
    ...evento,
    modulo: evento.modulo || moduloDe(evento.accion, evento.entidad),
    accion_tipo: evento.accion_tipo || tipoAccionDe(evento.accion),
    paciente: textoPaciente(pacienteDe(evento, detalles[indice])),
    referencia: referencia(evento, detalles[indice]),
    detalle_legible: detalleLegible(evento.detalle),
  }));
}

function rangoDia(fecha) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
    ? String(fecha)
    : fechaActual();
  const inicio = new Date(`${dia}T00:00:00-05:00`);
  const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { dia, inicio: inicio.toISOString(), fin: fin.toISOString() };
}

export function routes(router) {
  router.get('/api/reports/users', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.REPORTES_VER);

    const { dia, inicio, fin } = rangoDia(ctx.url.searchParams.get('fecha'));
    const ahora = nowIso();

    const filas = db
      .prepare(
        `SELECT u.id, u.nombre, u.rol, u.activo,
                COUNT(a.id) AS eventos,
                SUM(CASE WHEN a.accion = 'login' THEN 1 ELSE 0 END) AS inicios,
                SUM(CASE WHEN a.accion = 'logout' THEN 1 ELSE 0 END) AS cierres,
                MAX(a.creado_en) AS ultimo,
                CASE WHEN EXISTS(
                  SELECT 1 FROM sessions s
                  WHERE s.user_id = u.id AND s.expira_en > ?
                ) THEN 1 ELSE 0 END AS sesion_activa
         FROM users u
         LEFT JOIN audit_log a
           ON a.user_id = u.id
          AND a.creado_en >= ?
          AND a.creado_en < ?
         WHERE u.activo = 1 OR a.id IS NOT NULL
         GROUP BY u.id
         ORDER BY eventos DESC, u.nombre COLLATE NOCASE`
      )
      .all(ahora, inicio, fin)
      .map((fila) => ({
        ...fila,
        eventos: Number(fila.eventos || 0),
        inicios: Number(fila.inicios || 0),
        cierres: Number(fila.cierres || 0),
        sesion_activa: Boolean(fila.sesion_activa),
      }));

    const resumen = {
      fecha: dia,
      eventos: filas.reduce((total, fila) => total + fila.eventos, 0),
      usuariosActivos: filas.filter((fila) => fila.eventos > 0).length,
      inicios: filas.reduce((total, fila) => total + fila.inicios, 0),
      ultimo:
        filas
          .map((fila) => fila.ultimo)
          .filter(Boolean)
          .sort()
          .at(-1) || null,
    };

    return { ...resumen, usuarios: filas };
  });

  // Registro de actividad global, con filtro opcional por usuario.
  router.get('/api/reports/activity', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.REPORTES_VER);

    const { dia, inicio, fin } = rangoDia(ctx.url.searchParams.get('fecha'));
    const usuarioId = String(ctx.url.searchParams.get('usuario') || '').trim();
    const modulo = String(ctx.url.searchParams.get('modulo') || '').trim();
    const accionTipo = String(ctx.url.searchParams.get('accion') || '').trim();
    const limite = Math.min(
      Math.max(Number(ctx.url.searchParams.get('limit') || 5000), 1),
      5000
    );

    let objetivo = null;
    if (usuarioId) {
      objetivo = db
        .prepare('SELECT id, nombre, rol, activo FROM users WHERE id = ?')
        .get(usuarioId);
      if (!objetivo) throw new HttpError(404, 'Usuario no encontrado');
    }

    const todos = enriquecerEventos(
      db
        .prepare(
          `SELECT a.id, a.user_id AS usuario_id, u.nombre AS usuario_nombre,
                  a.accion, a.accion_tipo, a.entidad, a.entidad_id, a.modulo,
                  a.detalle, a.creado_en
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
           WHERE a.creado_en >= ? AND a.creado_en < ?
             ${objetivo ? 'AND a.user_id = ?' : ''}
           ORDER BY a.creado_en DESC
           LIMIT ?`
        )
        .all(...(objetivo ? [inicio, fin, objetivo.id, limite] : [inicio, fin, limite]))
    );

    const filtros = {
      modulos: [...MODULOS_SISTEMA],
      acciones: [...TIPOS_ACCION],
    };
    const eventos = todos.filter(
      (evento) =>
        (!modulo || evento.modulo === modulo) &&
        (!accionTipo || evento.accion_tipo === accionTipo)
    );

    return { fecha: dia, usuario: objetivo, filtros, eventos };
  });

  router.get('/api/reports/users/:id/activity', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.REPORTES_VER);

    const objetivo = db
      .prepare('SELECT id, nombre, rol, activo FROM users WHERE id = ?')
      .get(ctx.params.id);
    if (!objetivo) throw new HttpError(404, 'Usuario no encontrado');

    const { dia, inicio, fin } = rangoDia(ctx.url.searchParams.get('fecha'));
    const limite = Math.min(
      Math.max(Number(ctx.url.searchParams.get('limit') || 500), 1),
      1000
    );

    const eventos = enriquecerEventos(
      db
        .prepare(
          `SELECT id, accion, accion_tipo, entidad, entidad_id, modulo, detalle, creado_en
           FROM audit_log
           WHERE user_id = ? AND creado_en >= ? AND creado_en < ?
           ORDER BY creado_en DESC
           LIMIT ?`
        )
        .all(objetivo.id, inicio, fin, limite)
    );

    return { fecha: dia, usuario: objetivo, eventos };
  });

  router.post('/api/reports/users/:id/close-sessions', (ctx) => {
    const admin = requireUser(ctx);
    exigir(admin, PERMISOS.REPORTES_VER);

    const objetivo = db
      .prepare('SELECT id, nombre FROM users WHERE id = ?')
      .get(ctx.params.id);
    if (!objetivo) throw new HttpError(404, 'Usuario no encontrado');

    const sesiones = db
      .prepare('SELECT id FROM sessions WHERE user_id = ?')
      .all(objetivo.id)
      .map((sesion) => sesion.id);

    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(objetivo.id);
    cerrarSesionesTiempoReal(sesiones, 'revocada_por_admin');

    audit(admin.id, 'sesiones_revocadas', 'users', objetivo.id, {
      sesiones: sesiones.length,
      usuario: objetivo.nombre,
    });

    return { ok: true, cerradas: sesiones.length };
  });
}
