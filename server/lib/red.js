import { networkInterfaces } from 'node:os';
import { config } from '../config.js';
import { httpsActivo } from './https.js';

const nombreVirtual =
  /vmware|virtualbox|vbox|vethernet|hyper-v|tailscale|docker|loopback|bluetooth|vpn|tap|tun|zerotier|radmin|hamachi/i;
const macVirtual = /^(00:50:56|00:0c:29|00:05:69|00:1c:14|08:00:27|00:15:5d)/i;
const nombreFisico = /wi-?fi|wlan|ethernet|eth\d|en\d/i;

function prioridad({ ip, nombre, mac }) {
  if (nombreVirtual.test(nombre) || macVirtual.test(mac)) return 100;

  let base = nombreFisico.test(nombre) ? 0 : 5;
  if (ip.startsWith('192.168.')) base += 0;
  else if (ip.startsWith('10.')) base += 1;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) base += 2;
  else base += 3;

  return base;
}

/** Todas las IPv4 no virtuales del equipo, ordenadas por probabilidad de uso. */
export function direccionesLocales() {
  const interfaces = networkInterfaces();
  const candidatas = [];

  for (const [nombre, lista] of Object.entries(interfaces)) {
    for (const item of lista || []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      if (item.address.startsWith('169.254.')) continue;
      candidatas.push({ ip: item.address, nombre, mac: item.mac || '' });
    }
  }

  return candidatas.sort((a, b) => prioridad(a) - prioridad(b));
}

/** Primera IPv4 de la red local, útil para que un celular alcance el sistema. */
export function ipLocal() {
  return direccionesLocales()[0]?.ip || null;
}

/**
 * URL base que debe viajar dentro del QR. Si el operador entra por
 * 127.0.0.1, el celular no podría alcanzar esa dirección: usamos la IP
 * de la red local. PUBLIC_URL permite fijar una dirección manualmente.
 */
export function urlBasePublica(req) {
  if (config.publicUrl) return config.publicUrl.replace(/\/+$/, '');

  const hostHeader = req.headers.host || `127.0.0.1:${config.port}`;
  const sinPuerto = hostHeader.split(':')[0];
  const esLocal = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(sinPuerto);
  const protocoloProxy = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const tienePuerto = /:\d+$/.test(hostHeader);

  // Detrás de un proxy (Render, Railway, Fly.io, Nginx) el host llega sin
  // puerto y con x-forwarded-proto: se usa tal cual, sin añadir :3000.
  if (!esLocal && (protocoloProxy || !tienePuerto)) {
    return `${protocoloProxy || 'https'}://${hostHeader}`;
  }

  const seguro = httpsActivo() && config.qrHttps;
  const protocolo = seguro ? 'https' : 'http';
  const puerto = seguro ? config.httpsPort : config.port;

  if (esLocal) {
    const ip = ipLocal();
    if (ip) return `${protocolo}://${ip}:${puerto}`;
  }

  return `${protocolo}://${sinPuerto}:${puerto}`;
}
