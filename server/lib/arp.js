import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

/**
 * Resolución de direcciones MAC para la lista blanca IP + MAC.
 *
 * Solo funciona para equipos del mismo segmento de red (la MAC viaja en la
 * trama Ethernet y no atraviesa routers). Para el propio equipo se lee de las
 * interfaces locales. Si la MAC no se puede resolver, la entrada con MAC queda
 * bloqueada: así la combinación IP + MAC es realmente la clave.
 */

const TTL_MS = 20_000;
let cache = { tabla: new Map(), actualizado: 0 };

export function normalizarMac(valor) {
  const hex = String(valor ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

function macDeInterfaces(ip) {
  for (const lista of Object.values(networkInterfaces())) {
    for (const item of lista || []) {
      if (item.family !== 'IPv4' || item.address !== ip) continue;
      const mac = normalizarMac(item.mac);
      if (mac && mac !== '00:00:00:00:00:00') return mac;
    }
  }
  return null;
}

function leerSalida() {
  if (process.platform === 'win32') {
    return execFileSync('arp', ['-a'], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
  }

  try {
    return execFileSync('ip', ['neigh', 'show'], {
      encoding: 'utf8',
      timeout: 4000,
    });
  } catch {
    try {
      return readFileSync('/proc/net/arp', 'utf8');
    } catch {
      return '';
    }
  }
}

function leerTablaArp() {
  if (Date.now() - cache.actualizado < TTL_MS) return cache.tabla;

  const tabla = new Map();
  try {
    for (const linea of leerSalida().split(/\r?\n/)) {
      const ip = linea.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
      const mac = linea.match(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i)?.[0];
      if (!ip || !mac) continue;
      const normalizada = normalizarMac(mac);
      if (normalizada) tabla.set(ip, normalizada);
    }
  } catch {
    // El comando arp/ip no está disponible: se devuelve una tabla vacía.
  }

  cache = { tabla, actualizado: Date.now() };
  return tabla;
}

/** Devuelve la MAC normalizada del equipo con esa IP, o null. */
export function macDeIp(ip) {
  const propio = macDeInterfaces(ip);
  if (propio) return propio;
  return leerTablaArp().get(ip) || null;
}

export function invalidarCacheMac() {
  cache = { tabla: new Map(), actualizado: 0 };
}
