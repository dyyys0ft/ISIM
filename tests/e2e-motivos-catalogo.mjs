import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E del catálogo de motivos de consulta:
 * - permiso agenda.motivos solo para admin, secretario/a y enfermero;
 * - CRUD por API con validaciones, duplicados y baja lógica;
 * - acceso rápido en Agenda (sin pasar por Ajustes);
 * - “Otro…” con alta opcional en el catálogo;
 * - las citas conservan el texto histórico al desactivar un motivo.
 */

const CAPTURAS = resolve(tmpdir(), 'isim-capturas');
const FECHA = '2026-12-23'; // miércoles con horario por defecto
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

async function sesion(cliente, username, password) {
  const respuesta = await cliente('/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(respuesta.status, 200, `Debe iniciar sesión ${username}`);
  return respuesta.datos;
}

async function main() {
  mkdirSync(CAPTURAS, { recursive: true });
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente({ crudo: true });
  await sesion(admin, 'admin', '54321');

  const sello = String(Date.now()).slice(-8);
  const usuarioEnfermero = `enfermero.${sello}`;
  const claveEnfermero = `Clave${sello}9`;
  const creadoEnfermero = await admin('/api/users', {
    method: 'POST',
    body: {
      nombre: 'Enfermero de prueba motivos',
      cedula: `EN${sello}`,
      username: usuarioEnfermero,
      password: claveEnfermero,
      rol: 'enfermero',
    },
  });
  assert.equal(creadoEnfermero.status, 201, 'El usuario enfermero debe crearse');

  const recepcion = entorno.crearCliente({ crudo: true });
  const medico = entorno.crearCliente({ crudo: true });
  const lectura = entorno.crearCliente({ crudo: true });
  const enfermero = entorno.crearCliente({ crudo: true });
  const sesionRecepcion = await sesion(recepcion, 'recepcion', '1236');
  const sesionMedico = await sesion(medico, 'veronica', '1235');
  const sesionLectura = await sesion(lectura, 'lector1', '1111');
  const sesionEnfermero = await sesion(enfermero, usuarioEnfermero, claveEnfermero);

  for (const [rol, datos] of [
    ['operador', sesionRecepcion],
    ['enfermero', sesionEnfermero],
  ]) {
    assert.ok(
      datos.permisos.includes('agenda.motivos'),
      `El rol ${rol} debe recibir agenda.motivos por defecto`
    );
  }
  for (const [rol, datos] of [
    ['medico', sesionMedico],
    ['lectura', sesionLectura],
  ]) {
    assert.ok(
      !datos.permisos.includes('agenda.motivos'),
      `El rol ${rol} no debe recibir agenda.motivos`
    );
  }
  const permisosAdmin = await admin('/api/auth/me');
  assert.ok(permisosAdmin.datos.permisos.includes('agenda.motivos'));
  console.log('✓ Permiso por defecto: admin, operador y enfermero; no médico ni lectura');

  const nuevo = await admin('/api/motivos', {
    method: 'POST',
    body: { grupo: 'Pruebas E2E', motivo: 'Motivo Ñandú' },
  });
  assert.equal(nuevo.status, 201, 'El administrador debe crear motivos');
  assert.ok(nuevo.datos.id);
  const idMotivo = nuevo.datos.id;

  const duplicado = await admin('/api/motivos', {
    method: 'POST',
    body: { grupo: 'pruebas e2e', motivo: 'MOTIVO NANDU' },
  });
  assert.equal(duplicado.status, 409, 'El duplicado sin tildes ni mayúsculas debe rechazarse');

  const otroGrupo = await admin('/api/motivos', {
    method: 'POST',
    body: { grupo: 'Pruebas E2E bis', motivo: 'Motivo Ñandú' },
  });
  assert.equal(otroGrupo.status, 201, 'El mismo texto en otro grupo debe permitirse');

  assert.equal(
    (await admin('/api/motivos', { method: 'POST', body: { grupo: 'X', motivo: '   ' } })).status,
    400,
    'El motivo vacío debe rechazarse'
  );
  assert.equal(
    (
      await admin('/api/motivos', {
        method: 'POST',
        body: { grupo: 'X', motivo: 'x'.repeat(121) },
      })
    ).status,
    400,
    'El motivo demasiado largo debe rechazarse'
  );
  assert.equal(
    (
      await admin('/api/motivos', {
        method: 'POST',
        body: { grupo: 'X', motivo: 'Orden inválido', orden: 0 },
      })
    ).status,
    400,
    'El orden fuera de rango debe rechazarse'
  );
  console.log('✓ Validaciones de texto, orden y duplicados por grupo');

  for (const [rol, cliente] of [
    ['médico', medico],
    ['lectura', lectura],
  ]) {
    assert.equal(
      (await cliente('/api/motivos/admin')).status,
      403,
      `${rol} no debe leer la administración de motivos`
    );
    assert.equal(
      (
        await cliente('/api/motivos', {
          method: 'POST',
          body: { grupo: 'X', motivo: `Sin permiso ${rol}` },
        })
      ).status,
      403,
      `${rol} no debe crear motivos`
    );
    assert.equal(
      (await cliente(`/api/motivos/${encodeURIComponent(idMotivo)}`, { method: 'PATCH', body: { orden: 3 } }))
        .status,
      403,
      `${rol} no debe editar motivos`
    );
    assert.equal(
      (await cliente(`/api/motivos/${encodeURIComponent(idMotivo)}`, { method: 'DELETE' })).status,
      403,
      `${rol} no debe desactivar motivos`
    );
  }
  console.log('✓ Médico y lectura reciben 403 en lectura administrativa y CRUD');

  const edicion = await recepcion(`/api/motivos/${encodeURIComponent(idMotivo)}`, {
    method: 'PATCH',
    body: { motivo: 'Motivo Ñandú editado', orden: 4 },
  });
  assert.equal(edicion.status, 200, 'Secretario/a debe editar motivos');
  const listadoRecepcion = await recepcion('/api/motivos/admin');
  assert.equal(listadoRecepcion.status, 200, 'Secretario/a debe leer la administración');
  assert.ok(
    listadoRecepcion.datos.some(
      (fila) => fila.id === idMotivo && fila.motivo === 'Motivo Ñandú editado'
    )
  );

  const creadoEnfermeroMotivo = await enfermero('/api/motivos', {
    method: 'POST',
    body: { grupo: 'Pruebas E2E', motivo: `Motivo enfermero ${sello}` },
  });
  assert.equal(creadoEnfermeroMotivo.status, 201, 'Enfermero debe crear motivos');
  assert.equal(
    (
      await enfermero(`/api/motivos/${encodeURIComponent(creadoEnfermeroMotivo.datos.id)}`, {
        method: 'DELETE',
      })
    ).status,
    200,
    'Enfermero debe desactivar motivos'
  );
  console.log('✓ Secretario/a y enfermero operan el CRUD; administrador conserva acceso');

  const baja = await admin(`/api/motivos/${encodeURIComponent(idMotivo)}`, { method: 'DELETE' });
  assert.equal(baja.status, 200, 'La baja lógica debe responder 200');
  const activos = await admin('/api/motivos');
  assert.ok(
    !activos.datos.some((grupo) => grupo.motivos.some((item) => item.id === idMotivo)),
    'El motivo desactivado ya no se ofrece en la agenda'
  );
  const administrativo = await admin('/api/motivos/admin');
  const inactivo = administrativo.datos.find((fila) => fila.id === idMotivo);
  assert.equal(inactivo?.activo, 0, 'La baja es lógica y conserva la fila');

  const reactivado = await admin(`/api/motivos/${encodeURIComponent(idMotivo)}`, {
    method: 'PATCH',
    body: { activo: 1 },
  });
  assert.equal(reactivado.status, 200, 'Administración debe poder reactivar');
  await admin(`/api/motivos/${encodeURIComponent(idMotivo)}`, { method: 'DELETE' });
  console.log('✓ Baja lógica con reactivación y sin borrado físico');

  // Una cita mantiene su texto aunque el motivo se desactive.
  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `MT${sello}`,
      nombres: 'PACIENTE MOTIVOS',
      apellidos: 'PRUEBA CATALOGO',
      fecha_nacimiento: '1990-02-20',
      sexo: 'F',
    },
  });
  assert.equal(paciente.status, 201);
  const cita = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.datos.id,
      fechaHora: `${FECHA}T11:00:00-05:00`,
      duracionMin: 30,
      motivo: 'Motivo Ñandú editado',
      motivoGrupo: 'Pruebas E2E',
      estado: 'programada',
    },
  });
  assert.equal(cita.status, 201);
  const citaDetalle = await admin(`/api/appointments/${encodeURIComponent(cita.datos.id)}`);
  assert.equal(citaDetalle.datos.motivo, 'Motivo Ñandú editado');
  console.log('✓ Las citas conservan el texto histórico del motivo desactivado');

  const db = new DatabaseSync(entorno.dbFile, { readOnly: true });
  try {
    const eventos = db
      .prepare(
        `SELECT accion, modulo, accion_tipo FROM audit_log
         WHERE accion LIKE 'agenda_motivo_%' ORDER BY creado_en`
      )
      .all();
    assert.ok(eventos.length >= 5, 'Debe auditarse alta, edición, baja y reactivación');
    assert.ok(eventos.every((evento) => evento.modulo === 'Agenda'));
    assert.ok(eventos.some((evento) => evento.accion === 'agenda_motivo_creado'));
    assert.ok(eventos.some((evento) => evento.accion === 'agenda_motivo_desactivado'));
    assert.ok(
      eventos
        .filter((evento) => evento.accion.includes('desactiv'))
        .every((evento) => evento.accion_tipo === 'eliminar')
    );
  } finally {
    db.close();
  }
  console.log('✓ Auditoría clasificada en Agenda con tipo de acción correcto');

  // Interfaz: acceso rápido desde Agenda sin pasar por Ajustes.
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
  pagina.on('dialog', (dialogo) => dialogo.accept());

  await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#btn-ingresar');
  await pagina.type('#login-usuario', 'recepcion');
  await pagina.type('#login-password', '1236');
  await pagina.click('#btn-ingresar');
  await pagina.waitForFunction(() => location.pathname === '/agenda.html');
  await pagina.waitForSelector('.top .nav', { timeout: 20000 });

  const acceso = await pagina.evaluate(() => {
    const boton = document.querySelector('#btn-motivos');
    return boton ? { hidden: boton.hidden, texto: boton.textContent.trim() } : null;
  });
  assert.ok(acceso, 'Debe existir el acceso rápido a motivos en Agenda');
  assert.equal(acceso.hidden, false, 'Secretario/a debe ver el acceso rápido sin configuracion.ver');
  assert.match(acceso.texto, /Motivos/i);

  await pagina.click('#btn-motivos');
  await pagina.waitForFunction(() => document.querySelector('#dlg-motivos')?.open === true);
  await pagina.waitForFunction(() => document.querySelectorAll('#motivos-lista .motivo-fila').length > 0);
  await pagina.$eval('#motivo-grupo', (nodo) => {
    nodo.value = '';
  });
  await pagina.type('#motivo-grupo', 'Consultas');
  await pagina.type('#motivo-texto', `Control prenatal ${sello}`);
  await pagina.type('#motivo-orden', '9');
  await pagina.click('#btn-guardar-motivo');
  await pagina.waitForFunction(
    (texto) =>
      [...document.querySelectorAll('#motivos-lista .motivo-fila')].some((fila) =>
        (fila.innerText || '').includes(texto)
      ),
    { timeout: 20000 },
    `Control prenatal ${sello}`
  );
  await pagina.waitForFunction(
    (texto) =>
      [...document.querySelectorAll('#motivos-cita option')].some(
        (opcion) => opcion.value === texto
      ),
    { timeout: 20000 },
    `Control prenatal ${sello}`
  );
  console.log('✓ Alta desde el acceso rápido y actualización del selector de motivos');

  await pagina.screenshot({ path: join(CAPTURAS, 'motivos-administracion-escritorio.png') });

  const fila = await pagina.evaluateHandle((texto) => {
    return [...document.querySelectorAll('#motivos-lista .motivo-fila')].find((nodo) =>
      (nodo.innerText || '').includes(texto)
    );
  }, `Control prenatal ${sello}`);
  await pagina.evaluate((nodo) => nodo.querySelector('[data-editar-motivo]').click(), fila);
  await pagina.waitForFunction(
    () => document.querySelector('#motivo-id')?.value !== '',
    { timeout: 10000 }
  );
  await pagina.$eval('#motivo-texto', (nodo) => {
    nodo.value = '';
  });
  await pagina.type('#motivo-texto', `Control prenatal editado ${sello}`);
  await pagina.click('#btn-guardar-motivo');
  await pagina.waitForFunction(
    (texto) =>
      [...document.querySelectorAll('#motivos-lista .motivo-fila')].some((nodo) =>
        (nodo.innerText || '').includes(texto)
      ),
    { timeout: 20000 },
    `Control prenatal editado ${sello}`
  );

  const filaEditada = await pagina.evaluateHandle((texto) => {
    return [...document.querySelectorAll('#motivos-lista .motivo-fila')].find((nodo) =>
      (nodo.innerText || '').includes(texto)
    );
  }, `Control prenatal editado ${sello}`);
  await pagina.evaluate((nodo) => nodo.querySelector('[data-desactivar-motivo]').click(), filaEditada);
  await pagina.waitForFunction(
    (texto) => {
      const nodo = [...document.querySelectorAll('#motivos-lista .motivo-fila')].find((fila) =>
        (fila.innerText || '').includes(texto)
      );
      return nodo && /inactivo/i.test(nodo.innerText || '');
    },
    { timeout: 20000 },
    `Control prenatal editado ${sello}`
  );
  await pagina.setViewport({ width: 390, height: 844 });
  await new Promise((listo) => setTimeout(listo, 4000));
  await pagina.screenshot({ path: join(CAPTURAS, 'motivos-administracion-movil.png') });
  await pagina.setViewport({ width: 1440, height: 900 });
  await pagina.click('#dlg-motivos [data-cerrar]');
  await pagina.waitForFunction(() => document.querySelector('#dlg-motivos')?.open === false);
  console.log('✓ Edición y baja con confirmación desde la administración de motivos');

  // “Otro…” en la cita: guarda snapshot y, con permiso, también en el catálogo.
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
  await pagina.click('#btn-motivo-otro');
  await pagina.waitForFunction(() => document.querySelector('#motivo-otro-panel')?.hidden === false);
  assert.equal(
    await pagina.$eval('#motivo-otro-guardar-wrap', (nodo) => nodo.hidden),
    false,
    'Secretario/a puede guardar el texto libre en el catálogo'
  );
  const textoLibre = `Motivo libre ${sello}`;
  await pagina.type('#motivo-otro-texto', textoLibre);
  await pagina.screenshot({ path: join(CAPTURAS, 'motivo-otro-escritorio.png') });
  await pagina.setViewport({ width: 390, height: 844 });
  await new Promise((listo) => setTimeout(listo, 300));
  await pagina.evaluate(() =>
    document.querySelector('#motivo-otro-panel')?.scrollIntoView({ block: 'center' })
  );
  await new Promise((listo) => setTimeout(listo, 250));
  await pagina.screenshot({ path: join(CAPTURAS, 'motivo-otro-movil.png') });
  await pagina.setViewport({ width: 1440, height: 900 });
  await pagina.click('#motivo-otro-guardar');
  assert.equal(
    await pagina.$eval('#motivo-otro-guardar', (nodo) => nodo.checked),
    true,
    'La opción de guardar en catálogo debe poder marcarse'
  );
  await pagina.evaluate(() => document.querySelector('#btn-motivo-otro-usar')?.click());
  await pagina.waitForFunction(
    (texto) => document.querySelector('#cita-motivo')?.value === texto,
    { timeout: 20000 },
    textoLibre
  );
  assert.equal(
    await pagina.$eval('#cita-motivo', (nodo) => nodo.value),
    textoLibre,
    '“Otro…” debe usar el texto como motivo de la cita'
  );
  await pagina.waitForFunction(
    (texto) =>
      [...document.querySelectorAll('#motivos-cita option')].some(
        (opcion) => opcion.value === texto
      ),
    { timeout: 20000 },
    textoLibre
  );
  await pagina.click('#dlg-cita [data-cerrar]');

  const verificacion = entorno.crearCliente({ crudo: true });
  await sesion(verificacion, 'admin', '54321');
  const catalogoFinal = await verificacion('/api/motivos');
  assert.ok(
    catalogoFinal.datos.some((grupo) =>
      grupo.motivos.some((item) => item.motivo === textoLibre)
    ),
    'El texto libre autorizado debe quedar guardado en el catálogo'
  );
  console.log('✓ “Otro…” guarda el texto libre en el catálogo cuando hay permiso');

  // Sin permiso, “Otro…” funciona como snapshot pero no ofrece guardar.
  const contextoMedico = await navegador.createBrowserContext();
  const paginaMedico = await contextoMedico.newPage();
  await paginaMedico.setViewport({ width: 1440, height: 900 });
  await paginaMedico.setCacheEnabled(false);
  await paginaMedico.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
  await paginaMedico.waitForSelector('#btn-ingresar');
  await paginaMedico.type('#login-usuario', 'veronica');
  await paginaMedico.type('#login-password', '1235');
  await paginaMedico.click('#btn-ingresar');
  await paginaMedico.waitForFunction(() => location.pathname === '/agenda.html');
  await paginaMedico.waitForSelector('.top .nav', { timeout: 20000 });
  assert.equal(
    await paginaMedico.$eval('#btn-motivos', (nodo) => nodo.hidden),
    true,
    'Médico no debe ver el acceso rápido a motivos'
  );
  await paginaMedico.goto(`${entorno.base}/agenda.html?fecha=${FECHA}`, {
    waitUntil: 'domcontentloaded',
  });
  await paginaMedico.waitForSelector('#btn-vista-jornada');
  await paginaMedico.click('#btn-vista-jornada');
  await paginaMedico.waitForSelector('#vista-jornada [data-jornada-hora="10:00"]');
  await paginaMedico.evaluate(() => {
    document.querySelector('#vista-jornada [data-jornada-hora="10:00"]').click();
  });
  await paginaMedico.waitForFunction(() => document.querySelector('#dlg-cita')?.open === true);
  await paginaMedico.click('#btn-motivo-otro');
  await paginaMedico.waitForFunction(
    () => document.querySelector('#motivo-otro-panel')?.hidden === false
  );
  assert.equal(
    await paginaMedico.$eval('#motivo-otro-guardar-wrap', (nodo) => nodo.hidden),
    true,
    'Médico no debe poder guardar el texto libre en el catálogo'
  );
  await paginaMedico.type('#motivo-otro-texto', `Solo snapshot ${sello}`);
  await paginaMedico.evaluate(() => document.querySelector('#btn-motivo-otro-usar')?.click());
  await paginaMedico.waitForFunction(
    (texto) => document.querySelector('#cita-motivo')?.value === texto,
    { timeout: 10000 },
    `Solo snapshot ${sello}`
  );
  assert.equal(
    await paginaMedico.$eval('#cita-motivo', (nodo) => nodo.value),
    `Solo snapshot ${sello}`,
    'Sin permiso el texto se usa solo como snapshot de la cita'
  );
  await paginaMedico.close();
  await contextoMedico.close();
  console.log('✓ Sin permiso, “Otro…” funciona como snapshot y no ofrece guardar');

  await pagina.close();

  console.log('');
  console.log('E2E DE MOTIVOS DE CONSULTA COMPLETADO');
  console.log(
    JSON.stringify(
      {
        permiso: 'agenda.motivos',
        rolesAutorizados: ['admin', 'operador', 'enfermero'],
        rolesDenegados: ['medico', 'lectura'],
        bajaLogica: true,
        otro: true,
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
  console.error('E2E DE MOTIVOS DE CONSULTA FALLÓ:', error.message);
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
