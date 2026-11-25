import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

const capturas = resolve('C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2\\capturas-ux');
mkdirSync(capturas, { recursive: true });
const DATA_DIR = resolve(
  'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2',
  `data-ux-movil-${Date.now()}`
);
mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;

const entorno = await crearEntornoE2E();
const admin = entorno.crearCliente();
await entorno.iniciarSesion(admin, 'admin', '54321');
const [paciente] = await admin('/api/patients?limit=1');
const medicos = await admin('/api/medicos');
const cita = await admin('/api/appointments', {
  method: 'POST',
  body: {
    patientId: paciente.id,
    medicoId: medicos[0]?.id || null,
    fechaHora: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    duracionMin: 30,
    motivo: 'Control móvil UX',
    estado: 'programada',
  },
});
await admin(`/api/appointments/${encodeURIComponent(cita.id)}/start-consultation`, {
  method: 'POST',
});
const historias = await admin(
  `/api/clinical-records?appointmentId=${encodeURIComponent(cita.id)}`
);
const historia = historias[0];
assert.ok(historia?.id, 'Debe existir una historia clínica');
await admin(`/api/clinical-records/${encodeURIComponent(historia.id)}/prescription`, {
  method: 'PUT',
  body: {
    fecha: new Date().toLocaleDateString('en-CA'),
    hora: new Date().toTimeString().slice(0, 5),
    items: [
      {
        medicamento: 'Paracetamol',
        dci: 'Paracetamol',
        presentacion: 'Tableta 500 mg',
        indicaciones: '1 tableta cada 8 horas',
        cantidad: 12,
        unidad: 'tabletas',
      },
    ],
    datos: {
      diagnostico: 'Cefalea',
      cie: 'R51',
      alergias: 'No refiere',
      recomendaciones: 'Hidratación',
      para_pareja: 0,
    },
    diagnostico: 'Cefalea',
    cie10: 'R51',
    alergias: 'No refiere',
    recomendaciones: 'Hidratación',
    paraPareja: 0,
  },
});

