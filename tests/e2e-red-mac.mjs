import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';
import { ipLocal } from '../server/lib/red.js';

/**
 * E2E de acceso por IP + MAC.
 *
 * Detecta la MAC del equipo, la registra junto a su IP, activa la restricción
 * y comprueba que solo la combinación correcta puede entrar. Una MAC distinta
 * bloquea el acceso y una MAC inválida se rechaza al guardar.
 */

let entorno = null;

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(() => resolve(port));
    });
  });
}

function solicitudDesde(ipOrigen, ipDestino, puerto) {
  return new Promise((resolve) => {
    const peticion = httpGet(
      { host: ipDestino, port: puerto, path: '/api/health', localAddress: ipOrigen, timeout: 4000 },
      (respuesta) => {
        respuesta.resume();
        resolve({ status: respuesta.statusCode });
      }
    );
    peticion.on('error', (error) => resolve({ error: error.code || error.message }));
    peticion.on('timeout', () => {
      peticion.destroy();
      resolve({ error: 'timeout' });
    });
  });
}

async function main() {
  entorno = await crearEntornoE2E({ host: '0.0.0.0' });
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  const ipLan = ipLocal();
  assert.ok(ipLan, 'Se necesita una IP de red local para esta prueba');
  const puerto = await puertoLibre();

  // 1. Detectar la MAC del equipo y registrarla junto a su IP.
  const detectada = await admin('/api/settings/red/mac', {
    method: 'POST',
    body: { ip: ipLan },
  });
  assert.match(detectada.mac, /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
  console.log(`✓ MAC detectada para ${ipLan}: ${detectada.mac}`);

  const guardada = await admin('/api/settings/red/ips', {
    method: 'POST',
    body: { ip: ipLan, mac: detectada.mac, descripcion: 'Equipo con MAC' },
  });
  const entrada = guardada.ips.find((item) => item.ip === ipLan);
  assert.equal(entrada.mac, detectada.mac);
  console.log('✓ Entrada guardada con IP + MAC');

  // 2. Exponer un puerto y activar la restricción.
  await admin('/api/settings/red/puerto', { method: 'POST', body: { puerto } });
  await admin('/api/settings/red/restriccion', {
    method: 'POST',
    body: { activa: true, confiarProxy: false },
  });

  const permitida = await solicitudDesde(ipLan, ipLan, puerto);
  assert.equal(permitida.status, 200, 'La combinación IP + MAC correcta debe entrar');
  console.log('✓ IP + MAC correctas: acceso permitido');

  // 3. Cambiar la MAC por una incorrecta: debe bloquear.
  await admin('/api/settings/red/ips', {
    method: 'POST',
    body: { ip: ipLan, mac: '00:11:22:33:44:55' },
  });
  const bloqueada = await solicitudDesde(ipLan, ipLan, puerto);
  assert.ok(bloqueada.error, 'Una MAC distinta debe bloquear el acceso');
  console.log('✓ MAC incorrecta: acceso bloqueado');

  // 4. Restaurar la MAC correcta: vuelve a entrar.
  await admin('/api/settings/red/ips', {
    method: 'POST',
    body: { ip: ipLan, mac: detectada.mac },
  });
  const restaurada = await solicitudDesde(ipLan, ipLan, puerto);
  assert.equal(restaurada.status, 200);
  console.log('✓ MAC correcta restaurada: acceso permitido');

  // 5. Validaciones de formato.
  let macInvalida = null;
  try {
    await admin('/api/settings/red/ips', {
      method: 'POST',
      body: { ip: '192.168.9.9', mac: 'ZZ:11:22' },
    });
  } catch (error) {
    macInvalida = error;
  }
  assert.ok(macInvalida && /→ 400:/.test(macInvalida.message));

  let macEnRango = null;
  try {
    await admin('/api/settings/red/ips', {
      method: 'POST',
      body: { ip: '192.168.9.0/24', mac: detectada.mac },
    });
  } catch (error) {
    macEnRango = error;
  }
  assert.ok(macEnRango && /→ 400:/.test(macEnRango.message));
  console.log('✓ MAC inválida y MAC en rangos rechazadas con 400');

  // Limpieza de la configuración.
  await admin('/api/settings/red/restriccion', {
    method: 'POST',
    body: { activa: false, confiarProxy: false },
  });
  await admin('/api/settings/red/ips', {
    method: 'DELETE',
    body: { ip: ipLan },
  });

  console.log('');
  console.log('E2E DE ACCESO POR IP Y MAC COMPLETADO');
  console.log(
    JSON.stringify(
      {
        ip: ipLan,
        mac: detectada.mac,
        puerto,
        accesoConMacCorrecta: true,
        bloqueoConMacIncorrecta: true,
        validacionesDeFormato: true,
      },
      null,
      2
    )
  );
}

try {
  await main();
} catch (error) {
  console.error('');
  console.error('E2E DE ACCESO POR IP Y MAC FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-60).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await entorno?.limpiar();
}
