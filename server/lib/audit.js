import { db, nowIso } from '../db/index.js';

/** Registra una acción en la bitácora. Nunca lanza: la auditoría no debe romper el flujo. */
export function audit(userId, accion, entidad, entidadId = null, detalle = null) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, accion, entidad, entidad_id, detalle, creado_en)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId ?? null,
      accion,
      entidad,
      entidadId,
      detalle ? JSON.stringify(detalle) : null,
      nowIso()
    );
  } catch (error) {
    console.error('[audit] no se pudo registrar la acción:', error.message);
  }
}
