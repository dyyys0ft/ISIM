import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

const capturas = resolve('C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2\\capturas-ux');
mkdirSync(capturas, { recursive: true });
const DATA_DIR = resolve(
  'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2',
  `data-ux-rapida-${Date.now()}`
);
mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;

const entorno = await crearEntornoE2E();
const admin = entorno.crearCliente();
await entorno.iniciarSesion(admin, 'admin', '54321');
const [pacienteBase] = await admin('/api/patients?limit=1');
const medicos = await admin('/api/medicos');
const cita = await admin('/api/appointments', {
  method: 'POST',
  body: {
    patientId: pacienteBase.id,
    medicoId: medicos[0]?.id || null,
    fechaHora: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    duracionMin: 30,
    motivo: 'Control de pruebas UX',
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
assert.ok(historia?.id, 'Debe existir una historia clínica para la receta');
await admin(`/api/clinical-records/${encodeURIComponent(historia.id)}/prescription`, {
  method: 'PUT',
  body: {
    fecha: new Date().toLocaleDateString('en-CA'),
    hora: new Date().toTimeString().slice(0, 5),
    items: [
      {
        medicamento: 'Ibuprofeno',
        dci: 'Ibuprofeno',
        presentacion: 'Tableta 400 mg',
        indicaciones: '1 tableta cada 8 horas',
        cantidad: 10,
        unidad: 'tabletas',
      },
    ],
    datos: {
      diagnostico: 'Dolor pélvico',
      cie: 'R10.2',
      alergias: 'Penicilina',
      recomendaciones: 'Control en 7 días',
      para_pareja: 0,
    },
    diagnostico: 'Dolor pélvico',
    cie10: 'R10.2',
    alergias: 'Penicilina',
    recomendaciones: 'Control en 7 días',
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

async function nuevaPagina(viewport = { width: 1440, height: 900 }) {
  const pagina = await navegador.newPage();
  await pagina.setViewport(viewport);
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
  return pagina;
}

async function iniciarSesion(pagina) {
  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#btn-ingresar');
  await pagina.type('#login-usuario', 'admin');
  await pagina.type('#login-password', '54321');
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html', { timeout: 30000 });
  await pagina.waitForSelector('body.isim-shell');
}

let pagina = null;
let recetaPage = null;
try {
  pagina = await nuevaPagina();
  await iniciarSesion(pagina);

  // 1. Búsqueda global y acceso rápido a una cita.
  await pagina.keyboard.down('Control');
  await pagina.keyboard.press('KeyK');
  await pagina.keyboard.up('Control');
  await pagina.waitForSelector('#cmd-busqueda[open]');
  await pagina.waitForSelector('#cmd-resultados [data-cmd-id="cita"]', {
    timeout: 15000,
  });
  await pagina.type('#cmd-entrada', pacienteBase.apellidos.slice(0, 5));
  await pagina.waitForFunction(
    () => document.querySelectorAll('#cmd-resultados .cmd__paciente').length > 0,
    { timeout: 15000 }
  );
  await pagina.screenshot({ path: `${capturas}\\33-busqueda-global.png` });
  const chipCita = await pagina.$('#cmd-resultados .cmd__chip');
  assert.ok(chipCita, 'La búsqueda debe ofrecer Nueva cita');
  await chipCita.click();
  await pagina.waitForSelector('#dlg-cita[open]', { timeout: 20000 });
  assert.ok(
    await pagina.$eval('#cita-paciente', (nodo) => Boolean(nodo.value)),
    'La cita debe abrir con la paciente preseleccionada'
  );
  await pagina.keyboard.press('Escape');

  // La búsqueda debe seguir disponible después de una navegación parcial.
  await pagina.click('a[data-nav="pacientes"]');
  await pagina.waitForFunction(() => location.pathname === '/pacientes.html', {
    timeout: 20000,
  });
  await pagina.keyboard.down('Control');
  await pagina.keyboard.press('KeyK');
  await pagina.keyboard.up('Control');
  await pagina.waitForSelector('#cmd-busqueda[open]', { timeout: 15000 });
  await pagina.keyboard.press('Escape');
  console.log('✓ Búsqueda global con apertura directa de cita');

  // 2. Alta rápida de paciente y búsqueda única.
  await pagina.goto(`${entorno.base}/pacientes.html?nuevo=1`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#dlg-paciente[open]', { timeout: 20000 });
  const visibles = await pagina.$$eval(
    '#form-paciente input, #form-paciente select, #form-paciente textarea',
    (nodos) =>
      nodos.filter((n) => {
        if (n.closest('details:not([open])')) return false;
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).length
  );
  assert.ok(visibles <= 7, `El alta rápida debe mostrar pocos campos (mostró ${visibles})`);
  const cedula = `UX${String(Date.now()).slice(-6)}`;
  await pagina.type('#p-nombres', 'Paciente');
  await pagina.type('#p-apellidos', 'Creación Rápida');
  await pagina.type('#p-cedula', cedula);
  await pagina.screenshot({ path: `${capturas}\\34-alta-rapida-paciente.png` });
  await pagina.click('#btn-guardar-paciente');
  await pagina.waitForFunction(() => document.querySelector('#dlg-paciente')?.open === false, {
    timeout: 20000,
  });
  const pacienteCreado = await pagina.evaluate(async (valorCedula) => {
    const respuesta = await fetch(
      `/api/patients/paginated?cedula=${encodeURIComponent(valorCedula)}`
    );
    return respuesta.json();
  }, cedula);
  assert.equal(pacienteCreado.items?.length, 1, 'La paciente rápida debe quedar registrada');
  assert.equal(
    await pagina.$eval('#filtros-avanzados-pacientes', (nodo) => nodo.open),
    false,
    'Los filtros avanzados deben iniciar cerrados'
  );
  await pagina.type('#buscar-paciente', cedula);
  await pagina.waitForFunction(
    () => document.querySelectorAll('#lista .patient-card').length === 1,
    { timeout: 15000 }
  );
  console.log('✓ Alta rápida y búsqueda única de pacientes');

  // 3. Consentimiento con valores por defecto y creación con firma.
  await pagina.goto(`${entorno.base}/documentos.html?nuevo=1`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#dlg-nuevo[open]', { timeout: 20000 });
  const consentimiento = await pagina.evaluate(() => ({
    plantilla: document.querySelector('#nuevo-tipo')?.value || '',
    titulo: document.querySelector('#nuevo-titulo')?.value || '',
    aviso: document.querySelector('#nuevo-medico-aviso')?.textContent || '',
    crearFirmar: Boolean(document.querySelector('#btn-crear-firmar')),
  }));
  assert.ok(consentimiento.plantilla, 'Debe preseleccionar una plantilla');
  assert.ok(consentimiento.titulo, 'Debe autocompletar el título');
  assert.ok(consentimiento.crearFirmar, 'Debe existir Crear y firmar');
  await pagina.type('#nuevo-paciente-busqueda', pacienteBase.apellidos.slice(0, 5));
  await pagina.waitForSelector('#resultados-pacientes .search-result', { timeout: 15000 });
  await pagina.click('#resultados-pacientes .search-result');
  await pagina.screenshot({ path: `${capturas}\\35-consentimiento-rapido.png` });
  const respuestaFirma = pagina.waitForResponse(
    (respuesta) =>
      respuesta.url().includes('/sign-session') &&
      respuesta.request().method() === 'POST',
    { timeout: 20000 }
  );
  await pagina.click('#btn-crear-firmar');
  const firma = await respuestaFirma;
  assert.ok(
    [200, 201].includes(firma.status()),
    `Crear y firmar debe iniciar la sesión de firma (${firma.status()})`
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
  for (const objetivo of await navegador.pages()) {
    if (objetivo !== pagina) await objetivo.close();
  }
  await pagina.waitForSelector('#lista .doc-item', { timeout: 20000 });
  assert.ok(
    await pagina.$('[data-firmar-doc]'),
    'La lista debe permitir firmar un consentimiento pendiente'
  );
  await pagina.screenshot({ path: `${capturas}\\35b-consentimiento-en-lista.png` });

  await pagina.click('#btn-nuevo');
  await pagina.waitForSelector('#dlg-nuevo[open]');
  const reapertura = await pagina.evaluate(() => ({
    plantilla: document.querySelector('#nuevo-tipo')?.value || '',
    titulo: document.querySelector('#nuevo-titulo')?.value || '',
  }));
  assert.ok(reapertura.plantilla, 'Al reabrir debe conservar la plantilla preferida');
  assert.ok(reapertura.titulo, 'Al reabrir debe autocompletar el título');
  assert.equal(
    await pagina.$eval('#btn-crear-firmar', (nodo) => nodo.disabled),
    false,
    'El botón Crear y firmar debe quedar habilitado al reabrir'
  );
  await pagina.evaluate(() => document.querySelector('#dlg-nuevo').close());
  console.log('✓ Consentimiento con plantilla, título y firma directa');

  // 4. Repetir la última receta en una pestaña nueva.
  recetaPage = await nuevaPagina();
  await recetaPage.goto(
    `${entorno.base}/paciente.html?id=${encodeURIComponent(
      pacienteBase.id
    )}&cita=${encodeURIComponent(cita.id)}&tab=receta`,
    { waitUntil: 'domcontentloaded' }
  );
  await recetaPage.waitForSelector('#form-receta', { timeout: 25000 });
  await recetaPage.waitForSelector('#rx-repetir', { timeout: 20000 });
  await recetaPage.click('#rx-repetir');
  const confirmacion = await recetaPage.$('dialog.modal [data-aceptar]');
  if (confirmacion) await confirmacion.click();
  await recetaPage.waitForFunction(
    () => document.querySelectorAll('#rx-items .rx-item').length > 0,
    { timeout: 15000 }
  );
  assert.equal(
    await recetaPage.$eval('#rx-items [data-k="medicamento"]', (nodo) => nodo.value),
    'Ibuprofeno'
  );
  await recetaPage.screenshot({ path: `${capturas}\\36-repetir-receta.png` });
  console.log('✓ Repetir última receta');

  // 5. Fuentes locales y sin peticiones externas.
  assert.deepEqual(peticionesExternas, [], 'No debe haber peticiones a CDN externos');
  assert.match(
    await pagina.evaluate(() => getComputedStyle(document.body).fontFamily),
    /Poppins/
  );
  const fuente = await pagina.evaluate(async () => {
    const respuesta = await fetch('/fonts/poppins-400-latin.woff2');
    return {
      status: respuesta.status,
      tipo: respuesta.headers.get('content-type'),
      bytes: (await respuesta.arrayBuffer()).byteLength,
    };
  });
  assert.equal(fuente.status, 200);
  assert.match(fuente.tipo || '', /font\/woff2/);
  assert.ok(fuente.bytes > 1000);
  console.log('✓ Poppins local sin Google Fonts');

  console.log('');
  console.log('UX CREACIÓN RÁPIDA OK');
} finally {
  await recetaPage?.close().catch(() => {});
  await pagina?.close().catch(() => {});
  await navegador.close();
  await entorno.limpiar();
  rmSync(DATA_DIR, { recursive: true, force: true });
}
