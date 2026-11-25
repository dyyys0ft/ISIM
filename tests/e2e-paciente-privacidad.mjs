import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Embarazo en notas importantes, orden junto al contador, contacto
 * enmascarado con revelado auditado y reportes por acción/módulo/paciente.
 */
const sello = String(Date.now()).slice(-6);
const apellido = `Privacidad ${sello}`;
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const entorno = await crearEntornoE2E();

try {
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  const comun = {
    apellidos: apellido,
    fecha_nacimiento: '1990-01-15',
    sexo: 'F',
  };
  const ana = await admin('/api/patients', {
    method: 'POST',
    body: {
      ...comun,
      cedula: `ZZ${sello}`,
      nombres: 'Ana',
      telefono: '0991234567',
      email: 'ana.privacidad@isim.local',
      fum: '2026-10-01',
      embarazada: '1',
      embarazo_nota: 'Control prenatal cada 4 semanas',
    },
  });
  await admin('/api/patients', {
    method: 'POST',
    body: {
      ...comun,
      cedula: `AA${sello}`,
      nombres: 'Zoe',
      telefono: '0997654321',
      email: 'zoe.privacidad@isim.local',
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

    await p.goto(`${entorno.base}/pacientes.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#lista .patient-card');
    await p.waitForSelector('#buscar-paciente');
    await p.type('#buscar-paciente', apellido);
    await p.waitForFunction(
      () => document.querySelectorAll('#lista .patient-card').length === 2,
      { timeout: 20000 }
    );

    const tarjeta = (id) => `[data-id="${id}"]`;
    const textoAna = await p.$eval(tarjeta(ana.id), (nodo) => nodo.innerText);
    assert.match(textoAna, /•••• 4567/);
    assert.ok(!textoAna.includes('0991234567'), 'El teléfono completo no debe mostrarse');
    assert.ok(
      !textoAna.includes('ana.privacidad@isim.local'),
      'El correo completo no debe mostrarse'
    );
    assert.equal(
      await p.$$eval('[data-action="editar"]', (nodos) => nodos.length),
      0,
      'La lista no debe ofrecer el botón Editar'
    );
    assert.ok(
      await p.$('.patient-results-bar [data-orden="nombre_asc"][aria-pressed="true"]'),
      'A-Z debe ser el orden inicial'
    );
    await p.waitForSelector('#alerta-sin-consentimiento:not([hidden])');
    assert.match(
      await p.$eval('#alerta-sin-consentimiento-texto', (nodo) => nodo.textContent),
      /consentimiento LOPDP/i
    );
    assert.match(
      await p.$$eval('#lista .patient-card__badges', (nodos) =>
        nodos.map((nodo) => nodo.innerText).join(' ')
      ),
      /sin consentimiento lopdp/i
    );

    // La alerta permite filtrar exactamente a quienes no tienen consentimiento.
    await p.click('#btn-filtrar-sin-consentimiento');
    await p.waitForFunction(
      () => document.querySelector('#btn-filtrar-sin-consentimiento')?.getAttribute('aria-pressed') === 'true',
      { timeout: 20000 }
    );
    await p.waitForFunction(
      () => document.querySelectorAll('#lista .patient-card').length === 2,
      { timeout: 20000 }
    );
    await p.click('#btn-filtrar-sin-consentimiento');
    await p.waitForFunction(
      () => document.querySelector('#btn-filtrar-sin-consentimiento')?.getAttribute('aria-pressed') === 'false',
      { timeout: 20000 }
    );

    // Revelar: se ven los datos completos y queda el evento de auditoría.
    await p.click(`${tarjeta(ana.id)} [data-revelar-contacto]`);
    await p.waitForFunction(
      (id) => document.querySelector(`[data-id="${id}"]`)?.innerText.includes('0991234567'),
      { timeout: 10000 },
      ana.id
    );
    assert.match(
      await p.$eval(tarjeta(ana.id), (nodo) => nodo.innerText),
      /ana\.privacidad@isim\.local/
    );

    const db = new DatabaseSync(entorno.dbFile);
    let auditoria = null;
    const limite = Date.now() + 8000;
    while (Date.now() < limite) {
      auditoria = db
        .prepare(
          "SELECT accion, entidad, entidad_id FROM audit_log WHERE accion = 'contacto_paciente_revelado' AND entidad_id = ?"
        )
        .get(ana.id);
      if (auditoria) break;
      await esperar(100);
    }
    db.close();
    assert.ok(auditoria, 'El revelado de contacto debe auditarse');

    await p.click(`${tarjeta(ana.id)} [data-revelar-contacto]`);
    await p.waitForFunction(
      (id) => !document.querySelector(`[data-id="${id}"]`)?.innerText.includes('0991234567'),
      { timeout: 10000 },
      ana.id
    );

    // Orden junto al contador de resultados.
    const primerNombre = () =>
      p.$eval('#lista .patient-card__name', (nodo) => nodo.textContent.trim());
    await p.click('[data-orden="nombre_desc"]');
    await p.waitForFunction(
      () => document.querySelector('#lista .patient-card__name')?.textContent.includes('Zoe'),
      { timeout: 20000 }
    );
    await p.click('[data-orden="cedula_asc"]');
    await p.waitForFunction(
      () => document.querySelector('#lista .patient-card__name')?.textContent.includes('Zoe'),
      { timeout: 20000 }
    );
    await p.click('[data-orden="cedula_desc"]');
    await p.waitForFunction(
      () => document.querySelector('#lista .patient-card__name')?.textContent.includes('Ana'),
      { timeout: 20000 }
    );
    assert.match(await primerNombre(), /Ana/);

    // Ficha: check de embarazo, FUM y nota visibles arriba.
    await p.goto(
      `${entorno.base}/paciente.html?id=${encodeURIComponent(ana.id)}&tab=datos`,
      { waitUntil: 'domcontentloaded' }
    );
    await p.waitForSelector('#form-datos');
    assert.equal(
      await p.$eval('[name="embarazada"]', (nodo) => nodo.checked),
      true,
      'El check de embarazo debe estar marcado'
    );
    assert.equal(await p.$eval('[name="fum"]', (nodo) => nodo.value), '2026-10-01');
    assert.equal(
      await p.$eval('[name="embarazo_nota"]', (nodo) => nodo.value),
      'Control prenatal cada 4 semanas'
    );

    const notaEmbarazo = await p.$eval('.nota-imp--embarazo', (nodo) => nodo.innerText);
    assert.match(notaEmbarazo, /EMBARAZO/);
    assert.match(notaEmbarazo, /FUM/i);
    assert.match(notaEmbarazo, /01 oct 2026/i);
    assert.match(notaEmbarazo, /Control prenatal cada 4 semanas/);
    assert.match(await p.$eval('#datos-telefono', (nodo) => nodo.value), /•••• 4567/);
    assert.ok(
      !(await p.$eval('#datos-email', (nodo) => nodo.value)).includes('ana.privacidad@isim.local')
    );
    await p.click('[data-revelar-contacto-form]');
    await p.waitForFunction(
      () => document.querySelector('#datos-telefono')?.value === '0991234567',
      { timeout: 10000 }
    );
    assert.equal(
      await p.$eval('#datos-email', (nodo) => nodo.value),
      'ana.privacidad@isim.local'
    );
    const contactoFicha = await p.$eval('.phead .contacto-privado', (nodo) => nodo.innerText);
    assert.match(contactoFicha, /•••• 4567/);
    assert.ok(!contactoFicha.includes('0991234567'));

    // Reportes: columnas Acción, Fecha y hora, Módulo, Paciente.
    await p.goto(`${entorno.base}/reportes.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.reporte-tabla', { timeout: 25000 });
    const encabezados = await p.$$eval('.reporte-tabla thead th', (nodos) =>
      nodos.map((nodo) => nodo.textContent.trim())
    );
    assert.deepEqual(encabezados, [
      'Acción',
      'Fecha y hora',
      'Módulo',
      'Paciente',
      'Usuario',
      'Detalle',
    ]);
    const filas = await p.$$eval('.reporte-tabla tbody tr', (nodos) =>
      nodos.map((nodo) => nodo.innerText)
    );
    assert.ok(
      filas.some(
        (fila) =>
          /Datos de contacto consultados/.test(fila) &&
          /Pacientes/.test(fila) &&
          fila.includes(apellido)
      ),
      'El reporte debe mostrar acción, módulo Pacientes y la paciente involucrada'
    );

    console.log('✓ Embarazo visible en notas importantes y datos editables');
    console.log('✓ Orden A-Z/Z-A/Cédula junto al contador de resultados');
    console.log('✓ Contacto enmascarado, ojo revela y auditoría registrada');
    console.log('✓ Reportes por acción, fecha/hora, módulo y paciente');
    console.log('');
    console.log('PACIENTE, PRIVACIDAD Y REPORTES OK');
  } finally {
    await navegador.close();
  }
} finally {
  await entorno.limpiar();
}
