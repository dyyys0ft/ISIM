import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de avisos de formularios.
 *
 * Comprueba que los campos obligatorios se resaltan al enviar vacío y que los
 * errores del servidor se muestran encima del diálogo, no detrás de él.
 */

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

async function main() {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const sello = String(Date.now()).slice(-8);
  await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `AV${sello}`,
      nombres: 'Duplicada',
      apellidos: 'PRUEBA AVISOS',
      fecha_nacimiento: '1990-01-01',
      sexo: 'F',
    },
  });

  const ejecutable = encontrarNavegador();
  if (!ejecutable) {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
    return;
  }

  navegador = await puppeteer.launch({
    executablePath: ejecutable,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1000'],
  });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 1000 });
  await pagina.setCacheEnabled(false);
  pagina.setDefaultTimeout(30000);

  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.type('#login-usuario', 'admin');
  await pagina.type('#login-password', '54321');
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html');

  await pagina.goto(`${entorno.base}/pacientes.html`, { waitUntil: 'domcontentloaded' });
  await pagina.click('#btn-nuevo');
  await pagina.waitForFunction(() => document.querySelector('#dlg-paciente')?.open === true);

  // 1. Enviar vacío: los obligatorios quedan resaltados.
  await pagina.click('#btn-guardar-paciente');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const resaltados = await pagina.evaluate(() =>
    ['p-nombres', 'p-apellidos', 'p-cedula'].filter((id) =>
      document.querySelector(`#${id}`)?.classList.contains('campo-invalido')
    )
  );
  assert.deepEqual(resaltados, ['p-nombres', 'p-apellidos', 'p-cedula']);
  console.log('✓ Campos obligatorios resaltados al enviar vacío');

  // 2. Error del servidor: aviso visible sobre el diálogo.
  await pagina.type('#p-nombres', 'Prueba');
  await pagina.type('#p-apellidos', 'Avisos');
  await pagina.type('#p-cedula', `AV${sello}`);
  await pagina.evaluate(() => {
    const fecha = document.querySelector('#p-nacimiento');
    fecha.value = '1990-01-01';
    fecha.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pagina.click('#btn-guardar-paciente');
  await pagina.waitForSelector('.toasts .toast--error');

  const aviso = await pagina.evaluate(() => {
    const caja = document.querySelector('.toasts');
    const toast = caja?.querySelector('.toast--error');
    const rect = toast?.getBoundingClientRect();
    return {
      capaSuperior: Boolean(caja?.matches(':popover-open')),
      visible: Boolean(rect && rect.width > 0 && rect.height > 0),
      texto: toast?.textContent || '',
      top: Math.round(rect?.top || 0),
    };
  });
  assert.equal(aviso.capaSuperior, true);
  assert.equal(aviso.visible, true);
  assert.match(aviso.texto, /Ya existe una paciente/i);
  assert.ok(aviso.top >= 0 && aviso.top < 200, `El aviso debe quedar arriba y visible (${aviso.top}px)`);
  console.log(`✓ Error del servidor visible sobre el diálogo (${aviso.texto})`);

  await pagina.screenshot({
    path: 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\avisos-formulario.png',
    fullPage: false,
  });

  console.log('');
  console.log('E2E DE AVISOS EN FORMULARIOS COMPLETADO');
  console.log(
    JSON.stringify(
      {
        camposResaltados: resaltados,
        avisoSobreDialogo: true,
        textoAviso: aviso.texto,
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
  console.error('E2E DE AVISOS EN FORMULARIOS FALLÓ:', error.message);
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
  await entorno?.limpiar();
}
