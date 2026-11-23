import { createServer, connect } from 'node:net';
import { config } from '../config.js';
import { db, nowIso } from '../db/index.js';
import {
  accesoPermitido,
  alCambiarControlIp,
  estadoControlIp,
  normalizarIp,
  registrarAccesoIp,
} from './control-ip.js';

/**
 * Exposición de un puerto de acceso elegido desde la interfaz.
 *
 * El servidor sigue escuchando en `config.port` (y `config.httpsPort`). Cuando
 * el administrador elige otro puerto se levanta un proxy TCP que reenvía las
 * conexiones hacia el servidor principal. Así el cambio se aplica al instante,
 * sin reiniciar ISIM y sin perder sesiones ni WebSocket (el proxy copia bytes).
 */

const CLAVE_PUERTO = 'red_puerto';
const PUERTOS_HABITUALES = [80, 443, 3000, 3443, 8000, 8080, 8081, 8090, 8888, 9000];

let servidor = null;
let puertoActivo = null;
let ultimoError = null;

// Si la lista de IPs cambia, se cortan las conexiones ya establecidas para
// que una sesión keep-alive no siga siendo válida con una autorización vieja.
const conexiones = new Set();
alCambiarControlIp(() => {
  for (const socket of conexiones) socket.destroy();
  conexiones.clear();
});

function leerPuertoGuardado() {
  const valor = db.prepare('SELECT valor FROM settings WHERE clave = ?').get(CLAVE_PUERTO)?.valor;
  return valor === null || valor === undefined ? null : Number(valor);
}

export function puertoSeleccionado() {
  const guardado = leerPuertoGuardado();
  return Number.isInteger(guardado) && guardado >= 1 && guardado <= 65535
    ? guardado
    : config.port;
}

export function esPuertoDelServidor(puerto) {
  return puerto === config.port || puerto === config.httpsPort;
}

export function validarPuerto(valor) {
  const puerto = Number(valor);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) return null;
  return puerto;
}

export function estadoProxy() {
  return {
    activo: puertoActivo !== null,
    puerto: puertoActivo,
    seleccionado: puertoSeleccionado(),
    sinProxy: puertoActivo !== null && esPuertoDelServidor(puertoActivo),
    destino: config.port,
    error: ultimoError,
  };
}

function guardarPuerto(puerto) {
  db.prepare(
    `INSERT OR REPLACE INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)`
  ).run(CLAVE_PUERTO, String(puerto), nowIso());
}

function cerrarServidor(instancia) {
  if (!instancia) return;
  try {
    // Corta también las conexiones keep-alive: si no, el puerto parece seguir
    // respondiendo aunque ya no acepte conexiones nuevas.
    instancia.closeAllConnections?.();
    instancia.close();
  } catch {
    // ya estaba cerrado
  }
}

export function cerrarProxy() {
  cerrarServidor(servidor);
  servidor = null;
  puertoActivo = null;
  ultimoError = null;
}

function crearProxy(puerto) {
  const servidorNuevo = createServer((socket) => {
    // El proxy ve la IP real del cliente. Si no hay un proxy externo que
    // reenvíe X-Forwarded-For, aplicamos aquí la lista blanca: de lo
    // contrario el servidor principal solo vería 127.0.0.1 y la evitaría.
    const controlIp = estadoControlIp();
    const ip = normalizarIp(socket.remoteAddress || '');
    if (controlIp.activa && !controlIp.confiarProxy && !accesoPermitido(ip)) {
      console.warn(`[red] Conexión bloqueada en el puerto ${puerto} desde ${ip || 'desconocida'}`);
      socket.destroy();
      return;
    }

    registrarAccesoIp(ip);
    conexiones.add(socket);
    socket.once('close', () => conexiones.delete(socket));

    const destino = connect({ host: '127.0.0.1', port: config.port });

    destino.once('connect', () => {
      socket.pipe(destino);
      destino.pipe(socket);
    });
    destino.on('error', () => socket.destroy());
    socket.on('error', () => destino.destroy());
  });

  return new Promise((resolve) => {
    let resuelto = false;
    const terminar = (valor) => {
      if (!resuelto) {
        resuelto = true;
        resolve(valor);
      }
    };

    servidorNuevo.once('error', (error) => {
      terminar({
        ok: false,
        error:
          error.code === 'EADDRINUSE'
            ? `El puerto ${puerto} ya está ocupado por otro programa`
            : error.message,
      });
    });

    servidorNuevo.listen(puerto, config.host, () => terminar({ ok: true, servidor: servidorNuevo }));
  });
}

async function cambiarPuerto(puerto, guardar) {
  if (esPuertoDelServidor(puerto)) {
    cerrarProxy();
    puertoActivo = puerto;
    if (guardar) guardarPuerto(puerto);
    console.log(`[red] El sistema ya escucha directamente en el puerto ${puerto}.`);
    return estadoProxy();
  }

  const resultado = await crearProxy(puerto);
  if (!resultado.ok) {
    ultimoError = resultado.error;
    return { ...estadoProxy(), error: resultado.error };
  }

  const anterior = servidor;
  servidor = resultado.servidor;
  puertoActivo = puerto;
  ultimoError = null;
  if (guardar) guardarPuerto(puerto);
  if (anterior && anterior !== servidor) cerrarServidor(anterior);

  console.log(`[red] Puerto ${puerto} expuesto hacia 127.0.0.1:${config.port}`);
  return estadoProxy();
}

/** Aplica un puerto elegido desde la interfaz y lo persiste. */
export async function aplicarPuerto(valor) {
  const puerto = validarPuerto(valor);
  if (!puerto) throw new Error('El puerto debe ser un número entre 1 y 65535');
  return cambiarPuerto(puerto, true);
}

/** Levanta el proxy del puerto guardado al iniciar el servidor. */
export async function iniciarProxy() {
  return cambiarPuerto(puertoSeleccionado(), false);
}

function verificarLibre(puerto) {
  return new Promise((resolve) => {
    const sonda = createServer();
    let resuelto = false;
    const terminar = (valor) => {
      if (!resuelto) {
        resuelto = true;
        resolve(valor);
      }
    };
    sonda.once('error', (error) => {
      terminar({
        libre: false,
        motivo: error.code === 'EADDRINUSE' ? 'ocupado' : error.code || 'no disponible',
      });
    });
    sonda.listen(puerto, config.host, () => {
      sonda.close(() => terminar({ libre: true, motivo: null }));
    });
  });
}

/** Puertos sugeridos con su disponibilidad real en este equipo. */
export async function puertosDisponibles() {
  const seleccionado = puertoSeleccionado();
  const candidatos = [
    ...new Set([...PUERTOS_HABITUALES, config.port, config.httpsPort, seleccionado]),
  ]
    .filter((puerto) => puerto >= 1 && puerto <= 65535)
    .sort((a, b) => a - b);

  const resultados = await Promise.all(
    candidatos.map(async (puerto) => ({
      puerto,
      ...(await verificarLibre(puerto)),
      delServidor: esPuertoDelServidor(puerto),
      seleccionado: puerto === seleccionado,
    }))
  );

  return resultados;
}
