import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E del acople del frontend ISIM:
 * - tema y logo,
 * - agenda en vista de jornada,
 * - historia clínica con datos clínicos JSON y CIE-10,
 * - receta con datos ISIM y catálogo de medicamentos.
 */

const FECHA = '2026-12-21';
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
  const sello = String(Date.now()).slice(-6);

  // Catálogos mínimos para probar CIE-10 y recetario.
  const db = new DatabaseSync(entorno.dbFile);
  const ahora = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO catalogo_diagnosticos (id, cie10, diagnostico, creado_en)
     VALUES (?, ?, ?, ?)`
  ).run('test-n76', 'N76', 'Otras vaginitis', ahora);
  db.prepare(
    `INSERT OR REPLACE INTO catalogo_medicinas
       (id, medicina, dci, forma, via, dosis, frecuencia, duracion, advertencia, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'test-diclo',
    'DICLOFENACO',
    'DICLOFENACO',
    'Tabletas',
    'Oral',
    '50 mg',
    'Cada 8 horas',
    '3 días',
    '',
    ahora
  );
  db.close();

  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `UI${sello}`,
      nombres: 'Paciente',
      apellidos: 'ACOPLE ISIM',
      fecha_nacimiento: '1992-04-18',
      sexo: 'F',
      telefono: '0999999999',
    },
  });

  const cita = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      fechaHora: new Date(Date.UTC(2026, 11, 21, 14, 30, 0)).toISOString(),
      duracionMin: 30,
      motivo: 'Consulta de control',
      estado: 'programada',
    },
  });

  const inicio = await admin(
    `/api/appointments/${encodeURIComponent(cita.id)}/start-consultation`,
    { method: 'POST', body: {} }
  );
  const recordId = inicio.recordId;

  // 1. Historia clínica con datos clínicos del frontend ISIM.
  const datosHistoria = {
    motivo: 'Control ginecológico',
    enfermedad_actual: 'Paciente refiere molestias leves.',
    pa_sis: '120',
    pa_dia: '80',
    fc: '72',
    fr: '18',
    temp: '36.6',
    sat: '98',
    peso: '60',
    talla: '165',
    fum: '2026-01-10',
    embarazo: 1,
    eg: '45 semanas 2 días',
    fpp: '2026-10-17',
    au: '32',
    fcf: '140',
    presentacion: 'Cefálica',
    examen_fisico: 'Sin hallazgos relevantes.',
    examen_gineco: 'Genitales externos normales.',
    diagnosticos: [{ cie: 'N76', desc: 'Otras vaginitis', tipo: 'PRE' }],
    plan: 'Tratamiento ambulatorio y control.',
    indicaciones: 'Hidratación y signos de alarma.',
    proxima_cita: '2026-12-27',
  };

  await admin(`/api/clinical-records/${encodeURIComponent(recordId)}`, {
    method: 'PATCH',
    body: { datos: datosHistoria },
  });

  const detalleCita = await admin(`/api/appointments/${encodeURIComponent(cita.id)}`);
  assert.ok(detalleCita.historia?.datos, 'La cita debe devolver los datos clínicos');
  assert.equal(detalleCita.historia.datos.pa_sis, '120');
  assert.equal(detalleCita.historia.datos.diagnosticos[0].cie, 'N76');
  assert.equal(detalleCita.consentimiento, null);
  console.log('✓ Historia clínica: datos clínicos ISIM guardados y recuperados');

  const historia = await admin(`/api/clinical-records/${encodeURIComponent(recordId)}`);
  assert.equal(historia.datos.peso, '60');
  assert.equal(historia.datos.embarazo, 1);
  assert.match(historia.diagnostico || '', /N76/);
  console.log('✓ Campos estructurados sincronizados (diagnóstico, plan, indicaciones)');

  // 2. Receta con datos ISIM y un medicamento.
  const receta = await admin(
    `/api/clinical-records/${encodeURIComponent(recordId)}/prescription`,
    {
      method: 'PUT',
      body: {
        fecha: '2026-12-21',
        hora: '09:00',
        lugar: 'Riobamba',
        encabezado: 'ISIM - Instituto de la Salud Integral de la Mujer',
        pie: 'ISIM',
        indicaciones: 'Tomar con alimentos.',
        datos: {
          diagnostico: 'Otras vaginitis',
          cie: 'N76',
          alergias: 'No refiere',
          recomendaciones: 'Control en 7 días.',
          para_pareja: 0,
        },
        items: [
          {
            medicamento: 'DICLOFENACO',
            presentacion: 'Tabletas 50 mg',
            dosis: '1 tableta',
            via: 'Oral',
            frecuencia: 'Cada 8 horas',
            duracion: '3 días',
            cantidad: '9',
            unidad: 'tabletas',
            indicaciones: 'Después de las comidas.',
          },
        ],
      },
    }
  );
  assert.equal(receta.datos.cie, 'N76');
  assert.equal(receta.datos.recomendaciones, 'Control en 7 días.');
  assert.equal(receta.items.length, 1);
  assert.ok(receta.numero >= 1, 'La receta debe tener número consecutivo');
  assert.ok(receta.centro?.nombre, 'La receta debe incluir los datos del centro');
  console.log(
    `✓ Receta: número ${receta.numero}, datos ISIM, centro y medicamento guardados`
  );

  // 2.b. La base quedó normalizada con las columnas de la nueva UI.
  const dbDatos = new DatabaseSync(entorno.dbFile, { readOnly: true });
  try {
    const consultaDb = dbDatos
      .prepare(
        `SELECT enfermedad_actual, pa_sis, pa_dia, fc, peso, talla, imc,
                fum, embarazo, plan, proxima_cita
         FROM clinical_records WHERE id = ?`
      )
      .get(recordId);
    assert.equal(consultaDb.pa_sis, '120');
    assert.equal(consultaDb.peso, '60');
    assert.equal(consultaDb.imc, '22.0');
    assert.equal(consultaDb.fum, '2026-01-10');
    assert.equal(consultaDb.embarazo, 1);
    assert.match(consultaDb.plan, /Tratamiento ambulatorio/);

    const diagnosticosDb = dbDatos
      .prepare('SELECT cie10, descripcion, tipo FROM clinical_diagnoses WHERE record_id = ?')
      .all(recordId);
    assert.equal(diagnosticosDb.length, 1);
    assert.equal(diagnosticosDb[0].cie10, 'N76');
    assert.equal(diagnosticosDb[0].tipo, 'PRE');

    const pacienteDb = dbDatos
      .prepare('SELECT fum FROM patients WHERE id = ?')
      .get(paciente.id);
    assert.equal(pacienteDb.fum, '2026-01-10');

    const recetaDb = dbDatos
      .prepare(
        `SELECT diagnostico, cie10, alergias, recomendaciones, para_pareja
         FROM prescriptions WHERE record_id = ?`
      )
      .get(recordId);
    assert.equal(recetaDb.cie10, 'N76');
    assert.equal(recetaDb.alergias, 'No refiere');
    assert.match(recetaDb.recomendaciones, /Control en 7 días/);
    assert.equal(recetaDb.para_pareja, 0);

    const itemDb = dbDatos
      .prepare(
        `SELECT unidad, cantidad
         FROM prescription_items
         WHERE prescription_id = (
           SELECT id FROM prescriptions WHERE record_id = ?
         )`
      )
      .get(recordId);
    assert.equal(itemDb.unidad, 'tabletas');
    assert.equal(itemDb.cantidad, '9');

    const plantilla = dbDatos
      .prepare(
        `SELECT nombre, cuerpo_html FROM templates
         WHERE nombre LIKE 'Consentimiento informado ISIM%' LIMIT 1`
      )
      .get();
    assert.ok(plantilla, 'Debe existir la plantilla ISIM de consentimiento');
    for (const marca of [
      '1. Nombre del procedimiento',
      '6. Riesgos',
      '9. Consecuencias posibles si no se realiza',
      'NEGATIVA DEL CONSENTIMIENTO INFORMADO',
      'REVOCATORIA DEL CONSENTIMIENTO INFORMADO',
      'Huella',
    ]) {
      assert.ok(plantilla.cuerpo_html.includes(marca), `Falta en la plantilla: ${marca}`);
    }
    console.log('✓ Plantilla de consentimiento ISIM (Form. 024) presente');
  } finally {
    dbDatos.close();
  }
  console.log('✓ Base normalizada: columnas clínicas, diagnósticos y receta');

  // 3. Catálogos.
  const diagnosticos = await admin('/api/catalogs/diagnoses?q=N76&limit=5');
  assert.ok(Array.isArray(diagnosticos) && diagnosticos.length > 0);
  assert.ok(diagnosticos.some((item) => String(item.cie).toUpperCase() === 'N76'));
  const medicamentos = await admin('/api/catalogs/medications?q=DICLO&limit=5');
  assert.ok(Array.isArray(medicamentos) && medicamentos.length > 0);
  assert.ok(
    medicamentos.some((item) =>
      `${item.comercial} ${item.generico}`.toUpperCase().includes('DICLO')
    )
  );
  console.log('✓ Catálogos CIE-10 y medicamentos disponibles');

  // 4. Validación visual.
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
    await pagina.waitForSelector('.top .brand-link img', { timeout: 20000 });

    const tema = await pagina.evaluate(() => ({
      brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
      secondary: getComputedStyle(document.documentElement)
        .getPropertyValue('--secondary')
        .trim(),
      logo: document.querySelector('.top .brand-link img')?.getAttribute('src') || '',
    }));
    assert.equal(tema.brand, '#284f8c');
    assert.equal(tema.secondary, '#45989f');
    assert.match(tema.logo, /logo/i);
    console.log(`✓ Tema ISIM aplicado (${tema.brand} / ${tema.secondary}) y logo visible`);

    // Vista de jornada.
    await pagina.goto(`${entorno.base}/agenda.html?fecha=${FECHA}`, {
      waitUntil: 'domcontentloaded',
    });
    await pagina.waitForSelector('#btn-vista-jornada');
    await pagina.click('#btn-vista-jornada');
    await pagina.waitForFunction(
      () => document.querySelector('#vista-jornada')?.hidden === false
    );
    await pagina.waitForFunction(
      () => document.querySelectorAll('#vista-jornada .jornada-slot').length > 10
    );
    const jornada = await pagina.evaluate(() => ({
      ocupadas: document.querySelectorAll('#vista-jornada .jornada-slot--ocupado').length,
      libres: document.querySelectorAll('#vista-jornada .jornada-slot--libre').length,
      texto: document.querySelector('#vista-jornada')?.innerText || '',
    }));
    assert.equal(jornada.ocupadas, 1);
    assert.ok(jornada.libres > 10);
    assert.match(jornada.texto, /Mañana/);
    assert.match(jornada.texto, /Tarde/);
    assert.ok(
      (await pagina.$$('#vista-jornada .jornada-slot--libre .jornada-slot__add')).length > 0,
      'Los espacios libres deben mostrar el botón +'
    );
    console.log(`✓ Agenda: jornada con ${jornada.ocupadas} cita, espacios libres y botón +`);

    // Un espacio libre abre el diálogo con la hora elegida.
    const hora = await pagina.$eval(
      '#vista-jornada .jornada-slot--libre[data-jornada-hora]',
      (nodo) => nodo.dataset.jornadaHora
    );
    await pagina.click(`#vista-jornada [data-jornada-hora="${hora}"]`);
    await pagina.waitForFunction(() => document.querySelector('#dlg-cita')?.open === true);
    const fechaCita = await pagina.$eval('#cita-fecha', (nodo) => nodo.value);
    assert.equal(fechaCita, `${FECHA}T${hora}`);
    await pagina.click('#dlg-cita [data-cerrar]');
    console.log(`✓ Jornada: espacio ${hora} abre la nueva cita con la hora correcta`);

    // En calendario también hay un botón + por día.
    await pagina.click('#btn-vista-calendario');
    await pagina.waitForFunction(
      () => document.querySelector('#vista-calendario')?.hidden === false
    );
    await pagina.waitForSelector('#calendario-grid .calendario-add');
    const diaCalendario = await pagina.$eval('#calendario-grid .calendario-add', (nodo) =>
      nodo.dataset.nuevaDia
    );
    await pagina.click('#calendario-grid .calendario-add');
    await pagina.waitForFunction(() => document.querySelector('#dlg-cita')?.open === true);
    const fechaCalendario = await pagina.$eval('#cita-fecha', (nodo) => nodo.value);
    assert.ok(fechaCalendario.startsWith(`${diaCalendario}T09:00`));
    await pagina.click('#dlg-cita [data-cerrar]');
    console.log(`✓ Calendario: botón + agenda el día ${diaCalendario}`);

    // Historia clínica dentro de la ficha unificada (UI v2).
    await pagina.goto(
      `${entorno.base}/paciente.html?id=${encodeURIComponent(
        paciente.id
      )}&cita=${encodeURIComponent(cita.id)}&tab=consulta`,
      { waitUntil: 'domcontentloaded' }
    );
    await pagina.waitForSelector('#form-consulta', { timeout: 25000 });
    await pagina.waitForFunction(
      () => document.querySelector('[name="pa_sis"]')?.value === '120'
    );
    const consulta = await pagina.evaluate(() => ({
      pa: document.querySelector('[name="pa_sis"]')?.value,
      peso: document.querySelector('[name="peso"]')?.value,
      imc: document.querySelector('[name="imc"]')?.value,
      diagnosticos: document.querySelector('#diagnosticos')?.textContent || '',
      plan: document.querySelector('[name="plan"]')?.value,
      secciones: document.querySelectorAll('#form-consulta .sec').length,
      numeros: [...document.querySelectorAll('#form-consulta .sec > h3 .n')].map((nodo) =>
        nodo.textContent.trim()
      ),
      avatar: document.querySelector('.phead .avatar')?.textContent || '',
      alergias: document.querySelector('.phead .alerg')?.textContent || '',
    }));
    assert.equal(consulta.pa, '120');
    assert.equal(consulta.peso, '60');
    assert.match(consulta.imc, /22\.0/);
    assert.match(consulta.diagnosticos, /N76/);
    assert.match(consulta.plan, /Tratamiento ambulatorio/);
    assert.ok(consulta.secciones >= 9, 'La consulta debe mostrar las secciones A-I');
    for (const letra of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) {
      assert.ok(consulta.numeros.includes(letra), `Falta la sección ${letra}`);
    }
    assert.ok(consulta.avatar.length >= 2, 'El avatar de la paciente debe mostrarse');
    assert.match(consulta.alergias, /Alergias/i);
    console.log('✓ Ficha: secciones A-I, signos vitales, IMC, CIE-10 y plan visibles');

    // Receta con datos ISIM, en su pestaña de la ficha.
    await pagina.click('#tabs-ficha button[data-tab="receta"]');
    await pagina.waitForSelector('#form-receta', { timeout: 25000 });
    await pagina.waitForFunction(
      () => document.querySelector('[name="cie"]')?.value === 'N76'
    );
    const recetaVisual = await pagina.evaluate(() => ({
      diagnostico: document.querySelector('[name="diagnostico"]')?.value,
      cie: document.querySelector('[name="cie"]')?.value,
      alergias: document.querySelector('[name="alergias"]')?.value,
      recomendaciones: document.querySelector('[name="recomendaciones"]')?.value,
      items: document.querySelectorAll('#rx-items .rx-item').length,
    }));
    assert.match(recetaVisual.diagnostico, /vaginitis/i);
    assert.equal(recetaVisual.cie, 'N76');
    assert.equal(recetaVisual.alergias, 'No refiere');
    assert.match(recetaVisual.recomendaciones, /Control en 7 días/);
    assert.equal(recetaVisual.items, 1);
    console.log('✓ Receta: diagnóstico, CIE-10, alergias y recomendaciones visibles');

    // 5. Formato de impresión ISIM (A5).
    await pagina.goto(`${entorno.base}/receta.html?id=${encodeURIComponent(receta.id)}`, {
      waitUntil: 'domcontentloaded',
    });
    await pagina.waitForSelector('.receta-isim');
    const recetaImpresion = await pagina.evaluate(() => ({
      texto: document.querySelector('.receta-isim')?.innerText || '',
      numero: document.querySelector('.receta-isim__paciente')?.innerText || '',
    }));
    assert.match(recetaImpresion.texto, /RECETA MÉDICA/i);
    assert.match(recetaImpresion.texto, /Rp\/ Prescripción/i);
    assert.match(recetaImpresion.texto, /Cantidad:/i);
    assert.match(recetaImpresion.texto, /Firma y sello/i);
    assert.match(recetaImpresion.texto, /Alergias/i);
    assert.match(recetaImpresion.texto, /ACOPLE ISIM/i);
    assert.ok(
      recetaImpresion.numero.includes(String(receta.numero).padStart(5, '0')),
      'La receta impresa debe mostrar el número consecutivo'
    );
    console.log('✓ Receta impresa ISIM: A5 con número, Rp/, cantidad y firma');

    await pagina.screenshot({
      path: 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\isim-receta.png',
      fullPage: false,
    });
  } else {
    console.log('⚠ No se encontró Chrome/Edge; se omite la validación visual.');
  }

  // 6. Anulación de receta: conserva el documento y bloquea ediciones.
  // El navegador inició sesión como admin y la sesión única invalidó este cliente;
  // se vuelve a autenticar antes de continuar con la API.
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const anulacion = await admin(
    `/api/prescriptions/${encodeURIComponent(receta.id)}/annul`,
    { method: 'POST', body: { motivo: 'Error de dosificación' } }
  );
  assert.equal(anulacion.ok, true);

  const recetaAnulada = await admin(`/api/prescriptions/${encodeURIComponent(receta.id)}`);
  assert.ok(recetaAnulada.anulada_en, 'La receta debe tener fecha de anulación');
  assert.match(recetaAnulada.motivo_anulacion, /dosificación/i);
  assert.ok(recetaAnulada.anulada_por_nombre, 'La receta debe registrar quién la anuló');

  let errorEdicion = null;
  try {
    await admin(`/api/clinical-records/${encodeURIComponent(recordId)}/prescription`, {
      method: 'PUT',
      body: {
        fecha: '2026-12-21',
        items: [{ medicamento: 'DICLOFENACO', cantidad: '9' }],
      },
    });
  } catch (error) {
    errorEdicion = error;
  }
  assert.ok(errorEdicion && /→ 409:/.test(errorEdicion.message));

  let errorDobleAnulacion = null;
  try {
    await admin(`/api/prescriptions/${encodeURIComponent(receta.id)}/annul`, {
      method: 'POST',
      body: {},
    });
  } catch (error) {
    errorDobleAnulacion = error;
  }
  assert.ok(errorDobleAnulacion && /→ 409:/.test(errorDobleAnulacion.message));
  console.log('✓ Receta anulada: conserva el documento, registra motivo y bloquea edición');

  if (navegador) {
    // La sesión anterior fue reemplazada por la del cliente API; se abre un
    // contexto nuevo y se inicia sesión otra vez para ver la receta anulada.
    const contexto = await navegador.createBrowserContext();
    const paginaAnulada = await contexto.newPage();
    await paginaAnulada.setViewport({ width: 1440, height: 1000 });
    await paginaAnulada.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
    await paginaAnulada.type('#login-usuario', 'admin');
    await paginaAnulada.type('#login-password', '54321');
    await paginaAnulada.click('#btn-ingresar');
    await paginaAnulada.waitForFunction(() => location.pathname === '/agenda.html');
    await paginaAnulada.goto(
      `${entorno.base}/receta.html?id=${encodeURIComponent(receta.id)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await paginaAnulada.waitForSelector('.receta-anulada');
    const aviso = await paginaAnulada.$eval('.receta-anulada', (nodo) => nodo.innerText);
    assert.match(aviso, /RECETA ANULADA/i);
    assert.match(aviso, /dosificación/i);
    await paginaAnulada.screenshot({
      path: 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\isim-receta-anulada.png',
      fullPage: false,
    });
    await contexto.close();
    console.log('✓ Receta anulada visible con aviso rojo en la impresión');
  }

  console.log('');
  console.log('E2E DE ACOPLE DEL FRONTEND ISIM COMPLETADO');
  console.log(
    JSON.stringify(
      {
        tema: { brand: '#284f8c', secondary: '#45989f' },
        agendaJornada: true,
        historiaDatos: true,
        recetaDatos: true,
        recetaAnulada: true,
        catalogos: true,
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
  console.error('E2E DE ACOPLE DEL FRONTEND ISIM FALLÓ:', error.message);
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
