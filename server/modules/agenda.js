import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, nowIso, sha256, tx, uid } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { requireUser } from './auth.js';
import { calcularEdad, esMenorDeEdad } from '../lib/edad.js';
import { permitirCitasSimultaneas } from '../lib/ajustes.js';
import { nombreArchivoSeguro, parseArchivoDataUrl } from '../lib/files.js';
import { enviarConfirmacionCita, whatsappAuto } from '../lib/whatsapp.js';

const ESTADOS = [
  'programada',
  'confirmada',
  'en_progreso',
  'atendida',
  'cancelada',
  'reagendada',
  'no_asistio',
];
const TIPOS_EXAMEN = ['clinico', 'laboratorio', 'imagen', 'otro'];
const MAX_ADJUNTO = 8 * 1024 * 1024;
const MAX_DOCUMENTOS_PACIENTE = 10;

function limpiar(valor, max = 500) {
  return String(valor ?? '').trim().slice(0, max);
}

function construirFiltroCarpetas(params, alias = 'p') {
  const q = limpiar(params.get('q'), 80);
  const nombre = limpiar(params.get('nombre'), 80);
  const apellido = limpiar(params.get('apellido'), 80);
  const cedula = limpiar(params.get('cedula'), 30);
  const condiciones = [];
  const valores = [];

  if (q) {
    const like = `%${q}%`;
    condiciones.push(
      `(sin_tildes(${alias}.nombres || ' ' || ${alias}.apellidos) LIKE sin_tildes(?) OR ${alias}.cedula LIKE ?)`
    );
    valores.push(like, like);
  }
  if (nombre) {
    condiciones.push(`sin_tildes(${alias}.nombres) LIKE sin_tildes(?)`);
    valores.push(`%${nombre}%`);
  }
  if (apellido) {
    condiciones.push(`sin_tildes(${alias}.apellidos) LIKE sin_tildes(?)`);
    valores.push(`%${apellido}%`);
  }
  if (cedula) {
    condiciones.push(`${alias}.cedula LIKE ?`);
    valores.push(`%${cedula}%`);
  }

  return {
    sql: condiciones.length ? `AND ${condiciones.join(' AND ')}` : '',
    valores,
  };
}

function parseFechaHora(valor, mensaje = 'La fecha y hora no son válidas') {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) throw new HttpError(400, mensaje);
  return fecha.toISOString();
}

function parseDuracion(valor) {
  const numero = Number(valor || 30);
  if (!Number.isFinite(numero) || numero < 5 || numero > 240) {
    throw new HttpError(400, 'La duración debe estar entre 5 y 240 minutos');
  }
  return Math.round(numero);
}

function validarEstado(valor, porDefecto = 'programada') {
  const estado = String(valor || porDefecto).trim();
  if (!ESTADOS.includes(estado)) throw new HttpError(400, 'Estado de cita no válido');
  return estado;
}

function medicoValido(medicoId) {
  if (!medicoId) return null;
  const medico = db
    .prepare("SELECT id, nombre FROM users WHERE id = ? AND rol = 'medico' AND activo = 1")
    .get(medicoId);
  if (!medico) throw new HttpError(400, 'El médico seleccionado no es válido');
  return medico;
}

function pacienteValido(patientId) {
  const id = String(patientId || '').trim();
  if (!id) throw new HttpError(400, 'Selecciona una paciente válida');

  const paciente = db
    .prepare('SELECT id, nombres, apellidos, cedula FROM patients WHERE id = ? AND activo = 1')
    .get(id);
  if (!paciente) throw new HttpError(400, 'Selecciona una paciente válida');
  return paciente;
}

function hayConflicto({
  medicoId,
  fechaHora,
  duracionMin,
  excluirId = null,
  cupo = null,
  tipo = 'normal',
}) {
  if (!medicoId) return null;

  const inicio = new Date(fechaHora).getTime();
  const fin = inicio + duracionMin * 60000;
  const margen = 6 * 60 * 60 * 1000;
  const desde = new Date(inicio - margen).toISOString();
  const hasta = new Date(fin + margen).toISOString();

  const condiciones = [
    'medico_id = ?',
    "estado NOT IN ('cancelada', 'no_asistio')",
    'fecha_hora >= ? AND fecha_hora <= ?',
  ];
  const valores = [medicoId, desde, hasta];
  if (excluirId) {
    condiciones.push('id != ?');
    valores.push(excluirId);
  }
  // Turnos de la jornada comparten el horario: solo se compara por cupo,
  // para permitir hasta `cupos_por_hora` pacientes en la misma hora.
  if (tipo === 'normal' && cupo != null) {
    condiciones.push('COALESCE(cupo, 1) = ?');
    valores.push(cupo);
  }

  const citas = db
    .prepare(
      `SELECT id, fecha_hora, duracion_min, motivo
       FROM appointments
       WHERE ${condiciones.join(' AND ')}`
    )
    .all(...valores);

  for (const cita of citas) {
    const citaInicio = new Date(cita.fecha_hora).getTime();
    const citaFin = citaInicio + cita.duracion_min * 60000;
    if (inicio < citaFin && fin > citaInicio) return cita;
  }

  return null;
}

function rangoFecha(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return null;
  const inicio = new Date(`${fecha}T00:00:00`);
  const fin = new Date(`${fecha}T23:59:59.999`);
  if (Number.isNaN(inicio.getTime())) return null;
  return { desde: inicio.toISOString(), hasta: fin.toISOString() };
}

function limiteFecha(valor, fin = false) {
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(valor))) {
    const fecha = new Date(`${valor}T${fin ? '23:59:59.999' : '00:00:00'}`);
    return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
  }
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function citaMapeada(fila) {
  if (!fila) return fila;
  return {
    ...fila,
    fecha_nacimiento: fila.fecha_nacimiento || null,
    edad: calcularEdad(fila.fecha_nacimiento),
    es_menor: esMenorDeEdad(fila.fecha_nacimiento),
    paciente: {
      id: fila.patient_id,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      cedula: fila.paciente_cedula,
      fecha_nacimiento: fila.fecha_nacimiento || null,
      edad: calcularEdad(fila.fecha_nacimiento),
      es_menor: esMenorDeEdad(fila.fecha_nacimiento),
    },
    medico: fila.medico_id
      ? { id: fila.medico_id, nombre: fila.medico_nombre || '' }
      : null,
  };
}

/**
 * Estado del consentimiento de una cita de un paciente menor.
 * Prefiere el documento enlazado a la cita; si no existe, acepta uno del
 * mismo día (consentimientos creados antes de enlazarlos).
 */
function consentimientoDeCita(cita) {
  if (!cita?.es_menor) return null;

  const fila = db
    .prepare(
      `SELECT d.id, d.titulo, d.estado, d.creado_en
       FROM documents d
       WHERE d.appointment_id = ?
          OR (
            d.appointment_id IS NULL
            AND d.patient_id = ?
            AND substr(d.creado_en, 1, 10) = substr(?, 1, 10)
          )
       ORDER BY CASE WHEN d.appointment_id = ? THEN 0 ELSE 1 END, d.creado_en DESC
       LIMIT 1`
    )
    .get(cita.id, cita.patient_id, cita.fecha_hora, cita.id);

  if (!fila) {
    return { id: null, estado: 'sin_generar', firmado: false, titulo: null };
  }

  return {
    id: fila.id,
    titulo: fila.titulo,
    estado: fila.estado,
    firmado: fila.estado === 'firmado',
    creadoEn: fila.creado_en,
  };
}

function conConsentimiento(cita) {
  return { ...cita, consentimiento: consentimientoDeCita(cita) };
}

function datosClinicosDe(recordIds) {
  const adjuntosPorRegistro = new Map();
  const examenesPorRegistro = new Map();
  if (!recordIds.length) return { adjuntosPorRegistro, examenesPorRegistro };

  const marcadores = recordIds.map(() => '?').join(', ');
  const adjuntos = db
    .prepare(
      `SELECT id, record_id, exam_id, nombre, mime, tamano, creado_en, subido_por
       FROM clinical_attachments
       WHERE record_id IN (${marcadores})
       ORDER BY creado_en ASC`
    )
    .all(...recordIds);

  const examenes = db
    .prepare(
      `SELECT * FROM clinical_exams
       WHERE record_id IN (${marcadores})
       ORDER BY creado_en ASC`
    )
    .all(...recordIds);

  const adjuntosPorExamen = new Map();
  for (const adjunto of adjuntos) {
    if (!adjuntosPorRegistro.has(adjunto.record_id)) {
      adjuntosPorRegistro.set(adjunto.record_id, []);
    }
    adjuntosPorRegistro.get(adjunto.record_id).push(adjunto);

    if (adjunto.exam_id) {
      if (!adjuntosPorExamen.has(adjunto.exam_id)) adjuntosPorExamen.set(adjunto.exam_id, []);
      adjuntosPorExamen.get(adjunto.exam_id).push(adjunto);
    }
  }

  for (const examen of examenes) {
    const item = { ...examen, adjuntos: adjuntosPorExamen.get(examen.id) || [] };
    if (!examenesPorRegistro.has(examen.record_id)) examenesPorRegistro.set(examen.record_id, []);
    examenesPorRegistro.get(examen.record_id).push(item);
  }

  return { adjuntosPorRegistro, examenesPorRegistro };
}

