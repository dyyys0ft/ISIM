import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Reportes de actividad:
 * - sin lista lateral de usuarios,
 * - filtros por módulo, acción y usuario,
 * - impresión del día con los filtros aplicados.
 */
const sello = String(Date.now()).slice(-6);
const capturas = 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2\\capturas';
const entorno = await crearEntornoE2E();

try {
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const usuarioAdmin = await admin('/api/auth/me');
  const medicos = await admin('/api/medicos');
  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `REP${sello}`,
      nombres: 'Reporte',
      apellidos: `Filtros ${sello}`,
      fecha_nacimiento: '1990-01-15',
      sexo: 'F',
      telefono: '0991234567',
    },
  });
  await admin(`/api/patients/${encodeURIComponent(paciente.id)}/contacto-visto`, {
    method: 'POST',
    body: {},
  });
  await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      medicoId: medicos[0].id,
      fechaHora: '2027-02-10T15:00:00.000Z',
      duracionMin: 30,
      motivo: 'Control para reporte',
      estado: 'programada',
    },
  });

  const db = new DatabaseSync(entorno.dbFile, { readOnly: true });
  const clasificacion = Object.fromEntries(
    db
      .prepare(
        `SELECT accion, modulo, accion_tipo FROM audit_log
         WHERE accion IN ('paciente_creado', 'contacto_paciente_revelado', 'cita_creada', 'login')`
      )
      .all()
      .map((fila) => [fila.accion, fila])
  );
  db.close();
  assert.equal(clasificacion.paciente_creado.modulo, 'Pacientes');
  assert.equal(clasificacion.paciente_creado.accion_tipo, 'modificar');
  assert.equal(clasificacion.contacto_paciente_revelado.accion_tipo, 'leer');
  assert.equal(clasificacion.cita_creada.modulo, 'Agenda');
  assert.equal(clasificacion.cita_creada.accion_tipo, 'modificar');
  assert.equal(clasificacion.login.modulo, 'Acceso');
  assert.equal(clasificacion.login.accion_tipo, 'ver');

  const navegador = await puppeteer.launch({
    executablePath: [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]
      .filter(Boolean)
      .find((ruta) => existsSync(ruta)),
    headless: 'new',
    args: ['--no-sandbox'],
  });

  try {
    const p = await navegador.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await p.setCacheEnabled(false);
    p.setDefaultTimeout(30000);

    await p.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
    await p.type('#login-usuario', 'admin');
    await p.type('#login-password', '54321');
    await p.click('#btn-ingresar');
    await p.waitForFunction(() => location.pathname === '/agenda.html');

    await p.goto(`${entorno.base}/reportes.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#reporte-fecha');
    await p.waitForSelector('#actividad-modulo');
    await p.waitForFunction(
      () => document.querySelectorAll('#actividad-lista .reporte-tabla tbody tr').length > 0,
      { timeout: 25000 }
    );

    assert.equal(await p.$('#reporte-lista'), null, 'No debe existir la lista lateral');
    assert.equal(await p.$('.reporte-usuarios'), null, 'No debe existir la columna de usuarios');

    const opcionesModulo = await p.$$eval('#actividad-modulo option', (nodos) =>
      nodos.map((nodo) => nodo.textContent.trim())
    );
    assert.ok(opcionesModulo.includes('Pacientes'));
    assert.ok(opcionesModulo.includes('Agenda'));
    assert.ok(opcionesModulo.includes('Documentos'));
    assert.ok(opcionesModulo.includes('Reportes'));
    const opcionesAccion = await p.$$eval('#actividad-accion option', (nodos) =>
      nodos.map((nodo) => nodo.value)
    );
    assert.deepEqual(opcionesAccion, ['', 'ver', 'leer', 'modificar', 'eliminar']);

    // Filtrar por módulo, acción y usuario.
    await p.select('#actividad-modulo', 'Pacientes');
    await p.waitForFunction(
      () =>
        document.querySelector('#actividad-modulo')?.value === 'Pacientes' &&
        document.querySelectorAll('#actividad-lista .reporte-tabla tbody tr').length > 0,
      { timeout: 25000 }
    );
    await p.select('#actividad-accion', 'modificar');
    await p.waitForFunction(
      () =>
        document.querySelector('#actividad-accion')?.value === 'modificar' &&
        [...document.querySelectorAll('#actividad-lista tbody tr')].every(
          (fila) => fila.cells[0]?.innerText.trim() === 'Modificar'
        ),
      { timeout: 25000 }
    );
    await p.select('#actividad-usuario', usuarioAdmin.id);
    await p.waitForFunction(
      (id) =>
        document.querySelector('#actividad-usuario')?.value === id &&
        document.querySelectorAll('#actividad-lista .reporte-tabla tbody tr').length === 1,
      { timeout: 25000 },
      usuarioAdmin.id
    );

    const fila = await p.$eval('#actividad-lista .reporte-tabla tbody tr', (nodo) =>
      nodo.innerText
    );
    assert.match(fila, /Modificar/);
    assert.match(fila, /Paciente creado/);
    assert.match(fila, /Pacientes/);
    assert.match(fila, new RegExp(usuarioAdmin.nombre, 'i'));

    // Impresión: se invoca window.print y el encabezado refleja fecha/filtros.
    await p.evaluate(() => {
      window.__impreso = 0;
      window.print = () => {
        window.__impreso += 1;
      };
    });
    await p.click('#btn-imprimir-reporte');
    assert.equal(await p.evaluate(() => window.__impreso), 1);
    const encabezado = await p.$eval('#reporte-print-head', (nodo) => nodo.textContent);
    assert.match(encabezado, /Reporte de actividad de usuarios/);
    assert.match(encabezado, /Fecha:/);
    assert.match(encabezado, /Módulo: Pacientes/);
    assert.match(encabezado, /Acción: Modificar/);
    assert.match(encabezado, new RegExp(usuarioAdmin.nombre, 'i'));

    await p.screenshot({ path: `${capturas}\\54-reportes-filtros.png` });

    // Limpiar filtros devuelve la actividad completa.
    await p.click('#btn-limpiar-filtros-reporte');
    await p.waitForFunction(
      () =>
        document.querySelector('#actividad-modulo')?.value === '' &&
        document.querySelector('#actividad-accion')?.value === '' &&
        document.querySelector('#actividad-usuario')?.value === '' &&
        /Cita creada/.test(document.querySelector('#actividad-lista')?.innerText || ''),
      { timeout: 25000 }
    );

    // La impresión solo muestra el encabezado y la tabla, sin controles.
    await p.emulateMediaType('print');
    await p.screenshot({
      path: `${capturas}\\55-reportes-impresion.png`,
      fullPage: true,
    });
    await p.emulateMediaType('screen');

    await p.setViewport({ width: 390, height: 844 });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(
      () => document.querySelectorAll('#actividad-lista .reporte-tabla tbody tr').length > 0,
      { timeout: 25000 }
    );
    await p.screenshot({ path: `${capturas}\\56-reportes-movil.png` });

    console.log('✓ Reportes sin columna lateral de usuarios');
    console.log('✓ Filtros por módulo, acción y usuario');
    console.log('✓ Impresión con fecha y filtros aplicados');
    console.log('✓ Limpiar filtros y vista móvil');
    console.log('');
    console.log('REPORTES DE ACTIVIDAD: FILTROS E IMPRESIÓN OK');
  } finally {
    await navegador.close();
  }
} finally {
  await entorno.limpiar();
}
