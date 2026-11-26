import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de Agenda → Jornada → “Asignar turno”:
 * - la vista principal ya no ofrece el buscador libre de pacientes;
 * - el autocomplete del diálogo encuentra por nombres, apellidos y cédula;
 * - los términos se pueden escribir en cualquier orden y sin tildes;
 * - la selección y la asignación del cupo funcionan para admin y secretario/a.
 */

const FECHA = '2026-12-22'; // martes con horario L-V por defecto
const CAPTURAS = resolve(tmpdir(), 'isim-capturas');
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

async function iniciarSesion(pagina, username, password) {
  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#btn-ingresar');
  await pagina.type('#login-usuario', username);
  await pagina.type('#login-password', password);
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html');
  await pagina.waitForSelector('.top .nav', { timeout: 20000 });
}

async function abrirJornada(pagina) {
  await pagina.goto(`${entorno.base}/agenda.html?fecha=${FECHA}`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#btn-vista-jornada');
  await pagina.click('#btn-vista-jornada');
  await pagina.waitForFunction(
    () => document.querySelector('#vista-jornada')?.hidden === false
  );
}

async function abrirCupo(pagina, hora) {
  await pagina.waitForSelector(`#vista-jornada [data-jornada-hora="${hora}"]`);
  await pagina.evaluate((valor) => {
    document.querySelector(`#vista-jornada [data-jornada-hora="${valor}"]`)?.click();
  }, hora);
  await pagina.waitForFunction(() => document.querySelector('#dlg-cita')?.open === true);
  const titulo = await pagina.$eval('#titulo-cita', (nodo) => nodo.textContent.trim());
  assert.match(titulo, /Asignar turno/i, 'El cupo debe abrir el diálogo “Asignar turno”');
}

/** Escribe en el autocomplete, espera la respuesta real y devuelve el texto visible. */
async function buscarPaciente(pagina, texto) {
  const respuesta = pagina
    .waitForResponse(
      (res) => /\/api\/patients\?/.test(res.url()) && res.request().method() === 'GET',
      { timeout: 20000 }
    )
    .catch(() => null);
  await pagina.$eval('#cita-paciente-busqueda', (nodo) => {
    nodo.value = '';
    nodo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await pagina.type('#cita-paciente-busqueda', texto, { delay: 15 });
  await respuesta;
  await pagina.waitForFunction(
    () => {
      const nodo = document.querySelector('#resultados-pacientes-cita');
      return nodo && nodo.hidden === false && /GUAMÁN PILCO/i.test(nodo.innerText || '');
    },
    { timeout: 20000 }
  );
  return pagina.$eval('#resultados-pacientes-cita', (nodo) => nodo.innerText.trim());
}

async function seleccionarPaciente(pagina, cedula) {
  await pagina.waitForFunction(
    (valor) =>
      [...document.querySelectorAll('#resultados-pacientes-cita .search-result')].some((nodo) =>
        (nodo.innerText || '').includes(valor)
      ),
    { timeout: 20000 },
    cedula
  );
  const elegido = await pagina.evaluate((valor) => {
    const boton = [...document.querySelectorAll('#resultados-pacientes-cita .search-result')].find(
      (nodo) => (nodo.innerText || '').includes(valor)
    );
    if (!boton) return null;
    boton.click();
    return true;
  }, cedula);
  assert.ok(elegido, `Debe poder seleccionarse la paciente con cédula ${cedula}`);
  await pagina.waitForFunction(
    () => document.querySelector('#cita-paciente')?.value !== '',
    { timeout: 10000 }
  );
}

async function guardarCita(pagina) {
  await pagina.click('#btn-guardar-cita');
  await pagina.waitForFunction(
    () => document.querySelector('#dlg-cita')?.open === false,
    { timeout: 25000 }
  );
}

async function capturar(pagina, nombre, ancho, alto) {
  await pagina.setViewport({ width: ancho, height: alto, deviceScaleFactor: 1 });
  await new Promise((listo) => setTimeout(listo, 350));
  await pagina.screenshot({ path: join(CAPTURAS, nombre), fullPage: false });
}

async function main() {
  mkdirSync(CAPTURAS, { recursive: true });
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const ejecutable = encontrarNavegador();
  if (!ejecutable) {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
    return;
  }

  const sello = String(Date.now()).slice(-8);
  const paciente = {
    cedula: `CP${sello}`,
    apellidos: 'GUAMÁN PILCO',
    nombres: 'SUSANA MARÍA',
    fecha_nacimiento: '1991-04-12',
    sexo: 'F',
  };

  const adminApi = entorno.crearCliente();
  await entorno.iniciarSesion(adminApi, 'admin', '54321');
  const creada = await adminApi('/api/patients', { method: 'POST', body: paciente });
  assert.ok(creada.id, 'La paciente de prueba debe crearse');

  // Búsqueda por API: el mismo contrato que consume el autocomplete.
  for (const consulta of [
    'Su',
    'Susana Guaman',
    'Guaman Susana',
    'Guamán Susana',
    'guam',
    paciente.cedula.slice(-6),
  ]) {
    const encontrados = await adminApi(
      `/api/patients/search?q=${encodeURIComponent(consulta)}&limit=20`
    );
    assert.ok(
      encontrados.some((fila) => fila.id === creada.id),
      `La búsqueda “${consulta}” debe encontrar a la paciente`
    );
  }
  for (const comodin of ['%', '_']) {
    const encontrados = await adminApi(`/api/patients/search?q=${encodeURIComponent(comodin)}&limit=20`);
    assert.equal(
      encontrados.length,
      0,
      `El carácter “${comodin}” debe buscarse literalmente, no como comodín SQL`
    );
  }
  console.log('✓ API: términos en cualquier orden, tildes, cédula y comodines literales');

  navegador = await puppeteer.launch({
    executablePath: ejecutable,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });

  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 900 });
  await pagina.setCacheEnabled(false);
  pagina.setDefaultTimeout(30000);
  const errores = [];
  pagina.on('pageerror', (error) => errores.push(String(error)));

  await iniciarSesion(pagina, 'admin', '54321');
  await abrirJornada(pagina);

  // R1: la búsqueda libre de la vista principal ya no está.
  assert.equal(
    await pagina.$('#buscar'),
    null,
    'La vista principal de Agenda no debe mostrar el buscador #buscar'
  );
  assert.equal(
    await pagina.$('.agenda-toolbar .agenda-search'),
    null,
    'La barra de Agenda no debe incluir el buscador de pacientes'
  );
  assert.ok(
    await pagina.$('#btn-filtros'),
    'Los filtros de estado y médico deben seguir disponibles'
  );

  await abrirCupo(pagina, '09:30');
  await capturar(pagina, 'agenda-cupo-escritorio.png', 1440, 900);

  const porNombre = await buscarPaciente(pagina, 'Susana');
  assert.match(porNombre, /GUAMÁN PILCO/i, 'Buscar por nombre debe mostrar a la paciente');

  const porOrdenEtiqueta = await buscarPaciente(pagina, 'Guaman Susana');
  assert.match(
    porOrdenEtiqueta,
    /GUAMÁN PILCO/i,
    'Buscar “apellidos nombres” debe mostrar a la paciente'
  );

  const porOrdenNormal = await buscarPaciente(pagina, 'Susana Guaman');
  assert.match(
    porOrdenNormal,
    /GUAMÁN PILCO/i,
    'Buscar “nombres apellidos” debe mostrar a la paciente'
  );

  const conTildes = await buscarPaciente(pagina, 'Guamán Susana');
  assert.match(conTildes, /GUAMÁN PILCO/i, 'Buscar con tildes debe mostrar a la paciente');

  const sinTildes = await buscarPaciente(pagina, 'Guaman');
  assert.match(sinTildes, /GUAMÁN PILCO/i, 'Buscar sin tildes debe mostrar a la paciente');

  const incompleta = await buscarPaciente(pagina, 'Gua Sus');
  assert.match(incompleta, /GUAMÁN PILCO/i, 'Dos o más letras por término deben encontrar');

  await capturar(pagina, 'agenda-cupo-resultados-escritorio.png', 1440, 900);
  await seleccionarPaciente(pagina, paciente.cedula);
  const seleccion = await pagina.$eval('#cita-paciente', (nodo) => nodo.value);
  assert.equal(seleccion, creada.id, 'La selección debe guardar el ID de la paciente');
  await capturar(pagina, 'agenda-cupo-movil.png', 390, 844);
  await pagina.setViewport({ width: 1440, height: 900 });

  await guardarCita(pagina);
  await pagina.waitForFunction(
    (apellido) => (document.querySelector('#vista-jornada')?.innerText || '').includes(apellido),
    { timeout: 25000 },
    'GUAMÁN'
  );

  // La lista y el calendario siguen funcionando sin el buscador retirado.
  await pagina.click('#btn-vista-lista');
  await pagina.waitForFunction(() => document.querySelector('#lista')?.hidden === false);
  await pagina.waitForFunction(
    (apellido) => (document.querySelector('#lista')?.innerText || '').includes(apellido),
    { timeout: 20000 },
    'GUAMÁN'
  );
  await pagina.click('#btn-filtros');
  await pagina.select('#filtro-estado', 'programada');
  await pagina.waitForFunction(
    (apellido) => (document.querySelector('#lista')?.innerText || '').includes(apellido),
    { timeout: 20000 },
    'GUAMÁN'
  );
  await pagina.click('#btn-vista-calendario');
  await pagina.waitForFunction(() => document.querySelector('#vista-calendario')?.hidden === false);
  await pagina.waitForFunction(() =>
    Boolean(document.querySelector('#calendario-grid .calendario-dia'))
  );
  await capturar(pagina, 'agenda-sin-busqueda-escritorio.png', 1440, 900);
  await capturar(pagina, 'agenda-sin-busqueda-movil.png', 390, 844);
  await pagina.setViewport({ width: 1440, height: 900 });
  console.log('✓ Lista, filtros y calendario operativos sin búsqueda principal');
  assert.deepEqual(errores, [], 'La página no debe generar errores JavaScript');
  await pagina.close();

  // El nuevo inicio de sesión por API invalida la sesión anterior de admin;
  // se consulta después de terminar el flujo visual del administrador.
  const adminConsulta = entorno.crearCliente();
  await entorno.iniciarSesion(adminConsulta, 'admin', '54321');
  const citas = await adminConsulta(`/api/appointments?fecha=${FECHA}&limit=50`);
  const citaAdmin = citas.find((fila) => fila.patient_id === creada.id);
  assert.ok(citaAdmin, 'La cita asignada desde el cupo debe quedar registrada');
  assert.equal(citaAdmin.cupo, 1);
  assert.equal(citaAdmin.tipo, 'normal');
  assert.equal(citaAdmin.jornada, 'manana');
  console.log('✓ Cupo asignado desde Jornada con la paciente seleccionada');

  // Secretario/a: mismo flujo de cupo y autocomplete con sus permisos.
  const paginaRecepcion = await navegador.newPage();
  await paginaRecepcion.setViewport({ width: 1440, height: 900 });
  await paginaRecepcion.setCacheEnabled(false);
  paginaRecepcion.setDefaultTimeout(30000);
  await iniciarSesion(paginaRecepcion, 'recepcion', '1236');
  await abrirJornada(paginaRecepcion);
  await abrirCupo(paginaRecepcion, '10:00');
  const medicosRecepcion = await paginaRecepcion.$$eval('#cita-medico option', (nodos) =>
    nodos.map((nodo) => nodo.textContent.trim())
  );
  assert.deepEqual(
    medicosRecepcion,
    ['Sin médico asignado'],
    'Secretario/a agenda sin listado de médicos (no tiene documentos.ver)'
  );
  const resultadosRecepcion = await buscarPaciente(paginaRecepcion, 'Guaman Susana');
  assert.match(
    resultadosRecepcion,
    /GUAMÁN PILCO/i,
    'Secretario/a debe encontrar a la paciente con el mismo autocomplete'
  );
  await seleccionarPaciente(paginaRecepcion, paciente.cedula);
  await guardarCita(paginaRecepcion);

  const citasRecepcion = await adminConsulta(`/api/appointments?fecha=${FECHA}&limit=50`);
  assert.equal(
    citasRecepcion.filter((fila) => fila.patient_id === creada.id).length,
    2,
    'Secretario/a debe poder asignar el cupo sin el listado de médicos'
  );
  console.log('✓ Secretario/a busca, selecciona y asigna el cupo sin /api/medicos');

  assert.deepEqual(errores, [], 'La página no debe generar errores JavaScript');
  await paginaRecepcion.close();

  console.log('');
  console.log('E2E DE CUPOS DE JORNADA Y BÚSQUEDA DE PACIENTES COMPLETADO');
  console.log(
    JSON.stringify(
      {
        fecha: FECHA,
        paciente: paciente.cedula,
        busquedas: ['nombre', 'apellidos nombres', 'nombres apellidos', 'tildes', 'cédula'],
        busquedaPrincipalRetirada: true,
        admin: citaAdmin.id,
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
  console.error('E2E DE CUPOS DE JORNADA FALLÓ:', error.message);
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