function datosParseados(valor) {
  if (!valor) return null;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}

function serializarDatos(valor) {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  try {
    return JSON.stringify(valor);
  } catch {
    return null;
  }
}

function diagnosticoDeDatos(datos) {
  if (!datos || !Array.isArray(datos.diagnosticos)) return '';
  return datos.diagnosticos
    .map((item) => `${item.cie || ''} ${item.desc || ''}`.trim())
    .filter(Boolean)
    .join('; ')
    .slice(0, 5000);
}

function columnasClinicas(datos) {
  if (!datos || typeof datos !== 'object') return null;
  return {
    enfermedad_actual: limpiar(datos.enfermedad_actual, 5000) || null,
    pa_sis: limpiar(datos.pa_sis, 20) || null,
    pa_dia: limpiar(datos.pa_dia, 20) || null,
    fc: limpiar(datos.fc, 20) || null,
    fr: limpiar(datos.fr, 20) || null,
    temp: limpiar(datos.temp, 20) || null,
    sat: limpiar(datos.sat, 20) || null,
    peso: limpiar(datos.peso, 20) || null,
    talla: limpiar(datos.talla, 20) || null,
    imc:
      limpiar(datos.imc, 20) ||
      (Number(datos.peso) > 0 && Number(datos.talla) > 0
        ? (Number(datos.peso) / (Number(datos.talla) / 100) ** 2).toFixed(1)
        : null),
    fum: limpiar(datos.fum, 20) || null,
    embarazo: datos.embarazo ? 1 : 0,
    eg: limpiar(datos.eg, 80) || null,
    fpp: limpiar(datos.fpp, 20) || null,
    au: limpiar(datos.au, 20) || null,
    fcf: limpiar(datos.fcf, 20) || null,
    presentacion: limpiar(datos.presentacion, 120) || null,
    edemas: limpiar(datos.edemas, 200) || null,
    examen_fisico: limpiar(datos.examen_fisico, 5000) || null,
    examen_gineco: limpiar(datos.examen_gineco, 5000) || null,
    plan: limpiar(datos.plan, 5000) || null,
    proxima_cita: limpiar(datos.proxima_cita, 20) || null,
  };
}

