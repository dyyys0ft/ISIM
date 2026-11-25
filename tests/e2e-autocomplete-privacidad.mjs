import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de privacidad del autocomplete y respuestas fuera de orden:
 * - `/api/patients/search` devuelve solo el DTO mínimo de selección;
 * - el detalle autorizado sigue disponible al seleccionar;
 * - una respuesta antigua no reemplaza resultados nuevos;
 * - al borrar/acortar/cerrar se limpian los resultados pendientes;
 * - el flujo de paciente menor sigue mostrando su aviso.
 */

const FECHA = '2026-12-29'; // martes con horario por defecto
let entorno = null;
let navegador = null;

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

async function iniciarSesion(pagina) {
  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#btn-ingresar');
  await pagina.type('#login-usuario', 'admin');
  await pagina.type('#login-password', '54321');
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html');
  await pagina.waitForSelector('.top .nav', { timeout: 20000 });
}

async function abrirCupo(pagina, hora = '09:30') {
  await pagina.goto(`${entorno.base}/agenda.html?fecha=${FECHA}`, {
    waitUntil: 'domcontentloaded',
  });
  await pagina.waitForSelector('#btn-vista-jornada');
  await pagina.click('#btn-vista-jornada');
  await pagina.waitForSelector(`#vista-jornada [data-jornada-hora="${hora}"]`);
  await pagina.evaluate((valor) => {
    document.querySelector(`#vista-jornada [data-jornada-hora="${valor}"]`)?.click();
  }, hora);
  await pagina.waitForFunction(() => document.querySelector('#dlg-cita')?.open === true);
}

async function escribirBusqueda(pagina, texto) {
  await pagina.$eval(
    '#cita-paciente-busqueda',
    (nodo, valor) => {
      nodo.value = valor;
      nodo.dispatchEvent(new Event('input', { bubbles: true }));
    },
    texto
  );
}

async function esperar(ms) {
  await new Promise((listo) => setTimeout(listo, ms));
}

