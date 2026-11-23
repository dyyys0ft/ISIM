import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Los documentos se abren con navegación parcial (sin recargar toda la app)
 * y el generador de QR se carga solo cuando se solicita una firma externa.
 */
const sello = String(Date.now()).slice(-6);
const entorno = await crearEntornoE2E();

try {
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `DOC${sello}`,
      nombres: 'Documento',
      apellidos: `Rápido ${sello}`,
      fecha_nacimiento: '1991-04-10',
      sexo: 'F',
    },
  });
  const medicos = await admin('/api/medicos');
  for (const titulo of [`Consentimiento uno ${sello}`, `Consentimiento dos ${sello}`]) {
    await admin('/api/documents', {
      method: 'POST',
      body: {
        patientId: paciente.id,
        medicoId: medicos[0].id,
        titulo,
      },
    });
  }

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

    await p.goto(`${entorno.base}/documentos.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(
      () => document.querySelectorAll('.doc-item').length >= 2,
      { timeout: 20000 }
    );
    await p.evaluate(() => {
      window.__navegacionParcial = '1';
    });

    // Abre el segundo documento sin recargar la aplicación.
    const tituloSegundo = await p.$$eval('.doc-item', (nodos) =>
      nodos[1]?.querySelector('.doc-item__title')?.textContent.trim()
    );
    assert.ok(tituloSegundo, 'Debe existir un segundo documento en la lista');
    await p.evaluate(() => {
      document.querySelectorAll('.doc-item')[1]?.click();
    });
    await p.waitForFunction(
      (titulo) =>
        location.pathname === '/documento.html' &&
        document.querySelector('#doc-titulo')?.textContent.includes(titulo),
      { timeout: 20000 },
      tituloSegundo
    );
    assert.equal(
      await p.evaluate(() => window.__navegacionParcial),
      '1',
      'Abrir un documento no debe recargar toda la página'
    );
    assert.equal(
      await p.evaluate(() => typeof window.qrcode),
      'undefined',
      'El generador de QR debe cargarse solo al pedir una firma externa'
    );

    // El botón Volver también conserva la aplicación y vuelve a la lista.
    await p.click('.breadcrumb a[data-nav="documentos"]');
    await p.waitForFunction(
      () => location.pathname === '/documentos.html' && document.querySelector('.doc-item'),
      { timeout: 20000 }
    );
    assert.equal(
      await p.evaluate(() => window.__navegacionParcial),
      '1',
      'Volver a consentimientos no debe recargar toda la página'
    );

    // Si se pide firma externa, el QR se carga de forma diferida y se dibuja.
    await p.evaluate(() => {
      document.querySelectorAll('.doc-item')[1]?.click();
    });
    await p.waitForFunction(
      () => location.pathname === '/documento.html' && document.querySelector('#doc-titulo'),
      { timeout: 20000 }
    );
    await p.waitForSelector('#btn-firmar-externo');
    await p.click('#btn-firmar-externo');
    await p.waitForFunction(
      () =>
        document.querySelector('#dlg-qr')?.open === true &&
        Boolean(document.querySelector('#qr-contenedor svg')),
      { timeout: 25000 }
    );
    assert.equal(await p.evaluate(() => typeof window.qrcode), 'function');
    await p.click('#btn-cerrar-qr');

    console.log('✓ Segundo documento y Volver usan navegación parcial sin recarga');
    console.log('✓ El QR se carga solo al solicitar firma externa');
    console.log('');
    console.log('DOCUMENTOS: NAVEGACIÓN Y QR OK');
  } finally {
    await navegador.close();
  }
} finally {
  await entorno.limpiar();
}
