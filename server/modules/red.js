import { config } from '../config.js';
import { db, nowIso } from '../db/index.js';
import { direccionesLocales, ipLocal } from '../lib/red.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir, puede } from '../lib/permissions.js';
import {
  estadoControlIp,
  ipEstaEnLista,
  recargarControlIp,
  validarEntradaIp,
  validarEntradaMac,
} from '../lib/control-ip.js';
import { invalidarCacheMac, macDeIp } from '../lib/arp.js';
import { ping } from '../lib/ping.js';
import {
  aplicarPuerto,
  estadoProxy,
  puertosDisponibles,
  puertoSeleccionado,
} from '../lib/puerto-acceso.js';
import { requireUser } from './auth.js';

function guardar(clave, valor) {
  db.prepare(
    `INSERT OR REPLACE INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)`
  ).run(clave, valor, nowIso());
}

function urlDe(host, puerto, seguro = false) {
  const anfitrion = host && host.includes(':') ? `[${host}]` : host || 'localhost';
  const puertoVisible = puerto === (seguro ? 443 : 80) ? '' : `:${puerto}`;
  return `${seguro ? 'https' : 'http'}://${anfitrion}${puertoVisible}/`;
}

/** Estado completo que consume la pantalla de ajustes. */
function estadoRed(user = null) {
  const ip = ipLocal();
  const seleccionado = puertoSeleccionado();

  return {
    host: config.host,
    ipLocal: ip,
    direccionesLocales: direccionesLocales(),
    puertoEscucha: config.port,
    puertoHttps: config.httpsPort,
    puertoSeleccionado: seleccionado,
    urlAcceso: urlDe(ip, seleccionado),
    urlAccesoHttps: urlDe(ip, config.httpsPort, true),
    urlLocal: urlDe('localhost', seleccionado),
    proxy: estadoProxy(),
    ...estadoControlIp(),
    ...(user ? { puedeGestionar: puede(user, PERMISOS.CONFIGURACION_GESTIONAR) } : {}),
  };
}

function ipsGuardadas() {
  return db
    .prepare(
      `SELECT ip, mac, descripcion, creado_en, ultimo_acceso_en, accesos
       FROM ips_permitidas ORDER BY ip`
    )
    .all()
    .map((fila) => ({
      ip: fila.ip,
      mac: fila.mac || null,
      descripcion: fila.descripcion || '',
      creadoEn: fila.creado_en,
      ultimoAccesoEn: fila.ultimo_acceso_en || null,
      accesos: fila.accesos || 0,
    }));
}

export function routes(router) {
  router.get('/api/settings/red', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_VER);
    return { ...estadoRed(user), ips: ipsGuardadas() };
  });

  router.get('/api/settings/red/puertos', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_VER);
    return { puertos: await puertosDisponibles() };
  });

  router.post('/api/settings/red/puerto', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const antes = estadoProxy();
    let proxy;
    try {
      proxy = await aplicarPuerto(ctx.body?.puerto);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    if (proxy.error) throw new HttpError(409, proxy.error);

    audit(user.id, 'red_puerto_actualizado', 'settings', 'red', {
      antes: antes.seleccionado,
      despues: proxy.seleccionado,
    });
    ctx.ok({ ...estadoRed(user), ips: ipsGuardadas() });
  });

  router.post('/api/settings/red/restriccion', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const activa = ctx.body?.activa === true;
    const confiarProxy = ctx.body?.confiarProxy === true;
    const antes = estadoControlIp();

    guardar('red_ip_restriccion', activa ? '1' : '0');
    guardar('red_confiar_proxy', confiarProxy ? '1' : '0');
    recargarControlIp();

    audit(user.id, 'red_restriccion_actualizada', 'settings', 'red', {
      activa,
      confiarProxy,
      antesActiva: antes.activa,
    });
    ctx.ok({ ...estadoRed(user), ips: ipsGuardadas() });
  });

  router.post('/api/settings/red/ping', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_VER);

    const ip = validarEntradaIp(ctx.body?.ip);
    if (!ip) throw new HttpError(400, 'IP no válida');
    if (!ipEstaEnLista(ip)) throw new HttpError(404, 'La IP no está en la lista blanca');

    return ping(ip);
  });

  router.post('/api/settings/red/mac', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_VER);

    const ip = validarEntradaIp(ctx.body?.ip);
    if (!ip) throw new HttpError(400, 'IP no válida');
    if (ip.includes('/')) throw new HttpError(400, 'La MAC solo aplica a una IP exacta');

    // Un ping previo fuerza la entrada ARP cuando el equipo aún no se ha visto.
    await ping(ip);
    invalidarCacheMac();
    const mac = macDeIp(ip);
    if (!mac) {
      throw new HttpError(
        404,
        'No se pudo determinar la MAC. Verifica que el equipo esté encendido y en la misma red.'
      );
    }

    return { ip, mac };
  });

  router.post('/api/settings/red/ips', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const ip = validarEntradaIp(ctx.body?.ip);
    if (!ip) throw new HttpError(400, 'Escribe una IP válida (o un rango CIDR como 192.168.1.0/24)');
    const descripcion = String(ctx.body?.descripcion || '')
      .trim()
      .slice(0, 200);

    const macEnviada = ctx.body?.mac;
    let mac = null;
    if (macEnviada !== undefined && macEnviada !== null && String(macEnviada).trim() !== '') {
      mac = validarEntradaMac(macEnviada);
      if (!mac) {
        throw new HttpError(400, 'La MAC debe tener el formato AA:BB:CC:DD:EE:FF');
      }
      if (ip.includes('/')) {
        throw new HttpError(400, 'La MAC solo se puede exigir a una IP exacta, no a un rango');
      }
    }

    const existente = db.prepare('SELECT mac FROM ips_permitidas WHERE ip = ?').get(ip);
    const macFinal = macEnviada === undefined ? existente?.mac || null : mac;

    db.prepare(
      `INSERT INTO ips_permitidas (ip, mac, descripcion, creado_por, creado_en)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         mac = excluded.mac,
         descripcion = excluded.descripcion`
    ).run(ip, macFinal, descripcion, user.id, nowIso());
    recargarControlIp();

    audit(user.id, 'red_ip_agregada', 'settings', 'red', {
      ip,
      mac: macFinal,
      descripcion,
    });
    ctx.ok({ ...estadoRed(user), ips: ipsGuardadas() });
  });

  router.delete('/api/settings/red/ips', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const ip = String(ctx.body?.ip || '').trim();
    if (!ip) throw new HttpError(400, 'Falta la IP a eliminar');

    const resultado = db.prepare('DELETE FROM ips_permitidas WHERE ip = ?').run(ip);
    if (!resultado.changes) throw new HttpError(404, 'La IP no estaba en la lista');
    recargarControlIp();

    audit(user.id, 'red_ip_eliminada', 'settings', 'red', { ip });
    ctx.ok({ ...estadoRed(user), ips: ipsGuardadas() });
  });
}
