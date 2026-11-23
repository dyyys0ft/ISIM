import { db, nowIso, uid } from '../db/index.js';

export function telefonoPaciente(patientId) {
  return db.prepare('SELECT telefono FROM patients WHERE id = ?').get(patientId)?.telefono || null;
}

export function asegurarConversacion(patientId, { telefono = null, waId = null } = {}) {
  let conversacion = db
    .prepare('SELECT * FROM crm_conversations WHERE patient_id = ?')
    .get(patientId);
  if (conversacion) {
    if ((telefono && telefono !== conversacion.telefono) || (waId && waId !== conversacion.wa_id)) {
      db.prepare(
        `UPDATE crm_conversations
         SET telefono = COALESCE(?, telefono), wa_id = COALESCE(?, wa_id), actualizado_en = ?
         WHERE id = ?`
      ).run(telefono, waId, nowIso(), conversacion.id);
      conversacion = db
        .prepare('SELECT * FROM crm_conversations WHERE id = ?')
        .get(conversacion.id);
    }
    return conversacion;
  }

  const id = uid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO crm_conversations
       (id, patient_id, telefono, wa_id, estado, no_leidos, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, 'abierta', 0, ?, ?)`
  ).run(id, patientId, telefono || telefonoPaciente(patientId), waId, ts, ts);
  return db.prepare('SELECT * FROM crm_conversations WHERE id = ?').get(id);
}

export function registrarMensaje({
  patientId,
  appointmentId = null,
  direccion,
  tipo = 'texto',
  contenido = '',
  proveedorId = null,
  estado = 'enviado',
  error = null,
  creadoPor = null,
  metadata = null,
  telefono = null,
  waId = null,
}) {
  const conversacion = asegurarConversacion(patientId, { telefono, waId });
  const id = uid();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO crm_messages
       (id, conversation_id, patient_id, appointment_id, direccion, tipo,
        contenido, proveedor_id, estado, error, creado_por, creado_en, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    conversacion.id,
    patientId,
    appointmentId,
    direccion,
    tipo,
    String(contenido || ''),
    proveedorId,
    estado,
    error,
    creadoPor,
    ts,
    metadata ? JSON.stringify(metadata) : null
  );

  db.prepare(
    `UPDATE crm_conversations
     SET ultimo_mensaje = ?, ultimo_mensaje_en = ?, actualizado_en = ?,
         no_leidos = CASE WHEN ? = 'entrante' THEN no_leidos + 1 ELSE no_leidos END
     WHERE id = ?`
  ).run(String(contenido || '').slice(0, 500), ts, ts, direccion, conversacion.id);

  return { id, conversationId: conversacion.id };
}

export function buscarPacientePorTelefono(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) return null;

  const sinPais = digitos.startsWith('593') ? digitos.slice(3) : digitos;
  const conCero = sinPais.startsWith('0') ? sinPais : `0${sinPais}`;
  const ultimos = sinPais.slice(-9);
  const candidatos = [...new Set([digitos, sinPais, conCero, ultimos])].filter(Boolean);
  const marcadores = candidatos.map(() => '?').join(', ');

  return (
    db
      .prepare(
        `SELECT id, nombres, apellidos, telefono
         FROM patients
         WHERE activo = 1
           AND replace(replace(replace(replace(telefono, ' ', ''), '-', ''), '+', ''), '.', '')
               IN (${marcadores})
         LIMIT 1`
      )
      .get(...candidatos) || null
  );
}

export function marcarConversacionLeida(conversationId) {
  db.prepare(
    'UPDATE crm_conversations SET no_leidos = 0, actualizado_en = ? WHERE id = ?'
  ).run(nowIso(), conversationId);
}
