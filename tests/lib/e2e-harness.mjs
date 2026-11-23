import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reserva un puerto libre real en loopback y lo libera antes de usarlo. */
function puertoLibre(host) {
  return new Promise((resolvePort, reject) => {
    const sonda = createServer();
    sonda.unref();
    sonda.on('error', reject);
    sonda.listen(0, host, () => {
      const { port } = sonda.address();
      sonda.close(() => resolvePort(port));
    });
  });
}

/**
 * Levanta un servidor aislado con una base temporal y devuelve clientes HTTP
 * independientes (una cookie por cliente) para probar varios roles.
 */
export async function crearEntornoE2E({ host = '127.0.0.1' } = {}) {
  const stamp = Date.now();
  const dbFile = resolve(root, 'data', `e2e-${stamp}.db`);
  let port = await puertoLibre(host);
  let httpsPort = port + 1;
  let base = `http://${host}:${port}`;
  let log = '';
  let child = null;
  let intentosPuerto = 0;

  function iniciarProceso() {
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: root,
      env: {
        ...process.env,
        DB_FILE: dbFile,
        HOST: host,
        PORT: String(port),
        HTTPS_PORT: String(httpsPort),
        ISIM_SEMILLA: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (bloque) => {
      log += bloque.toString();
    });
    child.stderr.on('data', (bloque) => {
      log += bloque.toString();
    });
  }

  async function esperarServidor() {
    for (let intento = 0; intento < 160; intento += 1) {
      if (!child) throw new Error('El servidor de prueba no se pudo iniciar.');
      if (child.exitCode !== null) {
        throw new Error(`El servidor de prueba terminó antes de iniciar.\n${log.slice(-3000)}`);
      }
      try {
        // Cualquier respuesta HTTP confirma que el puerto ya está escuchando;
        // un 403 por control de IP también cuenta como servidor disponible.
        const respuesta = await fetch(`${base}/api/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (respuesta.status > 0) return;
      } catch {
        // todavía no responde
      }
      await dormir(250);
    }
    throw new Error(`El servidor de prueba no respondió en el puerto ${port}.\n${log.slice(-3000)}`);
  }

  async function iniciar() {
    if (child && child.exitCode === null) return;

    for (let intento = 0; intento < 4; intento += 1) {
      iniciarProceso();
      try {
        await esperarServidor();
        return;
      } catch (error) {
        const colision = /EADDRINUSE|address already in use/i.test(log);
        if (!colision || intento === 3) throw error;
        // Otro proceso tomó el puerto: se elige uno nuevo y se reintenta.
        await dormir(200);
        await detener();
        port = await puertoLibre(host);
        httpsPort = port + 1;
        base = `http://${host}:${port}`;
        intentosPuerto += 1;
        log = '';
      }
    }
  }

  /**
   * Crea un cliente HTTP con su propia cookie.
   * Con `crudo: true` devuelve `{ status, ok, datos }` en lugar de lanzar
   * excepción cuando la respuesta no es 2xx; sirve para probar carreras.
   */
  function crearCliente({ crudo = false } = {}) {
    let cookie = '';

    async function req(
      ruta,
      { method = 'GET', body, rawBody, contentType, headers: extraHeaders, timeout = 30000 } = {}
    ) {
      const headers = { ...(extraHeaders || {}) };
      let payload;

      if (rawBody !== undefined) {
        payload = rawBody;
        headers['content-type'] = contentType || 'application/json';
      } else if (body !== undefined) {
        payload = JSON.stringify(body);
        headers['content-type'] = 'application/json';
      }
      if (cookie) headers.cookie = cookie;

      const respuesta = await fetch(`${base}${ruta}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(timeout),
      });

      const cookies = respuesta.headers.getSetCookie?.() || [];
      if (cookies.length) {
        cookie = cookies.map((valor) => valor.split(';')[0]).join('; ');
      }

      const texto = await respuesta.text();
      let datos = texto;
      try {
        datos = texto ? JSON.parse(texto) : null;
      } catch {
        // respuesta no JSON
      }

      if (crudo) {
        return { status: respuesta.status, ok: respuesta.ok, datos };
      }

      if (!respuesta.ok) {
        const mensaje = datos && typeof datos === 'object' && datos.error ? datos.error : texto;
        throw new Error(`${method} ${ruta} → ${respuesta.status}: ${mensaje}`);
      }
      return datos;
    }

    req.cookieActual = () => cookie;
    return req;
  }

  async function iniciarSesion(req, username, password) {
    const usuario = await req('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    if (!usuario?.nombre) throw new Error('No se pudo iniciar sesión');
    return usuario;
  }

  async function detener() {
    if (!child || child.exitCode !== null) {
      child = null;
      return;
    }
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGKILL');
    }
    for (let intento = 0; intento < 20; intento += 1) {
      if (child.exitCode !== null) break;
      await dormir(100);
    }
    child = null;
  }

  async function reiniciar() {
    await detener();
    await iniciar();
  }

  async function limpiar(archivosExtra = []) {
    await detener();
    for (const archivo of archivosExtra) {
      const ruta = resolve(root, 'data', archivo);
      if (existsSync(ruta)) rmSync(ruta, { force: true });
    }
    for (const archivo of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
      if (existsSync(archivo)) rmSync(archivo, { force: true });
    }
  }

  await iniciar();
  return {
    base,
    root,
    dbFile,
    crearCliente,
    iniciarSesion,
    iniciar,
    reiniciar,
    detener,
    limpiar,
    obtenerLog: () => log,
  };
}
