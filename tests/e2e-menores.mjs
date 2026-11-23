import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de pacientes menores de edad.
 *
 * Registra 5 menores con representante legal, agenda sus citas, genera
 * consentimientos (uno pendiente y otro firmado), y comprueba que el estado
 * se ve en la agenda (lista y calendario) y en la consulta en curso.
 */

const FECHA = '2026-12-15';
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

  let admin = entorno.crearCliente();
  const sesion = await entorno.iniciarSesion(admin, 'admin', '54321');
  const sello = String(Date.now()).slice(-6);
  const hoy = new Date().toLocaleDateString('en-CA');

  const nacimientos = [
    '2010-05-10',
    '2012-08-20',
    '2014-03-15',
    '2017-11-01',
    '2019-02-28',
  ];

  const menores = [];
  for (let i = 0; i < nacimientos.length; i += 1) {
    const paciente = await admin('/api/patients', {
      method: 'POST',
      body: {
        cedula: `MN${sello}${i}`,
        nombres: `Menor ${i + 1}`,
        apellidos: 'PRUEBA EDAD',
        fecha_nacimiento: nacimientos[i],
        sexo: 'F',
        telefono: `0999${String(i).padStart(6, '0')}`.slice(0, 10),
        representante1_nombre: `Adulto Responsable ${i + 1}`,
        representante1_cedula: `RP${sello}${i}`,
        representante1_parentesco: i % 2 === 0 ? 'Madre' : 'Padre',
        representante1_telefono: `0988${String(i).padStart(6, '0')}`.slice(0, 10),
      },
    });

    const cita = await admin('/api/appointments', {
      method: 'POST',
      body: {
        patientId: paciente.id,
        fechaHora: new Date(Date.UTC(2026, 11, 15, 13 + i, 0, 0)).toISOString(),
        duracionMin: 30,
        motivo: `Consulta del menor ${i + 1}`,
        estado: 'programada',
      },
    });

    menores.push({ paciente, cita });
  }
  console.log(`✓ ${menores.length} pacientes menores registrados con representante legal`);

  // Todos empiezan sin consentimiento: la API debe reflejarlo.
  const citas = await admin(`/api/appointments?fecha=${FECHA}&limit=100`);
  const nuestras = citas.filter((cita) => menores.some((item) => item.cita.id === cita.id));
  assert.equal(nuestras.length, menores.length);
  for (const cita of nuestras) {
    assert.equal(cita.es_menor, true);
    assert.equal(typeof cita.edad, 'number');
    assert.ok(cita.edad < 18, `La edad ${cita.edad} debe ser menor de 18`);
    assert.equal(cita.consentimiento?.estado, 'sin_generar');
    assert.equal(cita.consentimiento?.firmado, false);
  }
  console.log('✓ API: 5 citas de menores, todas sin consentimiento (rojo)');

  // 1) Consentimiento pendiente para el primer menor.
  const primero = menores[0];
  const pendiente = await admin(
    `/api/appointments/${encodeURIComponent(primero.cita.id)}/consent`,
    { method: 'POST', body: {} }
  );
  assert.ok(pendiente.id);
  const documentoPendiente = await admin(`/api/documents/${encodeURIComponent(pendiente.id)}`);
  assert.equal(documentoPendiente.estado, 'borrador');
  assert.match(documentoPendiente.titulo, /Consentimiento informado ISIM/i);
  const cuerpoConsentimiento = documentoPendiente.versiones?.[0]?.contenido_html || '';
  for (const marca of [
    '1. Nombre del procedimiento',
    '6. Riesgos',
    'NEGATIVA DEL CONSENTIMIENTO INFORMADO',
    'REVOCATORIA DEL CONSENTIMIENTO INFORMADO',
    'Huella',
  ]) {
    assert.ok(cuerpoConsentimiento.includes(marca), `Falta en el consentimiento: ${marca}`);
  }
  console.log(`✓ Consentimiento pendiente con formato ISIM: ${documentoPendiente.titulo}`);

  // 2) Consentimiento firmado para el segundo menor: se usa una plantilla que
  //    solo requiere la firma del profesional (se firma al emitirse).
  const db = new DatabaseSync(entorno.dbFile);
  db.prepare(
    `UPDATE templates SET firma_modo = 'medico'
     WHERE activo = 1 AND tipo = 'consentimiento'`
  ).run();
  db.close();

  const segundo = menores[1];
  const firmado = await admin(
    `/api/appointments/${encodeURIComponent(segundo.cita.id)}/consent`,
    { method: 'POST', body: {} }
  );
  const documentoFirmado = await admin(`/api/documents/${encodeURIComponent(firmado.id)}`);
  assert.equal(documentoFirmado.estado, 'firmado');
  console.log(`✓ Consentimiento firmado generado: ${documentoFirmado.titulo}`);

  // La API debe distinguir firmado, pendiente y sin generar.
  const trasConsentimientos = await admin(`/api/appointments?fecha=${FECHA}&limit=100`);
  const mapaCitas = new Map(
    trasConsentimientos
      .filter((cita) => menores.some((item) => item.cita.id === cita.id))
      .map((cita) => [cita.id, cita])
  );
  assert.equal(mapaCitas.get(primero.cita.id).consentimiento.firmado, false);
  assert.equal(mapaCitas.get(primero.cita.id).consentimiento.estado, 'borrador');
  assert.equal(mapaCitas.get(segundo.cita.id).consentimiento.firmado, true);
  assert.equal(mapaCitas.get(segundo.cita.id).consentimiento.estado, 'firmado');
  assert.equal(mapaCitas.get(menores[2].cita.id).consentimiento.estado, 'sin_generar');
  console.log('✓ API: estados firmado / pendiente / sin generar correctos');

  // 3) Textos configurables + negativa y revocatoria.
  const textos = await admin('/api/settings/consentimiento', {
    method: 'POST',
    body: {
      declaracion:
        'DECLARACIÓN PERSONALIZADA ISIM. Yo, {{paciente.nombre_completo}}, con C.I. {{paciente.cedula}}, acepto el procedimiento tras recibir la información completa.',
      negativa:
        'NEGATIVA PERSONALIZADA ISIM: la paciente o su representante rechaza el procedimiento.',
      revocatoria:
        'REVOCATORIA PERSONALIZADA ISIM: la paciente deja sin efecto el consentimiento otorgado.',
    },
  });
  assert.match(textos.consentimientoDeclaracion, /DECLARACIÓN PERSONALIZADA ISIM/);

  let dbEventos = new DatabaseSync(entorno.dbFile);
  dbEventos
    .prepare(
      `UPDATE templates SET firma_modo = 'ambas'
       WHERE activo = 1 AND tipo = 'consentimiento'`
    )
    .run();
  dbEventos.close();

  const citaNegativa = menores[3].cita;
  const docNegativa = await admin(
    `/api/appointments/${encodeURIComponent(citaNegativa.id)}/consent`,
    { method: 'POST', body: {} }
  );
  const negativa = await admin(
    `/api/documents/${encodeURIComponent(docNegativa.id)}/consent-event`,
    { method: 'POST', body: { tipo: 'negativa', motivo: 'Decisión de la familia' } }
  );
  assert.equal(negativa.consentEstado, 'negativa');

  const docNegado = await admin(`/api/documents/${encodeURIComponent(docNegativa.id)}`);
  assert.equal(docNegado.estado, 'anulado');
  assert.equal(docNegado.esConsentimiento, true);
  assert.equal(docNegado.consentEstado, 'negativa');
  assert.equal(docNegado.consentEvents[0].tipo, 'negativa');
  assert.match(docNegado.consentEvents[0].motivo, /Decisión de la familia/);
  const cuerpoNegado = docNegado.versiones?.[0]?.contenido_html || '';
  assert.match(cuerpoNegado, /DECLARACIÓN PERSONALIZADA ISIM/);
  assert.match(cuerpoNegado, /NEGATIVA PERSONALIZADA ISIM/);
  assert.match(
    cuerpoNegado,
    new RegExp(menores[3].paciente.nombres),
    'La declaración debe interpolar el nombre de la paciente'
  );

  let errorDuplicado = null;
  try {
    await admin(`/api/documents/${encodeURIComponent(docNegativa.id)}/consent-event`, {
      method: 'POST',
      body: { tipo: 'negativa' },
    });
  } catch (error) {
    errorDuplicado = error;
  }
  assert.ok(errorDuplicado && /→ 409:/.test(errorDuplicado.message));
  console.log('✓ Negativa: documento anulado, evento auditado y textos configurables aplicados');

  dbEventos = new DatabaseSync(entorno.dbFile);
  dbEventos
    .prepare(
      `UPDATE templates SET firma_modo = 'medico'
       WHERE activo = 1 AND tipo = 'consentimiento'`
    )
    .run();
  dbEventos.close();

  const citaRevocatoria = menores[4].cita;
  const docRevocatoria = await admin(
    `/api/appointments/${encodeURIComponent(citaRevocatoria.id)}/consent`,
    { method: 'POST', body: {} }
  );
  const docFirmado = await admin(`/api/documents/${encodeURIComponent(docRevocatoria.id)}`);
  assert.equal(docFirmado.estado, 'firmado');

  // Una negativa no aplica a un consentimiento ya firmado.
  let errorNegativaFirmada = null;
  try {
    await admin(`/api/documents/${encodeURIComponent(docRevocatoria.id)}/consent-event`, {
      method: 'POST',
      body: { tipo: 'negativa' },
    });
  } catch (error) {
    errorNegativaFirmada = error;
  }
  assert.ok(errorNegativaFirmada && /→ 409:/.test(errorNegativaFirmada.message));

  const revocatoria = await admin(
    `/api/documents/${encodeURIComponent(docRevocatoria.id)}/consent-event`,
    { method: 'POST', body: { tipo: 'revocatoria', motivo: 'Cambio de decisión' } }
  );
  assert.equal(revocatoria.consentEstado, 'revocatoria');

  const docRevocado = await admin(`/api/documents/${encodeURIComponent(docRevocatoria.id)}`);
  assert.equal(docRevocado.estado, 'anulado');
  assert.equal(docRevocado.consentEstado, 'revocatoria');
  assert.equal(docRevocado.consentEvents[0].tipo, 'revocatoria');
  assert.equal(docRevocado.versiones[0].estado, 'firmada');
  console.log('✓ Revocatoria: conserva la versión firmada y marca el documento como anulado');

  const actividadConsentimientos = await admin(
    `/api/reports/activity?fecha=${encodeURIComponent(hoy)}&usuario=${encodeURIComponent(
      sesion.id
    )}&limit=1000`
  );
  const accionesConsentimientos = actividadConsentimientos.eventos.map(
    (evento) => evento.accion
  );
  assert.ok(accionesConsentimientos.includes('consentimiento_negado'));
  assert.ok(accionesConsentimientos.includes('consentimiento_revocado'));
  assert.ok(accionesConsentimientos.includes('textos_consentimiento_actualizados'));
  console.log('✓ Actividad: negativa, revocatoria y textos registrados');

  // El calendario también debe devolver el estado para la vista previa.
  const calendario = await admin(
    `/api/appointments/calendar?desde=${encodeURIComponent(
      new Date(Date.UTC(2026, 11, 15)).toISOString()
    )}&hasta=${encodeURIComponent(
      new Date(Date.UTC(2026, 11, 15, 23, 59, 59)).toISOString()
    )}&porDia=10&tzOffset=0`
  );
  const dia = calendario.dias.find((item) => item.fecha === FECHA);
  assert.ok(dia, 'El calendario debe incluir el día de las citas');
  const preview = new Map(dia.citas.map((cita) => [cita.id, cita]));
  assert.equal(preview.get(primero.cita.id).consentimiento.estado, 'borrador');
  assert.equal(preview.get(segundo.cita.id).consentimiento.firmado, true);
  console.log('✓ Calendario: vista previa con estado del consentimiento');

  // Consulta en curso del tercer menor (sin consentimiento).
  const tercero = menores[2];
  await admin(`/api/appointments/${encodeURIComponent(tercero.cita.id)}/start-consultation`, {
    method: 'POST',
    body: {},
  });

  // Un adulto no debe poder usar el atajo de consentimiento.
  const adulto = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `AD${sello}`,
      nombres: 'Paciente Adulto',
      apellidos: 'PRUEBA EDAD',
      fecha_nacimiento: '1990-01-01',
      sexo: 'F',
    },
  });
  const citaAdulta = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: adulto.id,
      fechaHora: new Date(Date.UTC(2026, 11, 16, 14, 0, 0)).toISOString(),
      duracionMin: 30,
      motivo: 'Consulta adulto',
      estado: 'programada',
    },
  });
  let errorAdulto = null;
  try {
    await admin(`/api/appointments/${encodeURIComponent(citaAdulta.id)}/consent`, {
      method: 'POST',
      body: {},
    });
  } catch (error) {
    errorAdulto = error;
  }
  assert.ok(errorAdulto && /→ 400:/.test(errorAdulto.message));

  // Actividad registrada y filtrable.
  const actividad = await admin(
    `/api/reports/activity?fecha=${encodeURIComponent(hoy)}&usuario=${encodeURIComponent(
      sesion.id
    )}&limit=1000`
  );
  const acciones = actividad.eventos.map((evento) => evento.accion);
  assert.ok(acciones.filter((accion) => accion === 'paciente_creado').length >= 6);
  assert.ok(acciones.filter((accion) => accion === 'cita_creada').length >= 6);
  assert.ok(acciones.filter((accion) => accion === 'consentimiento_generado_cita').length >= 2);
  assert.ok(actividad.eventos.every((evento) => !evento.usuario_id || evento.usuario_id === sesion.id));
  console.log('✓ Actividad: altas, citas y consentimientos registrados por usuario');

  // Validación visual en navegador real.
  const ejecutable = encontrarNavegador();
  if (ejecutable) {
    navegador = await puppeteer.launch({
      executablePath: ejecutable,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1100'],
    });
    const pagina = await navegador.newPage();
    await pagina.setViewport({ width: 1440, height: 1100 });
    await pagina.setCacheEnabled(false);
    pagina.setDefaultTimeout(30000);

    await pagina.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
    await pagina.type('#login-usuario', 'admin');
    await pagina.type('#login-password', '54321');
    await pagina.click('#btn-ingresar');
    await pagina.waitForFunction(() => location.pathname === '/agenda.html');

    // Vista lista.
    await pagina.goto(`${entorno.base}/agenda.html?fecha=${FECHA}`, {
      waitUntil: 'domcontentloaded',
    });
    await pagina.waitForSelector('#btn-vista-lista');
    await pagina.click('#btn-vista-lista');
    await pagina.waitForFunction(
      (ids) => {
        const items = [...document.querySelectorAll('.agenda-item')];
        return ids.every((id) => items.some((item) => item.dataset.id === id));
      },
      { timeout: 25000 },
      menores.map((item) => item.cita.id)
    );

    const lista = await pagina.evaluate((ids) => {
      const items = [...document.querySelectorAll('.agenda-item')];
      return ids.map((id) => {
        const item = items.find((nodo) => nodo.dataset.id === id);
        const estado = item?.querySelector('.agenda-consentimiento');
        return {
          id,
          texto: item?.innerText || '',
          consentimiento: estado?.textContent.trim() || '',
          clase: estado?.className || '',
        };
      });
    }, menores.map((item) => item.cita.id));

    for (const item of lista) {
      assert.match(item.texto, /Menor de edad/i, `La cita ${item.id} debe advertir que es menor`);
    }
    const filaPrimero = lista.find((item) => item.id === primero.cita.id);
    const filaSegundo = lista.find((item) => item.id === segundo.cita.id);
    assert.match(filaPrimero.consentimiento, /sin firmar/i);
    assert.match(filaPrimero.clase, /agenda-consentimiento--pendiente/);
    assert.match(filaSegundo.consentimiento, /firmado/i);
    assert.match(filaSegundo.clase, /agenda-consentimiento--firmado/);
    console.log('✓ Lista: consentimiento pendiente en rojo y firmado en verde');

    // Vista calendario.
    await pagina.click('#btn-vista-calendario');
    await pagina.waitForFunction(() => document.querySelector('#vista-calendario')?.hidden === false);
    await pagina.waitForFunction(
      (id) => Boolean(document.querySelector(`[data-cita="${id}"]`)),
      { timeout: 20000 },
      primero.cita.id
    );

    const calendarioVisual = await pagina.evaluate(({ pendienteId, firmadoId }) => {
      const pendiente = document.querySelector(`[data-cita="${pendienteId}"]`);
      const firmado = document.querySelector(`[data-cita="${firmadoId}"]`);
      return {
        pendienteClase: pendiente?.className || '',
        pendienteTexto: pendiente?.innerText || '',
        firmadoClase: firmado?.className || '',
        firmadoTexto: firmado?.innerText || '',
      };
    }, { pendienteId: primero.cita.id, firmadoId: segundo.cita.id });

    assert.match(calendarioVisual.pendienteClase, /calendario-cita--consentimiento-pendiente/);
    assert.match(calendarioVisual.pendienteTexto, /sin firmar/i);
    assert.doesNotMatch(calendarioVisual.firmadoClase, /consentimiento-pendiente/);
    assert.match(calendarioVisual.firmadoTexto, /firmado/i);
    console.log('✓ Calendario: cita pendiente marcada en rojo y firmada en verde');

    // Consulta en curso: advertencia persistente de menor y consentimiento pendiente.
    await pagina.goto(
      `${entorno.base}/paciente.html?id=${encodeURIComponent(
        tercero.paciente.id
      )}&cita=${encodeURIComponent(tercero.cita.id)}&tab=consulta`,
      { waitUntil: 'domcontentloaded' }
    );
    await pagina.waitForSelector('.ficha-warn', { timeout: 25000 });
    const consulta = await pagina.evaluate(() => ({
      menor: document.querySelector('.phead__menor')?.textContent || '',
      aviso: document.querySelector('.ficha-warn')?.innerText || '',
      clase: document.querySelector('.ficha-warn')?.className || '',
    }));
    assert.match(consulta.menor, /menor de edad/i);
    assert.match(consulta.aviso, /pendiente/i);
    assert.match(consulta.aviso, /firmar/i);
    assert.match(consulta.clase, /ficha-warn/);
    console.log('✓ Consulta en curso: menor advertido y consentimiento pendiente en rojo');

    await pagina.screenshot({
      path: 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\menores-consulta.png',
      fullPage: false,
    });

    // Documento con negativa: aviso visible y acciones bloqueadas.
    await pagina.goto(
      `${entorno.base}/documento.html?id=${encodeURIComponent(docNegativa.id)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await pagina.waitForSelector('#alerta-consent:not([hidden])', { timeout: 25000 });
    const vistaNegativa = await pagina.evaluate(() => ({
      alerta: document.querySelector('#alerta-consent')?.innerText || '',
      negativaVisible: !document.querySelector('#btn-negativa')?.hidden,
      revocatoriaVisible: !document.querySelector('#btn-revocatoria')?.hidden,
      hoja: document.querySelector('#hoja')?.innerText || '',
      eventos: document.querySelector('#consent-lista')?.innerText || '',
    }));
    assert.match(vistaNegativa.alerta, /NEGATIVA REGISTRADA/i);
    assert.match(vistaNegativa.alerta, /Decisión de la familia/);
    assert.equal(vistaNegativa.negativaVisible, false);
    assert.equal(vistaNegativa.revocatoriaVisible, false);
    assert.match(vistaNegativa.hoja, /NEGATIVA PERSONALIZADA ISIM/);
    assert.match(vistaNegativa.eventos, /Decisión de la familia/);
    console.log('✓ Documento: negativa visible y botones de firma/evento bloqueados');
  } else {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
  }

  console.log('');
  console.log('E2E DE PACIENTES MENORES COMPLETADO');
  console.log(
    JSON.stringify(
      {
        menoresRegistrados: menores.length,
        fecha: FECHA,
        consentimientoPendiente: primero.cita.id,
        consentimientoFirmado: segundo.cita.id,
        estadosVisibles: ['lista', 'calendario', 'consulta'],
        adultoRechazado: true,
        actividadRegistrada: true,
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
  console.error('E2E DE PACIENTES MENORES FALLÓ:', error.message);
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
