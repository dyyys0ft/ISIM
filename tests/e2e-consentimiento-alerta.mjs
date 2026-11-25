import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de evidencia LOPDP:
 * - la alerta se deriva de `consentimiento_evidencia_path`, no del timestamp;
 * - filtro/contador sinEvidencia en API y UI;
 * - alta de cita sin modal automático, aviso no modal y acciones;
 * - subida desde Pacientes y desde la ficha resuelve el pendiente;
 * - ficha: preview/print y carga de evidencia disponibles;
 * - si falla la cita después de crear la paciente, el reintento no duplica.
 */

const CAPTURAS = resolve(tmpdir(), 'isim-capturas');
const FECHA = '2026-12-28'; // lunes con horario por defecto
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
let entorno = null;
let navegador = null;
let fixtureDir = null;

function encontrarNavegador() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter(Boolean)
    .find((ruta) => existsSync(ruta));
}

async function iniciarSesion(pagina, username, password) {
  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#btn-ingresar');
  await pagina.type('#login-usuario', username);
  await pagina.type('#login-password', password);
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html');
  await pagina.waitForSelector('.top .nav', { timeout: 20000 });
}

async function esperarToast(pagina, texto) {
  await pagina.waitForFunction(
    (valor) => (document.querySelector('.toasts')?.innerText || '').includes(valor),
    { timeout: 20000 },
    texto
  );
}

async function crearPaciente(admin, datos) {
  const creada = await admin('/api/patients', { method: 'POST', body: datos });
  assert.ok(creada.id, `Debe crearse la paciente ${datos.cedula}`);
  return creada;
}

async function subirEvidenciaApi(admin, id, nombre) {
  await admin(`/api/patients/${encodeURIComponent(id)}/consentimiento-evidencia`, {
    method: 'POST',
    body: {
      nombre,
      data: `data:image/png;base64,${PNG_1X1}`,
    },
  });
}