function sincronizarDiagnosticos(recordId, diagnosticos, creadoEn) {
  db.prepare('DELETE FROM clinical_diagnoses WHERE record_id = ?').run(recordId);
  if (!Array.isArray(diagnosticos)) return;

  let orden = 0;
  for (const item of diagnosticos) {
    const cie = limpiar(item?.cie, 20) || null;
    const descripcion = limpiar(item?.desc, 500) || null;
    if (!cie && !descripcion) continue;
    orden += 1;
    db.prepare(
      `INSERT INTO clinical_diagnoses
         (id, record_id, cie10, descripcion, tipo, orden, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(uid(), recordId, cie, descripcion, item?.tipo === 'DEF' ? 'DEF' : 'PRE', orden, creadoEn);
  }
}

function actualizarFumPaciente(patientId, fum) {
  if (!patientId || !/^\d{4}-\d{2}-\d{2}$/.test(String(fum || ''))) return;
  db.prepare('UPDATE patients SET fum = ? WHERE id = ?').run(fum, patientId);
}

function historiaCompleta(historia) {
  if (!historia) return null;
  const { adjuntosPorRegistro, examenesPorRegistro } = datosClinicosDe([historia.id]);
  const diagnosticos = db
    .prepare(
      `SELECT cie10 AS cie, descripcion AS desc, tipo
       FROM clinical_diagnoses
       WHERE record_id = ?
       ORDER BY orden ASC, creado_en ASC`
    )
    .all(historia.id);

  const datos = datosParseados(historia.datos) || {
    motivo: historia.motivo_consulta || '',
    enfermedad_actual: historia.enfermedad_actual || '',
    pa_sis: historia.pa_sis || '',
    pa_dia: historia.pa_dia || '',
    fc: historia.fc || '',
    fr: historia.fr || '',
    temp: historia.temp || '',
    sat: historia.sat || '',
    peso: historia.peso || '',
    talla: historia.talla || '',
    imc: historia.imc || '',
    fum: historia.fum || '',
    embarazo: historia.embarazo ? 1 : 0,
    eg: historia.eg || '',
    fpp: historia.fpp || '',
    au: historia.au || '',
    fcf: historia.fcf || '',
    presentacion: historia.presentacion || '',
    edemas: historia.edemas || '',
    examen_fisico: historia.examen_fisico || '',
    examen_gineco: historia.examen_gineco || '',
    plan: historia.plan || '',
    indicaciones: historia.indicaciones || '',
    proxima_cita: historia.proxima_cita || '',
    diagnosticos,
  };

  if (diagnosticos.length) datos.diagnosticos = diagnosticos;
  else if (historia.diagnostico) {
    datos.diagnosticos = [{ cie: '', desc: historia.diagnostico, tipo: '' }];
  }

  const addenda = db
    .prepare(
      `SELECT ca.id, ca.texto, ca.creado_en, ca.usuario_id, u.nombre AS usuario_nombre
       FROM clinical_addenda ca
       LEFT JOIN users u ON u.id = ca.usuario_id
       WHERE ca.record_id = ?
       ORDER BY ca.creado_en ASC`
    )
    .all(historia.id);

  return {
    ...historia,
    datos,
    diagnosticos,
    addenda,
    consulta_finalizada: historia.cita_estado === 'atendida',
    adjuntos: (adjuntosPorRegistro.get(historia.id) || []).filter((a) => !a.exam_id),
    examenes: examenesPorRegistro.get(historia.id) || [],
  };
}

/** Actualiza la marca de última modificación de la historia clínica. */
function marcarHistoriaModificada(recordId, userId, fecha = nowIso()) {
  db.prepare(
    'UPDATE clinical_records SET actualizado_en = ?, actualizado_por = ? WHERE id = ?'
  ).run(fecha, userId, recordId);
}

function validarPropietario(user, cita) {
  if (user.rol === 'medico' && cita.medico_id && cita.medico_id !== user.id) {
    throw new HttpError(403, 'Esta cita pertenece a otro médico');
  }
}

const DESFASE_ECUADOR_MS = 5 * 60 * 60 * 1000;

function fechaLocalEcuador(fechaHora) {
  return new Date(new Date(fechaHora).getTime() - DESFASE_ECUADOR_MS);
}

function jornadaDe(fechaHora) {
  const hora = fechaLocalEcuador(fechaHora).getUTCHours();
  return hora < 12 ? 'manana' : 'tarde';
}

function lunesDe(fecha) {
  const copia = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate())
  );
  const dia = (copia.getUTCDay() + 6) % 7;
  copia.setUTCDate(copia.getUTCDate() - dia);
  return copia;
}

function clavePeriodo(fechaHora, periodo) {
  const local = fechaLocalEcuador(fechaHora);
  if (periodo === 'mes') return local.toISOString().slice(0, 7);
  if (periodo === 'semana') return lunesDe(local).toISOString().slice(0, 10);
  return local.toISOString().slice(0, 10);
}

function etiquetaDiaCorta(clave) {
  const [, mes, dia] = clave.split('-');
  return `${dia}/${mes}`;
}

function etiquetaMesCorta(clave) {
  return new Date(`${clave}-01T00:00:00Z`)
    .toLocaleDateString('es-EC', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .replace('.', '');
}

function construirSerieCitas(periodo) {
  const hoyLocal = fechaLocalEcuador(new Date());
  const hoy = new Date(
    Date.UTC(hoyLocal.getUTCFullYear(), hoyLocal.getUTCMonth(), hoyLocal.getUTCDate())
  );
  const puntos = [];

  if (periodo === 'semana') {
    const lunes = lunesDe(hoy);
    for (let i = -6; i <= 5; i += 1) {
      const fecha = new Date(lunes);
      fecha.setUTCDate(fecha.getUTCDate() + i * 7);
      const clave = fecha.toISOString().slice(0, 10);
      puntos.push({
        clave,
        etiqueta: `Sem ${etiquetaDiaCorta(clave)}`,
        desde: `${clave}T00:00:00-05:00`,
      });
    }
  } else if (periodo === 'mes') {
    for (let i = -6; i <= 5; i += 1) {
      const fecha = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + i, 1));
      const clave = fecha.toISOString().slice(0, 7);
      puntos.push({
        clave,
        etiqueta: etiquetaMesCorta(clave),
        desde: `${clave}-01T00:00:00-05:00`,
      });
    }
  } else {
    for (let i = -7; i <= 6; i += 1) {
      const fecha = new Date(hoy);
      fecha.setUTCDate(fecha.getUTCDate() + i);
      const clave = fecha.toISOString().slice(0, 10);
      puntos.push({
        clave,
        etiqueta: etiquetaDiaCorta(clave),
        desde: `${clave}T00:00:00-05:00`,
      });
    }
  }

  const inicio = new Date(puntos[0].desde);
  const fin = new Date(puntos[puntos.length - 1].desde);
  if (periodo === 'semana') fin.setUTCDate(fin.getUTCDate() + 7);
  else if (periodo === 'mes') fin.setUTCMonth(fin.getUTCMonth() + 1);
  else fin.setUTCDate(fin.getUTCDate() + 1);

  const filas = db
    .prepare(
      `SELECT a.fecha_hora, a.patient_id
       FROM appointments a
       WHERE a.estado NOT IN ('cancelada', 'no_asistio')
         AND a.fecha_hora >= ? AND a.fecha_hora < ?`
    )
    .all(inicio.toISOString(), fin.toISOString());

  const mapa = new Map(
    puntos.map((punto) => [punto.clave, { citas: 0, pacientes: new Set() }])
  );

  for (const fila of filas) {
    const item = mapa.get(clavePeriodo(fila.fecha_hora, periodo));
    if (!item) continue;
    item.citas += 1;
    item.pacientes.add(fila.patient_id);
  }

  return puntos.map((punto) => ({
    clave: punto.clave,
    etiqueta: punto.etiqueta,
    citas: mapa.get(punto.clave).citas,
    pacientes: mapa.get(punto.clave).pacientes.size,
  }));
}

function contarCitasRango(desde, hasta) {
  return db
    .prepare(
      `SELECT COUNT(*) AS citas, COUNT(DISTINCT patient_id) AS pacientes
       FROM appointments
       WHERE estado NOT IN ('cancelada', 'no_asistio')
         AND fecha_hora >= ? AND fecha_hora < ?`
    )
    .get(desde, hasta);
}

function rangoDesdeHoy(dias) {
  const hoyLocal = fechaLocalEcuador(new Date());
  const clave = hoyLocal.toISOString().slice(0, 10);
  const desde = new Date(`${clave}T00:00:00-05:00`);
  const hasta = new Date(desde);
  hasta.setUTCDate(hasta.getUTCDate() + dias);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

function rangoDashboard(diasAtras, diasAdelante) {
  const hoyLocal = fechaLocalEcuador(new Date());
  const clave = hoyLocal.toISOString().slice(0, 10);
  const desde = new Date(`${clave}T00:00:00-05:00`);
  desde.setUTCDate(desde.getUTCDate() - diasAtras);
  const hasta = new Date(`${clave}T00:00:00-05:00`);
  hasta.setUTCDate(hasta.getUTCDate() + diasAdelante + 1);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

function citaDetalle(id) {
  const fila = db
    .prepare(
      `SELECT a.*, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
              p.fecha_nacimiento, p.sexo, p.alergias, p.telefono, p.email, p.direccion,
              p.representante1_nombre, p.representante1_cedula,
              u.nombre AS medico_nombre, u.especialidad AS medico_especialidad
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN users u ON u.id = a.medico_id
       WHERE a.id = ?`
    )
    .get(id);
  if (!fila) throw new HttpError(404, 'Cita no encontrada');

  const historia = db
    .prepare(
      `SELECT cr.*,
              ua.nombre AS actualizado_por_nombre,
              um.nombre AS medico_nombre
       FROM clinical_records cr
       LEFT JOIN users ua ON ua.id = cr.actualizado_por
       LEFT JOIN users um ON um.id = cr.medico_id
       WHERE cr.appointment_id = ?`
    )
    .get(id);

  const notificaciones = db
    .prepare(
      `SELECT id, canal, destino, plantilla, estado, proveedor_id, error, creado_en
       FROM appointment_notifications
       WHERE appointment_id = ?
       ORDER BY creado_en DESC
       LIMIT 5`
    )
    .all(id);

  const documentosPaciente = db
    .prepare('SELECT COUNT(*) AS n FROM clinical_attachments WHERE patient_id = ?')
    .get(fila.patient_id).n;

  return {
    ...conConsentimiento(citaMapeada(fila)),
    historia: historiaCompleta(historia),
    notificaciones,
    documentosPaciente,
  };
}

export function routes(router) {
  // Carpetas de historia clínica: pacientes con sus indicadores principales.
  router.get('/api/clinical-history/patients', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const params = ctx.url.searchParams;
    const filtro = construirFiltroCarpetas(params);
    const limit = Math.min(Number(params.get('limit') || 200), 1000);
    const ahora = nowIso();

    const filas = db
      .prepare(
        `SELECT p.id, p.nombres, p.apellidos, p.cedula, p.fecha_nacimiento, p.sexo, p.telefono,
                COALESCE(h.total_historias, 0) AS total_historias,
                h.ultima_historia,
                COALESCE(e.examenes_pendientes, 0) AS examenes_pendientes,
                c.proxima_cita,
                COALESCE(c.total_citas, 0) AS total_citas
         FROM patients p
         LEFT JOIN (
           SELECT patient_id, COUNT(*) AS total_historias, MAX(fecha) AS ultima_historia
           FROM clinical_records
           GROUP BY patient_id
         ) h ON h.patient_id = p.id
         LEFT JOIN (
           SELECT cr.patient_id, COUNT(*) AS examenes_pendientes
           FROM clinical_exams ce
           JOIN clinical_records cr ON cr.id = ce.record_id
           WHERE ce.estado != 'evaluado'
           GROUP BY cr.patient_id
         ) e ON e.patient_id = p.id
         LEFT JOIN (
           SELECT patient_id,
                  COUNT(*) AS total_citas,
                  MIN(CASE
                        WHEN fecha_hora >= ? AND estado NOT IN ('cancelada', 'no_asistio')
                        THEN fecha_hora
                      END) AS proxima_cita
           FROM appointments
           GROUP BY patient_id
         ) c ON c.patient_id = p.id
         WHERE p.activo = 1
           ${filtro.sql}
         ORDER BY p.apellidos COLLATE NOCASE, p.nombres COLLATE NOCASE
         LIMIT ?`
      )
      .all(ahora, ...filtro.valores, limit);

    return filas.map((fila) => ({
      ...fila,
      edad: calcularEdad(fila.fecha_nacimiento),
      es_menor: esMenorDeEdad(fila.fecha_nacimiento),
    }));
  });

  router.get('/api/clinical-history/patients/paginated', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const params = ctx.url.searchParams;
    const filtro = construirFiltroCarpetas(params);
    const ahora = nowIso();
    const ordenes = {
      nombre_asc: 'p.apellidos COLLATE NOCASE ASC, p.nombres COLLATE NOCASE ASC',
      nombre_desc: 'p.apellidos COLLATE NOCASE DESC, p.nombres COLLATE NOCASE DESC',
      cedula_asc: 'p.cedula ASC',
      cedula_desc: 'p.cedula DESC',
      fecha_desc:
        'hf.ultima_historia DESC, p.apellidos COLLATE NOCASE ASC, p.nombres COLLATE NOCASE ASC',
      fecha_asc:
        'hf.ultima_historia ASC, p.apellidos COLLATE NOCASE ASC, p.nombres COLLATE NOCASE ASC',
    };
    const orden = ordenes[String(params.get('orden') || 'nombre_asc')]
      ? String(params.get('orden') || 'nombre_asc')
      : 'nombre_asc';
    const unirFecha = orden.startsWith('fecha')
      ? `LEFT JOIN (
           SELECT patient_id, MAX(fecha) AS ultima_historia
           FROM clinical_records
           GROUP BY patient_id
         ) hf ON hf.patient_id = p.id`
      : '';
    const limit = Math.min(Math.max(Number(params.get('limit') || 24), 1), 100);
    const total = db
      .prepare(
        `SELECT COUNT(*) AS n FROM patients p
         WHERE p.activo = 1
           ${filtro.sql}`
      )
      .get(...filtro.valores).n;
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(Number(params.get('page') || 1), 1), pages);

    const filas = db
      .prepare(
        `SELECT p.id, p.nombres, p.apellidos, p.cedula, p.fecha_nacimiento, p.sexo, p.telefono
         FROM patients p
         ${unirFecha}
         WHERE p.activo = 1
           ${filtro.sql}
         ORDER BY ${ordenes[orden]}
         LIMIT ? OFFSET ?`
      )
      .all(...filtro.valores, limit, (page - 1) * limit);

    if (!filas.length) {
      return { items: [], total, page, pages, limit };
    }

    const ids = filas.map((fila) => fila.id);
    const marcadores = ids.map(() => '?').join(', ');
    const historias = new Map(
      db
        .prepare(
          `SELECT patient_id, COUNT(*) AS total_historias, MAX(fecha) AS ultima_historia
           FROM clinical_records
           WHERE patient_id IN (${marcadores})
           GROUP BY patient_id`
        )
        .all(...ids)
        .map((fila) => [fila.patient_id, fila])
    );
    const examenes = new Map(
      db
        .prepare(
          `SELECT cr.patient_id, COUNT(*) AS examenes_pendientes
           FROM clinical_exams ce
           JOIN clinical_records cr ON cr.id = ce.record_id
           WHERE ce.estado != 'evaluado'
             AND cr.patient_id IN (${marcadores})
           GROUP BY cr.patient_id`
        )
        .all(...ids)
        .map((fila) => [fila.patient_id, fila])
    );
    const citas = new Map(
      db
        .prepare(
          `SELECT patient_id,
                  COUNT(*) AS total_citas,
                  MIN(CASE
                        WHEN fecha_hora >= ? AND estado NOT IN ('cancelada', 'no_asistio')
                        THEN fecha_hora
                      END) AS proxima_cita
           FROM appointments
           WHERE patient_id IN (${marcadores})
           GROUP BY patient_id`
        )
        .all(ahora, ...ids)
        .map((fila) => [fila.patient_id, fila])
    );

    return {
      items: filas.map((fila) => ({
        ...fila,
        total_historias: historias.get(fila.id)?.total_historias || 0,
        ultima_historia: historias.get(fila.id)?.ultima_historia || null,
        examenes_pendientes: examenes.get(fila.id)?.examenes_pendientes || 0,
        total_citas: citas.get(fila.id)?.total_citas || 0,
        proxima_cita: citas.get(fila.id)?.proxima_cita || null,
        edad: calcularEdad(fila.fecha_nacimiento),
        es_menor: esMenorDeEdad(fila.fecha_nacimiento),
      })),
      total,
      page,
      pages,
      limit,
    };
  });

  router.get('/api/appointments', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_VER);

    const params = ctx.url.searchParams;
    const q = limpiar(params.get('q'), 80);
    const estado = String(params.get('estado') || '').trim();
    // Los médicos ven únicamente su propia agenda.
    const medicoId =
      user.rol === 'medico' ? user.id : String(params.get('medicoId') || '').trim();
    const patientId = String(params.get('patientId') || '').trim();
    const fecha = String(params.get('fecha') || '').trim();
    const limit = Math.min(Number(params.get('limit') || 300), 500);

    let desde = limiteFecha(params.get('desde'), false);
    let hasta = limiteFecha(params.get('hasta'), true);

    const rango = rangoFecha(fecha);
    if (rango) {
      desde = rango.desde;
      hasta = rango.hasta;
    } else if (!desde && !hasta && !patientId) {
      // Por defecto, la agenda muestra las próximas citas.
      desde = new Date().toISOString();
      hasta = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    }

    if (estado && !ESTADOS.includes(estado)) {
      throw new HttpError(400, 'Estado de cita no válido');
    }

    const like = `%${q}%`;
    const condiciones = [];
    const valores = [];

    if (q) {
      condiciones.push(
        `(sin_tildes(p.nombres || ' ' || p.apellidos) LIKE sin_tildes(?) OR p.cedula LIKE ?)`
      );
      valores.push(like, like);
    }
    if (estado) {
      condiciones.push('a.estado = ?');
      valores.push(estado);
    }
    if (medicoId) {
      condiciones.push('a.medico_id = ?');
      valores.push(medicoId);
    }
    if (patientId) {
      condiciones.push('a.patient_id = ?');
      valores.push(patientId);
    }
    if (desde) {
      condiciones.push('a.fecha_hora >= ?');
      valores.push(desde);
    }
    if (hasta) {
      condiciones.push('a.fecha_hora <= ?');
      valores.push(hasta);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const filas = db
      .prepare(
        `SELECT a.*, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
                p.fecha_nacimiento,
                u.nombre AS medico_nombre,
                cr.id AS historia_id, cr.fecha AS historia_fecha,
                (SELECT n.estado FROM appointment_notifications n
                  WHERE n.appointment_id = a.id ORDER BY n.creado_en DESC LIMIT 1)
                  AS ultima_notificacion_estado,
                (SELECT n.creado_en FROM appointment_notifications n
                  WHERE n.appointment_id = a.id ORDER BY n.creado_en DESC LIMIT 1)
                  AS ultima_notificacion_en
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.medico_id
         LEFT JOIN clinical_records cr ON cr.appointment_id = a.id
         ${where}
         ORDER BY a.fecha_hora ASC
         LIMIT ?`
      )
      .all(...valores, limit);

    return filas.map((fila) => conConsentimiento(citaMapeada(fila)));
  });

  // Resumen mensual para el calendario: totales por día y una vista previa
  // limitada para no saturar la cuadrícula.
  router.get('/api/appointments/calendar', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_VER);

    const params = ctx.url.searchParams;
    const q = limpiar(params.get('q'), 80);
    const estado = String(params.get('estado') || '').trim();
    const medicoId =
      user.rol === 'medico' ? user.id : String(params.get('medicoId') || '').trim();
    const patientId = String(params.get('patientId') || '').trim();
    const desde = limiteFecha(params.get('desde'), false);
    const hasta = limiteFecha(params.get('hasta'), true);
    const porDia = Math.min(Math.max(Number(params.get('porDia') || 3), 1), 6);
    const tzParam = params.get('tzOffset');
    const tzValor =
      tzParam === null || tzParam === '' ? new Date().getTimezoneOffset() : Number(tzParam);
    const tzOffset = Math.min(
      840,
      Math.max(-840, Number.isFinite(tzValor) ? tzValor : new Date().getTimezoneOffset())
    );

    if (!desde || !hasta) {
      throw new HttpError(400, 'El rango de fechas del calendario es obligatorio');
    }
    if (estado && !ESTADOS.includes(estado)) {
      throw new HttpError(400, 'Estado de cita no válido');
    }

    const like = `%${q}%`;
    const condiciones = ['a.fecha_hora >= ?', 'a.fecha_hora <= ?'];
    const valores = [desde, hasta];

    if (q) {
      condiciones.push(
        `(sin_tildes(p.nombres || ' ' || p.apellidos) LIKE sin_tildes(?) OR p.cedula LIKE ?)`
      );
      valores.push(like, like);
    }
    if (estado) {
      condiciones.push('a.estado = ?');
      valores.push(estado);
    }
    if (medicoId) {
      condiciones.push('a.medico_id = ?');
      valores.push(medicoId);
    }
    if (patientId) {
      condiciones.push('a.patient_id = ?');
      valores.push(patientId);
    }

    const filas = db
      .prepare(
        `SELECT a.*, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
                p.fecha_nacimiento,
                u.nombre AS medico_nombre,
                cr.id AS historia_id, cr.fecha AS historia_fecha
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.medico_id
         LEFT JOIN clinical_records cr ON cr.appointment_id = a.id
         WHERE ${condiciones.join(' AND ')}
         ORDER BY a.fecha_hora ASC
         LIMIT 20000`
      )
      .all(...valores);

    const grupos = new Map();
    const resumen = {
      total: filas.length,
      pendientes: 0,
      enProgreso: 0,
      atendidas: 0,
      canceladas: 0,
    };

    for (const fila of filas) {
      const local = new Date(new Date(fila.fecha_hora).getTime() - tzOffset * 60000);
      const fecha = local.toISOString().slice(0, 10);
      if (!grupos.has(fecha)) grupos.set(fecha, []);
      grupos.get(fecha).push(citaMapeada(fila));

      if (['programada', 'confirmada', 'reagendada'].includes(fila.estado)) {
        resumen.pendientes += 1;
      } else if (fila.estado === 'en_progreso') {
        resumen.enProgreso += 1;
      } else if (fila.estado === 'atendida') {
        resumen.atendidas += 1;
      } else if (['cancelada', 'no_asistio'].includes(fila.estado)) {
        resumen.canceladas += 1;
      }
    }

    const dias = [...grupos.entries()].map(([fecha, citas]) => ({
      fecha,
      total: citas.length,
      citas: citas.slice(0, porDia).map(conConsentimiento),
    }));

    return { dias, total: filas.length, resumen, porDia };
  });

  router.get('/api/appointments/dashboard', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_VER);

    const periodo = ['dia', 'semana', 'mes'].includes(ctx.url.searchParams.get('periodo'))
      ? ctx.url.searchParams.get('periodo')
      : 'dia';

    const hoy = rangoDesdeHoy(1);
    const proximos7 = rangoDesdeHoy(7);
    const proximos30 = rangoDesdeHoy(30);
    const hace365 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const hace180 = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

    const resumenHoy = contarCitasRango(hoy.desde, hoy.hasta);
    const resumen7 = contarCitasRango(proximos7.desde, proximos7.hasta);
    const resumen30 = contarCitasRango(proximos30.desde, proximos30.hasta);

    const embarazos = db
      .prepare(
        `SELECT COUNT(DISTINCT cr.patient_id) AS total
         FROM clinical_records cr
         JOIN appointments a ON a.id = cr.appointment_id
         WHERE a.estado NOT IN ('cancelada', 'no_asistio')
           AND a.fecha_hora >= ?
           AND (
             LOWER(COALESCE(cr.motivo_consulta, '')) LIKE '%embaraz%'
             OR LOWER(COALESCE(cr.diagnostico, '')) LIKE '%embaraz%'
             OR LOWER(COALESCE(a.motivo, '')) LIKE '%embaraz%'
             OR LOWER(COALESCE(cr.motivo_consulta, '')) LIKE '%gestaci%'
             OR LOWER(COALESCE(cr.diagnostico, '')) LIKE '%gestaci%'
             OR LOWER(COALESCE(a.motivo, '')) LIKE '%prenatal%'
           )`
      )
      .get(hace365).total;

    const motivos = db
      .prepare(
        `SELECT COALESCE(
                  NULLIF(TRIM(cr.motivo_consulta), ''),
                  NULLIF(TRIM(a.motivo), ''),
                  'Sin motivo'
                ) AS motivo,
                COUNT(*) AS total
         FROM clinical_records cr
         JOIN appointments a ON a.id = cr.appointment_id
         WHERE a.estado NOT IN ('cancelada', 'no_asistio')
           AND a.fecha_hora >= ?
         GROUP BY motivo
         ORDER BY total DESC
         LIMIT 8`
      )
      .all(hace180);

    const rangoGraficos = rangoDashboard(30, 30);

    const estados = db
      .prepare(
        `SELECT estado, COUNT(*) AS total
         FROM appointments
         WHERE fecha_hora >= ? AND fecha_hora < ?
         GROUP BY estado
         ORDER BY total DESC`
      )
      .all(rangoGraficos.desde, rangoGraficos.hasta);

    const medicos = db
      .prepare(
        `SELECT COALESCE(u.nombre, 'Sin médico asignado') AS nombre,
                COUNT(*) AS total
         FROM appointments a
         LEFT JOIN users u ON u.id = a.medico_id
         WHERE a.fecha_hora >= ? AND a.fecha_hora < ?
           AND a.estado NOT IN ('cancelada', 'no_asistio')
         GROUP BY u.id
         ORDER BY total DESC
         LIMIT 8`
      )
      .all(rangoGraficos.desde, rangoGraficos.hasta);

    const porHora = db
      .prepare(
        `SELECT CAST(strftime('%H', datetime(fecha_hora, '-5 hours')) AS INTEGER) AS hora,
                COUNT(*) AS total
         FROM appointments
         WHERE fecha_hora >= ? AND fecha_hora < ?
           AND estado NOT IN ('cancelada', 'no_asistio')
         GROUP BY hora
         ORDER BY hora`
      )
      .all(rangoGraficos.desde, rangoGraficos.hasta);

    const porDiaSemana = db
      .prepare(
        `SELECT CAST(strftime('%w', datetime(fecha_hora, '-5 hours')) AS INTEGER) AS dia,
                COUNT(*) AS total
         FROM appointments
         WHERE fecha_hora >= ? AND fecha_hora < ?
           AND estado NOT IN ('cancelada', 'no_asistio')
         GROUP BY dia
         ORDER BY dia`
      )
      .all(rangoGraficos.desde, rangoGraficos.hasta);

    return {
      periodo,
      resumen: {
        citasHoy: resumenHoy.citas,
        pacientesHoy: resumenHoy.pacientes,
        citasSemana: resumen7.citas,
        pacientesSemana: resumen7.pacientes,
        citasMes: resumen30.citas,
        pacientesMes: resumen30.pacientes,
        embarazosAtendidos: embarazos,
      },
      serie: construirSerieCitas(periodo),
      motivos,
      estados,
      medicos,
      porHora,
      porDiaSemana,
    };
  });

  router.get('/api/appointments/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_VER);
    return citaDetalle(ctx.params.id);
  });

  router.post('/api/appointments', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_GESTIONAR);

    const paciente = pacienteValido(ctx.body?.patientId);
    let medicoId = String(ctx.body?.medicoId || '').trim() || null;
    if (!medicoId && user.rol === 'medico') medicoId = user.id;
    medicoValido(medicoId);

    const fechaHora = parseFechaHora(ctx.body?.fechaHora, 'Selecciona la fecha y hora de la cita');
    const duracionMin = parseDuracion(ctx.body?.duracionMin);
    const estado = validarEstado(ctx.body?.estado);
    const motivo = limpiar(ctx.body?.motivo, 500);
    const notas = limpiar(ctx.body?.notas, 2000);
    const jornada = ['manana', 'tarde'].includes(ctx.body?.jornada)
      ? ctx.body.jornada
      : jornadaDe(fechaHora);
    const tipo = ['normal', 'extra', 'emergencia'].includes(ctx.body?.tipo)
      ? ctx.body.tipo
      : 'normal';
    const cupo = Math.min(Math.max(Number(ctx.body?.cupo || 1), 1), 10);
    const motivoGrupo = limpiar(ctx.body?.motivoGrupo, 80) || null;
    const id = uid();
    const ts = nowIso();

    tx(() => {
      if (
        !permitirCitasSimultaneas() &&
        !['cancelada', 'no_asistio'].includes(estado)
      ) {
        const conflicto =
          tipo === 'normal'
            ? hayConflicto({ medicoId, fechaHora, duracionMin, cupo })
            : hayConflicto({ medicoId, fechaHora, duracionMin, tipo });
        if (conflicto) {
          throw new HttpError(409, 'El médico ya tiene una cita en ese horario.');
        }
      }

      db.prepare(
        `INSERT INTO appointments
           (id, patient_id, medico_id, fecha_hora, duracion_min, motivo, estado, notas,
            jornada, tipo, cupo, motivo_grupo, creado_por, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        paciente.id,
        medicoId,
        fechaHora,
        duracionMin,
        motivo || null,
        estado,
        notas || null,
        jornada,
        tipo,
        cupo,
        motivoGrupo,
        user.id,
        ts,
        ts
      );
    });

    audit(user.id, 'cita_creada', 'appointments', id, {
      patientId: paciente.id,
      medicoId,
      fechaHora,
    });
    ctx.ok({ id }, 201);

    // Envío automático opcional; no bloquea la respuesta de creación.
    if (whatsappAuto() && !['cancelada', 'no_asistio'].includes(estado)) {
      enviarConfirmacionCita(id, user.id).catch((error) => {
        console.error('[whatsapp] confirmación automática:', error.message);
      });
    }
  });

  router.patch('/api/appointments/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_GESTIONAR);

    const actual = db.prepare('SELECT * FROM appointments WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Cita no encontrada');

    const cambios = {};
    let pacienteId = actual.patient_id;
    if (ctx.body?.patientId !== undefined) {
      const paciente = pacienteValido(ctx.body.patientId);
      const historia = db
        .prepare('SELECT id FROM clinical_records WHERE appointment_id = ?')
        .get(actual.id);
      if (historia && paciente.id !== actual.patient_id) {
        throw new HttpError(409, 'No se puede cambiar la paciente de una cita con historia clínica.');
      }
      pacienteId = paciente.id;
      cambios.patient_id = paciente.id;
    }

    let medicoId = actual.medico_id;
    if (ctx.body?.medicoId !== undefined) {
      medicoId = String(ctx.body.medicoId || '').trim() || null;
      medicoValido(medicoId);
      cambios.medico_id = medicoId;
    }

    let fechaHora = actual.fecha_hora;
    if (ctx.body?.fechaHora !== undefined) {
      fechaHora = parseFechaHora(ctx.body.fechaHora);
      cambios.fecha_hora = fechaHora;
    }

    let duracionMin = actual.duracion_min;
    if (ctx.body?.duracionMin !== undefined) {
      duracionMin = parseDuracion(ctx.body.duracionMin);
      cambios.duracion_min = duracionMin;
    }
    if (ctx.body?.estado !== undefined) cambios.estado = validarEstado(ctx.body.estado);
    if (ctx.body?.motivoReagenda !== undefined) {
      cambios.motivo_reagenda = limpiar(ctx.body.motivoReagenda, 500) || null;
    }
    if (ctx.body?.motivo !== undefined) cambios.motivo = limpiar(ctx.body.motivo, 500) || null;
    if (ctx.body?.notas !== undefined) cambios.notas = limpiar(ctx.body.notas, 2000) || null;
    if (ctx.body?.tipo !== undefined) {
      cambios.tipo = ['normal', 'extra', 'emergencia'].includes(ctx.body.tipo)
        ? ctx.body.tipo
        : 'normal';
    }
    if (ctx.body?.jornada !== undefined) {
      cambios.jornada = ['manana', 'tarde'].includes(ctx.body.jornada)
        ? ctx.body.jornada
        : null;
    } else if (cambios.fecha_hora) {
      cambios.jornada = jornadaDe(cambios.fecha_hora);
    }
    if (ctx.body?.cupo !== undefined) {
      cambios.cupo = Math.min(Math.max(Number(ctx.body.cupo || 1), 1), 10);
    }
    if (ctx.body?.motivoGrupo !== undefined) {
      cambios.motivo_grupo = limpiar(ctx.body.motivoGrupo, 80) || null;
    }

    if (!Object.keys(cambios).length) throw new HttpError(400, 'No hay cambios para guardar');

    const estadoFinal = cambios.estado || actual.estado;
    if (estadoFinal === 'reagendada') {
      const motivoReagenda =
        cambios.motivo_reagenda !== undefined
          ? cambios.motivo_reagenda
          : actual.motivo_reagenda;
      if (!motivoReagenda) {
        throw new HttpError(400, 'Selecciona el motivo de la reagenda');
      }
    }

    cambios.actualizado_en = nowIso();

    tx(() => {
      const estadoFinal = cambios.estado || actual.estado;
      if (
        !permitirCitasSimultaneas() &&
        !['cancelada', 'no_asistio'].includes(estadoFinal)
      ) {
        const tipoFinal = cambios.tipo || actual.tipo;
        const cupoFinal = cambios.cupo !== undefined ? cambios.cupo : actual.cupo;
        const conflicto =
          tipoFinal === 'normal'
            ? hayConflicto({
                medicoId,
                fechaHora,
                duracionMin,
                cupo: cupoFinal,
                excluirId: actual.id,
              })
            : hayConflicto({
                medicoId,
                fechaHora,
                duracionMin,
                tipo: tipoFinal,
                excluirId: actual.id,
              });
        if (conflicto) {
          throw new HttpError(409, 'El médico ya tiene una cita en ese horario.');
        }
      }

      const campos = Object.keys(cambios).map((columna) => `${columna} = ?`);
      db.prepare(`UPDATE appointments SET ${campos.join(', ')} WHERE id = ?`).run(
        ...Object.values(cambios),
        actual.id
      );
    });

    audit(user.id, 'cita_editada', 'appointments', actual.id, {
      pacienteId,
      estado: cambios.estado || actual.estado,
    });
    ctx.ok({ ok: true });
  });

  router.post('/api/appointments/:id/cancel', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_GESTIONAR);
    const actual = db.prepare('SELECT id FROM appointments WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Cita no encontrada');

    db.prepare(
      "UPDATE appointments SET estado = 'cancelada', actualizado_en = ? WHERE id = ?"
    ).run(nowIso(), actual.id);

    audit(user.id, 'cita_cancelada', 'appointments', actual.id, null);
    ctx.ok({ ok: true });
  });

  router.post('/api/appointments/:id/notify-whatsapp', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_GESTIONAR);

    const resultado = await enviarConfirmacionCita(ctx.params.id, user.id);
    audit(user.id, 'cita_notificada_whatsapp', 'appointments', ctx.params.id, {
      destino: resultado.destino,
      estado: resultado.estado,
    });
    ctx.ok(resultado);
  });

  // Al iniciar la cita se crea (o recupera) la consulta médica asociada.
  router.post('/api/appointments/:id/start-consultation', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const cita = db.prepare('SELECT * FROM appointments WHERE id = ?').get(ctx.params.id);
    if (!cita) throw new HttpError(404, 'Cita no encontrada');
    if (['cancelada', 'no_asistio'].includes(cita.estado)) {
      throw new HttpError(409, 'No se puede iniciar una cita cancelada o marcada como no asistió');
    }
    if (cita.estado === 'atendida') {
      throw new HttpError(409, 'La cita ya está finalizada');
    }
    validarPropietario(user, cita);

    let recordId = null;
    let creada = false;

    tx(() => {
      const existente = db
        .prepare('SELECT id FROM clinical_records WHERE appointment_id = ?')
        .get(cita.id);
      const ts = nowIso();

      if (existente) {
        recordId = existente.id;
      } else {
        recordId = uid();
        db.prepare(
          `INSERT INTO clinical_records
             (id, appointment_id, patient_id, medico_id, fecha, duracion_estimada_min,
              motivo_consulta, creado_por, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          recordId,
          cita.id,
          cita.patient_id,
          cita.medico_id || user.id,
          ts,
          cita.duracion_min || 30,
          cita.motivo || null,
          user.id,
          ts,
          ts
        );
        creada = true;
      }

      db.prepare(
        "UPDATE appointments SET estado = 'en_progreso', actualizado_en = ? WHERE id = ?"
      ).run(ts, cita.id);
    });

    audit(user.id, creada ? 'consulta_iniciada' : 'consulta_abierta', 'appointments', cita.id, {
      recordId,
    });
    ctx.ok({ appointmentId: cita.id, recordId });
  });

  router.post('/api/appointments/:id/finish-consultation', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const cita = db.prepare('SELECT * FROM appointments WHERE id = ?').get(ctx.params.id);
    if (!cita) throw new HttpError(404, 'Cita no encontrada');
    if (cita.estado === 'cancelada' || cita.estado === 'no_asistio') {
      throw new HttpError(409, 'La cita está cancelada o marcada como no asistió');
    }
    validarPropietario(user, cita);

    const historia = db
      .prepare('SELECT id FROM clinical_records WHERE appointment_id = ?')
      .get(cita.id);
    if (!historia) {
      throw new HttpError(409, 'Primero debes iniciar la consulta de esta cita');
    }

    db.prepare(
      "UPDATE appointments SET estado = 'atendida', actualizado_en = ? WHERE id = ?"
    ).run(nowIso(), cita.id);

    audit(user.id, 'consulta_finalizada', 'appointments', cita.id, {
      recordId: historia.id,
    });
    ctx.ok({ ok: true });
  });

  router.get('/api/clinical-records', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const params = ctx.url.searchParams;
    const patientId = String(params.get('patientId') || '').trim();
    const appointmentId = String(params.get('appointmentId') || '').trim();
    const q = limpiar(params.get('q'), 80);
    const limit = Math.min(Number(params.get('limit') || 300), 500);

    const condiciones = [];
    const valores = [];
    if (patientId) {
      condiciones.push('cr.patient_id = ?');
      valores.push(patientId);
    }
    if (appointmentId) {
      condiciones.push('cr.appointment_id = ?');
      valores.push(appointmentId);
    }
    if (q) {
      const like = `%${q}%`;
      condiciones.push('(p.nombres LIKE ? OR p.apellidos LIKE ? OR p.cedula LIKE ?)');
      valores.push(like, like, like);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const filas = db
      .prepare(
        `SELECT cr.*, a.fecha_hora AS cita_fecha, a.motivo AS cita_motivo,
                a.estado AS cita_estado, p.fecha_nacimiento, p.sexo,
                p.nombres, p.apellidos, p.cedula AS paciente_cedula,
                u.nombre AS medico_nombre,
                ua.nombre AS actualizado_por_nombre,
                (SELECT COUNT(*) FROM clinical_addenda ca
                  WHERE ca.record_id = cr.id) AS addenda_count
         FROM clinical_records cr
         JOIN appointments a ON a.id = cr.appointment_id
         JOIN patients p ON p.id = cr.patient_id
         LEFT JOIN users u ON u.id = cr.medico_id
         LEFT JOIN users ua ON ua.id = cr.actualizado_por
         ${where}
         ORDER BY cr.fecha DESC
         LIMIT ?`
      )
      .all(...valores, limit);

    const { adjuntosPorRegistro, examenesPorRegistro } = datosClinicosDe(
      filas.map((fila) => fila.id)
    );
    return filas.map((fila) => ({
      ...fila,
      adjuntos: (adjuntosPorRegistro.get(fila.id) || []).filter((a) => !a.exam_id),
      examenes: examenesPorRegistro.get(fila.id) || [],
    }));
  });

  router.get('/api/clinical-records/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const historia = db
      .prepare(
        `SELECT cr.*, a.fecha_hora AS cita_fecha, a.motivo AS cita_motivo,
                a.estado AS cita_estado,
                p.nombres, p.apellidos, p.cedula AS paciente_cedula,
                p.fecha_nacimiento, p.telefono,
                u.nombre AS medico_nombre,
                ua.nombre AS actualizado_por_nombre
         FROM clinical_records cr
         JOIN appointments a ON a.id = cr.appointment_id
         JOIN patients p ON p.id = cr.patient_id
         LEFT JOIN users u ON u.id = cr.medico_id
         LEFT JOIN users ua ON ua.id = cr.actualizado_por
         WHERE cr.id = ?`
      )
      .get(ctx.params.id);
    if (!historia) throw new HttpError(404, 'Historia clínica no encontrada');

    // Trazabilidad LOPDP: se registra la lectura como máximo una vez cada
    // 10 minutos por usuario y registro, para no llenar la bitácora.
    const desde = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const reciente = db
      .prepare(
        `SELECT 1 FROM audit_log
         WHERE user_id = ? AND accion = 'historia_consultada'
           AND entidad = 'clinical_records' AND entidad_id = ? AND creado_en > ?
         LIMIT 1`
      )
      .get(user.id, historia.id, desde);
    if (!reciente) {
      audit(user.id, 'historia_consultada', 'clinical_records', historia.id, null);
    }

    return historiaCompleta(historia);
  });

  router.post('/api/clinical-records', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const appointmentId = String(ctx.body?.appointmentId || '').trim();
    const cita = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    if (!cita) throw new HttpError(404, 'Cita no encontrada');

    const existente = db
      .prepare('SELECT id FROM clinical_records WHERE appointment_id = ?')
      .get(appointmentId);
    if (existente) {
      throw new HttpError(409, 'Esta cita ya tiene una historia clínica registrada.');
    }

    const fecha = ctx.body?.fecha
      ? parseFechaHora(ctx.body.fecha, 'La fecha de la historia no es válida')
      : cita.fecha_hora;
    const duracionEstimadaMin = parseDuracion(ctx.body?.duracionEstimadaMin || cita.duracion_min);
    const datosObj =
      ctx.body?.datos && typeof ctx.body.datos === 'object' ? ctx.body.datos : null;
    const motivoConsulta = limpiar(ctx.body?.motivoConsulta ?? datosObj?.motivo, 1000);
    const notas = limpiar(ctx.body?.notas, 10000);
    const diagnostico = limpiar(
      ctx.body?.diagnostico ?? diagnosticoDeDatos(datosObj),
      5000
    );
    const tratamiento = limpiar(ctx.body?.tratamiento, 5000);
    const receta = limpiar(ctx.body?.receta, 5000);
    const indicaciones = limpiar(ctx.body?.indicaciones ?? datosObj?.indicaciones, 5000);
    const recomendaciones = limpiar(ctx.body?.recomendaciones ?? datosObj?.plan, 5000);
    const datos = serializarDatos(ctx.body?.datos);
    const id = uid();
    const ts = nowIso();

    const columnas = columnasClinicas(datosObj) || {};

    tx(() => {
      const campos = {
        id,
        appointment_id: appointmentId,
        patient_id: cita.patient_id,
        medico_id: cita.medico_id || user.id,
        fecha,
        duracion_estimada_min: duracionEstimadaMin,
        motivo_consulta: motivoConsulta || null,
        notas: notas || null,
        diagnostico: diagnostico || null,
        tratamiento: tratamiento || null,
        receta: receta || null,
        indicaciones: indicaciones || null,
        recomendaciones: recomendaciones || null,
        datos: datos ?? null,
        ...columnas,
        creado_por: user.id,
        actualizado_por: user.id,
        creado_en: ts,
        actualizado_en: ts,
      };
      const nombres = Object.keys(campos);
      db.prepare(
        `INSERT INTO clinical_records (${nombres.join(', ')})
         VALUES (${nombres.map(() => '?').join(', ')})`
      ).run(...Object.values(campos));

      sincronizarDiagnosticos(id, datosObj?.diagnosticos, ts);
      actualizarFumPaciente(cita.patient_id, datosObj?.fum);
    });

    audit(user.id, 'historia_creada', 'clinical_records', id, { appointmentId });
    ctx.ok({ id }, 201);
  });

  router.patch('/api/clinical-records/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const actual = db
      .prepare('SELECT * FROM clinical_records WHERE id = ?')
      .get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Historia clínica no encontrada');

    const citaDeHistoria = db
      .prepare('SELECT estado FROM appointments WHERE id = ?')
      .get(actual.appointment_id);
    if (citaDeHistoria?.estado === 'atendida') {
      throw new HttpError(
        409,
        'La consulta está finalizada. Registra una nota aclaratoria (addenda) para corregirla.'
      );
    }

    const cambios = {};
    if (ctx.body?.fecha !== undefined) {
      cambios.fecha = parseFechaHora(ctx.body.fecha, 'La fecha de la historia no es válida');
    }
    if (ctx.body?.duracionEstimadaMin !== undefined) {
      cambios.duracion_estimada_min = parseDuracion(ctx.body.duracionEstimadaMin);
    }
    if (ctx.body?.motivoConsulta !== undefined) {
      cambios.motivo_consulta = limpiar(ctx.body.motivoConsulta, 1000) || null;
    }
    if (ctx.body?.notas !== undefined) cambios.notas = limpiar(ctx.body.notas, 10000) || null;
    if (ctx.body?.diagnostico !== undefined) {
      cambios.diagnostico = limpiar(ctx.body.diagnostico, 5000) || null;
    }
    if (ctx.body?.tratamiento !== undefined) {
      cambios.tratamiento = limpiar(ctx.body.tratamiento, 5000) || null;
    }
    if (ctx.body?.receta !== undefined) {
      cambios.receta = limpiar(ctx.body.receta, 5000) || null;
    }
    if (ctx.body?.indicaciones !== undefined) {
      cambios.indicaciones = limpiar(ctx.body.indicaciones, 5000) || null;
    }
    if (ctx.body?.recomendaciones !== undefined) {
      cambios.recomendaciones = limpiar(ctx.body.recomendaciones, 5000) || null;
    }
    let datosObj = null;
    if (ctx.body?.datos !== undefined) {
      datosObj =
        ctx.body.datos && typeof ctx.body.datos === 'object' ? ctx.body.datos : null;
      cambios.datos = serializarDatos(ctx.body.datos);
      if (ctx.body?.motivoConsulta === undefined && datosObj?.motivo !== undefined) {
        cambios.motivo_consulta = limpiar(datosObj.motivo, 1000) || null;
      }
      if (ctx.body?.diagnostico === undefined && datosObj) {
        cambios.diagnostico = diagnosticoDeDatos(datosObj) || null;
      }
      if (ctx.body?.indicaciones === undefined && datosObj?.indicaciones !== undefined) {
        cambios.indicaciones = limpiar(datosObj.indicaciones, 5000) || null;
      }
      if (ctx.body?.recomendaciones === undefined && datosObj?.plan !== undefined) {
        cambios.recomendaciones = limpiar(datosObj.plan, 5000) || null;
      }

      const columnas = columnasClinicas(datosObj) || {};
      for (const [campo, valor] of Object.entries(columnas)) {
        const presente =
          datosObj[campo] !== undefined ||
          (campo === 'imc' && (datosObj.peso !== undefined || datosObj.talla !== undefined));
        if (presente) cambios[campo] = valor;
      }
    }
    if (!Object.keys(cambios).length) throw new HttpError(400, 'No hay cambios para guardar');

    const ahoraHistoria = nowIso();
    cambios.actualizado_en = ahoraHistoria;
    cambios.actualizado_por = user.id;
    const campos = Object.keys(cambios).map((columna) => `${columna} = ?`);

    tx(() => {
      db.prepare(`UPDATE clinical_records SET ${campos.join(', ')} WHERE id = ?`).run(
        ...Object.values(cambios),
        actual.id
      );
      if (datosObj) {
        if (Array.isArray(datosObj.diagnosticos)) {
          sincronizarDiagnosticos(actual.id, datosObj.diagnosticos, ahoraHistoria);
        }
        actualizarFumPaciente(actual.patient_id, datosObj.fum);
      }
    });

    audit(user.id, 'historia_editada', 'clinical_records', actual.id, null);
    ctx.ok({ ok: true });
  });

  router.post('/api/clinical-records/:id/exams', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const historia = db
      .prepare('SELECT id, patient_id FROM clinical_records WHERE id = ?')
      .get(ctx.params.id);
    if (!historia) throw new HttpError(404, 'Historia clínica no encontrada');

    const nombre = limpiar(ctx.body?.nombre, 200);
    if (!nombre) throw new HttpError(400, 'El nombre del examen es obligatorio');
    const tipo = String(ctx.body?.tipo || 'clinico').trim();
    if (!TIPOS_EXAMEN.includes(tipo)) throw new HttpError(400, 'Tipo de examen no válido');
    const descripcion = limpiar(ctx.body?.descripcion ?? ctx.body?.indicaciones, 5000);
    const observaciones = limpiar(ctx.body?.observaciones, 5000);
    const estado = ['solicitado', 'recibido', 'evaluado'].includes(ctx.body?.estado)
      ? ctx.body.estado
      : 'solicitado';

    let pedidoId = null;
    if (ctx.body?.pedidoId) {
      const pedido = db
        .prepare('SELECT id, patient_id FROM clinical_orders WHERE id = ?')
        .get(String(ctx.body.pedidoId));
      if (!pedido) throw new HttpError(400, 'El pedido seleccionado no existe');
      if (pedido.patient_id !== historia.patient_id) {
        throw new HttpError(400, 'El pedido no corresponde a la paciente');
      }
      pedidoId = pedido.id;
    }

    const id = uid();
    const ts = nowIso();

    db.prepare(
      `INSERT INTO clinical_exams
         (id, record_id, patient_id, pedido_id, nombre, tipo, descripcion, indicaciones, observaciones, estado,
          creado_por, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      historia.id,
      historia.patient_id,
      pedidoId,
      nombre,
      tipo,
      descripcion || null,
      descripcion || null,
      observaciones || null,
      estado,
      user.id,
      ts,
      ts
    );

    marcarHistoriaModificada(historia.id, user.id, ts);

    audit(user.id, 'examen_solicitado', 'clinical_exams', id, {
      recordId: historia.id,
      nombre,
    });
    ctx.ok({ id }, 201);
  });

  router.patch('/api/clinical-exams/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const actual = db
      .prepare('SELECT * FROM clinical_exams WHERE id = ?')
      .get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Examen no encontrado');

    const cambios = {};
    if (ctx.body?.nombre !== undefined) {
      const nombre = limpiar(ctx.body.nombre, 200);
      if (!nombre) throw new HttpError(400, 'El nombre del examen es obligatorio');
      cambios.nombre = nombre;
    }
    if (ctx.body?.tipo !== undefined) {
      const tipo = String(ctx.body.tipo || '').trim();
      if (!TIPOS_EXAMEN.includes(tipo)) throw new HttpError(400, 'Tipo de examen no válido');
      cambios.tipo = tipo;
    }
    if (ctx.body?.descripcion !== undefined || ctx.body?.indicaciones !== undefined) {
      const descripcion = limpiar(ctx.body?.descripcion ?? ctx.body?.indicaciones, 5000);
      cambios.descripcion = descripcion || null;
      cambios.indicaciones = descripcion || null;
    }
    if (ctx.body?.estado !== undefined) {
      const estado = String(ctx.body.estado || '').trim();
      if (!['solicitado', 'recibido', 'evaluado'].includes(estado)) {
        throw new HttpError(400, 'Estado de examen no válido');
      }
      cambios.estado = estado;
    }
    if (ctx.body?.observaciones !== undefined) {
      if (!['medico', 'admin'].includes(user.rol)) {
        throw new HttpError(403, 'Solo el médico o el administrador pueden modificar la observación del examen');
      }
      cambios.observaciones = limpiar(ctx.body.observaciones, 5000) || null;
    }
    if (!Object.keys(cambios).length) throw new HttpError(400, 'No hay cambios para guardar');

    cambios.actualizado_en = nowIso();
    const campos = Object.keys(cambios).map((columna) => `${columna} = ?`);
    db.prepare(`UPDATE clinical_exams SET ${campos.join(', ')} WHERE id = ?`).run(
      ...Object.values(cambios),
      actual.id
    );

    marcarHistoriaModificada(actual.record_id, user.id, cambios.actualizado_en);

    audit(user.id, 'examen_actualizado', 'clinical_exams', actual.id, {
      estado: cambios.estado || actual.estado,
    });
    ctx.ok({ ok: true });
  });

  router.delete('/api/clinical-exams/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const actual = db
      .prepare('SELECT * FROM clinical_exams WHERE id = ?')
      .get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Examen no encontrado');

    const archivos = db
      .prepare('SELECT id, ruta FROM clinical_attachments WHERE exam_id = ?')
      .all(actual.id);

    for (const archivo of archivos) {
      db.prepare('DELETE FROM clinical_attachments WHERE id = ?').run(archivo.id);
      try {
        unlinkSync(resolve(config.dataDir, archivo.ruta));
      } catch {
        // el archivo pudo no existir
      }
    }

    db.prepare('DELETE FROM clinical_exams WHERE id = ?').run(actual.id);
    marcarHistoriaModificada(actual.record_id, user.id);
    audit(user.id, 'examen_eliminado', 'clinical_exams', actual.id, {
      recordId: actual.record_id,
      nombre: actual.nombre,
      archivos: archivos.length,
    });
    ctx.ok({ ok: true });
  });

  router.post('/api/clinical-records/:id/attachments', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const historia = db
      .prepare('SELECT id, patient_id FROM clinical_records WHERE id = ?')
      .get(ctx.params.id);
    if (!historia) throw new HttpError(404, 'Historia clínica no encontrada');

    const examId = String(ctx.body?.examId || '').trim();
    if (!examId) {
      throw new HttpError(400, 'El archivo debe estar asociado a un examen');
    }

    const examen = db
      .prepare('SELECT id, record_id, estado FROM clinical_exams WHERE id = ?')
      .get(examId);
    if (!examen || examen.record_id !== historia.id) {
      throw new HttpError(400, 'El examen no pertenece a esta historia clínica');
    }

    const totalDocumentos = db
      .prepare('SELECT COUNT(*) AS n FROM clinical_attachments WHERE patient_id = ?')
      .get(historia.patient_id).n;
    if (totalDocumentos >= MAX_DOCUMENTOS_PACIENTE) {
      throw new HttpError(
        409,
        `La paciente ya tiene ${MAX_DOCUMENTOS_PACIENTE} documentos. Elimina uno para subir otro.`
      );
    }

    const nombre = nombreArchivoSeguro(ctx.body?.nombre);
    const { buffer, mime, ext } = parseArchivoDataUrl(ctx.body?.data, {
      maxBytes: MAX_ADJUNTO,
    });

    const id = uid();
    const shard = String(historia.patient_id || 'sin')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 2) || '00';
    const relPath = `historias/${shard}/${historia.patient_id}/${examId}/${id}.${ext}`;
    const absPath = resolve(config.dataDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, buffer);

    try {
      db.prepare(
        `INSERT INTO clinical_attachments
           (id, record_id, patient_id, exam_id, nombre, mime, tamano, ruta, hash, subido_por, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        historia.id,
        historia.patient_id,
        examId,
        nombre,
        mime,
        buffer.length,
        relPath,
        sha256(buffer),
        user.id,
        nowIso()
      );

      if (examId) {
        db.prepare(
          `UPDATE clinical_exams
           SET estado = CASE WHEN estado = 'solicitado' THEN 'recibido' ELSE estado END,
               actualizado_en = ?
           WHERE id = ?`
        ).run(nowIso(), examId);
      }
    } catch (error) {
      try {
        unlinkSync(absPath);
      } catch {
        // el archivo pudo no haberse escrito
      }
      throw error;
    }

    audit(user.id, 'adjunto_subido', 'clinical_attachments', id, {
      recordId: historia.id,
      examId,
      nombre,
      mime,
    });
    marcarHistoriaModificada(historia.id, user.id);
    ctx.ok(
      {
        id,
        nombre,
        mime,
        tamano: buffer.length,
        examId,
        documentosPaciente: totalDocumentos + 1,
        maxDocumentos: MAX_DOCUMENTOS_PACIENTE,
      },
      201
    );
  });

  router.get('/api/clinical-attachments/:id/file', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const adjunto = db
      .prepare('SELECT * FROM clinical_attachments WHERE id = ?')
      .get(ctx.params.id);
    if (!adjunto) throw new HttpError(404, 'Archivo no encontrado');

    const absoluta = resolve(config.dataDir, adjunto.ruta);
    const base = resolve(config.dataDir);
    if (!absoluta.startsWith(base) || !existsSync(absoluta)) {
      throw new HttpError(404, 'No se encontró el archivo');
    }

    const buffer = readFileSync(absoluta);
    const descarga = ctx.url.searchParams.get('download') === '1';
    const nombre = encodeURIComponent(adjunto.nombre);

    ctx.res.writeHead(200, {
      'content-type': adjunto.mime,
      'content-length': buffer.length,
      'content-disposition': `${descarga ? 'attachment' : 'inline'}; filename*=UTF-8''${nombre}`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    ctx.res.end(buffer);
  });

  router.delete('/api/clinical-attachments/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const adjunto = db
      .prepare('SELECT * FROM clinical_attachments WHERE id = ?')
      .get(ctx.params.id);
    if (!adjunto) throw new HttpError(404, 'Archivo no encontrado');

    db.prepare('DELETE FROM clinical_attachments WHERE id = ?').run(adjunto.id);

    try {
      unlinkSync(resolve(config.dataDir, adjunto.ruta));
    } catch {
      // el archivo pudo no existir
    }

    audit(user.id, 'adjunto_eliminado', 'clinical_attachments', adjunto.id, {
      recordId: adjunto.record_id,
      nombre: adjunto.nombre,
    });
    marcarHistoriaModificada(adjunto.record_id, user.id);
    ctx.ok({ ok: true });
  });
}
