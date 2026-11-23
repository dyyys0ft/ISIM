import assert from 'node:assert/strict';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de registro de IPs nuevas y ping.
 *
 * Valida la lista blanca (altas, último acceso y contador), la herramienta de
 * ping y el filtro de actividad por usuario.
 */

let entorno = null;

async function main() {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  const sesion = await entorno.iniciarSesion(admin, 'admin', '54321');
  const hoy = new Date().toLocaleDateString('en-CA');

  const nuevas = [
    { ip: '127.0.0.1', descripcion: 'Equipo local' },
    { ip: '192.168.5.101', descripcion: 'Recepción' },
    { ip: '192.168.5.102', descripcion: 'Consultorio 1' },
  ];

  for (const entrada of nuevas) {
    await admin('/api/settings/red/ips', {
      method: 'POST',
      body: entrada,
    });
  }

  const listado = await admin('/api/settings/red');
  assert.equal(listado.ips.length, nuevas.length);
  for (const entrada of nuevas) {
    const fila = listado.ips.find((item) => item.ip === entrada.ip);
    assert.ok(fila, `Debe registrarse ${entrada.ip}`);
    assert.equal(fila.descripcion, entrada.descripcion);
    assert.equal(fila.accesos, 0);
    assert.equal(fila.ultimoAccesoEn, null);
  }
  console.log(`✓ ${nuevas.length} IPs nuevas registradas en la lista blanca`);

  const pingLocal = await admin('/api/settings/red/ping', {
    method: 'POST',
    body: { ip: '127.0.0.1' },
  });
  assert.equal(pingLocal.ip, '127.0.0.1');
  assert.notEqual(pingLocal.enRed, false, 'El equipo local debe responder al ping');
  assert.ok(pingLocal.detalle);
  console.log(`✓ Ping 127.0.0.1: ${pingLocal.detalle}${pingLocal.ms != null ? ` (${pingLocal.ms} ms)` : ''}`);

  for (const ip of ['192.168.5.101', '192.168.5.102']) {
    const resultado = await admin('/api/settings/red/ping', {
      method: 'POST',
      body: { ip },
    });
    assert.equal(resultado.ip, ip);
    assert.ok(
      [true, false, null].includes(resultado.enRed),
      'El ping debe indicar en red, fuera de red o no disponible'
    );
    assert.ok(resultado.detalle);
  }
  console.log('✓ Ping ejecutado sobre las IPs registradas');

  // Un acceso real (simulado con X-Forwarded-For) actualiza último acceso y contador.
  await admin('/api/settings/red/restriccion', {
    method: 'POST',
    body: { activa: true, confiarProxy: true },
  });
  const crudo = entorno.crearCliente({ crudo: true });
  const permitida = await crudo('/api/health', {
    headers: { 'x-forwarded-for': '192.168.5.101' },
  });
  assert.equal(permitida.status, 200);

  const trasAcceso = await admin('/api/settings/red');
  const conAcceso = trasAcceso.ips.find((item) => item.ip === '192.168.5.101');
  assert.ok(conAcceso.ultimoAccesoEn, 'Debe quedar registrado el último acceso');
  assert.ok(conAcceso.accesos >= 1, 'Debe incrementarse el contador de accesos');
  console.log(`✓ Último acceso y contador actualizados (${conAcceso.accesos} acceso)`);

  // Quitar una IP y comprobar que ya no se puede pingear.
  await admin('/api/settings/red/ips', {
    method: 'DELETE',
    body: { ip: '192.168.5.102' },
  });
  const final = await admin('/api/settings/red');
  assert.equal(final.ips.length, nuevas.length - 1);
  assert.ok(!final.ips.some((item) => item.ip === '192.168.5.102'));

  let retirada = null;
  try {
    await admin('/api/settings/red/ping', {
      method: 'POST',
      body: { ip: '192.168.5.102' },
    });
  } catch (error) {
    retirada = error;
  }
  assert.ok(retirada && /→ 404:/.test(retirada.message));
  console.log('✓ IP retirada: ping rechazado con 404');

  // Actividad: filtro por usuario y acciones registradas.
  const actividad = await admin(
    `/api/reports/activity?fecha=${encodeURIComponent(hoy)}&usuario=${encodeURIComponent(
      sesion.id
    )}&limit=1000`
  );
  assert.ok(Array.isArray(actividad.eventos) && actividad.eventos.length > 0);
  assert.ok(
    actividad.eventos.every(
      (evento) => !evento.usuario_id || evento.usuario_id === sesion.id
    ),
    'El filtro por usuario no debe mezclar otros usuarios'
  );
  const acciones = new Set(actividad.eventos.map((evento) => evento.accion));
  assert.ok(acciones.has('red_ip_agregada'), 'Debe registrarse el alta de IPs');
  assert.ok(acciones.has('red_ip_eliminada'), 'Debe registrarse la baja de IPs');
  assert.ok(acciones.has('red_restriccion_actualizada'));
  console.log(
    `✓ Actividad filtrada por usuario: ${actividad.eventos.length} eventos, ` +
      `${[...acciones].filter((accion) => accion.startsWith('red_')).join(', ')}`
  );

  // Quitar la restricción para dejar el entorno limpio antes de borrar la base.
  await admin('/api/settings/red/restriccion', {
    method: 'POST',
    body: { activa: false, confiarProxy: false },
  });

  console.log('');
  console.log('E2E DE REGISTRO DE IPS Y PING COMPLETADO');
  console.log(
    JSON.stringify(
      {
        ipsRegistradas: nuevas.map((entrada) => entrada.ip),
        pingLocal: pingLocal.detalle,
        ultimoAccesoRegistrado: Boolean(conAcceso.ultimoAccesoEn),
        accesos: conAcceso.accesos,
        ipRetirada: '192.168.5.102',
        eventosActividad: actividad.eventos.length,
        filtroPorUsuario: sesion.username,
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
  console.error('E2E DE REGISTRO DE IPS Y PING FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-50).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await entorno?.limpiar();
}