async function main() {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const sello = String(Date.now()).slice(-8);
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  const adulto = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `AP${sello}`,
      nombres: 'PRIVACIDAD ADULTA',
      apellidos: `AUTOPRIV ${sello}`,
      fecha_nacimiento: '1990-01-10',
      sexo: 'F',
      telefono: '0991234567',
      email: `privada-${sello}@isim.local`,
      direccion: 'Dirección sensible 123',
      alergias: 'Penicilina',
      ant_personales: 'Antecedente sensible',
      medicacion_habitual: 'Medicación sensible',
      notas: 'Nota clínica sensible',
      representante1_nombre: 'Representante Adulto',
      representante1_cedula: '0911111111',
    },
  });
  assert.ok(adulto.id);

  const menor = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `MN${sello}`,
      nombres: 'MENOR AUTOCOMPLETE',
      apellidos: `AUTOMENOR ${sello}`,
      fecha_nacimiento: '2014-05-15',
      sexo: 'F',
      representante1_nombre: 'Madre del menor',
      representante1_cedula: '0922222222',
      representante1_parentesco: 'Madre',
    },
  });
  assert.ok(menor.id);

  const busqueda = await admin(
    `/api/patients/search?q=${encodeURIComponent(`AUTOPRIV ${sello}`)}&limit=20`
  );
  assert.equal(busqueda.length, 1, 'La búsqueda debe encontrar a la paciente adulta');
  const resumen = busqueda[0];
  assert.deepEqual(
    Object.keys(resumen).sort(),
    ['apellidos', 'cedula', 'es_menor', 'fecha_nacimiento', 'id', 'nombres'],
    'El DTO de búsqueda debe tener solo la lista blanca mínima'
  );
  for (const campo of [
    'telefono',
    'email',
    'direccion',
    'alergias',
    'ant_personales',
    'medicacion_habitual',
    'notas',
    'representante1_nombre',
    'representante1_cedula',
    'consentimiento_datos',
    'consentimientoEvidencia',
    'consentimientoEstado',
  ]) {
    assert.ok(!(campo in resumen), `La búsqueda no debe devolver ${campo}`);
  }
  const serializado = JSON.stringify(resumen);
  for (const valor of [
    '0991234567',
    `privada-${sello}@isim.local`,
    'Dirección sensible 123',
    'Penicilina',
    'Antecedente sensible',
    'Medicación sensible',
    'Nota clínica sensible',
    'Representante Adulto',
  ]) {
    assert.ok(
      !serializado.includes(valor),
      `La respuesta de búsqueda no debe contener “${valor}”`
    );
  }

  const busquedaMenor = await admin(
    `/api/patients/search?q=${encodeURIComponent(`AUTOMENOR ${sello}`)}&limit=20`
  );
  assert.equal(busquedaMenor.length, 1);
  assert.equal(busquedaMenor[0].es_menor, true);
  assert.ok(!('representante1_nombre' in busquedaMenor[0]));

  const detalle = await admin(`/api/patients/${encodeURIComponent(adulto.id)}`);
  assert.equal(detalle.telefono, '0991234567', 'El detalle autorizado conserva los datos');
  assert.equal(detalle.alergias, 'Penicilina');
  assert.ok(detalle.representantes.length >= 1);
  console.log('✓ DTO mínimo de búsqueda y detalle autorizado intacto');

  const ejecutable = encontrarNavegador();
  if (!ejecutable) {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación de respuestas.');
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

  await iniciarSesion(pagina);
  await abrirCupo(pagina);

  const peticionesBusqueda = [];
  let retenerPrimera = true;
  let retenerCorta = false;
  let retenerCierre = false;
  let primeraRetenida = null;
  let cortaRetenida = null;
  let cierreRetenido = null;

  await pagina.setRequestInterception(true);
  pagina.on('request', (peticion) => {
    const url = peticion.url();
    if (url.includes('/api/patients/search')) {
      peticionesBusqueda.push(url);
      if (retenerPrimera && url.includes('AUTOPRIV')) {
        retenerPrimera = false;
        primeraRetenida = peticion;
        return;
      }
      if (retenerCorta && url.includes('AUTOPRIV')) {
        retenerCorta = false;
        cortaRetenida = peticion;
        return;
      }
      if (retenerCierre && url.includes('AUTOMENOR')) {
        retenerCierre = false;
        cierreRetenido = peticion;
        return;
      }
    }
    peticion.continue();
  });

  // 1. Respuesta fuera de orden: la consulta vieja se libera después de la nueva.
  const esperaPrimera = pagina.waitForRequest(
    (peticion) => peticion.url().includes('/api/patients/search') && peticion.url().includes('AUTOPRIV'),
    { timeout: 15000 }
  );
  await escribirBusqueda(pagina, `AUTOPRIV ${sello}`);
  const peticionVieja = await esperaPrimera;
  assert.ok(peticionVieja.url().includes('/api/patients/search'));

  await escribirBusqueda(pagina, `AUTOMENOR ${sello}`);
  await pagina.waitForFunction(
    (texto) =>
      (document.querySelector('#resultados-pacientes-cita')?.innerText || '').includes(texto),
    { timeout: 20000 },
    'MENOR AUTOCOMPLETE'
  );
  await peticionVieja.continue();
  await esperar(800);
  const textoFinal = await pagina.$eval(
    '#resultados-pacientes-cita',
    (nodo) => nodo.innerText
  );
  assert.match(textoFinal, /MENOR AUTOCOMPLETE/i);
  assert.ok(
    !/PRIVACIDAD ADULTA/i.test(textoFinal),
    'La respuesta antigua no debe reemplazar los resultados actuales'
  );
  console.log('✓ Respuesta fuera de orden descartada');

  // 2. Borrar/acortar la consulta invalida la petición pendiente y limpia.
  retenerCorta = true;
  const esperaCorta = pagina.waitForRequest(
    (peticion) => peticion.url().includes('/api/patients/search') && peticion.url().includes('AUTOPRIV'),
    { timeout: 15000 }
  );
  await escribirBusqueda(pagina, `AUTOPRIV ${sello}`);
  const peticionCorta = await esperaCorta;
  await escribirBusqueda(pagina, 'A');
  await pagina.waitForFunction(
    () => {
      const nodo = document.querySelector('#resultados-pacientes-cita');
      return nodo?.hidden === true && (nodo.innerText || '').trim() === '';
    },
    { timeout: 10000 }
  );
  await peticionCorta.continue();
  await esperar(800);
  assert.equal(
    await pagina.$eval('#resultados-pacientes-cita', (nodo) => nodo.hidden),
    true,
    'Con menos de 2 letras los resultados deben permanecer ocultos'
  );
  assert.equal(
    await pagina.$eval('#resultados-pacientes-cita', (nodo) => (nodo.innerText || '').trim()),
    '',
    'La lista de resultados debe quedar vacía al acortar la consulta'
  );
  console.log('✓ Consulta corta/limpiada invalida y limpia resultados');

  // 3. Cerrar el diálogo también invalida una respuesta pendiente.
  retenerCierre = true;
  const esperaCierre = pagina.waitForRequest(
    (peticion) => peticion.url().includes('/api/patients/search') && peticion.url().includes('AUTOMENOR'),
    { timeout: 15000 }
  );
  await escribirBusqueda(pagina, `AUTOMENOR ${sello}`);
  const peticionCierre = await esperaCierre;
  await pagina.click('#dlg-cita [data-cerrar]');
  await pagina.waitForFunction(() => document.querySelector('#dlg-cita')?.open === false);
  await peticionCierre.continue();
  await esperar(800);
  assert.equal(
    await pagina.$eval('#resultados-pacientes-cita', (nodo) => (nodo.innerText || '').trim()),
    '',
    'Al cerrar el diálogo no debe reaparecer una respuesta pendiente'
  );
  console.log('✓ Cerrar el diálogo invalida la búsqueda pendiente');

  // 4. El menor sigue disponible para el flujo de cita.
  await abrirCupo(pagina, '10:00');
  await escribirBusqueda(pagina, `AUTOMENOR ${sello}`);
  await pagina.waitForFunction(
    (texto) =>
      (document.querySelector('#resultados-pacientes-cita')?.innerText || '').includes(texto),
    { timeout: 20000 },
    'MENOR AUTOCOMPLETE'
  );
  assert.match(
    await pagina.$eval('#resultados-pacientes-cita', (nodo) => nodo.innerText),
    /menor de edad/i
  );
  await pagina.evaluate(() => {
    document
      .querySelector('#resultados-pacientes-cita .search-result')
      ?.click();
  });
  await pagina.waitForFunction(
    (id) => document.querySelector('#cita-paciente')?.value === id,
    { timeout: 10000 },
    menor.id
  );
  await pagina.waitForFunction(
    () => document.querySelector('#cita-menor-aviso')?.hidden === false,
    { timeout: 15000 }
  );
  console.log('✓ Selección de menor y aviso de representante operativos');

  assert.ok(
    peticionesBusqueda.length >= 3 &&
      peticionesBusqueda.every((url) => url.includes('/api/patients/search')),
    'El autocomplete debe usar exclusivamente el endpoint de búsqueda mínimo'
  );

  await pagina.close();
  console.log('');
  console.log('E2E DE AUTOCOMPLETE Y PRIVACIDAD COMPLETADO');
  console.log(
    JSON.stringify(
      {
        dto: ['id', 'nombres', 'apellidos', 'cedula', 'fecha_nacimiento', 'es_menor'],
        sinDatosSensibles: true,
        respuestasFueraDeOrden: true,
        consultaCorta: true,
        cierreDialogo: true,
        menorOperativo: true,
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
  console.error('E2E DE AUTOCOMPLETE Y PRIVACIDAD FALLÓ:', error.message);
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