const navegador = await puppeteer.launch({
  executablePath: [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
    .filter(Boolean)
    .find((ruta) => existsSync(ruta)),
  headless: 'new',
  args: ['--no-sandbox'],
});

const peticionesExternas = [];
try {
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await pagina.setCacheEnabled(false);
  pagina.setDefaultTimeout(30000);
  await pagina.setRequestInterception(true);
  pagina.on('request', (peticion) => {
    const url = peticion.url();
    if (url.startsWith(entorno.base) || url.startsWith('data:') || url.startsWith('blob:')) {
      peticion.continue();
    } else {
      peticionesExternas.push(url);
      peticion.abort();
    }
  });

  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#btn-ingresar');
  await pagina.type('#login-usuario', 'admin');
  await pagina.type('#login-password', '54321');
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html', { timeout: 30000 });
  await pagina.waitForSelector('body.isim-shell');

  // 1. Barra rápida móvil y cita directa.
  await pagina.waitForSelector('.quickbar', { timeout: 20000 });
  const barra = await pagina.$eval('.quickbar', (nodo) => ({
    bottom: Math.round(innerHeight - nodo.getBoundingClientRect().bottom),
    alturas: [...nodo.querySelectorAll('.quickbar__item')].map((item) =>
      Math.round(item.getBoundingClientRect().height)
    ),
    items: [...nodo.querySelectorAll('.quickbar__item')].map((item) =>
      item.textContent.trim()
    ),
  }));
  assert.equal(barra.bottom, 0, 'La barra rápida debe pegarse al borde inferior');
  assert.ok(barra.alturas.every((alto) => alto >= 44), 'Los accesos móviles deben ser táctiles');
  assert.ok(barra.items.length >= 4);
  await pagina.screenshot({ path: `${capturas}\\37-barra-rapida-movil.png` });
  await pagina.click('.quickbar__item--principal');
  await pagina.waitForSelector('#dlg-cita[open]', { timeout: 20000 });
  await pagina.keyboard.press('Escape');
  console.log('✓ Barra rápida móvil y nueva cita');

  // 2. Ficha móvil: pestañas cortas, desplazamiento y guardado fijo.
  await pagina.goto(
    `${entorno.base}/paciente.html?id=${encodeURIComponent(
      paciente.id
    )}&cita=${encodeURIComponent(cita.id)}&tab=datos`,
    { waitUntil: 'domcontentloaded' }
  );
  await pagina.waitForSelector('#form-datos', { timeout: 30000 });
  const pestañas = await pagina.$eval('#tabs-ficha', (nodo) => ({
    scrollWidth: nodo.scrollWidth,
    clientWidth: nodo.clientWidth,
    corta: getComputedStyle(nodo.querySelector('.tab-etiqueta--corta')).display,
    larga: getComputedStyle(nodo.querySelector('.tab-etiqueta--larga')).display,
    activaVisible: (() => {
      const activa = nodo.querySelector('button.on');
      const caja = nodo.getBoundingClientRect();
      const r = activa.getBoundingClientRect();
      return r.left >= caja.left && r.right <= caja.right;
    })(),
  }));
  assert.ok(pestañas.scrollWidth > pestañas.clientWidth, 'Las pestañas deben desplazarse');
  assert.equal(pestañas.corta, 'inline');
  assert.equal(pestañas.larga, 'none');
  assert.ok(pestañas.activaVisible);
  const guardadoDatos = await pagina.$eval('.form-acciones-fijas', (nodo) =>
    Math.round(innerHeight - nodo.getBoundingClientRect().bottom)
  );
  assert.ok(guardadoDatos <= 2, 'El guardado de datos debe quedar fijo abajo');
  await pagina.screenshot({ path: `${capturas}\\38-ficha-movil.png` });
  console.log('✓ Pestañas y guardado fijo en la ficha móvil');

  // 3. Autoguardado de la consulta.
  await pagina.click('#tabs-ficha button[data-tab="consulta"]');
  await pagina.waitForSelector('#form-consulta', { timeout: 25000 });
  await pagina.type('[name="motivo"]', 'Control móvil con autoguardado');
  assert.ok(
    await pagina.$eval('.form-acciones-fijas', (nodo) =>
      Math.round(innerHeight - nodo.getBoundingClientRect().bottom) <= 2
    ),
    'La consulta debe mantener el guardado fijo'
  );
  await pagina.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const guardado = await pagina.evaluate(async (citaId) => {
    const lista = await (
      await fetch(`/api/clinical-records?appointmentId=${encodeURIComponent(citaId)}`)
    ).json();
    if (!lista[0]?.id) return null;
    return (
      await fetch(`/api/clinical-records/${encodeURIComponent(lista[0].id)}`)
    ).json();
  }, cita.id);
  assert.match(
    String(guardado?.datos?.motivo || guardado?.motivo_consulta || ''),
    /Control móvil con autoguardado/,
    'El autoguardado debe persistir el motivo'
  );
  console.log('✓ Autoguardado de la consulta');

  // 4. Receta móvil con acción fija y repetir última.
  await pagina.click('#tabs-ficha button[data-tab="receta"]');
  await pagina.waitForSelector('#form-receta', { timeout: 25000 });
  await pagina.waitForSelector('#rx-repetir', { timeout: 20000 });
  const guardadoReceta = await pagina.$eval('.form-acciones-fijas', (nodo) =>
    Math.round(innerHeight - nodo.getBoundingClientRect().bottom)
  );
  assert.ok(guardadoReceta <= 2, 'La receta debe mantener el guardado fijo');
  await pagina.screenshot({ path: `${capturas}\\39-receta-movil.png` });
  assert.deepEqual(peticionesExternas, [], 'No debe haber peticiones externas');
  console.log('✓ Receta móvil y acciones fijas');

  console.log('');
  console.log('UX MÓVIL OK');
  await pagina.close();
} finally {
  await navegador.close();
  await entorno.limpiar();
  rmSync(DATA_DIR, { recursive: true, force: true });
}
