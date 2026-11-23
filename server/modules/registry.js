import { db } from '../db/index.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { requireUser } from './auth.js';

function parseJson(texto) {
  try {
    return JSON.parse(texto || '{}');
  } catch {
    return {};
  }
}

function mapFirma(row) {
  const paciente = parseJson(row.patient_snapshot);
  const usuario = parseJson(row.user_snapshot);

  return {
    id: row.id,
    documentId: row.document_id,
    version: row.version_numero,
    titulo: row.documento_titulo || row.titulo_actual || 'Documento',
    firmadoEn: row.firmado_en,
    empleado: {
      id: row.gestionado_por || usuario.id || null,
      nombre: row.gestionado_nombre || usuario.nombre || 'Usuario no disponible',
      rol: row.gestionado_rol || usuario.rol || '',
    },
    paciente: {
      nombres: paciente.nombres || '',
      apellidos: paciente.apellidos || '',
      cedula: paciente.cedula || '',
      nombre: `${paciente.nombres || ''} ${paciente.apellidos || ''}`.trim(),
    },
  };
}

export function routes(router) {
  // Registro histórico de firmas: quién la gestionó, qué día y a qué hora.
  router.get('/api/signatures', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.REGISTRO_VER);
    const params = ctx.url.searchParams;

    const desde = String(params.get('desde') || '').trim();
    const hasta = String(params.get('hasta') || '').trim();
    const userId = String(params.get('userId') || '').trim();
    const documentId = String(params.get('documentId') || '').trim();
    const q = String(params.get('q') || '').trim().slice(0, 80);
    const like = `%${q}%`;
    const limit = Math.min(Number(params.get('limit') || 500), 1000);

    const filas = db
      .prepare(
        `SELECT s.id, s.document_id, s.version_id, s.patient_snapshot, s.user_snapshot,
                s.gestionado_por, s.gestionado_nombre, s.gestionado_rol, s.firmado_en,
                s.documento_titulo, d.titulo AS titulo_actual, v.numero AS version_numero
         FROM signatures s
         JOIN documents d ON d.id = s.document_id
         JOIN document_versions v ON v.id = s.version_id
         WHERE (? = '' OR s.firmado_en >= ?)
           AND (? = '' OR s.firmado_en <= ?)
           AND (? = '' OR s.gestionado_por = ?)
           AND (? = '' OR s.document_id = ?)
           AND (? = '' OR s.documento_titulo LIKE ? OR d.titulo LIKE ? OR s.patient_snapshot LIKE ?)
         ORDER BY s.firmado_en DESC
         LIMIT ?`
      )
      .all(
        desde,
        desde,
        hasta,
        hasta,
        userId,
        userId,
        documentId,
        documentId,
        q,
        like,
        like,
        like,
        limit
      );

    return filas.map(mapFirma);
  });

  router.get('/api/signatures/employees', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.REGISTRO_VER);
    return db
      .prepare(
        `SELECT gestionado_por AS id, gestionado_nombre AS nombre, gestionado_rol AS rol,
                COUNT(*) AS firmas
         FROM signatures
         WHERE gestionado_por IS NOT NULL
         GROUP BY gestionado_por, gestionado_nombre, gestionado_rol
         ORDER BY nombre COLLATE NOCASE`
      )
      .all();
  });
}
