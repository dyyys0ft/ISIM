import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { get as httpGet } from 'node:http';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';
import { ipLocal } from '../server/lib/red.js';

/**
 * E2E de acceso en intranet.
 *
 * Verifica en un servidor aislado que:
 *  - la configuración de red expone la IP, el puerto y la URL completa;
 *  - el puerto elegido desde la API queda expuesto de inmediato;
 *  - la lista blanca bloquea peticiones de IPs no autorizadas (API y páginas);
 *  - IPs individuales y rangos CIDR autorizan el acceso;
 *  - la configuración sobrevive a un reinicio.
 */

let entorno = null;
let bloqueador = null;

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

function puertoAceptaConexiones(puerto) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: puerto });
    const temporizador = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1500);
    socket.once('connect', () => {
      clearTimeout(temporizador);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(temporizador);
      resolve(false);
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

async function responderConIp(cliente, ip, ruta = '/api/health') {
  return cliente(ruta, {
    headers: ip ? { 'x-forwarded-for': ip } : {},
  });
}

async function main() {
  entorno = await crearEntornoE2E();
  const puertoServidor = Number(new URL(entorno.base).port);
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  // 1. Estado inicial y URL completa.
  const inicial = await admin('/api/settings/red');
  assert.equal(inicial.puertoEscucha, puertoServidor);
  assert.equal(inicial.puertoSeleccionado, puertoServidor);
  assert.ok(inicial.ipLocal, 'Debe mostrarse la IP de la intranet');
  assert.ok(Array.isArray(inicial.direccionesLocales) && inicial.direccionesLocales.length > 0);
  assert.ok(inicial.direccionesLocales.some((item) => item.ip === inicial.ipLocal));
  assert.equal(inicial.urlAcceso, `http://${inicial.ipLocal}:${puertoServidor}/`);
  assert.equal(inicial.urlLocal, `http://localhost:${puertoServidor}/`);
  assert.equal(inicial.activa, false);
  assert.deepEqual(inicial.ips, []);
  console.log(
    `✓ IP ${inicial.ipLocal} · puerto ${inicial.puertoSeleccionado} · ${inicial.urlAcceso}`
  );

  const disponibles = await admin('/api/settings/red/puertos');
  assert.ok(Array.isArray(disponibles.puertos) && disponibles.puertos.length >= 5);
  assert.ok(disponibles.puertos.some((item) => item.puerto === puertoServidor && item.delServidor));
  console.log(`✓ Lista de ${disponibles.puertos.length} puertos con disponibilidad`);

  // 2. Exponer un puerto elegido y comprobar que responde por él.
  const puertoExpuesto = await puertoLibre();
  const trasPuerto = await admin('/api/settings/red/puerto', {
    method: 'POST',
    body: { puerto: puertoExpuesto },
  });
  assert.equal(trasPuerto.proxy.activo, true);
  assert.equal(trasPuerto.proxy.puerto, puertoExpuesto);
  assert.equal(trasPuerto.puertoSeleccionado, puertoExpuesto);
  assert.equal(trasPuerto.urlAcceso, `http://${inicial.ipLocal}:${puertoExpuesto}/`);

  const porPuerto = await fetch(`http://127.0.0.1:${puertoExpuesto}/api/health`);
  assert.equal(porPuerto.status, 200);
  assert.equal((await porPuerto.json()).ok, true);

  const paginaPorPuerto = await fetch(`http://127.0.0.1:${puertoExpuesto}/`);
  assert.equal(paginaPorPuerto.status, 200);
  console.log(`✓ Puerto ${puertoExpuesto} expuesto y respondiendo (API y página)`);

  // Un puerto ocupado se rechaza sin derribar el proxy anterior.
  const puertoOcupado = await puertoLibre();
  bloqueador = createServer();
  await new Promise((resolve) => bloqueador.listen(puertoOcupado, '127.0.0.1', resolve));
  let conflicto = null;
  try {
    await admin('/api/settings/red/puerto', {
      method: 'POST',
      body: { puerto: puertoOcupado },
    });
  } catch (error) {
    conflicto = error;
  }
  assert.ok(conflicto && /→ 409:/.test(conflicto.message), 'El puerto ocupado debe dar 409');
  const sigue = await fetch(`http://127.0.0.1:${puertoExpuesto}/api/health`);
  assert.equal(sigue.status, 200);
  await new Promise((resolve) => bloqueador.close(resolve));
  bloqueador = null;
  console.log('✓ Puerto ocupado rechazado con 409 sin afectar el acceso actual');

  // 3. Lista blanca: primero se habilita la confianza en el proxy de intranet.
  const conLista = await admin('/api/settings/red/restriccion', {
    method: 'POST',
    body: { activa: true, confiarProxy: true },
  });
  assert.equal(conLista.activa, true);
  assert.equal(conLista.confiarProxy, true);

  const crudo = entorno.crearCliente({ crudo: true });

  const denegado = await responderConIp(crudo, '203.0.113.77');
  assert.equal(denegado.status, 403);
  assert.match(denegado.datos.error, /no está autorizada/);

  const paginaDenegada = await responderConIp(crudo, '203.0.113.77', '/agenda.html');
  assert.equal(paginaDenegada.status, 403);
  assert.match(String(paginaDenegada.datos), /Acceso denegado/);
  assert.match(String(paginaDenegada.datos), /\/img\/acceso-denegado\.svg/);

  // La imagen debe cargarse aunque la IP esté bloqueada; si no, la página quedaría rota.
  const imagen = await responderConIp(crudo, '203.0.113.77', '/img/acceso-denegado.svg');
  assert.equal(imagen.status, 200);
  assert.match(String(imagen.datos), /<svg/);

  const local = await responderConIp(crudo, null);
  assert.equal(local.status, 200, 'El loopback nunca debe bloquearse');
  console.log('✓ IP no listada bloqueada en API y páginas; loopback permitido');

  // 4. Agregar una IP exacta la autoriza; quitarla la vuelve a bloquear.
  const agregada = await admin('/api/settings/red/ips', {
    method: 'POST',
    body: { ip: '10.10.10.10', descripcion: 'Recepción' },
  });
  assert.ok(agregada.ips.some((item) => item.ip === '10.10.10.10'));

  const permitida = await responderConIp(crudo, '10.10.10.10');
  assert.equal(permitida.status, 200);

  const conAcceso = await admin('/api/settings/red');
  const entradaAccedida = conAcceso.ips.find((item) => item.ip === '10.10.10.10');
  assert.ok(entradaAccedida.ultimoAccesoEn, 'Debe registrarse el último acceso de la IP');
  assert.ok(entradaAccedida.accesos >= 1, 'Debe contabilizarse el acceso');

  const sondeo = await admin('/api/settings/red/ping', {
    method: 'POST',
    body: { ip: '10.10.10.10' },
  });
  assert.equal(sondeo.ip, '10.10.10.10');
  assert.ok([true, false, null].includes(sondeo.enRed));
  assert.ok(sondeo.detalle, 'El ping debe devolver un detalle');

  let pingInvalido = null;
  try {
    await admin('/api/settings/red/ping', { method: 'POST', body: { ip: '999.1.1.1' } });
  } catch (error) {
    pingInvalido = error;
  }
  assert.ok(pingInvalido && /→ 400:/.test(pingInvalido.message));

  let pingNoListado = null;
  try {
    await admin('/api/settings/red/ping', { method: 'POST', body: { ip: '8.8.8.8' } });
  } catch (error) {
    pingNoListado = error;
  }
  assert.ok(pingNoListado && /→ 404:/.test(pingNoListado.message));
  console.log('✓ Último acceso, contador y herramienta de ping verificados');

  await admin('/api/settings/red/ips', {
    method: 'DELETE',
    body: { ip: '10.10.10.10' },
  });
  const retirada = await responderConIp(crudo, '10.10.10.10');
  assert.equal(retirada.status, 403);
  console.log('✓ IP exacta agregada y retirada con efecto inmediato');

  // 5. Un rango CIDR autoriza solo a su red.
  await admin('/api/settings/red/ips', {
    method: 'POST',
    body: { ip: '192.168.5.0/24', descripcion: 'Consultorios' },
  });
  assert.equal((await responderConIp(crudo, '192.168.5.44')).status, 200);
  assert.equal((await responderConIp(crudo, '192.168.6.1')).status, 403);
  console.log('✓ Rango CIDR 192.168.5.0/24 autoriza solo a su red');

  // Entradas inválidas se rechazan.
  for (const ip of ['999.1.1.1', '10.0.0.0/33', 'no-es-una-ip']) {
    let error = null;
    try {
      await admin('/api/settings/red/ips', { method: 'POST', body: { ip } });
    } catch (fallo) {
      error = fallo;
    }
    assert.ok(error && /→ 400:/.test(error.message), `${ip} debe rechazarse con 400`);
  }
  console.log('✓ IPs y rangos inválidos rechazados');

  // 6. Sin restricción, la cabecera X-Forwarded-For se ignora.
  await admin('/api/settings/red/restriccion', {
    method: 'POST',
    body: { activa: false, confiarProxy: false },
  });
  const sinRestriccion = await responderConIp(crudo, '203.0.113.77');
  assert.equal(sinRestriccion.status, 200);
  console.log('✓ Restricción desactivada: acceso libre');

  // 7. Cambiar de puerto cierra el anterior y abre el nuevo.
  const puertoNuevo = await puertoLibre();
  await admin('/api/settings/red/puerto', {
    method: 'POST',
    body: { puerto: puertoNuevo },
  });
  assert.equal((await fetch(`http://127.0.0.1:${puertoNuevo}/api/health`)).status, 200);

  const anteriorAunAbierto = await puertoAceptaConexiones(puertoExpuesto);
  assert.equal(anteriorAunAbierto, false, 'El puerto anterior debe liberarse');
  console.log(`✓ Cambio de puerto ${puertoExpuesto} → ${puertoNuevo} sin reinicio`);

  // 8. La configuración persiste tras reiniciar el proceso.
  await entorno.reiniciar();
  const adminTrasReinicio = entorno.crearCliente();
  await entorno.iniciarSesion(adminTrasReinicio, 'admin', '54321');
  const persistido = await adminTrasReinicio('/api/settings/red');
  assert.equal(persistido.puertoSeleccionado, puertoNuevo);
  assert.equal(persistido.proxy.activo, true);
  assert.equal(persistido.proxy.puerto, puertoNuevo);
  assert.equal(persistido.activa, false);
  assert.ok(persistido.ips.some((item) => item.ip === '192.168.5.0/24'));
  assert.equal((await fetch(`http://127.0.0.1:${puertoNuevo}/api/health`)).status, 200);
  console.log('✓ Configuración de red persistida tras reinicio');

  // 9. El puerto expuesto bloquea la IP real del cliente, no solo X-Forwarded-For.
  const ipLan = ipLocal();
  if (ipLan) {
    const entornoLan = await crearEntornoE2E({ host: '0.0.0.0' });
    try {
      const adminLan = entornoLan.crearCliente();
      await entornoLan.iniciarSesion(adminLan, 'admin', '54321');
      const puertoLan = await puertoLibre();
      await adminLan('/api/settings/red/puerto', {
        method: 'POST',
        body: { puerto: puertoLan },
      });
      await adminLan('/api/settings/red/restriccion', {
        method: 'POST',
        body: { activa: true, confiarProxy: false },
      });

      const bloqueada = await solicitudDesde(ipLan, ipLan, puertoLan);
      assert.ok(bloqueada.error, `La IP ${ipLan} debía ser bloqueada en el puerto expuesto`);

      await adminLan('/api/settings/red/ips', {
        method: 'POST',
        body: { ip: ipLan, descripcion: 'Prueba LAN' },
      });
      const autorizada = await solicitudDesde(ipLan, ipLan, puertoLan);
      assert.equal(autorizada.status, 200, 'La IP agregada debe entrar por el puerto expuesto');

      const estadoLan = await adminLan('/api/settings/red');
      const entradaLan = estadoLan.ips.find((item) => item.ip === ipLan);
      assert.ok(entradaLan.ultimoAccesoEn, 'El puerto expuesto debe registrar el último acceso');
      assert.ok(entradaLan.accesos >= 1);

      await adminLan('/api/settings/red/ips', {
        method: 'DELETE',
        body: { ip: ipLan },
      });
      const retirada = await solicitudDesde(ipLan, ipLan, puertoLan);
      assert.ok(retirada.error, 'La IP retirada debe volver a bloquearse');

      console.log(`✓ Puerto expuesto bloquea/autoriza la IP real ${ipLan}`);
    } finally {
      await entornoLan.limpiar();
    }
  } else {
    console.log('⚠ No hay IP de red local; se omite la prueba de IP real en el puerto expuesto.');
  }

  console.log('');
  console.log('E2E DE RED E INTRANET COMPLETADO');
  console.log(
    JSON.stringify(
      {
        ipServidor: inicial.ipLocal,
        puertoServidor,
        puertoExpuesto,
        puertoFinal: puertoNuevo,
        urlAcceso: persistido.urlAcceso,
        accesoBloqueado: 'IP no listada → 403 en API y páginas',
        ipExacta: 'agregada y retirada',
        rangoCidr: '192.168.5.0/24',
        entradasInvalidasRechazadas: 3,
        persistenciaTrasReinicio: true,
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
  console.error('E2E DE RED E INTRANET FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-60).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  if (bloqueador) await new Promise((resolve) => bloqueador.close(resolve)).catch(() => {});
  await entorno?.limpiar();
}
