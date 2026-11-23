import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, nowIso, uid } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { logoActual } from '../lib/branding.js';
import { urlBasePublica } from '../lib/red.js';
import { normalizarTelefono, whatsappConfigurado, enviarTextoWhatsApp } from '../lib/whatsapp.js';
import { requireUser } from './auth.js';

function pacienteDe(id) {
  const paciente = db
    .prepare(
      `SELECT id, nombres, apellidos, cedula, fecha_nacimiento, sexo, telefono
       FROM patients
       WHERE id = ? AND activo = 1`
    )
    .get(id);
  if (!paciente) throw new HttpError(404, 'Paciente no encontrada');
  return paciente;
}

function tokenSeguro() {
  return randomBytes(28).toString('hex');
}

function enlaceDe(token) {
  return db
    .prepare(
      `SELECT l.*, p.nombres, p.apellidos, p.cedula, p.fecha_nacimiento, p.sexo
       FROM patient_share_links l
       JOIN patients p ON p.id = l.patient_id
       WHERE l.token = ? AND l.revocado_en IS NULL`
    )
    .get(token);
}

function archivosDePaciente(patientId) {
  const examenes = db
    .prepare(
      `SELECT ce.id, ce.nombre, ce.tipo, ce.observaciones, ce.creado_en,
              cr.fecha AS consulta_fecha, a.fecha_hora AS cita_fecha
       FROM clinical_exams ce
       JOIN clinical_records cr ON cr.id = ce.record_id
       JOIN appointments a ON a.id = cr.appointment_id
       WHERE cr.patient_id = ?
         AND EXISTS (
           SELECT 1 FROM clinical_attachments ca WHERE ca.exam_id = ce.id
         )
       ORDER BY cr.fecha DESC, ce.creado_en ASC`
    )
    .all(patientId);

  if (!examenes.length) return [];

  const marcadores = examenes.map(() => '?').join(', ');
  const adjuntos = db
    .prepare(
      `SELECT id, exam_id, nombre, mime, tamano, creado_en
       FROM clinical_attachments
       WHERE exam_id IN (${marcadores})
       ORDER BY creado_en ASC`
    )
    .all(...examenes.map((examen) => examen.id));

  const porExamen = new Map();
  for (const adjunto of adjuntos) {
    if (!porExamen.has(adjunto.exam_id)) porExamen.set(adjunto.exam_id, []);
    porExamen.get(adjunto.exam_id).push(adjunto);
  }

  return examenes.map((examen) => ({
    ...examen,
    adjuntos: porExamen.get(examen.id) || [],
  }));
}

