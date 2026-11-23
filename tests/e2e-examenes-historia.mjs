import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Paciente nuevo con cita:
 * - solicitar exámenes con observaciones,
 * - subir el resultado,
 * - ver la cita de origen en cada examen,
 * - abrir el detalle de la cita en un modal desde Historia clínica.
 */
const sello = String(Date.now()).slice(-6);
const capturas = 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2\\capturas';
const DATA_DIR = resolve(
  'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2',
  `data-examenes-historia-${Date.now()}`
);
mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
const entorno = await crearEntornoE2E();
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const medicos = await admin('/api/medicos');
  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `EXH${sello}`,
      nombres: 'Elena',
      apellidos: `Exámenes ${sello}`,
      fecha_nacimiento: '1991-03-20',
      sexo: 'F',
      telefono: '0991234567',
    },
  });
  const cita = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      medicoId: medicos[0].id,
      fechaHora: '2027-01-15T15:00:00.000Z',
      duracionMin: 30,
      motivo: 'Control con exámenes',
      estado: 'programada',
    },
  });
  const historia = await admin('/api/clinical-records', {
    method: 'POST',
    body: {
      appointmentId: cita.id,
      motivoConsulta: 'Control y solicitud de exámenes',
      notas: 'Paciente nueva para control integral.',
    },
  });

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

    const ficha = `${entorno.base}/paciente.html?id=${encodeURIComponent(
      paciente.id
    )}&cita=${encodeURIComponent(cita.id)}`;

    // Solicitar dos exámenes con observaciones desde la ficha.
    await p.goto(`${ficha}&tab=examenes`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#form-examen', { timeout: 25000 });
    const examenes = [
      {
        nombre: 'Hemograma completo',
        tipo: 'laboratorio',
        descripcion: 'Control prenatal de primer trimestre',
        observaciones: 'Ayuno de 8 horas. Entregar resultado en 24 horas.',
      },
      {
        nombre: 'Ecografía transvaginal',
        tipo: 'imagen',
        descripcion: 'Evaluación de control',
        observaciones: 'Realizar con vejiga vacía.',
      },
    ];
    for (const examen of examenes) {
      await p.type('#form-examen [name="nombre"]', examen.nombre);
      await p.select('#form-examen [name="tipo"]', examen.tipo);
      await p.type('#form-examen [name="descripcion"]', examen.descripcion);
      await p.type('#form-examen [name="observaciones"]', examen.observaciones);
      await p.click('#form-examen button[type="submit"]');
      await p.waitForFunction(
        (nombre) => document.querySelector('#panel-tab')?.innerText.includes(nombre),
        { timeout: 25000 },
        examen.nombre
      );
    }

    const registros = await p.evaluate(async (id) => {
      const respuesta = await fetch(
        `/api/clinical-records?patientId=${encodeURIComponent(id)}`,
        { credentials: 'same-origin' }
      );
      return respuesta.json();
    }, paciente.id);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].id, historia.id);
    assert.equal(registros[0].appointment_id, cita.id);
    assert.equal(registros[0].cita_motivo, 'Control con exámenes');
    assert.equal(registros[0].examenes.length, 2);
    assert.deepEqual(
      registros[0].examenes.map((examen) => examen.observaciones).sort(),
      examenes.map((examen) => examen.observaciones).sort()
    );
    assert.ok(
      registros[0].examenes.every((examen) => examen.record_id === historia.id),
      'Cada examen debe pertenecer a la consulta de la cita'
    );

    // Subir el resultado del primer examen desde el historial.
    const archivo = resolve(
      'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2',
      `resultado-examen-${sello}.png`
    );
    writeFileSync(
      archivo,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      )
    );
    const primerExamen = registros[0].examenes.find(
      (examen) => examen.nombre === 'Hemograma completo'
    );
    const [selector] = await Promise.all([
      p.waitForFileChooser({ timeout: 10000 }),
      p.click(`[data-subir="${primerExamen.id}"]`),
    ]);
    await selector.accept([archivo]);
    await p.waitForFunction(
      () => document.body.innerText.includes('Resultado subido'),
      { timeout: 25000 }
    );
    await p.waitForSelector('a[href*="/api/clinical-attachments/"]', { timeout: 20000 });
    await esperar(300);
    await p.screenshot({ path: `${capturas}\\51-examenes-notas-cita.png` });

    const textoExamenes = await p.$eval('#panel-tab', (nodo) => nodo.innerText);
    assert.match(textoExamenes, /Cita:/);
    assert.match(textoExamenes, /Control con exámenes/);
    assert.match(textoExamenes, /Ayuno de 8 horas/);
    assert.match(textoExamenes, /Hemograma completo/);
    assert.match(textoExamenes, /Ecografía transvaginal/);

    // Historia clínica: cada cita por fecha/descripción y detalle en modal.
    await p.goto(`${ficha}&tab=historia`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#panel-tab table.tbl', { timeout: 25000 });
    const tabla = await p.$eval('#panel-tab table.tbl', (nodo) => nodo.innerText);
    assert.match(tabla, /motivo \/ descripción/i);
    assert.match(tabla, /Control y solicitud de exámenes/);
    await p.click('#panel-tab tbody tr[data-historia]');
    await p.waitForSelector('.modal .hc-detalle', { timeout: 20000 });
    const modal = await p.$eval('.modal .hc-detalle', (nodo) => nodo.innerText);
    assert.match(modal, /Control y solicitud de exámenes/);
    assert.match(modal, /Exámenes \(2\)/);
    assert.match(modal, /Hemograma completo/);
    assert.match(modal, /Ayuno de 8 horas/);
    assert.match(modal, /Control con exámenes/);
    assert.match(modal, /Recetas \(0\)/);
    assert.match(modal, /Pedidos \(0\)/);
    assert.match(modal, /Notas aclaratorias/);
    await esperar(400);
    await p.screenshot({ path: `${capturas}\\52-historia-modal-cita.png` });

    await p.setViewport({ width: 390, height: 844 });
    await esperar(300);
    await p.screenshot({ path: `${capturas}\\53-historia-modal-movil.png` });
    await p.click('.modal [data-cerrar-modal]');
    await p.waitForFunction(() => !document.querySelector('.modal'));
    assert.ok(await p.$('#panel-tab table.tbl'));

    console.log('✓ Paciente nuevo: exámenes solicitados con observaciones');
    console.log('✓ Resultado de examen subido desde la ficha');
    console.log('✓ Cada examen muestra su cita de origen');
    console.log('✓ Historia clínica: cita por fecha/descripción y modal completo');
    console.log('');
    console.log('EXÁMENES, NOTAS, CITA E HISTORIA MODAL OK');
  } finally {
    await navegador.close();
  }
} finally {
  await entorno.limpiar();
  rmSync(DATA_DIR, { recursive: true, force: true });
}
