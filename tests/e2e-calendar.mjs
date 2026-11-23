import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de calendario con carga masiva.
 *
 * Crea 100 citas por día durante 5 días, verifica la API del calendario y
 * abre la agenda en un navegador real para comprobar que cada celda muestra
 * solo una vista previa corta (+N más) sin expandirse ni saturar la cuadrícula.
 */

const DIAS = 5;
const CITAS_POR_DIA = 100;
const VISTA_PREVIA = 3;

function encontrarNavegador() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  return candidatos.find((ruta) => existsSync(ruta)) || null;
}

async function ejecutar(tareas, limite = 20) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;

  async function trabajador() {
    for (;;) {
      const indice = siguiente;
      siguiente += 1;
      if (indice >= tareas.length) return;
      try {
        resultados[indice] = { ok: true, valor: await tareas[indice]() };
      } catch (error) {
        resultados[indice] = { ok: false, error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limite, tareas.length)) }, () => trabajador())
  );

  const fallos = resultados.filter((item) => !item.ok);
  if (fallos.length) {
    throw new Error(
      `${fallos.length}/${resultados.length} operaciones fallaron: ${fallos
        .slice(0, 5)
        .map((item) => item.error.message)
        .join(' | ')}`
    );
  }
  return resultados.map((item) => item.valor);
}

const ahora = new Date();
const anio = ahora.getFullYear();
const mes = ahora.getMonth();
const dias = Array.from({ length: DIAS }, (_, i) => i + 1);
const fechas = dias.map((dia) => `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`);
const fechaInicio = fechas[0];
const desde = new Date(Date.UTC(anio, mes, 1, 0, 0, 0)).toISOString();
const hasta = new Date(Date.UTC(anio, mes, DIAS, 23, 59, 59, 999)).toISOString();

let entorno = null;
let navegador = null;