async function main() {
  mkdirSync(CAPTURAS, { recursive: true });
  fixtureDir = mkdtempSync(join(tmpdir(), 'isim-alerta-lopdp-'));
  const fixture = join(fixtureDir, 'evidencia-firmada.png');
  writeFileSync(fixture, Buffer.from(PNG_1X1, 'base64'));

  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const sello = String(Date.now()).slice(-8);
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  const sinMarca = await crearPaciente(admin, {
    cedula: `SM${sello}`,
    nombres: 'SIN MARCA',
    apellidos: 'EVIDENCIA PENDIENTE',
    fecha_nacimiento: '1990-03-10',
    sexo: 'F',
  });
  const conMarca = await crearPaciente(admin, {
    cedula: `CM${sello}`,
    nombres: 'CON MARCA',
    apellidos: 'EVIDENCIA PENDIENTE',
    fecha_nacimiento: '1991-04-11',
    sexo: 'F',
    consentimiento_datos: '2026-01-15T10:00:00.000Z',
  });
  const conEvidencia = await crearPaciente(admin, {
    cedula: `CE${sello}`,
    nombres: 'CON EVIDENCIA',
    apellidos: 'EVIDENCIA RESUELTA',
    fecha_nacimiento: '1992-05-12',
    sexo: 'F',
    consentimiento_datos: '2026-01-16T10:00:00.000Z',
  });
  const evidenciaSinMarca = await crearPaciente(admin, {
    cedula: `ES${sello}`,
    nombres: 'EVIDENCIA SIN MARCA',
    apellidos: 'EVIDENCIA RESUELTA',
    fecha_nacimiento: '1993-06-13',
    sexo: 'F',
  });
  await subirEvidenciaApi(admin, conEvidencia.id, 'evidencia-con-marca.png');
  await subirEvidenciaApi(admin, evidenciaSinMarca.id, 'evidencia-sin-marca.png');

  const detalleSinMarca = await admin(`/api/patients/${encodeURIComponent(sinMarca.id)}`);
  assert.equal(detalleSinMarca.consentimientoEstado.estado, 'sin_marca');
  assert.equal(detalleSinMarca.consentimientoEstado.pendienteEvidencia, true);
  const detalleConMarca = await admin(`/api/patients/${encodeURIComponent(conMarca.id)}`);
  assert.equal(detalleConMarca.consentimientoEstado.estado, 'pendiente_evidencia');
  assert.equal(detalleConMarca.consentimientoEstado.marca, true);
  assert.equal(detalleConMarca.consentimientoEstado.pendienteEvidencia, true);
  const detalleConEvidencia = await admin(`/api/patients/${encodeURIComponent(conEvidencia.id)}`);
  assert.equal(detalleConEvidencia.consentimientoEstado.estado, 'con_evidencia');
  assert.equal(detalleConEvidencia.consentimientoEstado.pendienteEvidencia, false);
  const detalleEvidenciaSinMarca = await admin(
    `/api/patients/${encodeURIComponent(evidenciaSinMarca.id)}`
  );
  assert.equal(
    detalleEvidenciaSinMarca.consentimientoEstado.estado,
    'con_evidencia',
    'La evidencia resuelve el pendiente aunque no haya timestamp'
  );
  console.log('✓ Estado derivado: sin marca, con marca y con evidencia');

  const pendientes = await admin('/api/patients?sinEvidencia=1&limit=500');
  const idsPendientes = new Set(pendientes.map((fila) => fila.id));
  assert.ok(idsPendientes.has(sinMarca.id), 'Sin timestamp y sin evidencia debe listarse');
  assert.ok(idsPendientes.has(conMarca.id), 'Con timestamp y sin evidencia también debe listarse');
  assert.ok(!idsPendientes.has(conEvidencia.id), 'Con evidencia no debe listarse');
  assert.ok(!idsPendientes.has(evidenciaSinMarca.id), 'Evidencia sin timestamp no debe listarse');

  const paginado = await admin('/api/patients/paginated?sinEvidencia=1&limit=100');
  assert.ok(paginado.items.some((fila) => fila.id === sinMarca.id));
  assert.ok(paginado.items.some((fila) => fila.id === conMarca.id));
  assert.ok(!paginado.items.some((fila) => fila.id === conEvidencia.id));
  assert.ok(
    Number(paginado.sinEvidencia) >= 2,
    'El contador sinEvidencia debe incluir a las pacientes pendientes'
  );
  const todos = await admin('/api/patients/paginated?limit=1');
  assert.ok(Number(todos.sinEvidencia) >= 2, 'El contador global debe informar pendientes');

  const sinConsentimiento = await admin('/api/patients?sinConsentimiento=1&limit=500');
  const idsSinConsentimiento = new Set(sinConsentimiento.map((fila) => fila.id));
  assert.ok(idsSinConsentimiento.has(sinMarca.id), 'El filtro anterior debe conservarse');
  assert.ok(!idsSinConsentimiento.has(conMarca.id));
  console.log('✓ Filtros sinEvidencia y sinConsentimiento, contadores y compatibilidad');

  const ejecutable = encontrarNavegador();
  if (!ejecutable) {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
    return;
  }

  navegador = await puppeteer.launch({
    executablePath: ejecutable,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 900 });
  await pagina.setCacheEnabled(false);
  pagina.setDefaultTimeout(30000);

  await iniciarSesion(pagina, 'admin', '54321');
  // Cliente API con otro rol para consultar sin invalidar la sesión del navegador.
  const operador = entorno.crearCliente();
  await entorno.iniciarSesion(operador, 'recepcion', '1236');
  await pagina.goto(`${entorno.base}/pacientes.html`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#lista .patient-card');
  await pagina.waitForSelector('#alerta-sin-evidencia:not([hidden])', { timeout: 20000 });
  assert.match(
    await pagina.$eval('#alerta-sin-evidencia-texto', (nodo) => nodo.textContent),
    /evidencia LOPDP/i
  );
  assert.equal(
    await pagina.$eval('#alerta-sin-evidencia', (nodo) => nodo.getAttribute('role')),
    'status',
    'La alerta debe anunciarse como estado no modal'
  );
  await pagina.screenshot({
    path: join(CAPTURAS, 'consentimiento-alerta-escritorio.png'),
  });
  await pagina.setViewport({ width: 390, height: 844 });
  await pagina.evaluate(() => window.scrollTo(0, 0));
  await new Promise((listo) => setTimeout(listo, 250));
  await pagina.screenshot({
    path: join(CAPTURAS, 'consentimiento-alerta-movil.png'),
  });
  await pagina.setViewport({ width: 1440, height: 900 });

  await pagina.click('#btn-filtrar-sin-evidencia');
  await pagina.waitForFunction(
    () =>
      document
        .querySelector('#btn-filtrar-sin-evidencia')
        ?.getAttribute('aria-pressed') === 'true',
    { timeout: 20000 }
  );
  await pagina.waitForFunction(
    (id) => Boolean(document.querySelector(`[data-id="${id}"]`)),
    { timeout: 20000 },
    sinMarca.id
  );
  assert.ok(
    await pagina.$(`[data-id="${conMarca.id}"]`),
    'La paciente con timestamp pero sin evidencia debe aparecer en el filtro'
  );
  assert.equal(
    await pagina.$(`[data-id="${conEvidencia.id}"]`),
    null,
    'La paciente con evidencia no debe aparecer en pendientes'
  );
  assert.match(
    await pagina.$eval(`[data-id="${sinMarca.id}"] .patient-card__badges`, (nodo) => nodo.innerText),
    /evidencia LOPDP pendiente/i
  );
  assert.match(
    await pagina.$eval(`[data-id="${conMarca.id}"] .patient-card__badges`, (nodo) => nodo.innerText),
    /evidencia LOPDP pendiente/i
  );
  console.log('✓ Alerta y filtro de Pacientes derivados de la evidencia');

  // Subida directa desde el listado filtrado.
  const [selectorLista] = await Promise.all([
    pagina.waitForFileChooser({ timeout: 15000 }),
    pagina.click(`[data-id="${sinMarca.id}"] [data-action="evidencia"]`),
  ]);
  await selectorLista.accept([fixture]);
  await esperarToast(pagina, 'Evidencia firmada guardada');
  await pagina.waitForFunction(
    (id) => !document.querySelector(`[data-id="${id}"]`),
    { timeout: 25000 },
    sinMarca.id
  );
  const sinMarcaResuelta = await operador(`/api/patients/${encodeURIComponent(sinMarca.id)}`);
  assert.equal(sinMarcaResuelta.consentimientoEstado.pendienteEvidencia, false);
  console.log('✓ Subir evidencia desde Pacientes resuelve y retira la tarjeta pendiente');

  // Ficha de Datos: controles disponibles, preview/print y carga de evidencia.
  await pagina.goto(`${entorno.base}/paciente.html?id=${encodeURIComponent(conMarca.id)}&tab=datos`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#form-datos');
  await pagina.waitForFunction(
    () => document.querySelector('#tabs-ficha [data-tab="datos"]')?.classList.contains('on'),
    { timeout: 15000 }
  );
  await pagina.waitForSelector('#imprimir-consentimiento', { timeout: 15000 });
  await pagina.waitForSelector('#subir-evidencia', { timeout: 15000 });
  assert.match(
    await pagina.$eval('.evidencia-consentimiento', (nodo) => nodo.innerText),
    /sin evidencia/i,
    'La ficha debe mostrar que la evidencia sigue pendiente'
  );
  await pagina.screenshot({
    path: join(CAPTURAS, 'consentimiento-ficha-datos-escritorio.png'),
  });

  await pagina.click('#imprimir-consentimiento');
  await pagina.waitForSelector('#consentimiento-opcion', { timeout: 15000 });
  const opciones = await pagina.$$eval('#consentimiento-opcion option', (nodos) =>
    nodos.map((nodo) => nodo.textContent.trim())
  );
  assert.ok(opciones.some((texto) => /LOPDP/i.test(texto)));
  await pagina.click('.modal [data-cerrar-modal]');
  await pagina.waitForFunction(() => !document.querySelector('.modal'));

  const entradaFicha = await pagina.$('#archivo-evidencia');
  assert.ok(entradaFicha, 'La ficha debe permitir subir evidencia');
  await entradaFicha.uploadFile(fixture);
  await esperarToast(pagina, 'Evidencia firmada guardada');
  await pagina.waitForFunction(
    () => /evidencia cargada/i.test(document.querySelector('.evidencia-consentimiento')?.innerText || ''),
    { timeout: 20000 }
  );
  const conMarcaResuelta = await operador(`/api/patients/${encodeURIComponent(conMarca.id)}`);
  assert.equal(conMarcaResuelta.consentimientoEstado.pendienteEvidencia, false);
  console.log('✓ Ficha de Datos: preview/print y subida de evidencia');

  await pagina.goto(`${entorno.base}/consentimiento-datos.html?id=${encodeURIComponent(conMarca.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#consentimiento-doc .hoja-impresion__head', { timeout: 20000 });
  assert.match(
    await pagina.$eval('#consentimiento-doc', (nodo) => nodo.innerText),
    /CONSENTIMIENTO DE TRATAMIENTO DE DATOS/i
  );
  assert.ok(await pagina.$('#btn-imprimir'), 'La previsualización debe ofrecer imprimir');
  console.log('✓ Previsualización/imprimir del consentimiento desde la alerta');

  // Reintento: paciente creada y cita fallida no debe duplicar la paciente.
  await pagina.goto(`${entorno.base}/agenda.html?fecha=${FECHA}`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#btn-vista-jornada');
  await pagina.click('#btn-vista-jornada');
  await pagina.waitForSelector('#vista-jornada [data-jornada-hora="09:30"]');
  await pagina.evaluate(() => {
    document.querySelector('#vista-jornada [data-jornada-hora="09:30"]').click();
  });
  await pagina.waitForFunction(() => document.querySelector('#dlg-cita')?.open === true);
  await pagina.click('#btn-paciente-nueva');
  await pagina.waitForFunction(
    () => document.querySelector('#cita-nueva-paciente')?.hidden === false
  );

  const cedulaReintento = `RE${sello}`;
  await pagina.type('#np-cedula', cedulaReintento);
  await pagina.type('#np-apellidos', 'REINTENTO CITA');
  await pagina.type('#np-nombres', 'PACIENTE');
  await pagina.$eval('#np-nacimiento', (nodo) => {
    nodo.value = '1990-07-15';
    nodo.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pagina.click('#np-lopdp');
  await pagina.$eval('#cita-motivo', (nodo) => {
    nodo.value = 'Control';
    nodo.dispatchEvent(new Event('input', { bubbles: true }));
  });

  let abortarCita = true;
  await pagina.setRequestInterception(true);
  pagina.on('request', (peticion) => {
    const ruta = new URL(peticion.url()).pathname;
    if (
      abortarCita &&
      peticion.method() === 'POST' &&
      ruta === '/api/appointments'
    ) {
      abortarCita = false;
      peticion.abort();
      return;
    }
    peticion.continue();
  });

  await pagina.click('#btn-guardar-cita');
  await pagina.waitForFunction(
    () => Boolean(document.querySelector('.toasts .toast--error')),
    { timeout: 20000 }
  );
  assert.equal(
    await pagina.$eval('#dlg-cita', (nodo) => nodo.open),
    true,
    'La cita fallida no debe cerrar el diálogo'
  );
  const pacientesTrasFallo = await operador(
    `/api/patients?cedula=${encodeURIComponent(cedulaReintento)}&limit=5`
  );
  assert.equal(pacientesTrasFallo.length, 1, 'La paciente se creó una sola vez');

  await pagina.click('#btn-guardar-cita');
  await pagina.waitForFunction(
    () => document.querySelector('#dlg-cita')?.open === false,
    { timeout: 25000 }
  );
  const pacientesFinal = await operador(
    `/api/patients?cedula=${encodeURIComponent(cedulaReintento)}&limit=5`
  );
  assert.equal(pacientesFinal.length, 1, 'El reintento no debe duplicar la paciente');
  const citaFinal = await operador(`/api/appointments?fecha=${FECHA}&limit=50`);
  assert.equal(
    citaFinal.filter((cita) => cita.patient_id === pacientesFinal[0].id).length,
    1,
    'El reintento debe guardar una sola cita para la paciente'
  );
  await pagina.waitForSelector('#aviso-lopdp-agenda:not([hidden])', { timeout: 25000 });
  assert.match(
    await pagina.$eval('#aviso-lopdp-texto', (nodo) => nodo.textContent),
    /REINTENTO CITA/i,
    'El aviso no modal debe identificar a la paciente de la cita'
  );
  await pagina
    .waitForFunction(() => !document.querySelector('.toasts .toast--error'), { timeout: 12000 })
    .catch(() => {});
  await pagina
    .waitForFunction(() => !document.querySelector('.toasts .toast'), { timeout: 6000 })
    .catch(() => {});
  await pagina.screenshot({
    path: join(CAPTURAS, 'agenda-aviso-lopdp-escritorio.png'),
  });
  await pagina.setViewport({ width: 390, height: 844 });
  await pagina.evaluate(() => window.scrollTo(0, 0));
  await new Promise((listo) => setTimeout(listo, 250));
  await pagina.screenshot({
    path: join(CAPTURAS, 'agenda-aviso-lopdp-movil.png'),
  });
  await pagina.setViewport({ width: 1440, height: 900 });
  await pagina.click('#aviso-lopdp-cerrar');
  await pagina.waitForFunction(
    () => document.querySelector('#aviso-lopdp-agenda')?.hidden === true
  );
  console.log('✓ Cita fallida + reintento reutiliza la paciente sin duplicar');

  await pagina.close();
  console.log('');
  console.log('E2E DE ALERTA DE CONSENTIMIENTO COMPLETADO');
  console.log(
    JSON.stringify(
      {
        estados: ['sin_marca', 'pendiente_evidencia', 'con_evidencia'],
        filtroSinEvidencia: true,
        filtroSinConsentimiento: true,
        subidaDesdeListado: true,
        fichaPreviewPrintUpload: true,
        reintentoSinDuplicado: true,
        capturas: CAPTURAS,
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
  console.error('E2E DE ALERTA DE CONSENTIMIENTO FALLÓ:', error.message);
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
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
}
