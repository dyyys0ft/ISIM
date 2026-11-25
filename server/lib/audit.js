import { db, nowIso } from '../db/index.js';
import { moduloDe, tipoAccionDe } from './auditTaxonomy.js';

/** Registra una acción en la bitácora. Nunca lanza: la auditoría no debe romper el flujo. */
export function audit(userId, accion, entidad, entidadId = null, detalle = null) {
  try {
    db.prepare(
      `INSERT INTO audit_log
         (user_id, accion, entidad, entidad_id, modulo, accion_tipo, detalle, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId ?? null,
      accion,
      entidad,
      entidadId,
      moduloDe(accion, entidad),
      tipoAccionDe(accion),
      detalle ? JSON.stringify(detalle) : null,
      nowIso()
    );
  } catch (error) {
    console.error('[audit] no se pudo registrar la acción:', error.message);
  }
}