function crearEnlace(patientId, userId) {
  const paciente = pacienteDe(patientId);
  const archivos = archivosDePaciente(patientId);
  if (!archivos.length) {
    throw new HttpError(
      400,
      'La paciente no tiene imágenes o documentos de exámenes para compartir'
    );
  }

  db.prepare(
    `UPDATE patient_share_links
     SET revocado_en = ?
     WHERE patient_id = ? AND revocado_en IS NULL`
  ).run(nowIso(), patientId);

  const id = uid();
  const token = tokenSeguro();
  db.prepare(
    `INSERT INTO patient_share_links
       (id, patient_id, token, creado_por, creado_en)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, patientId, token, userId, nowIso());

  return { id, token, paciente, archivos };
}

function enlaceActivo(patientId) {
  return db
    .prepare(
      `SELECT * FROM patient_share_links
       WHERE patient_id = ? AND revocado_en IS NULL
       ORDER BY creado_en DESC LIMIT 1`
    )
    .get(patientId);
}

function urlEnlace(ctx, token) {
  return `${urlBasePublica(ctx.req)}/documentos-paciente.html?t=${encodeURIComponent(token)}`;
}

export function routes(router) {
  router.post('/api/patients/:id/share-documents', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const { id, token, paciente, archivos } = crearEnlace(ctx.params.id, user.id);
    const url = urlEnlace(ctx, token);
    audit(user.id, 'documentos_paciente_compartidos', 'patients', paciente.id, {
      enlaceId: id,
      examenes: archivos.length,
    });
    ctx.ok({ id, token, url, ruta: `/documentos-paciente.html?t=${token}` });
  });

  router.get('/api/patients/:id/share-documents', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const paciente = pacienteDe(ctx.params.id);
    const enlace = enlaceActivo(paciente.id);
    const archivos = archivosDePaciente(paciente.id);
    return {
      activo: Boolean(enlace),
      url: enlace ? urlEnlace(ctx, enlace.token) : null,
      archivos: archivos.length,
    };
  });

  router.delete('/api/patients/:id/share-documents', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    db.prepare(
      `UPDATE patient_share_links
       SET revocado_en = ?
       WHERE patient_id = ? AND revocado_en IS NULL`
    ).run(nowIso(), ctx.params.id);
    audit(user.id, 'documentos_paciente_enlace_revocado', 'patients', ctx.params.id, null);
    ctx.ok({ ok: true });
  });

  router.post('/api/patients/:id/share-documents/whatsapp', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const paciente = pacienteDe(ctx.params.id);
    let enlace = enlaceActivo(paciente.id);
    if (!enlace) {
      const creado = crearEnlace(paciente.id, user.id);
      enlace = { token: creado.token };
      paciente.telefono = creado.paciente.telefono;
    }

    const destino = normalizarTelefono(paciente.telefono);
    if (!destino) {
      throw new HttpError(400, 'La paciente no tiene un teléfono válido registrado');
    }

    const url = urlEnlace(ctx, enlace.token);
    const mensaje = `Hola ${paciente.nombres} ${paciente.apellidos}, sus documentos clínicos están disponibles en: ${url}`;
    const manualUrl = `https://wa.me/${destino.replace(/\D/g, '')}?text=${encodeURIComponent(
      mensaje
    )}`;

    let enviado = false;
    let error = null;
    if (whatsappConfigurado()) {
      try {
        await enviarTextoWhatsApp(destino, mensaje);
        enviado = true;
      } catch (fallo) {
        error = fallo.message;
      }
    }

    audit(user.id, 'documentos_paciente_enviados_whatsapp', 'patients', paciente.id, {
      destino,
      enviado,
      error,
    });
    return { enviado, destino, url, manualUrl, error };
  });

  router.get('/api/patients/share/:token', (ctx) => {
    const enlace = enlaceDe(ctx.params.token);
    if (!enlace) throw new HttpError(404, 'Enlace no válido o revocado');

    db.prepare('UPDATE patient_share_links SET ultimo_acceso_en = ? WHERE id = ?').run(
      nowIso(),
      enlace.id
    );

    const archivos = archivosDePaciente(enlace.patient_id).map((examen) => ({
      ...examen,
      adjuntos: examen.adjuntos.map((adjunto) => ({
        id: adjunto.id,
        nombre: adjunto.nombre,
        mime: adjunto.mime,
        tamano: adjunto.tamano,
        url: `/api/patients/share/${encodeURIComponent(enlace.token)}/attachment/${encodeURIComponent(
          adjunto.id
        )}`,
      })),
    }));

    return {
      paciente: {
        nombres: enlace.nombres,
        apellidos: enlace.apellidos,
        cedula: enlace.cedula,
        fecha_nacimiento: enlace.fecha_nacimiento,
        sexo: enlace.sexo,
      },
      logoUrl: logoActual(),
      examenes: archivos,
    };
  });

  router.get('/api/patients/share/:token/attachment/:id', (ctx) => {
    const enlace = enlaceDe(ctx.params.token);
    if (!enlace) throw new HttpError(404, 'Enlace no válido o revocado');

    const adjunto = db
      .prepare(
        `SELECT ca.*
         FROM clinical_attachments ca
         JOIN clinical_exams ce ON ce.id = ca.exam_id
         JOIN clinical_records cr ON cr.id = ce.record_id
         WHERE ca.id = ? AND cr.patient_id = ?`
      )
      .get(ctx.params.id, enlace.patient_id);
    if (!adjunto) throw new HttpError(404, 'Archivo no encontrado');

    const absoluta = resolve(config.dataDir, adjunto.ruta);
    const base = resolve(config.dataDir);
    if (!absoluta.startsWith(base) || !existsSync(absoluta)) {
      throw new HttpError(404, 'No se encontró el archivo');
    }

    const buffer = readFileSync(absoluta);
    const descarga = ctx.url.searchParams.get('download') === '1';
    ctx.res.writeHead(200, {
      'content-type': adjunto.mime,
      'content-length': buffer.length,
      'content-disposition': `${descarga ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(
        adjunto.nombre
      )}`,
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    });
    ctx.res.end(buffer);
  });
}
