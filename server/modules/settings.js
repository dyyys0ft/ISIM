import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { db, nowIso, sha256 } from '../db/index.js';
import { APP_INFO, config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir, puede } from '../lib/permissions.js';
import { parsePngDataUrl, pngDimensions } from '../lib/images.js';
import { direccionCentro, logoActual, nombreCentro, textoPieActual } from '../lib/branding.js';
import { whatsappConfigurado } from '../lib/whatsapp.js';
import { activarDemo, contarDemo, desactivarDemo } from '../lib/demo.js';
import { TEXTOS_POR_DEFECTO } from '../lib/consentimientoIsim.js';
import { requireUser } from './auth.js';

function leer(clave) {
  return db.prepare('SELECT valor FROM settings WHERE clave = ?').get(clave)?.valor ?? null;
}

function limpiar(valor, max = 200) {
  return String(valor ?? '').trim().slice(0, max);
}

function guardar(clave, valor) {
  db.prepare(
    `INSERT OR REPLACE INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)`
  ).run(clave, valor, nowIso());
}

const HORARIO_POR_DEFECTO = {
  cupos_por_hora: 2,
  lv: {
    manana: ['09:30', '10:00', '10:30', '11:00', '11:30'],
    tarde: ['15:30', '16:00', '16:30', '17:00', '17:30'],
  },
  sabado: { manana: [], tarde: [] },
  domingo: { manana: [], tarde: [] },
};

const MEMBRETES_POR_DEFECTO = {
  iess: { encabezado: '', pie: '', ciudad: 'Riobamba' },
  atencion: { encabezado: '', pie: '', ciudad: 'Riobamba' },
};

function normalizarHoras(lista) {
  if (!Array.isArray(lista)) return [];
  const horas = [];
  for (const item of lista) {
    const hora = String(item ?? '').trim();
    if (!hora) continue;
    if (!/^\d{2}:\d{2}$/.test(hora)) {
      throw new HttpError(400, `La hora "${hora}" no es válida (usa el formato HH:MM)`);
    }
    const [h, m] = hora.split(':').map(Number);
    if (h > 23 || m > 59) {
      throw new HttpError(400, `La hora "${hora}" no es válida`);
    }
    if (!horas.includes(hora)) horas.push(hora);
  }
  return horas.sort();
}

function normalizarHorario(valor) {
  const base = valor && typeof valor === 'object' ? valor : {};
  const cupos = Math.min(Math.max(Number(base.cupos_por_hora ?? 2), 1), 20);
  const salida = { cupos_por_hora: Number.isFinite(cupos) ? cupos : 2 };
  for (const dia of ['lv', 'sabado', 'domingo']) {
    const fuente = base[dia] && typeof base[dia] === 'object' ? base[dia] : {};
    salida[dia] = {
      manana: normalizarHoras(fuente.manana),
      tarde: normalizarHoras(fuente.tarde),
    };
  }
  return salida;
}

function normalizarMembrete(valor) {
  const base = valor && typeof valor === 'object' ? valor : {};
  return {
    encabezado: String(base.encabezado ?? '').trim().slice(0, 400000),
    pie: String(base.pie ?? '').trim().slice(0, 400000),
    ciudad: String(base.ciudad ?? '').trim().slice(0, 120),
  };
}

function normalizarMembretes(valor) {
  const base = valor && typeof valor === 'object' ? valor : {};
  return {
    iess: normalizarMembrete(base.iess),
    atencion: normalizarMembrete(base.atencion),
  };
}

function leerJson(clave, porDefecto) {
  const crudo = leer(clave);
  if (!crudo) return porDefecto;
  try {
    const valor = JSON.parse(crudo);
    return valor && typeof valor === 'object' ? valor : porDefecto;
  } catch {
    return porDefecto;
  }
}

