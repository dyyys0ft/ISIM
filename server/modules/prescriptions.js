import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, nowIso, uid } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import {
  direccionCentro,
  logoActual,
  nombreCentro,
  textoPieActual,
} from '../lib/branding.js';
import { urlBasePublica } from '../lib/red.js';
import { normalizarTelefono, whatsappConfigurado, enviarTextoWhatsApp } from '../lib/whatsapp.js';
import { requireUser } from './auth.js';

function limpiar(valor, max = 500) {
  return String(valor ?? '').trim().slice(0, max);
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

function datosParseados(valor) {
  if (!valor) return null;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}

function fechaLocal(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    const hoy = new Date();
    return {
      fecha: hoy.toISOString().slice(0, 10),
      hora: hoy.toTimeString().slice(0, 5),
    };
  }
  const local = new Date(fecha.getTime() - 5 * 60 * 60 * 1000);
  return {
    fecha: local.toISOString().slice(0, 10),
    hora: local.toISOString().slice(11, 16),
  };
}

function pacienteDeRegistro(recordId) {
  return db
    .prepare(
      `SELECT cr.*, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
              p.fecha_nacimiento, p.telefono, p.direccion,
              a.fecha_hora AS cita_fecha, a.motivo AS cita_motivo,
              u.id AS doctor_id, u.nombre AS doctor_nombre, u.cedula AS doctor_cedula,
              u.especialidad AS doctor_especialidad, u.senecit AS doctor_senecit,
              u.firma_png_path AS doctor_firma, u.firma_hash AS doctor_firma_hash
       FROM clinical_records cr
       JOIN patients p ON p.id = cr.patient_id
       JOIN appointments a ON a.id = cr.appointment_id
       LEFT JOIN users u ON u.id = cr.medico_id
       WHERE cr.id = ?`
    )
    .get(recordId);
}

function itemsDe(recetaId) {
  return db
    .prepare(
      `SELECT id, orden, medicamento, presentacion, dosis, via, frecuencia,
              duracion, cantidad, unidad, indicaciones, dci, concentracion
       FROM prescription_items
       WHERE prescription_id = ?
       ORDER BY orden ASC, creado_en ASC`
    )
    .all(recetaId);
}

function detalle(recetaId, { publico = false } = {}) {
  const receta = db
    .prepare(
      `SELECT pr.*, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
              p.fecha_nacimiento, p.telefono, p.direccion,
              a.fecha_hora AS cita_fecha, a.motivo AS cita_motivo,
              uc.nombre AS creado_por_nombre, ua.nombre AS anulada_por_nombre
       FROM prescriptions pr
       JOIN patients p ON p.id = pr.patient_id
       LEFT JOIN clinical_records cr ON cr.id = pr.record_id
       LEFT JOIN appointments a ON a.id = cr.appointment_id
       LEFT JOIN users uc ON uc.id = pr.creado_por
       LEFT JOIN users ua ON ua.id = pr.anulada_por
       WHERE pr.id = ?`
    )
    .get(recetaId);
  if (!receta) throw new HttpError(404, 'Receta médica no encontrada');

  const firmaUrl = receta.firma_png_path
    ? publico
      ? `/api/prescriptions/share/${encodeURIComponent(receta.share_token)}/firma`
      : `/api/prescriptions/${encodeURIComponent(receta.id)}/firma`
    : null;

  return {
    ...receta,
    datos: datosParseados(receta.datos) || {
      diagnostico: receta.diagnostico || '',
      cie: receta.cie10 || '',
      alergias: receta.alergias || '',
      recomendaciones: receta.recomendaciones || '',
      para_pareja: receta.para_pareja || 0,
    },
    items: itemsDe(receta.id),
    centro: {
      nombre: nombreCentro(),
      direccion: direccionCentro() || '',
      telefono:
        db.prepare("SELECT valor FROM settings WHERE clave = 'centro_telefono'").get()
          ?.valor || '',
      ruc:
        db.prepare("SELECT valor FROM settings WHERE clave = 'centro_ruc'").get()?.valor ||
        '',
    },
    elaborado:
      receta.creado_por_nombre &&
      receta.creado_por_nombre !== receta.medico_nombre
        ? receta.creado_por_nombre
        : null,
    logoUrl: logoActual(),
    firmaUrl,
    paciente: {
      nombres: receta.nombres,
      apellidos: receta.apellidos,
      cedula: receta.paciente_cedula,
      fecha_nacimiento: receta.fecha_nacimiento,
      telefono: receta.telefono,
      direccion: receta.direccion,
    },
  };
}

