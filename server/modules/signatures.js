import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, nowIso, sha256, tx, uid } from '../db/index.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Guarda la firma capturada en la pantalla externa.
 * La sesión se valida de nuevo contra la base para evitar dobles usos del token.
 */
export function saveSignature(tokenHash, dataUrl, meta = {}) {
  const session = db.prepare('SELECT * FROM sign_sessions WHERE token_hash = ?').get(tokenHash);
  if (!session) throw new Error('La sesión de firma no existe');
  if (session.estado !== 'abierta') throw new Error('La sesión de firma ya no está abierta');
  if (session.expira_en <= nowIso()) throw new Error('El enlace de firma expiró');

  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || '').trim());
  if (!match) throw new Error('El formato de la firma no es válido');

  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (buffer.length < 400) throw new Error('La firma está vacía o es demasiado pequeña');
  if (buffer.length > 4 * 1024 * 1024) throw new Error('La firma es demasiado grande');
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('El archivo de firma no es un PNG válido');

  const version = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(session.version_id);
  const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(session.document_id);
  if (!version || !document) throw new Error('El documento ya no existe');
  if (version.estado === 'firmada') throw new Error('Esta versión ya fue firmada');
  if (document.estado === 'anulado') throw new Error('El documento está anulado');

  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(document.patient_id);
  const user = db
    .prepare('SELECT id, nombre, cedula, rol FROM users WHERE id = ?')
    .get(session.creada_por);

  const signatureId = uid();
  const relPath = `firmas/${version.id}-${signatureId}.png`;
  const absPath = resolve(config.dataDir, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, buffer);

  const firmaHash = sha256(buffer);
  const firmadoEn = nowIso();
  const gestionadoPor = user?.id ?? session.creada_por ?? null;
  const gestionadoNombre = user?.nombre ?? null;
  const gestionadoRol = user?.rol ?? null;

  try {
    return tx(() => {
      const fresh = db.prepare('SELECT estado FROM sign_sessions WHERE id = ?').get(session.id);
      if (fresh.estado !== 'abierta') throw new Error('La sesión de firma ya fue utilizada');

      // Revalidar dentro de la transacción: dos usuarios podrían intentar firmar
      // la misma versión al mismo tiempo.
      const versionActual = db
        .prepare('SELECT estado FROM document_versions WHERE id = ?')
        .get(version.id);
      if (versionActual?.estado === 'firmada') {
        throw new Error('Esta versión ya fue firmada por otro usuario');
      }

      const documentoActual = db
        .prepare('SELECT estado FROM documents WHERE id = ?')
        .get(document.id);
      if (!documentoActual || documentoActual.estado === 'anulado') {
        throw new Error('El documento está anulado');
      }

      db.prepare(
        `INSERT INTO signatures
           (id, sign_session_id, document_id, version_id, patient_snapshot, user_snapshot,
            gestionado_por, gestionado_nombre, gestionado_rol, documento_titulo,
            firma_png_path, firma_hash, documento_hash, firmado_en, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        signatureId,
        session.id,
        document.id,
        version.id,
        JSON.stringify({
          nombres: patient.nombres,
          apellidos: patient.apellidos,
          cedula: patient.cedula,
          fecha_nacimiento: patient.fecha_nacimiento,
          sexo: patient.sexo,
          telefono: patient.telefono,
          email: patient.email,
          direccion: patient.direccion,
          representante1_nombre: patient.representante1_nombre,
          representante1_cedula: patient.representante1_cedula,
          representante1_parentesco: patient.representante1_parentesco,
          representante1_telefono: patient.representante1_telefono,
          representante2_nombre: patient.representante2_nombre,
          representante2_cedula: patient.representante2_cedula,
          representante2_parentesco: patient.representante2_parentesco,
          representante2_telefono: patient.representante2_telefono,
        }),
        JSON.stringify(user ?? {}),
        gestionadoPor,
        gestionadoNombre,
        gestionadoRol,
        document.titulo,
        relPath,
        firmaHash,
        version.hash,
        firmadoEn,
        meta.ip || null,
        meta.userAgent || null
      );

      db.prepare("UPDATE document_versions SET estado = 'firmada' WHERE id = ?").run(version.id);
      db.prepare("UPDATE documents SET estado = 'firmado', actualizado_en = ? WHERE id = ?").run(
        firmadoEn,
        document.id
      );
      db.prepare("UPDATE sign_sessions SET estado = 'completada' WHERE id = ?").run(session.id);

      audit(user?.id ?? null, 'documento_firmado', 'documents', document.id, {
        version: version.numero,
        signatureId,
      });

      return {
        signatureId,
        documentId: document.id,
        version: version.numero,
        firmadoEn,
      };
    });
  } catch (error) {
    try {
      unlinkSync(absPath);
    } catch {
      // el archivo pudo no haberse escrito
    }
    throw error;
  }
}
