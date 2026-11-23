import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';
import { leerDump } from '../server/lib/migracion/oldDb.js';

/**
 * E2E de migración con credenciales antiguas.
 *
 * Migra old_db.sql completo conservando las claves de la tabla `sistema`,
 * ingresa como adminis/12345 y comprueba que la información antigua aparece
 * en la interfaz y en la API.
 */

const archivosLimpiar = [];
let entorno = null;
let navegador = null;

function encontrarNavegador() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidatos.find((ruta) => existsSync(ruta)) || null;
}

function texto(valor) {
  return String(valor ?? '').trim();
}

function cedulaDe(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

async function main() {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  console.log('Leyendo old_db.sql…');
  const tablas = leerDump(resolve('old_db.sql'));

  const filas = [...tablas.entries()].map(([nombre, lista]) => [nombre, lista]);
  const columnasDe = (tabla) => {
    const primera = (tablas.get(tabla) || [])[0] || {};
    return Object.keys(primera);
  };
  function sqlValor(valor) {
    if (valor === null || valor === undefined) return 'NULL';
    return `'${String(valor)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\0/g, '\\0')}'`;
  }
  const partes = filas.map(([tabla, lista]) => {
    const columnas = columnasDe(tabla);
    if (!columnas.length) return '';
    const bloques = [];
    for (let i = 0; i < lista.length; i += 50) {
      bloques.push(
        `INSERT INTO \`${tabla}\` (${columnas
          .map((columna) => `\`${columna}\``)
          .join(', ')}) VALUES\n${lista
          .slice(i, i + 50)
          .map((fila) => `(${columnas.map((columna) => sqlValor(fila[columna])).join(', ')})`)
          .join(',\n')};`
      );
    }
    return bloques.join('\n\n');
  });
  const sql = `${partes.filter(Boolean).join('\n\n')}\n`;
  console.log(`SQL de migración: ${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(1)} MB`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  const analisis = await admin('/api/migration/old-db/analyze', {
    method: 'POST',
    rawBody: sql,
    contentType: 'application/sql',
    headers: { 'x-nombre-archivo': 'old_db.sql' },
    timeout: 120000,
  });
  archivosLimpiar.push(`migracion/${analisis.id}.sql`);

  const corrida = await admin('/api/migration/old-db/run', {
    method: 'POST',
    body: { id: analisis.id, conservarClavesAntiguas: true },
    timeout: 240000,
  });
  if (corrida.resumen?.respaldo) {
    archivosLimpiar.push(relative(resolve(entorno.root, 'data'), corrida.resumen.respaldo));
  }
  if (corrida.resumen?.usuarios?.archivoCredenciales) {
    archivosLimpiar.push(corrida.resumen.usuarios.archivoCredenciales);
  }

  assert.equal(corrida.estado, 'completado');
  assert.equal(corrida.resumen.usuarios.clavesAntiguasConservadas, true);
  console.log(
    `✓ Migración completada: ${corrida.resumen.pacientes.insertados} pacientes, ` +
      `${corrida.resumen.citas.insertadas} citas, ` +
      `${corrida.resumen.consultas.insertadas} consultas, ` +
      `${corrida.resumen.usuarios.insertados} usuarios nuevos`
  );

  // Credencial antigua: adminis / 12345.
  const antiguo = entorno.crearCliente({ crudo: true });
  const login = await antiguo('/api/auth/login', {
    method: 'POST',
    body: { username: 'adminis', password: '12345' },
  });
  assert.equal(login.status, 200, 'La credencial antigua adminis/12345 debe funcionar');
  assert.equal(login.datos.username, 'adminis');
  assert.equal(login.datos.rol, 'admin');
  console.log('✓ Ingreso con credencial antigua adminis/12345');

  // La información antigua debe estar disponible para ese usuario.
  const pacienteOrigen = (tablas.get('datos') || []).find(
    (fila) => cedulaDe(fila.cedula).length === 10
  );
  assert.ok(pacienteOrigen, 'Debe existir un paciente antiguo con cédula válida');
  const cedula = cedulaDe(pacienteOrigen.cedula);

  const pacientes = await antiguo(`/api/patients?cedula=${encodeURIComponent(cedula)}&limit=50`);
  assert.equal(pacientes.status, 200);
  assert.ok(pacientes.datos.length > 0, 'La paciente antigua debe aparecer en la API');
  assert.ok(
    pacientes.datos.some((paciente) => paciente.cedula === cedula),
    'La cédula antigua debe conservarse exactamente'
  );

  const listado = await antiguo('/api/patients/paginated?limit=1');
  assert.equal(listado.status, 200);
  assert.ok(listado.datos.total >= 20000, 'Deben verse los pacientes antiguos');

  const historia = await antiguo('/api/clinical-history/patients?limit=20');
  assert.equal(historia.status, 200);
  assert.ok(historia.datos.length > 0, 'El historial clínico antiguo debe estar disponible');

  const citaOrigen = (tablas.get('citamedica') || []).find(
    (fila) => /^\d{4}-\d{2}-\d{2}$/.test(String(fila.citafec || '')) && texto(fila.nombrecod)
  );
  assert.ok(citaOrigen, 'Debe existir una cita antigua con fecha válida');
  const fechaCita = String(citaOrigen.citafec).slice(0, 10);

  const citasDia = await antiguo(`/api/appointments?fecha=${encodeURIComponent(fechaCita)}&limit=500`);
  assert.equal(citasDia.status, 200);
  assert.ok(citasDia.datos.length > 0, 'Las citas antiguas deben estar disponibles');
  console.log(
    `✓ Información antigua visible: ${listado.datos.total} pacientes, ` +
      `${citasDia.datos.length} citas el ${fechaCita}`
  );

  await antiguo('/api/auth/logout', { method: 'POST' });

  // Validación visual en navegador real.
  const ejecutable = encontrarNavegador();
  if (ejecutable) {
    navegador = await puppeteer.launch({
      executablePath: ejecutable,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1000'],
    });
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: 1440, height: 1000 });
    pagina.setDefaultTimeout(30000);

    await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
    await pagina.type('#login-usuario', 'adminis');
    await pagina.type('#login-password', '12345');
    await pagina.click('#btn-ingresar');
    await pagina.waitForFunction(() => location.pathname === '/agenda.html');
    await pagina.waitForFunction(
      () => /ADMINISTRADOR/i.test(document.querySelector('.user .who b')?.textContent || '')
    );
    console.log('✓ Navegador: ingreso con credencial antigua y usuario ADMINISTRADOR');

    await pagina.goto(`${entorno.base}/pacientes.html`, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('#buscar-cedula');
    await pagina.evaluate((valor) => {
      const input = document.querySelector('#buscar-cedula');
      input.value = valor;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, cedula);
    await pagina.waitForFunction(
      (valor) =>
        [...document.querySelectorAll('.patient-card')].some((tarjeta) =>
          tarjeta.innerText.includes(valor)
        ),
      { timeout: 20000 },
      cedula
    );
    console.log(`✓ Navegador: paciente antigua ${cedula} visible en Pacientes`);
  } else {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
  }

  console.log('');
  console.log('E2E DE MIGRACIÓN CON CREDENCIALES ANTIGUAS COMPLETADO');
  console.log(
    JSON.stringify(
      {
        fuente: 'old_db.sql',
        credencial: 'adminis / 12345',
        rol: 'admin',
        pacientesVisibles: listado.datos.total,
        citasVisiblesElDia: citasDia.datos.length,
        fechaCitaVerificada: fechaCita,
        pacienteVerificada: cedula,
        navegadorVerificado: Boolean(ejecutable),
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
  console.error('E2E DE MIGRACIÓN CON CREDENCIALES ANTIGUAS FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-50).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await navegador?.close().catch(() => {});
  await entorno?.limpiar(archivosLimpiar);
}