export function routes(router) {
  // Público: la pantalla de acceso y las pantallas abiertas lo usan para
  // mostrar la versión y detectar despliegues nuevos.
  router.get('/api/version', () => ({
    sistema: APP_INFO.sistema,
    version: APP_INFO.version,
    buildId: APP_INFO.buildId,
    actualizacionesAutomaticas: leer('actualizaciones_automaticas') === '1',
  }));

  router.get('/api/settings', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_VER);

    return {
      ...APP_INFO,
      logoUrl: logoActual(),
      logoActualizadoEn: leer('logo_actualizado_en'),
      centroNombre: nombreCentro(),
      centroDireccion: direccionCentro() || '',
      centroRuc: leer('centro_ruc') || '',
      centroTelefono: leer('centro_telefono') || '',
      consentimientoDeclaracion:
        leer('consentimiento_declaracion') || TEXTOS_POR_DEFECTO.declaracion,
      consentimientoNegativa:
        leer('consentimiento_negativa') || TEXTOS_POR_DEFECTO.negativa,
      consentimientoRevocatoria:
        leer('consentimiento_revocatoria') || TEXTOS_POR_DEFECTO.revocatoria,
      pieTexto: textoPieActual(),
      pieActualizadoEn: leer('pie_actualizado_en'),
      alertasExamenes: leer('alerta_examenes_pendientes') !== '0',
      permitirCitasSimultaneas: leer('permitir_citas_simultaneas') === '1',
      vistaAgenda: ['lista', 'jornada', 'calendario'].includes(leer('vista_agenda'))
        ? leer('vista_agenda')
        : 'jornada',
      actualizacionesAutomaticas: leer('actualizaciones_automaticas') === '1',
      whatsappHabilitado: leer('whatsapp_habilitado') === '1',
      whatsappPhoneNumberId: leer('whatsapp_phone_number_id') || '',
      whatsappApiVersion: leer('whatsapp_api_version') || 'v21.0',
      whatsappTemplate: leer('whatsapp_template') || 'confirmacion_cita',
      whatsappLanguage: leer('whatsapp_language') || 'es',
      whatsappCountryCode: leer('whatsapp_country_code') || '593',
      whatsappAuto: leer('whatsapp_auto') === '1',
      whatsappVerifyToken: leer('whatsapp_verify_token') || '',
      whatsappTieneAppSecret: Boolean(leer('whatsapp_app_secret')),
      whatsappTieneToken: Boolean(leer('whatsapp_token')),
      whatsappConfigurado: whatsappConfigurado(),
      demoActivo: leer('demo_activo') === '1',
      ...contarDemo(),
      puedeCambiarLogo: puede(user, PERMISOS.CONFIGURACION_GESTIONAR),
      puedeCambiarPie: puede(user, PERMISOS.CONFIGURACION_GESTIONAR),
      puedeCambiarCentro: puede(user, PERMISOS.CONFIGURACION_GESTIONAR),
    };
  });

  // Vista inicial de la agenda: lista, jornada o calendario.
  router.get('/api/settings/agenda-vista', (ctx) => {
    requireUser(ctx);
    const vista = leer('vista_agenda');
    return {
      vista: ['lista', 'jornada', 'calendario'].includes(vista) ? vista : 'jornada',
    };
  });

  router.put('/api/settings/agenda-vista', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);
    const vista = String(ctx.body?.vista || '').trim();
    if (!['lista', 'jornada', 'calendario'].includes(vista)) {
      throw new HttpError(400, 'La vista de agenda no es válida');
    }
    guardar('vista_agenda', vista);
    audit(user.id, 'vista_agenda_actualizada', 'settings', 'vista_agenda', { vista });
    ctx.ok({ vista });
  });

  // Horario de turnos (L–V con mañana y tarde; sábado y domingo configurables).
  router.get('/api/settings/horario', (ctx) => {
    // El horario lo necesita cualquier rol que vea la agenda; solo su
    // edición queda reservada a configuración.
    requireUser(ctx);
    return normalizarHorario(leerJson('horario_agenda', HORARIO_POR_DEFECTO));
  });

  router.put('/api/settings/horario', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);
    const horario = normalizarHorario(ctx.body);
    guardar('horario_agenda', JSON.stringify(horario));
    audit(user.id, 'horario_actualizado', 'settings', 'horario_agenda', {
      cuposPorHora: horario.cupos_por_hora,
    });
    ctx.ok(horario);
  });

  // Hojas membretadas para certificados IESS y de atención.
  router.get('/api/settings/membretes', (ctx) => {
    // Los membretes se usan al imprimir recetas y certificados; su edición
    // sigue reservada a configuración.
    requireUser(ctx);
    return normalizarMembretes(leerJson('membretes', MEMBRETES_POR_DEFECTO));
  });

  router.put('/api/settings/membretes', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);
    const membretes = normalizarMembretes(ctx.body);
    guardar('membretes', JSON.stringify(membretes));
    audit(user.id, 'membretes_actualizados', 'settings', 'membretes', null);
    ctx.ok(membretes);
  });

  // Público: lo usan el encabezado del documento y la pantalla de acceso.
  router.get('/api/settings/logo', (ctx) => {
    if (!existsSync(config.logoFile)) throw new HttpError(404, 'No hay logo configurado');

    const buffer = readFileSync(config.logoFile);
    ctx.res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': buffer.length,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    ctx.res.end(buffer);
  });

  // Datos institucionales que aparecen en los documentos y plantillas.
  router.post('/api/settings/centro', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const nombre = limpiar(ctx.body?.nombre, 200);
    const direccion = limpiar(ctx.body?.direccion, 300);
    const ruc = limpiar(ctx.body?.ruc, 30);
    const telefono = limpiar(ctx.body?.telefono, 30);
    if (!nombre) throw new HttpError(400, 'El nombre del centro médico es obligatorio');

    guardar('centro_nombre', nombre);
    guardar('centro_direccion', direccion);
    guardar('centro_ruc', ruc);
    guardar('centro_telefono', telefono);
    audit(user.id, 'centro_actualizado', 'settings', 'centro', {
      nombre,
      direccion,
      ruc,
      telefono,
    });
    ctx.ok({
      centroNombre: nombre,
      centroDireccion: direccion,
      centroRuc: ruc,
      centroTelefono: telefono,
    });
  });

  // Textos que se insertan en la plantilla de consentimiento informado.
  router.post('/api/settings/consentimiento', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const declaracion = limpiar(ctx.body?.declaracion, 2000);
    const negativa = limpiar(ctx.body?.negativa, 1500);
    const revocatoria = limpiar(ctx.body?.revocatoria, 1500);
    if (declaracion.length < 20) {
      throw new HttpError(400, 'El texto de la declaración es demasiado corto');
    }
    if (negativa.length < 10) {
      throw new HttpError(400, 'El texto de la negativa es demasiado corto');
    }
    if (revocatoria.length < 10) {
      throw new HttpError(400, 'El texto de la revocatoria es demasiado corto');
    }

    guardar('consentimiento_declaracion', declaracion);
    guardar('consentimiento_negativa', negativa);
    guardar('consentimiento_revocatoria', revocatoria);
    audit(user.id, 'textos_consentimiento_actualizados', 'settings', 'consentimiento', {
      declaracion: declaracion.length,
      negativa: negativa.length,
      revocatoria: revocatoria.length,
    });
    ctx.ok({
      consentimientoDeclaracion: declaracion,
      consentimientoNegativa: negativa,
      consentimientoRevocatoria: revocatoria,
    });
  });

  router.post('/api/settings/logo', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const buffer = parsePngDataUrl(ctx.body?.image, {
      minBytes: 300,
      maxBytes: 2 * 1024 * 1024,
    });
    const medidas = pngDimensions(buffer);
    if (medidas && (medidas.width < 40 || medidas.height < 20)) {
      throw new HttpError(400, 'El logo es demasiado pequeño (mínimo 40 × 20 px)');
    }

    writeFileSync(config.logoFile, buffer);
    const ts = nowIso();
    guardar('logo_actualizado_en', ts);
    guardar('logo_hash', sha256(buffer));
    guardar('logo_medidas', medidas ? `${medidas.width}x${medidas.height}` : '');

    audit(user.id, 'logo_actualizado', 'settings', 'logo', null);
    ctx.ok({ logoUrl: logoActual() });
  });

  router.delete('/api/settings/logo', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    if (existsSync(config.logoFile)) {
      try {
        unlinkSync(config.logoFile);
      } catch {
        // el archivo pudo no existir
      }
    }

    db.prepare("DELETE FROM settings WHERE clave LIKE 'logo_%'").run();
    audit(user.id, 'logo_eliminado', 'settings', 'logo', null);
    ctx.ok({ ok: true });
  });

  // Texto que aparece siempre al final de los documentos y de la pantalla de firma.
  router.post('/api/settings/pie', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const texto = String(ctx.body?.texto ?? '').replace(/\r\n/g, '\n').trim().slice(0, 1200);

    guardar('pie_texto', texto);
    guardar('pie_actualizado_en', nowIso());
    db.prepare("DELETE FROM settings WHERE clave IN ('pie_hash', 'pie_medidas')").run();

    audit(user.id, 'pie_actualizado', 'settings', 'pie', null);
    ctx.ok({ pieTexto: textoPieActual() });
  });

  router.delete('/api/settings/pie', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    db.prepare(
      "DELETE FROM settings WHERE clave IN ('pie_texto', 'pie_actualizado_en', 'pie_hash', 'pie_medidas')"
    ).run();
    audit(user.id, 'pie_eliminado', 'settings', 'pie', null);
    ctx.ok({ ok: true });
  });

  router.post('/api/settings/alertas', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const activa = ctx.body?.examenesPendientes !== false;
    guardar('alerta_examenes_pendientes', activa ? '1' : '0');
    audit(user.id, 'alertas_actualizadas', 'settings', 'alertas', {
      examenesPendientes: activa,
    });
    ctx.ok({ alertasExamenes: activa });
  });

  router.post('/api/settings/actualizaciones', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const automaticas = ctx.body?.automaticas === true;
    guardar('actualizaciones_automaticas', automaticas ? '1' : '0');
    audit(user.id, 'actualizaciones_actualizadas', 'settings', 'actualizaciones', {
      automaticas,
    });
    ctx.ok({ actualizacionesAutomaticas: automaticas });
  });

  router.post('/api/settings/agenda', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const permitir = ctx.body?.permitirCitasSimultaneas === true;
    guardar('permitir_citas_simultaneas', permitir ? '1' : '0');

    const vistaSolicitada = ctx.body?.vistaAgenda;
    if (vistaSolicitada !== undefined) {
      const vista = String(vistaSolicitada || '').trim();
      if (!['lista', 'jornada', 'calendario'].includes(vista)) {
        throw new HttpError(400, 'La vista de agenda no es válida');
      }
      guardar('vista_agenda', vista);
    }

    const vistaAgenda = ['lista', 'jornada', 'calendario'].includes(leer('vista_agenda'))
      ? leer('vista_agenda')
      : 'jornada';
    audit(user.id, 'agenda_actualizada', 'settings', 'agenda', {
      permitirCitasSimultaneas: permitir,
      vistaAgenda,
    });
    ctx.ok({ permitirCitasSimultaneas: permitir, vistaAgenda });
  });

  router.post('/api/settings/demo', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const activo = ctx.body?.activo === true;
    const resultado = activo ? activarDemo() : desactivarDemo();

    audit(user.id, activo ? 'demo_activado' : 'demo_desactivado', 'settings', 'demo', {
      antes: resultado.antes ?? null,
      ...contarDemo(),
    });

    ctx.ok({
      demoActivo: activo,
      ...contarDemo(),
      demoPacientesBloqueados: resultado.demoPacientesBloqueados || 0,
    });
  });

  router.post('/api/settings/whatsapp', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const habilitado = ctx.body?.habilitado === true;
    const auto = ctx.body?.auto === true;
    const phoneNumberId = limpiar(ctx.body?.phoneNumberId, 40);
    const apiVersion = limpiar(ctx.body?.apiVersion, 10) || 'v21.0';
    const template = limpiar(ctx.body?.template, 100) || 'confirmacion_cita';
    const language = limpiar(ctx.body?.language, 10) || 'es';
    const countryCode = limpiar(ctx.body?.countryCode, 4) || '593';
    const verifyToken = limpiar(ctx.body?.verifyToken, 200);
    const appSecret = String(ctx.body?.appSecret || '').trim();
    const token = String(ctx.body?.token || '').trim();

    if (phoneNumberId && !/^\d{5,40}$/.test(phoneNumberId)) {
      throw new HttpError(400, 'El Phone Number ID debe contener solo números');
    }
    if (!/^v\d+\.\d+$/.test(apiVersion)) {
      throw new HttpError(400, 'La versión de la API debe tener el formato v21.0');
    }
    if (!/^[A-Za-z0-9_]{3,100}$/.test(template)) {
      throw new HttpError(400, 'El nombre de la plantilla no es válido');
    }
    if (!/^\d{1,4}$/.test(countryCode)) {
      throw new HttpError(400, 'El código de país no es válido');
    }

    guardar('whatsapp_habilitado', habilitado ? '1' : '0');
    guardar('whatsapp_auto', auto ? '1' : '0');
    guardar('whatsapp_phone_number_id', phoneNumberId);
    guardar('whatsapp_api_version', apiVersion);
    guardar('whatsapp_template', template);
    guardar('whatsapp_language', language);
    guardar('whatsapp_country_code', countryCode);
    guardar('whatsapp_verify_token', verifyToken);
    if (appSecret) guardar('whatsapp_app_secret', appSecret);
    if (token) guardar('whatsapp_token', token);

    audit(user.id, 'whatsapp_configurado', 'settings', 'whatsapp', {
      habilitado,
      auto,
      phoneNumberId,
      template,
    });
    ctx.ok({ ok: true, whatsappConfigurado: whatsappConfigurado() });
  });

  router.delete('/api/settings/whatsapp/token', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    db.prepare("DELETE FROM settings WHERE clave = 'whatsapp_token'").run();
    audit(user.id, 'whatsapp_token_eliminado', 'settings', 'whatsapp', null);
    ctx.ok({ ok: true });
  });
}
