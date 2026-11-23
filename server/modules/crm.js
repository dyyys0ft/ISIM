import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, nowIso, uid } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import {
  configWhatsApp,
  enviarConfirmacionCita,
  enviarTextoWhatsApp,
  normalizarTelefono,
  whatsappConfigurado,
} from '../lib/whatsapp.js';
import {
  asegurarConversacion,
  buscarPacientePorTelefono,
  marcarConversacionLeida,
  registrarMensaje,
} from '../lib/crm.js';
import { requireUser } from './auth.js';

function limpiar(valor, max = 500) {
  return String(valor ?? '').trim().slice(0, max);
}

function contactoMapeado(fila) {
  return {
    ...fila,
    nombre: `${fila.nombres || ''} ${fila.apellidos || ''}`.trim(),
  };
}

function contactoDe(patientId) {
  const paciente = db
    .prepare(
      `SELECT id, nombres, apellidos, cedula, telefono, email, direccion, fecha_nacimiento,
              sexo, datos_incompletos, datos_incompletos_detalle
       FROM patients WHERE id = ? AND activo = 1`
    )
    .get(patientId);
  if (!paciente) throw new HttpError(404, 'Paciente no encontrada');
  return paciente;
}

function mensajesDe(conversationId, limit = 120) {
  const filas = db
    .prepare(
      `SELECT id, direccion, tipo, contenido, estado, error, appointment_id,
              proveedor_id, creado_en
       FROM crm_messages
       WHERE conversation_id = ?
       ORDER BY creado_en DESC
       LIMIT ?`
    )
    .all(conversationId, limit);
  return filas.reverse();
}

function detalleContacto(patientId) {
  const paciente = contactoDe(patientId);
  const conversacion = asegurarConversacion(patientId);
  marcarConversacionLeida(conversacion.id);

  const mensajes = mensajesDe(conversacion.id);
  const citas = db
    .prepare(
      `SELECT a.id, a.fecha_hora, a.duracion_min, a.motivo, a.estado,
              u.nombre AS medico_nombre
       FROM appointments a
       LEFT JOIN users u ON u.id = a.medico_id
       WHERE a.patient_id = ?
         AND a.fecha_hora >= ?
         AND a.estado NOT IN ('cancelada', 'no_asistio', 'reagendada')
       ORDER BY a.fecha_hora ASC
       LIMIT 8`
    )
    .all(patientId, nowIso());

  const tareas = db
    .prepare(
      `SELECT t.*, u.nombre AS asignado_nombre
       FROM crm_tasks t
       LEFT JOIN users u ON u.id = t.asignado_a
       WHERE t.patient_id = ?
       ORDER BY
         CASE t.estado WHEN 'pendiente' THEN 0 WHEN 'en_proceso' THEN 1 ELSE 2 END,
         CASE t.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
         t.fecha_limite IS NULL, t.fecha_limite ASC
       LIMIT 40`
    )
    .all(patientId);

  return {
    ...contactoMapeado(paciente),
    conversacion: { ...conversacion, no_leidos: 0 },
    mensajes,
    citas,
    tareas,
  };
}

