import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E del nuevo flujo de cita:
 * - admisión inline de paciente nueva,
 * - LOPDP obligatorio,
 * - menor con representante legal,
 * - cupo, tipo y grupo de motivo en la cita.
 */

const FECHA = '2026-12-22';
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

async function abrirNuevaDesdeJornada(pagina, hora) {
  await pagina.goto(`${entorno.base}/agenda.html?fecha=${FECHA}`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#btn-vista-jornada');
  await pagina.click('#btn-vista-jornada');
  await pagina.waitForFunction(
    () => document.querySelector('#vista-jornada')?.hidden === false
  );
  await pagina.waitForSelector(`#vista-jornada [data-jornada-hora="${hora}"]`);
  await pagina.evaluate((valor) => {
    document.querySelector(`#vista-jornada [data-jornada-hora="${valor}"]`)?.click();
  }, hora);
  await pagina.waitForFunction(() => document.querySelector('#dlg-cita')?.open === true);
  await pagina.waitForFunction(
    () => document.querySelector('#cita-nueva-paciente')?.hidden !== false
  );
  await pagina.click('#btn-paciente-nueva');
  await pagina.waitForFunction(
    () => document.querySelector('#cita-nueva-paciente')?.hidden === false
  );
}

async function llenarAdmision(pagina, datos) {
  await pagina.type('#np-cedula', datos.cedula);
  await pagina.type('#np-apellidos', datos.apellidos);
  await pagina.type('#np-nombres', datos.nombres);
  await pagina.$eval('#np-nacimiento', (nodo, valor) => {
    nodo.value = valor;
    nodo.dispatchEvent(new Event('change', { bubbles: true }));
  }, datos.nacimiento);
  await pagina.select('#np-sexo', datos.sexo);
  await pagina.type('#np-telefono', datos.telefono);
  await pagina.type('#np-direccion', datos.direccion);
  await pagina.type('#np-alergias', datos.alergias);
  await pagina.click('#np-lopdp');
  await pagina.$eval('#cita-motivo', (nodo) => {
    nodo.value = 'Ecografía';
    nodo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function cerrarAccionesLopdp(pagina, { subir = false, imprimir = false } = {}) {
  await pagina.waitForSelector('.modal #lopdp-imprimir', { timeout: 25000 });
  assert.ok(
    await pagina.$('.modal #lopdp-subir'),
    'La paciente nueva debe permitir subir la evidencia LOPDP'
  );

  if (subir) {
    const archivo = resolve(
      'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2',
      `evidencia-agenda-${Date.now()}.png`
    );
    writeFileSync(
      archivo,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      )
    );
    const [selector] = await Promise.all([
      pagina.waitForFileChooser({ timeout: 10000 }),
      pagina.click('.modal #lopdp-subir'),
    ]);
    await selector.accept([archivo]);
    await pagina.waitForFunction(
      () =>
        /Evidencia firmada:/i.test(document.querySelector('#lopdp-estado')?.innerText || '') &&
        !/sin cargar/i.test(document.querySelector('#lopdp-estado')?.innerText || ''),
      { timeout: 25000 }
    );
  }

  if (imprimir) {
    await pagina.click('.modal #lopdp-imprimir');
    await pagina.waitForSelector('#consentimiento-opcion', { timeout: 15000 });
    const opciones = await pagina.$$eval('#consentimiento-opcion option', (nodos) =>
      nodos.map((nodo) => nodo.textContent.trim())
    );
    assert.ok(opciones.some((texto) => /LOPDP/i.test(texto)));
  }

  await pagina.click('.modal [data-cerrar-modal]');
  await pagina.waitForFunction(() => !document.querySelector('.modal'));
}

async function main() {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const ejecutable = encontrarNavegador();
  if (!ejecutable) {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
    return;
  }

  const sello = String(Date.now()).slice(-8);
  const adulto = {
    cedula: `17${sello}`,
    apellidos: 'NUEVA ADULTA',
    nombres: 'Paciente',
    nacimiento: '1990-05-10',
    sexo: 'F',
    telefono: '0991112222',
    direccion: 'Riobamba',
    alergias: 'Penicilina',
  };
  const menor = {
    cedula: `18${sello}`,
    apellidos: 'NUEVA MENOR',
    nombres: 'Paciente',
    nacimiento: '2015-06-15',
    sexo: 'F',
    telefono: '0993334444',
    direccion: 'Riobamba',
    alergias: 'Ninguna',
  };

  navegador = await puppeteer.launch({
    executablePath: ejecutable,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1100'],
  });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 1100 });
  await pagina.setCacheEnabled(false);
  pagina.setDefaultTimeout(30000);

  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.type('#login-usuario', 'admin');
  await pagina.type('#login-password', '54321');
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html');

  // 1. Paciente adulta nueva.
  await abrirNuevaDesdeJornada(pagina, '09:30');
  await llenarAdmision(pagina, adulto);
  await pagina.click('#btn-guardar-cita');
  await pagina.waitForFunction(
    () => document.querySelector('#dlg-cita')?.open === false,
    { timeout: 25000 }
  );
  await pagina.waitForFunction(
    (nombre) => (document.querySelector('#vista-jornada')?.innerText || '').includes(nombre),
    { timeout: 25000 },
    adulto.apellidos
  );
  await cerrarAccionesLopdp(pagina, { subir: true, imprimir: true });
  console.log('✓ Cita creada con admisión inline de paciente adulta');

  // 2. Menor sin representante: debe rechazarse.
  await abrirNuevaDesdeJornada(pagina, '10:00');
  assert.equal(
    await pagina.$eval('#cita-menor-aviso', (nodo) => nodo.hidden),
    true
  );
  await llenarAdmision(pagina, menor);
  const avisoMenor = await pagina.$eval('#cita-menor-aviso', (nodo) => nodo.hidden);
  assert.equal(avisoMenor, false, 'Debe mostrarse el aviso de menor de edad');
  await pagina.click('#btn-guardar-cita');
  await pagina.waitForFunction(
    () => {
      const toast = document.querySelector('.toasts .toast--error');
      return toast && /representante legal/i.test(toast.textContent || '');
    },
    { timeout: 15000 }
  );
  console.log('✓ Menor sin representante rechazado con aviso visible');

  // 3. Completar representante y guardar.
  await pagina.type('#np-rep1-nombre', 'Madre del menor');
  await pagina.type('#np-rep1-cedula', `09${sello}`);
  await pagina.type('#np-rep1-parentesco', 'Madre');
  await pagina.click('#btn-guardar-cita');
  await pagina.waitForFunction(
    () => document.querySelector('#dlg-cita')?.open === false,
    { timeout: 25000 }
  );
  await pagina.waitForFunction(
    (nombre) => (document.querySelector('#vista-jornada')?.innerText || '').includes(nombre),
    { timeout: 25000 },
    menor.apellidos
  );
  await cerrarAccionesLopdp(pagina);
  console.log('✓ Menor registrado con representante legal y cita asignada');

  await pagina.screenshot({
    path: 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\nueva-cita.png',
    fullPage: false,
  });

  // 4. Verificación por API y base de datos.
  await navegador.close();
  navegador = null;

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  for (const [paciente, esMenor] of [
    [adulto, false],
    [menor, true],
  ]) {
    const encontrados = await admin(
      `/api/patients?cedula=${encodeURIComponent(paciente.cedula)}&limit=5`
    );
    assert.equal(encontrados.length, 1, `Debe existir ${paciente.cedula}`);
    const fila = encontrados[0];
    assert.equal(fila.alergias, paciente.alergias);
    assert.equal(fila.es_menor, esMenor);
    if (esMenor) {
      assert.equal(fila.representantes[0].nombre, 'Madre del menor');
    }
  }

  const citas = await admin(`/api/appointments?fecha=${FECHA}&limit=50`);
  const citaAdulta = citas.find((cita) => cita.paciente_cedula === adulto.cedula);
  const citaMenor = citas.find((cita) => cita.paciente_cedula === menor.cedula);
  assert.ok(citaAdulta && citaMenor);
  assert.equal(citaAdulta.tipo, 'normal');
  assert.equal(citaAdulta.cupo, 1);
  assert.equal(citaAdulta.motivo_grupo, 'Estudios');
  assert.equal(citaMenor.es_menor, true);
  console.log('✓ API: pacientes, LOPDP, menor, cupo, tipo y grupo de motivo');

  const db = new DatabaseSync(entorno.dbFile, { readOnly: true });
  try {
    const pacienteDb = db
      .prepare(
        `SELECT consentimiento_datos, telefono, direccion, tipo_doc
         FROM patients WHERE cedula = ?`
      )
      .get(adulto.cedula);
    assert.ok(pacienteDb.consentimiento_datos, 'Debe guardarse la autorización LOPDP');
    assert.equal(pacienteDb.telefono, adulto.telefono);
    assert.equal(pacienteDb.direccion, adulto.direccion);
    assert.equal(pacienteDb.tipo_doc, 'cedula');

    const citasDb = db
      .prepare(
        `SELECT cupo, tipo, motivo_grupo, jornada
         FROM appointments WHERE patient_id = (
           SELECT id FROM patients WHERE cedula = ?
         )`
      )
      .all(adulto.cedula);
    assert.equal(citasDb.length, 1);
    assert.equal(citasDb[0].cupo, 1);
    assert.equal(citasDb[0].tipo, 'normal');
    assert.equal(citasDb[0].motivo_grupo, 'Estudios');
    assert.ok(['manana', 'tarde'].includes(citasDb[0].jornada));

    const menorDb = db
      .prepare(
        `SELECT representante1_nombre FROM patients WHERE cedula = ?`
      )
      .get(menor.cedula);
    assert.equal(menorDb.representante1_nombre, 'Madre del menor');
  } finally {
    db.close();
  }
  console.log('✓ Base normalizada: admisión, LOPDP, representante y cita');

  console.log('');
  console.log('E2E DE NUEVA CITA COMPLETADO');
  console.log(
    JSON.stringify(
      {
        fecha: FECHA,
        adulta: adulto.cedula,
        menor: menor.cedula,
        lopdp: true,
        representante: true,
        cupo: 1,
        tipo: 'normal',
        motivoGrupo: 'Estudios',
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
  console.error('E2E DE NUEVA CITA FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-60).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await navegador?.close().catch(() => {});
  await entorno?.limpiar();
}
