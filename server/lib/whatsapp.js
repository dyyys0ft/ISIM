import { db, nowIso, uid } from '../db/index.js';
import { HttpError } from './http.js';
import { leerAjuste } from './ajustes.js';
import { registrarMensaje } from './crm.js';

const ZONA_HORARIA = 'America/Guayaquil';

export function configWhatsApp() {
  return {
    habilitado: leerAjuste('whatsapp_habilitado') === '1',
    phoneNumberId: leerAjuste('whatsapp_phone_number_id', '') || '',
    token: leerAjuste('whatsapp_token', '') || '',
    apiVersion: leerAjuste('whatsapp_api_version', 'v21.0') || 'v21.0',
    template: leerAjuste('whatsapp_template', 'confirmacion_cita') || 'confirmacion_cita',
    language: leerAjuste('whatsapp_language', 'es') || 'es',
    countryCode: leerAjuste('whatsapp_country_code', '593') || '593',
    auto: leerAjuste('whatsapp_auto') === '1',
    verifyToken: leerAjuste('whatsapp_verify_token', '') || '',
    appSecret: leerAjuste('whatsapp_app_secret', '') || '',
  };
}

export function whatsappConfigurado() {
  const config = configWhatsApp();
  return Boolean(config.habilitado && config.phoneNumberId && config.token && config.template);
}

export function whatsappAuto() {
  return configWhatsApp().auto;
}

/** Convierte un teléfono local a formato E.164. Ecuador usa 593 por defecto. */
export function normalizarTelefono(telefono, countryCode = '593') {
  let digits = String(telefono || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(countryCode)) return `+${digits}`;
  if (digits.startsWith('0')) return `+${countryCode}${digits.slice(1)}`;
  if (digits.length <= 10) return `+${countryCode}${digits}`;
  return `+${digits}`;
}

function fechaHoraCita(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return { fecha: '', hora: '' };

  const fechaTexto = fecha.toLocaleDateString('es-EC', {
    timeZone: ZONA_HORARIA,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const horaTexto = fecha.toLocaleTimeString('es-EC', {
    timeZone: ZONA_HORARIA,
    hour: '2-digit',
    minute: '2-digit',
  });

  return { fecha: fechaTexto, hora: horaTexto };
}

export async function enviarTextoWhatsApp(telefono, texto) {
  const config = configWhatsApp();
  if (!config.habilitado) {
    throw new HttpError(400, 'WhatsApp no está habilitado en Ajustes');
  }
  if (!config.phoneNumberId || !config.token) {
    throw new HttpError(400, 'Configura el Phone Number ID y el token de WhatsApp');
  }

  const destino = normalizarTelefono(telefono, config.countryCode);
  if (!destino) throw new HttpError(400, 'El teléfono no es válido');

  const respuesta = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: destino,
        type: 'text',
        text: { preview_url: true, body: String(texto || '').slice(0, 4000) },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    datos = null;
  }
  if (!respuesta.ok) {
    throw new HttpError(
      502,
      datos?.error?.message || `Error ${respuesta.status} de WhatsApp`
    );
  }
  return { destino, proveedorId: datos?.messages?.[0]?.id || null };
}

function registrarNotificacion({
  appointmentId,
  destino,
  plantilla,
  estado,
  proveedorId,
  error,
  userId,
}) {
  const id = uid();
  db.prepare(
    `INSERT INTO appointment_notifications
       (id, appointment_id, canal, destino, plantilla, estado, proveedor_id, error,
        creado_por, creado_en)
     VALUES (?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    appointmentId,
    destino,
    plantilla || null,
    estado,
    proveedorId || null,
    error || null,
    userId || null,
    nowIso()
  );
  return id;
}

/**
 * Envía la confirmación de una cita por WhatsApp Cloud API y registra el
 * resultado en appointment_notifications.
 */
export async function enviarConfirmacionCita(appointmentId, userId = null) {
  const cita = db
    .prepare(
      `SELECT a.*, p.nombres, p.apellidos, p.telefono, u.nombre AS medico_nombre
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       LEFT JOIN users u ON u.id = a.medico_id
       WHERE a.id = ?`
    )
    .get(appointmentId);

  if (!cita) throw new HttpError(404, 'Cita no encontrada');
  if (['cancelada', 'no_asistio'].includes(cita.estado)) {
    throw new HttpError(409, 'No se puede enviar confirmación de una cita cancelada');
  }

  const config = configWhatsApp();
  if (!config.habilitado) {
    throw new HttpError(400, 'WhatsApp no está habilitado en Ajustes');
  }
  if (!config.phoneNumberId || !config.token) {
    throw new HttpError(400, 'Configura el Phone Number ID y el token de WhatsApp');
  }

  const destino = normalizarTelefono(cita.telefono, config.countryCode);
  if (!destino) {
    throw new HttpError(400, 'La paciente no tiene un teléfono válido registrado');
  }

  const { fecha, hora } = fechaHoraCita(cita.fecha_hora);
  const parametros = [
    `${cita.nombres} ${cita.apellidos}`.trim(),
    fecha,
    hora,
    cita.medico_nombre || 'su médico',
  ];

  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  const cuerpo = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: destino,
    type: 'template',
    template: {
      name: config.template,
      language: { code: config.language },
      components: [
        {
          type: 'body',
          parameters: parametros.map((texto) => ({ type: 'text', text: texto })),
        },
      ],
    },
  };

  let estado = 'enviado';
  let proveedorId = null;
  let error = null;

  try {
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(25000),
    });

    let datos = null;
    try {
      datos = await respuesta.json();
    } catch {
      datos = null;
    }

    if (!respuesta.ok) {
      estado = 'error';
      error = datos?.error?.message || `Error ${respuesta.status} de WhatsApp`;
    } else {
      proveedorId = datos?.messages?.[0]?.id || null;
    }
  } catch (fallo) {
    estado = 'error';
    error = fallo.message || 'No se pudo conectar con WhatsApp';
  }

  const logId = registrarNotificacion({
    appointmentId: cita.id,
    destino,
    plantilla: config.template,
    estado,
    proveedorId,
    error,
    userId,
  });

  registrarMensaje({
    patientId: cita.patient_id,
    appointmentId: cita.id,
    direccion: 'saliente',
    tipo: 'template',
    contenido:
      estado === 'error'
        ? `No se pudo enviar la confirmación de la cita: ${error}`
        : `Confirmación de cita enviada para el ${fecha} a las ${hora}`,
    proveedorId,
    estado,
    error,
    creadoPor: userId,
    metadata: { plantilla: config.template, destino },
  });

  if (estado === 'error') {
    throw new HttpError(502, `No se pudo enviar el WhatsApp: ${error}`);
  }

  return { ok: true, id: logId, estado, destino, proveedorId };
}