function verificarFirmaWebhook(req, rawBody, appSecret) {
  if (!appSecret) return true;
  const firma = String(req.headers['x-hub-signature-256'] || '');
  if (!firma.startsWith('sha256=')) return false;
  const recibida = Buffer.from(firma.slice(7), 'hex');
  const esperada = createHmac('sha256', appSecret).update(rawBody).digest();
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

export function routes(router) {
  router.get('/api/crm/contacts', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_VER);

    const q = limpiar(ctx.url.searchParams.get('q'), 80);
    const limit = Math.min(Number(ctx.url.searchParams.get('limit') || 50), 100);
    const like = `%${q}%`;

    const filas = q
      ? db
          .prepare(
            `SELECT p.id, p.nombres, p.apellidos, p.cedula, p.telefono,
                    c.id AS conversation_id, c.no_leidos, c.ultimo_mensaje,
                    c.ultimo_mensaje_en, c.estado AS conversation_estado
             FROM patients p
             LEFT JOIN crm_conversations c ON c.patient_id = p.id
             WHERE p.activo = 1
               AND p.telefono IS NOT NULL AND trim(p.telefono) != ''
               AND (
                 sin_tildes(p.nombres || ' ' || p.apellidos) LIKE sin_tildes(?)
                 OR p.cedula LIKE ?
                 OR p.telefono LIKE ?
               )
             ORDER BY c.ultimo_mensaje_en IS NULL, c.ultimo_mensaje_en DESC,
                      p.apellidos COLLATE NOCASE, p.nombres COLLATE NOCASE
             LIMIT ?`
          )
          .all(like, like, like, limit)
      : db
          .prepare(
            `SELECT p.id, p.nombres, p.apellidos, p.cedula, p.telefono,
                    c.id AS conversation_id, c.no_leidos, c.ultimo_mensaje,
                    c.ultimo_mensaje_en, c.estado AS conversation_estado
             FROM patients p
             LEFT JOIN crm_conversations c ON c.patient_id = p.id
             WHERE p.activo = 1
               AND p.telefono IS NOT NULL AND trim(p.telefono) != ''
             ORDER BY c.ultimo_mensaje_en IS NULL, c.ultimo_mensaje_en DESC,
                      p.actualizado_en DESC
             LIMIT ?`
          )
          .all(limit);

    return filas.map(contactoMapeado);
  });

  router.get('/api/crm/contacts/:patientId', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_VER);
    return detalleContacto(ctx.params.patientId);
  });

  router.post('/api/crm/conversations/:id/read', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_VER);
    marcarConversacionLeida(ctx.params.id);
    audit(user.id, 'crm_conversacion_leida', 'crm_conversations', ctx.params.id, null);
    ctx.ok({ ok: true });
  });

  router.post('/api/crm/conversations/:id/messages', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_GESTIONAR);

    const texto = limpiar(ctx.body?.texto, 4000);
    if (!texto) throw new HttpError(400, 'Escribe un mensaje');

    const conversacion = db
      .prepare(
        `SELECT c.*, p.nombres, p.apellidos, p.telefono
         FROM crm_conversations c
         JOIN patients p ON p.id = c.patient_id
         WHERE c.id = ?`
      )
      .get(ctx.params.id);
    if (!conversacion) throw new HttpError(404, 'Conversación no encontrada');

    const destino = normalizarTelefono(conversacion.telefono);
    if (!destino) {
      throw new HttpError(400, 'La paciente no tiene un teléfono registrado.');
    }
    const manualUrl = `https://wa.me/${destino.replace(/\D/g, '')}?text=${encodeURIComponent(
      texto
    )}`;

    let estado = 'manual';
    let proveedorId = null;
    let error = null;

    if (whatsappConfigurado()) {
      try {
        const resultado = await enviarTextoWhatsApp(
          conversacion.telefono,
          texto
        );
        estado = 'enviado';
        proveedorId = resultado.proveedorId;
      } catch (fallo) {
        estado = 'error';
        error = fallo.message;
      }
    }

    const registrado = registrarMensaje({
      patientId: conversacion.patient_id,
      direccion: 'saliente',
      tipo: 'texto',
      contenido: texto,
      proveedorId,
      estado,
      error,
      creadoPor: user.id,
      telefono: conversacion.telefono,
      waId: conversacion.wa_id,
    });

    audit(user.id, 'crm_mensaje_enviado', 'crm_messages', registrado.id, {
      patientId: conversacion.patient_id,
      estado,
    });

    if (estado === 'error') {
      throw new HttpError(502, `No se pudo enviar el mensaje: ${error}`);
    }

    return {
      ok: true,
      mensaje: {
        id: registrado.id,
        direccion: 'saliente',
        tipo: 'texto',
        contenido: texto,
        estado,
        creado_en: nowIso(),
      },
      manual: estado === 'manual',
      manualUrl,
    };
  });

  router.get('/api/crm/tasks', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_VER);

    const patientId = String(ctx.url.searchParams.get('patientId') || '').trim();
    const estado = String(ctx.url.searchParams.get('estado') || '').trim();
    const tipo = String(ctx.url.searchParams.get('tipo') || '').trim();
    const prioridad = String(ctx.url.searchParams.get('prioridad') || '').trim();
    const q = limpiar(ctx.url.searchParams.get('q'), 80);
    const limit = Math.min(Math.max(Number(ctx.url.searchParams.get('limit') || 200), 1), 500);
    const condiciones = [];
    const valores = [];
    if (patientId) {
      condiciones.push('t.patient_id = ?');
      valores.push(patientId);
    }
    if (estado) {
      condiciones.push('t.estado = ?');
      valores.push(estado);
    }
    if (tipo) {
      condiciones.push('t.tipo = ?');
      valores.push(tipo);
    }
    if (prioridad) {
      condiciones.push('t.prioridad = ?');
      valores.push(prioridad);
    }
    if (q) {
      const like = `%${q}%`;
      condiciones.push(
        `(sin_tildes(t.motivo) LIKE sin_tildes(?)
          OR sin_tildes(COALESCE(t.descripcion, '')) LIKE sin_tildes(?)
          OR sin_tildes(p.nombres || ' ' || p.apellidos) LIKE sin_tildes(?)
          OR p.cedula LIKE ?)`
      );
      valores.push(like, like, like, like);
    }

    valores.push(limit);
    return db
      .prepare(
        `SELECT t.*, p.nombres, p.apellidos, p.cedula,
                u.nombre AS asignado_nombre
         FROM crm_tasks t
         JOIN patients p ON p.id = t.patient_id
         LEFT JOIN users u ON u.id = t.asignado_a
         ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
         ORDER BY
           CASE t.estado WHEN 'pendiente' THEN 0 WHEN 'en_proceso' THEN 1 ELSE 2 END,
           CASE t.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
           t.fecha_limite IS NULL, t.fecha_limite ASC
         LIMIT ?`
      )
      .all(...valores);
  });

  router.post('/api/crm/tasks', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_GESTIONAR);

    const patientId = String(ctx.body?.patientId || '').trim();
    if (!patientId) throw new HttpError(400, 'Selecciona una paciente');
    contactoDe(patientId);

    const tipo = ['tarea', 'queja', 'sugerencia'].includes(ctx.body?.tipo)
      ? ctx.body.tipo
      : 'tarea';
    const motivo = limpiar(ctx.body?.motivo, 200);
    if (!motivo) throw new HttpError(400, 'Escribe el motivo de la tarea');
    const prioridad = ['baja', 'media', 'alta', 'urgente'].includes(ctx.body?.prioridad)
      ? ctx.body.prioridad
      : 'media';
    const estado = ['pendiente', 'en_proceso', 'resuelta', 'cancelada'].includes(ctx.body?.estado)
      ? ctx.body.estado
      : 'pendiente';
    const fechaLimite = limpiar(ctx.body?.fechaLimite, 10);
    if (fechaLimite && !/^\d{4}-\d{2}-\d{2}$/.test(fechaLimite)) {
      throw new HttpError(400, 'La fecha límite no es válida');
    }

    const id = uid();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO crm_tasks
         (id, patient_id, tipo, motivo, descripcion, prioridad, estado, fecha_limite,
          asignado_a, creado_por, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      patientId,
      tipo,
      motivo,
      limpiar(ctx.body?.descripcion, 3000) || null,
      prioridad,
      estado,
      fechaLimite || null,
      String(ctx.body?.asignadoA || '').trim() || null,
      user.id,
      ts,
      ts
    );
    audit(user.id, 'crm_tarea_creada', 'crm_tasks', id, { patientId, tipo, motivo });
    ctx.ok({ id }, 201);
  });

  router.patch('/api/crm/tasks/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_GESTIONAR);

    const actual = db.prepare('SELECT * FROM crm_tasks WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Tarea no encontrada');

    const cambios = {};
    if (ctx.body?.motivo !== undefined) cambios.motivo = limpiar(ctx.body.motivo, 200);
    if (ctx.body?.descripcion !== undefined) {
      cambios.descripcion = limpiar(ctx.body.descripcion, 3000) || null;
    }
    if (['tarea', 'queja', 'sugerencia'].includes(ctx.body?.tipo)) {
      cambios.tipo = ctx.body.tipo;
    }
    if (['baja', 'media', 'alta', 'urgente'].includes(ctx.body?.prioridad)) {
      cambios.prioridad = ctx.body.prioridad;
    }
    if (['pendiente', 'en_proceso', 'resuelta', 'cancelada'].includes(ctx.body?.estado)) {
      cambios.estado = ctx.body.estado;
    }
    if (ctx.body?.fechaLimite !== undefined) {
      const fecha = limpiar(ctx.body.fechaLimite, 10);
      if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        throw new HttpError(400, 'La fecha límite no es válida');
      }
      cambios.fechaLimite = fecha || null;
    }
    if (ctx.body?.asignadoA !== undefined) {
      cambios.asignadoA = String(ctx.body.asignadoA || '').trim() || null;
    }

    const columnas = {
      motivo: 'motivo',
      descripcion: 'descripcion',
      tipo: 'tipo',
      prioridad: 'prioridad',
      estado: 'estado',
      fechaLimite: 'fecha_limite',
      asignadoA: 'asignado_a',
    };
    const entries = Object.entries(cambios);
    if (!entries.length) throw new HttpError(400, 'No hay cambios para guardar');
    const sets = entries.map(([campo]) => `${columnas[campo]} = ?`);
    const valores = entries.map(([, valor]) => valor);
    valores.push(nowIso(), ctx.params.id);
    db.prepare(
      `UPDATE crm_tasks SET ${sets.join(', ')}, actualizado_en = ? WHERE id = ?`
    ).run(...valores);
    audit(user.id, 'crm_tarea_actualizada', 'crm_tasks', ctx.params.id, cambios);
    ctx.ok({ ok: true });
  });

  router.post('/api/crm/appointments/:id/whatsapp', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CRM_GESTIONAR);

    const resultado = await enviarConfirmacionCita(ctx.params.id, user.id);
    audit(user.id, 'crm_cita_confirmada_whatsapp', 'appointments', ctx.params.id, {
      destino: resultado.destino,
      estado: resultado.estado,
    });
    ctx.ok(resultado);
  });

  // Verificación del webhook de Meta Cloud API.
  router.get('/api/whatsapp/webhook', (ctx) => {
    const modo = ctx.url.searchParams.get('hub.mode');
    const token = ctx.url.searchParams.get('hub.verify_token');
    const challenge = ctx.url.searchParams.get('hub.challenge');
    const config = configWhatsApp();

    if (modo === 'subscribe' && config.verifyToken && token === config.verifyToken) {
      ctx.res.writeHead(200, { 'content-type': 'text/plain' });
      ctx.res.end(String(challenge || ''));
      return undefined;
    }
    throw new HttpError(403, 'Verificación de webhook rechazada');
  });

  router.post('/api/whatsapp/webhook', (ctx) => {
    const config = configWhatsApp();
    if (!verificarFirmaWebhook(ctx.req, ctx.rawBody || Buffer.from(''), config.appSecret)) {
      throw new HttpError(401, 'Firma de webhook no válida');
    }

    const cuerpo = ctx.body || {};
    for (const entrada of cuerpo.entry || []) {
      for (const cambio of entrada.changes || []) {
        const valor = cambio.value || {};

        for (const estado of valor.statuses || []) {
          const proveedorId = estado.id;
          if (!proveedorId) continue;
          const nuevoEstado = estado.status;
          if (!nuevoEstado) continue;
          db.prepare('UPDATE crm_messages SET estado = ? WHERE proveedor_id = ?').run(
            nuevoEstado,
            proveedorId
          );
          db.prepare(
            'UPDATE appointment_notifications SET estado = ? WHERE proveedor_id = ?'
          ).run(nuevoEstado === 'failed' ? 'error' : 'enviado', proveedorId);
        }

        for (const mensaje of valor.messages || []) {
          const telefono = mensaje.from;
          const paciente = buscarPacientePorTelefono(telefono);
          if (!paciente) {
            console.warn(`[crm] Mensaje de WhatsApp sin paciente: ${telefono}`);
            continue;
          }

          let contenido = '';
          if (mensaje.type === 'text') contenido = mensaje.text?.body || '';
          else if (mensaje.type === 'image') contenido = mensaje.image?.caption || '[Imagen]';
          else if (mensaje.type === 'document') {
            contenido = mensaje.document?.caption || `[Documento: ${mensaje.document?.filename || ''}]`;
          } else {
            contenido = `[${mensaje.type || 'mensaje'}]`;
          }

          registrarMensaje({
            patientId: paciente.id,
            direccion: 'entrante',
            tipo: mensaje.type || 'texto',
            contenido,
            proveedorId: mensaje.id,
            estado: 'recibido',
            metadata: mensaje,
            telefono,
            waId: telefono,
          });
        }
      }
    }

    ctx.ok({ ok: true });
  });
}