function defaultsParaRegistro(registro) {
  const fecha = fechaLocal(registro.fecha || registro.cita_fecha);
  return {
    id: null,
    record_id: registro.id,
    patient_id: registro.patient_id,
    medico_id: registro.doctor_id || null,
    fecha: fecha.fecha,
    hora: fecha.hora,
    lugar: registro.direccion || 'Riobamba',
    encabezado: 'ISIM - Instituto de la Salud Integral de la Mujer',
    pie: textoPieActual() || 'Gracias por su confianza.',
    indicaciones: '',
    medico_nombre: registro.doctor_nombre || '',
    medico_especialidad: registro.doctor_especialidad || '',
    medico_cedula: registro.doctor_cedula || '',
    medico_senecit: registro.doctor_senecit || '',
    items: [],
    logoUrl: logoActual(),
    firmaUrl: null,
    paciente: {
      nombres: registro.nombres,
      apellidos: registro.apellidos,
      cedula: registro.paciente_cedula,
      fecha_nacimiento: registro.fecha_nacimiento,
      telefono: registro.telefono,
      direccion: registro.direccion,
    },
    estado: 'borrador',
  };
}

function tokenSeguro() {
  return randomBytes(28).toString('hex');
}

export function routes(router) {
  router.get('/api/clinical-records/:id/prescription', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const registro = pacienteDeRegistro(ctx.params.id);
    if (!registro) throw new HttpError(404, 'Historia clínica no encontrada');

    const existente = db
      .prepare('SELECT id FROM prescriptions WHERE record_id = ?')
      .get(ctx.params.id);
    if (existente) return detalle(existente.id);
    return defaultsParaRegistro(registro);
  });

  router.put('/api/clinical-records/:id/prescription', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const registro = pacienteDeRegistro(ctx.params.id);
    if (!registro) throw new HttpError(404, 'Historia clínica no encontrada');

    const fecha = limpiar(ctx.body?.fecha, 10);
    const hora = limpiar(ctx.body?.hora, 8);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      throw new HttpError(400, 'La fecha de la receta no es válida');
    }
    if (hora && !/^\d{2}:\d{2}$/.test(hora)) {
      throw new HttpError(400, 'La hora de la receta no es válida');
    }

    const items = Array.isArray(ctx.body?.items) ? ctx.body.items : [];
    const medicamentos = items
      .map((item, indice) => ({
        orden: indice + 1,
        medicamento: limpiar(item.medicamento, 200),
        presentacion: limpiar(item.presentacion, 120),
        dosis: limpiar(item.dosis, 120),
        via: limpiar(item.via, 80),
        frecuencia: limpiar(item.frecuencia, 120),
        duracion: limpiar(item.duracion, 80),
        cantidad: limpiar(item.cantidad, 60),
        unidad: limpiar(item.unidad, 40),
        indicaciones: limpiar(item.indicaciones, 500),
        dci: limpiar(item.dci ?? item.generico, 200),
        concentracion: limpiar(item.concentracion, 120),
      }))
      .filter((item) => item.medicamento);

    if (!medicamentos.length) {
      throw new HttpError(400, 'Agrega al menos un medicamento a la receta');
    }

    const doctor =
      db
        .prepare(
          `SELECT id, nombre, cedula, especialidad, senecit, firma_png_path, firma_hash
           FROM users
           WHERE id = ? AND rol = 'medico' AND activo = 1`
        )
        .get(registro.doctor_id || (user.rol === 'medico' ? user.id : null)) ||
      db
        .prepare(
          `SELECT id, nombre, cedula, especialidad, senecit, firma_png_path, firma_hash
           FROM users
           WHERE rol = 'medico' AND activo = 1
           ORDER BY nombre COLLATE NOCASE
           LIMIT 1`
        )
        .get() ||
      user;

    const datosObj =
      ctx.body?.datos && typeof ctx.body.datos === 'object' ? ctx.body.datos : null;
    const datos = serializarDatos(ctx.body?.datos);
    const diagnostico = limpiar(ctx.body?.diagnostico ?? datosObj?.diagnostico, 500) || null;
    const cie10 = limpiar(ctx.body?.cie10 ?? datosObj?.cie, 40) || null;
    const alergias = limpiar(ctx.body?.alergias ?? datosObj?.alergias, 500) || null;
    const recomendaciones =
      limpiar(ctx.body?.recomendaciones ?? datosObj?.recomendaciones, 3000) || null;
    const paraPareja =
      (ctx.body?.paraPareja ?? datosObj?.para_pareja) ? 1 : 0;
    const ahora = nowIso();
    const existente = db
      .prepare(
        'SELECT id, share_token, numero, anulada_en FROM prescriptions WHERE record_id = ?'
      )
      .get(ctx.params.id);
    if (existente?.anulada_en) {
      throw new HttpError(
        409,
        'La receta está anulada y no se puede modificar. Registra una nueva consulta para emitir otra receta.'
      );
    }
    let recetaId = existente?.id;
    let shareToken = existente?.share_token;
    let numero = existente?.numero;
    if (!numero) {
      numero = db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM prescriptions').get().n;
    }

    if (recetaId) {
      db.prepare(
        `UPDATE prescriptions
         SET medico_id = ?, fecha = ?, hora = ?, lugar = ?, encabezado = ?, pie = ?,
             indicaciones = ?, datos = ?, numero = ?, diagnostico = ?, cie10 = ?, alergias = ?,
             recomendaciones = ?, para_pareja = ?, medico_nombre = ?, medico_especialidad = ?,
             medico_cedula = ?, medico_senecit = ?, firma_png_path = ?, firma_hash = ?,
             actualizado_en = ?
         WHERE id = ?`
      ).run(
        doctor.id,
        fecha,
        hora || null,
        limpiar(ctx.body?.lugar, 200) || null,
        limpiar(ctx.body?.encabezado, 500) || null,
        limpiar(ctx.body?.pie, 1000) || null,
        limpiar(ctx.body?.indicaciones, 3000) || null,
        datos ?? null,
        numero,
        diagnostico,
        cie10,
        alergias,
        recomendaciones,
        paraPareja,
        doctor.nombre,
        doctor.especialidad || null,
        doctor.cedula || null,
        doctor.senecit || null,
        doctor.firma_png_path || null,
        doctor.firma_hash || null,
        ahora,
        recetaId
      );
      db.prepare('DELETE FROM prescription_items WHERE prescription_id = ?').run(recetaId);
    } else {
      recetaId = uid();
      shareToken = tokenSeguro();
      db.prepare(
        `INSERT INTO prescriptions
           (id, record_id, patient_id, medico_id, fecha, hora, lugar, encabezado, pie,
            indicaciones, datos, numero, diagnostico, cie10, alergias, recomendaciones, para_pareja,
            medico_nombre, medico_especialidad, medico_cedula, medico_senecit,
            firma_png_path, firma_hash, estado, share_token, creado_por, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?, ?)`
      ).run(
        recetaId,
        ctx.params.id,
        registro.patient_id,
        doctor.id,
        fecha,
        hora || null,
        limpiar(ctx.body?.lugar, 200) || null,
        limpiar(ctx.body?.encabezado, 500) || null,
        limpiar(ctx.body?.pie, 1000) || null,
        limpiar(ctx.body?.indicaciones, 3000) || null,
        datos ?? null,
        numero,
        diagnostico,
        cie10,
        alergias,
        recomendaciones,
        paraPareja,
        doctor.nombre,
        doctor.especialidad || null,
        doctor.cedula || null,
        doctor.senecit || null,
        doctor.firma_png_path || null,
        doctor.firma_hash || null,
        shareToken,
        user.id,
        ahora,
        ahora
      );
    }

    if (alergias) {
      db.prepare('UPDATE patients SET alergias = ? WHERE id = ?').run(
        alergias,
        registro.patient_id
      );
    }

    const insertItem = db.prepare(
      `INSERT INTO prescription_items
         (id, prescription_id, orden, medicamento, presentacion, dosis, via,
          frecuencia, duracion, cantidad, unidad, indicaciones, dci, concentracion, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of medicamentos) {
      insertItem.run(
        uid(),
        recetaId,
        item.orden,
        item.medicamento,
        item.presentacion || null,
        item.dosis || null,
        item.via || null,
        item.frecuencia || null,
        item.duracion || null,
        item.cantidad || null,
        item.unidad || null,
        item.indicaciones || null,
        item.dci || null,
        item.concentracion || null,
        ahora
      );
    }

    audit(user.id, 'receta_guardada', 'prescriptions', recetaId, {
      recordId: ctx.params.id,
      items: medicamentos.length,
    });
    return detalle(recetaId);
  });

  router.get('/api/prescriptions/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);
    return detalle(ctx.params.id);
  });

  // Anula la receta sin borrarla: conserva el documento y su trazabilidad.
  router.post('/api/prescriptions/:id/annul', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const receta = db
      .prepare('SELECT id, anulada_en FROM prescriptions WHERE id = ?')
      .get(ctx.params.id);
    if (!receta) throw new HttpError(404, 'Receta médica no encontrada');
    if (receta.anulada_en) throw new HttpError(409, 'La receta ya está anulada');

    const motivo = limpiar(ctx.body?.motivo, 500) || null;
    const ahora = nowIso();
    db.prepare(
      `UPDATE prescriptions
       SET anulada_en = ?, anulada_por = ?, motivo_anulacion = ?, actualizado_en = ?
       WHERE id = ?`
    ).run(ahora, user.id, motivo, ahora, receta.id);

    audit(user.id, 'receta_anulada', 'prescriptions', receta.id, { motivo });
    ctx.ok({ ok: true, anuladaEn: ahora, motivo });
  });

  router.get('/api/prescriptions/:id/firma', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);
    return servirFirma(ctx, ctx.params.id, false);
  });

  router.get('/api/prescriptions/share/:token', (ctx) => {
    const receta = db
      .prepare('SELECT id FROM prescriptions WHERE share_token = ?')
      .get(ctx.params.token);
    if (!receta) throw new HttpError(404, 'Receta no disponible');
    return detalle(receta.id, { publico: true });
  });

  router.get('/api/prescriptions/share/:token/firma', (ctx) => {
    const receta = db
      .prepare('SELECT id FROM prescriptions WHERE share_token = ?')
      .get(ctx.params.token);
    if (!receta) throw new HttpError(404, 'Receta no disponible');
    return servirFirma(ctx, receta.id, true);
  });

  router.post('/api/prescriptions/:id/share', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const receta = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(ctx.params.id);
    if (!receta) throw new HttpError(404, 'Receta médica no encontrada');

    let token = receta.share_token;
    if (!token) {
      token = tokenSeguro();
      db.prepare('UPDATE prescriptions SET share_token = ? WHERE id = ?').run(token, receta.id);
    }

    const ruta = `/receta.html?t=${encodeURIComponent(token)}`;
    audit(user.id, 'receta_compartida', 'prescriptions', receta.id, null);
    return {
      token,
      ruta,
      url: `${urlBasePublica(ctx.req)}${ruta}`,
    };
  });

  router.post('/api/prescriptions/:id/whatsapp', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const receta = db
      .prepare(
        `SELECT pr.*, p.telefono, p.nombres, p.apellidos,
                cr.id AS record_id
         FROM prescriptions pr
         JOIN patients p ON p.id = pr.patient_id
         JOIN clinical_records cr ON cr.id = pr.record_id
         WHERE pr.id = ?`
      )
      .get(ctx.params.id);
    if (!receta) throw new HttpError(404, 'Receta médica no encontrada');

    const destino = normalizarTelefono(receta.telefono);
    if (!destino) throw new HttpError(400, 'La paciente no tiene un teléfono válido registrado');

    let token = receta.share_token;
    if (!token) {
      token = tokenSeguro();
      db.prepare('UPDATE prescriptions SET share_token = ? WHERE id = ?').run(token, receta.id);
    }

    const url = `${urlBasePublica(ctx.req)}/receta.html?t=${encodeURIComponent(token)}`;
    const mensaje = `Hola ${receta.nombres} ${receta.apellidos}, le compartimos su receta médica digital: ${url}`;
    const manualUrl = `https://wa.me/${destino.replace(/\D/g, '')}?text=${encodeURIComponent(
      mensaje
    )}`;

    let enviado = false;
    let error = null;
    if (whatsappConfigurado()) {
      try {
        await enviarTextoWhatsApp(destino, mensaje);
        enviado = true;
        db.prepare(
          'UPDATE prescriptions SET enviado_en = ?, actualizado_en = ? WHERE id = ?'
        ).run(nowIso(), nowIso(), receta.id);
      } catch (fallo) {
        error = fallo.message;
      }
    }

    audit(user.id, 'receta_enviada_whatsapp', 'prescriptions', receta.id, {
      destino,
      enviado,
      error,
    });
    return { enviado, destino, url, manualUrl, error };
  });
}

function servirFirma(ctx, recetaId, publico) {
  const receta = db
    .prepare('SELECT firma_png_path FROM prescriptions WHERE id = ?')
    .get(recetaId);
  if (!receta?.firma_png_path) throw new HttpError(404, 'La receta no tiene firma registrada');

  const absoluta = resolve(config.dataDir, receta.firma_png_path);
  if (!absoluta.startsWith(resolve(config.dataDir)) || !existsSync(absoluta)) {
    throw new HttpError(404, 'No se encontró el archivo de la firma');
  }
  const buffer = readFileSync(absoluta);
  ctx.res.writeHead(200, {
    'content-type': 'image/png',
    'content-length': buffer.length,
    'cache-control': publico ? 'public, max-age=60' : 'private, max-age=60',
  });
  ctx.res.end(buffer);
}
