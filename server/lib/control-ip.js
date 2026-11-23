import { isIP } from 'node:net';
import { db, nowIso } from '../db/index.js';
import { macDeIp, normalizarMac } from './arp.js';

/**
 * Control de acceso por IP para despliegues en intranet.
 *
 * La lista se guarda en `ips_permitidas` y las banderas en `settings`.
 * El estado se mantiene en memoria y se recarga al iniciar y cada vez que el
 * administrador cambia la configuración, para no consultar la base en cada
 * petición. El loopback siempre tiene acceso para no perder el control local.
 */

const CLAVE_RESTRICCION = 'red_ip_restriccion';
const CLAVE_PROXY = 'red_confiar_proxy';

let estado = { activa: false, confiarProxy: false, ips: [] };
let cargado = false;
const observadores = new Set();
const ultimoRegistro = new Map();
const INTERVALO_REGISTRO_MS = 30_000;

/** Permite a otros módulos reaccionar cuando cambia la lista (ej.: cerrar proxies). */
export function alCambiarControlIp(funcion) {
  observadores.add(funcion);
  return () => observadores.delete(funcion);
}

function leer(clave) {
  return db.prepare('SELECT valor FROM settings WHERE clave = ?').get(clave)?.valor ?? null;
}

function asegurarCargado() {
  if (!cargado) recargarControlIp();
}

export function recargarControlIp() {
  estado = {
    activa: leer(CLAVE_RESTRICCION) === '1',
    confiarProxy: leer(CLAVE_PROXY) === '1',
    ips: db
      .prepare('SELECT ip, mac FROM ips_permitidas ORDER BY ip')
      .all()
      .map((fila) => ({ ip: fila.ip, mac: fila.mac || null })),
  };
  cargado = true;
  ultimoRegistro.clear();
  for (const observador of observadores) {
    try {
      observador();
    } catch {
      // un observador defectuoso no debe impedir el cambio de permisos
    }
  }
  return estadoControlIp();
}

export function estadoControlIp() {
  asegurarCargado();
  return { ...estado, ips: [...estado.ips] };
}

/** Normaliza la dirección que entrega Node (IPv4 mapeada o ::1). */
export function normalizarIp(valor) {
  let ip = String(valor ?? '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return ip;
}

export function esLoopback(ip) {
  const normalizada = normalizarIp(ip);
  return normalizada === '127.0.0.1' || normalizada.startsWith('127.');
}

/**
 * IP efectiva del cliente. Por defecto se usa el socket, que no se puede
 * falsificar. Solo si el administrador activa `confiarProxy` se toma el primer
 * valor de X-Forwarded-For (cabecera que un proxy de intranet sí controla).
 */
export function ipDelCliente(req) {
  const directa = normalizarIp(req?.socket?.remoteAddress || '');
  if (estado.confiarProxy) {
    const reenviada = String(req?.headers?.['x-forwarded-for'] || '')
      .split(',')[0]
      .trim();
    if (reenviada) return normalizarIp(reenviada);
  }
  return directa;
}

function ipv4Entero(ip) {
  const partes = String(ip).split('.');
  if (partes.length !== 4 || !partes.every((p) => /^\d{1,3}$/.test(p))) return null;
  const numeros = partes.map(Number);
  if (numeros.some((n) => n < 0 || n > 255)) return null;
  return ((numeros[0] << 24) | (numeros[1] << 16) | (numeros[2] << 8) | numeros[3]) >>> 0;
}

function coincide(ip, entrada) {
  if (ip === entrada) return true;

  const separado = entrada.split('/');
  if (separado.length !== 2) return false;
  const [base, bitsTexto] = separado;
  const versionIp = isIP(ip);
  const versionBase = isIP(base);
  if (!versionIp || !versionBase || versionIp !== versionBase) return false;
  if (!/^\d{1,3}$/.test(bitsTexto)) return false;

  const bits = Number(bitsTexto);
  if (!Number.isInteger(bits) || bits < 0 || bits > (versionIp === 4 ? 32 : 128)) return false;
  if (versionIp === 6) {
    return bits === 128 && ip.toLowerCase() === base.toLowerCase();
  }

  const valorIp = ipv4Entero(ip);
  const valorBase = ipv4Entero(base);
  if (valorIp === null || valorBase === null) return false;
  const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (valorIp & mascara) === (valorBase & mascara);
}

/**
 * Responde si la IP (y su MAC cuando la entrada la exige) puede usar el
 * sistema según la lista blanca vigente.
 */
export function accesoPermitido(ip) {
  asegurarCargado();
  if (!estado.activa) return true;
  const normalizada = normalizarIp(ip);
  if (esLoopback(normalizada)) return true;

  const entrada = estado.ips.find((item) => coincide(normalizada, item.ip));
  if (!entrada) return false;

  // Si la entrada no exige MAC, basta la IP (modo anterior).
  if (!entrada.mac) return true;

  const mac = macDeIp(normalizada);
  return Boolean(mac) && mac === normalizarMac(entrada.mac);
}

/** Indica si una IP pertenece a alguna entrada de la lista blanca. */
export function ipEstaEnLista(ip) {
  asegurarCargado();
  const normalizada = normalizarIp(ip);
  return estado.ips.some((entrada) => coincide(normalizada, entrada.ip));
}

/**
 * Registra el último acceso de una IP listada. Se limita a una escritura cada
 * 30 s por entrada para no llenar la base con una escritura por petición.
 */
export function registrarAccesoIp(ip) {
  asegurarCargado();
  const normalizada = normalizarIp(ip);
  if (esLoopback(normalizada)) return;

  const entrada = estado.ips.find((item) => coincide(normalizada, item.ip));
  if (!entrada) return;

  const ahora = Date.now();
  if (ahora - (ultimoRegistro.get(entrada.ip) || 0) < INTERVALO_REGISTRO_MS) return;
  ultimoRegistro.set(entrada.ip, ahora);

  db.prepare(
    'UPDATE ips_permitidas SET ultimo_acceso_en = ?, accesos = accesos + 1 WHERE ip = ?'
  ).run(nowIso(), entrada.ip);
}

/** Valida y normaliza una MAC (AA:BB:CC:DD:EE:FF) antes de guardarla. */
export function validarEntradaMac(valor) {
  return normalizarMac(valor);
}

/** Valida y normaliza una IP o rango CIDR IPv4/IPv6 antes de guardarlo. */
export function validarEntradaIp(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto || texto.length > 60) return null;

  if (!texto.includes('/')) {
    const version = isIP(texto);
    if (!version) return null;
    return version === 6 ? texto.toLowerCase() : normalizarIp(texto);
  }

  const partes = texto.split('/');
  if (partes.length !== 2 || !/^\d{1,3}$/.test(partes[1])) return null;
  const version = isIP(partes[0]);
  if (!version) return null;
  const bits = Number(partes[1]);
  if (!Number.isInteger(bits) || bits < 0 || bits > (version === 4 ? 32 : 128)) return null;
  return version === 6 ? `${partes[0].toLowerCase()}/${bits}` : `${normalizarIp(partes[0])}/${bits}`;
}