try {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);
  console.log(`Días: ${fechas.join(', ')} · ${CITAS_POR_DIA} citas por día`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  const pacientes = await ejecutar(
    Array.from({ length: 10 }, (_, i) => () =>
      admin('/api/patients', {
        method: 'POST',
        body: {
          cedula: `CAL${String(i).padStart(3, '0')}${String(Date.now()).slice(-6)}`,
          nombres: `Paciente calendario ${i + 1}`,
          apellidos: 'PRUEBA MASIVA',
          fecha_nacimiento: '1990-01-15',
          sexo: 'F',
          telefono: `0999${String(i).padStart(6, '0')}`.slice(0, 10),
        },
      })
    ),
    5
  );
  console.log(`✓ ${pacientes.length} pacientes creadas`);

  const tareasCitas = [];
  for (const dia of dias) {
    for (let i = 0; i < CITAS_POR_DIA; i += 1) {
      const fechaHora = new Date(Date.UTC(anio, mes, dia, 12, 0, 0, 0)).toISOString();
      tareasCitas.push(() =>
        admin('/api/appointments', {
          method: 'POST',
          body: {
            patientId: pacientes[i % pacientes.length].id,
            fechaHora,
            duracionMin: 30,
            motivo: `Calendario ${dia}-${i + 1}`,
            estado: 'programada',
          },
        })
      );
    }
  }

  const citas = await ejecutar(tareasCitas, 20);
  assert.equal(citas.length, DIAS * CITAS_POR_DIA, 'Deben crearse 500 citas');
  console.log(`✓ ${citas.length} citas creadas`);

  // API del calendario: totales por día y vista previa limitada.
  const calendario = await admin(
    `/api/appointments/calendar?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(
      hasta
    )}&porDia=${VISTA_PREVIA}&tzOffset=0`
  );

  assert.equal(calendario.total, DIAS * CITAS_POR_DIA);
  assert.equal(calendario.porDia, VISTA_PREVIA);
  assert.equal(calendario.dias.length, DIAS, 'Debe haber un grupo por día');
  assert.equal(calendario.resumen.total, DIAS * CITAS_POR_DIA);
  assert.equal(calendario.resumen.pendientes, DIAS * CITAS_POR_DIA);

  for (const dia of calendario.dias) {
    assert.equal(dia.total, CITAS_POR_DIA, `El día ${dia.fecha} debe tener 100 citas`);
    assert.equal(
      dia.citas.length,
      VISTA_PREVIA,
      `El día ${dia.fecha} solo debe enviar ${VISTA_PREVIA} citas de vista previa`
    );
    assert.ok(dia.citas.every((cita) => cita.id && cita.fecha_hora && cita.nombres));
  }
  console.log(
    `✓ API calendario: ${calendario.dias.length} días × ${CITAS_POR_DIA}, vista previa de ${VISTA_PREVIA}`
  );

  // Validación visual en navegador real.
  const ejecutable = encontrarNavegador();
  if (!ejecutable) {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
    console.log('E2E DE CALENDARIO (API) COMPLETADO');
  }

  if (ejecutable) {
    navegador = await puppeteer.launch({
    executablePath: ejecutable,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1000'],
  });

  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 1000 });
  pagina.setDefaultTimeout(25000);

  const erroresPagina = [];
  const erroresConsola = [];
  pagina.on('pageerror', (error) => erroresPagina.push(error.message));
  pagina.on('console', (mensaje) => {
    if (mensaje.type() !== 'error') return;
    const texto = mensaje.text();
    // La pantalla de acceso comprueba la sesión (401) y el logo puede faltar (404).
    if (/favicon|401|404/i.test(texto)) return;
    erroresConsola.push(texto);
  });

  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.type('#login-usuario', 'admin');
  await pagina.type('#login-password', '54321');
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html', {
    timeout: 20000,
  });

  await pagina.goto(`${entorno.base}/agenda.html?fecha=${fechaInicio}`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#btn-vista-calendario');
  await pagina.waitForFunction(
    () => /cita/.test(document.querySelector('#contador')?.textContent || ''),
    { timeout: 20000 }
  );
  await pagina.click('#btn-vista-calendario');

  await pagina.waitForFunction(
    (cantidad) =>
      document.querySelectorAll('.calendario-dia[data-total="100"]').length >= cantidad,
    { timeout: 25000 },
    DIAS
  );

  const celdas = await pagina.evaluate(() =>
    [...document.querySelectorAll('.calendario-dia[data-total="100"]')].map((celda) => {
      const rect = celda.getBoundingClientRect();
      const citasVisibles = celda.querySelectorAll('.calendario-cita').length;
      const mas = celda.querySelector('.calendario-ver-mas')?.textContent?.trim() || '';
      return {
        fecha: celda.dataset.diaCalendario,
        total: Number(celda.dataset.total),
        citasVisibles,
        mas,
        alto: Math.round(rect.height),
        ancho: Math.round(rect.width),
        scrollHeight: celda.scrollHeight,
      };
    })
  );

  assert.equal(celdas.length, DIAS, 'El calendario debe mostrar los 5 días con 100 citas');
  for (const celda of celdas) {
    assert.equal(celda.total, CITAS_POR_DIA, `${celda.fecha} debe tener 100 citas`);
    assert.equal(
      celda.citasVisibles,
      VISTA_PREVIA,
      `${celda.fecha} solo debe renderizar ${VISTA_PREVIA} citas`
    );
    assert.equal(celda.mas, `+${CITAS_POR_DIA - VISTA_PREVIA} más`, 'Debe indicar cuántas faltan');
    assert.ok(celda.alto <= 230, `${celda.fecha} no debe crecer demasiado (${celda.alto}px)`);
    assert.ok(celda.ancho > 0, 'La celda debe tener ancho visible');
  }

  const vista = await pagina.evaluate(() => ({
    contador: document.querySelector('#contador')?.textContent?.trim(),
    overflowHorizontal:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    totalCitasDom: document.querySelectorAll('.calendario-cita').length,
    totalCeldas: document.querySelectorAll('.calendario-dia').length,
  }));

  assert.equal(vista.contador, '500 citas', 'El contador debe mostrar el total del mes');
  assert.ok(
    vista.overflowHorizontal <= 2,
    `La vista no debe desbordarse horizontalmente (${vista.overflowHorizontal}px)`
  );
  assert.ok(
    vista.totalCitasDom <= DIAS * VISTA_PREVIA,
    `El DOM no debe renderizar más de ${DIAS * VISTA_PREVIA} citas de vista previa`
  );

  // El botón +N más abre el día completo en la vista de lista.
  await pagina.click('.calendario-dia[data-total="100"] .calendario-ver-mas');
  await pagina.waitForFunction(
    (cantidad) =>
      !document.querySelector('#lista')?.hidden &&
      document.querySelectorAll('.agenda-item').length === cantidad,
    { timeout: 20000 },
    CITAS_POR_DIA
  );

  const lista = await pagina.evaluate(() => ({
    items: document.querySelectorAll('.agenda-item').length,
    contador: document.querySelector('#contador')?.textContent?.trim(),
  }));
  assert.equal(lista.items, CITAS_POR_DIA, 'La lista del día debe mostrar las 100 citas');
  assert.equal(lista.contador, '100 citas');

  assert.deepEqual(erroresPagina, [], `Errores de página: ${erroresPagina.join(' | ')}`);
  assert.deepEqual(
    erroresConsola,
    [],
    `Errores inesperados de consola: ${erroresConsola.join(' | ')}`
  );

  console.log('✓ Navegador: cada día muestra 3 citas y “+97 más”');
  console.log(`✓ Altura de celda: ${celdas.map((c) => `${c.alto}px`).join(', ')}`);
  console.log('✓ Sin desbordamiento horizontal ni saturación del DOM');
  console.log('✓ “+97 más” abre las 100 citas del día en la lista');

  console.log('');
  console.log('E2E DE CALENDARIO COMPLETADO');
  console.log(
    JSON.stringify(
      {
        dias: DIAS,
        citasPorDia: CITAS_POR_DIA,
        total: DIAS * CITAS_POR_DIA,
        vistaPrevia: VISTA_PREVIA,
        alturaCeldas: celdas.map((c) => c.alto),
        contadorCalendario: vista.contador,
      },
      null,
      2
    )
  );
  }
} catch (error) {
  console.error('');
  console.error('E2E DE CALENDARIO FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('');
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-40).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await navegador?.close().catch(() => {});
  await entorno?.limpiar();
}
