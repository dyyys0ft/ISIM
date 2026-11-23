import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * 10 escenarios de usabilidad narrados como un médico usando el sistema:
 * agenda, admisión, consulta, firma, addenda, receta, pedido, certificado,
 * menor con consentimiento y validación/auditoría.
 */

const FECHA_BASE = Date.UTC(2027, 0, 10);
const capturas = 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2\\capturas';
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sello = '';
let pacienteSeq = 0;

function fechaCita(indice) {
  return new Date(FECHA_BASE + indice * 86400000 + 15 * 3600000).toISOString();
}

async function crearPaciente(admin, extra = {}) {
  pacienteSeq += 1;
  const cedula = extra.cedula || `USM${sello}${pacienteSeq}`;
  const cuerpo = {
    cedula,
    nombres: extra.nombres || 'Paciente',
    apellidos: extra.apellidos || `Usabilidad ${sello}`,
    fecha_nacimiento: extra.fecha_nacimiento || '1990-03-15',
    sexo: 'F',
    telefono: '0999999999',
    ...extra,
  };
  const paciente = await admin('/api/patients', { method: 'POST', body: cuerpo });
  return { id: paciente.id, cedula, ...cuerpo };
}

async function crearCita(admin, pacienteId, medicoId, indice) {
  const cita = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: pacienteId,
      medicoId,
      fechaHora: fechaCita(indice),
      duracionMin: 30,
      motivo: 'Control de usabilidad',
      estado: 'programada',
    },
  });
  return cita.id;
}

async function abrirFicha(pagina, base, pacienteId, citaId, tab = 'consulta') {
  await pagina.goto(
    `${base}/paciente.html?id=${encodeURIComponent(pacienteId)}&cita=${encodeURIComponent(citaId)}&tab=${tab}`,
    { waitUntil: 'domcontentloaded' }
  );
  await pagina.waitForSelector('#tabs-ficha button', { timeout: 25000 });
}

async function fijar(pagina, selector, valor) {
  await pagina.$eval(
    selector,
    (nodo, nuevo) => {
      nodo.value = nuevo;
      nodo.dispatchEvent(new Event('input', { bubbles: true }));
      nodo.dispatchEvent(new Event('change', { bubbles: true }));
    },
    valor
  );
}

async function confirmar(pagina) {
  await pagina.waitForSelector('.modal [data-aceptar]', { timeout: 10000 });
  await pagina.click('.modal [data-aceptar]');
}

async function esperarToast(pagina, texto) {
  await pagina.waitForFunction(
    (t) => [...document.querySelectorAll('.toast')].some((n) => n.textContent.includes(t)),
    { timeout: 15000 },
    texto
  );
}

async function main() {
  sello = String(Date.now()).slice(-6);
  const dataTest = resolve(
    'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2',
    `data-usabilidad-${Date.now()}`
  );
  rmSync(dataTest, { recursive: true, force: true });
  mkdirSync(dataTest, { recursive: true });
  process.env.DATA_DIR = dataTest;
  const entorno = await crearEntornoE2E();
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const medicos = await admin('/api/medicos');
  const medico = medicos.find((m) => /Verónica/i.test(m.nombre))?.id || medicos[0].id;

  const ejecutable = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).find((ruta) => existsSync(ruta));
  const navegador = await puppeteer.launch({
    executablePath: ejecutable,
    headless: 'new',
    args: ['--no-sandbox'],
  });

  try {
    const p = await navegador.newPage();
    p.setDefaultNavigationTimeout(40000);
    await p.setCacheEnabled(false);
    // Las pruebas de usabilidad no miden SSE; se evita acumular conexiones
    // abiertas entre las muchas navegaciones de la ficha.
    await p.evaluateOnNewDocument(() => {
      window.EventSource = undefined;
    });
    await p.evaluateOnNewDocument(() => {
      window.open = () => null;
    });
    await p.setRequestInterception(true);
    p.on('request', (r) => (/fonts\.(googleapis|gstatic)\.com/.test(r.url()) ? r.abort() : r.continue()));
    const errores = [];
    p.on('pageerror', (e) => errores.push(`PAGE ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/favicon|401|404|ERR_FAILED/.test(m.text())) {
        errores.push(`CONSOLE ${m.text()}`);
      }
    });

    await p.setViewport({ width: 1440, height: 900 });
    await p.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
    await p.type('#login-usuario', 'veronica');
    await p.type('#login-password', '1235');
    await p.click('#btn-ingresar');
    await p.waitForFunction(() => location.pathname === '/agenda.html');
    await p.waitForSelector('.top .nav', { timeout: 15000 });

    // 1. El médico entra y revisa su jornada.
    const menu = await p.evaluate(() => ({
      items: [...document.querySelectorAll('.top .nav > a, .top .nav > details > summary')].map((n) =>
        n.textContent.trim()
      ),
      activo: document.querySelector('.top .nav .on')?.textContent?.trim() || '',
      desborde: document.documentElement.scrollWidth > window.innerWidth + 2,
    }));
    assert.equal(menu.activo, 'Agenda');
    assert.ok(menu.items.includes('Agenda') && menu.items.includes('Pacientes'));
    assert.equal(menu.desborde, false);
    await p.click('#btn-vista-jornada');
    await p.waitForSelector('#vista-jornada .jornada-col', { timeout: 15000 });
    await p.screenshot({ path: `${capturas}\\23-medico-jornada.png` });
    console.log('✓ 1. Agenda del médico: menú, jornada y sin desbordamiento');

    // 2. Admisión de una paciente nueva y consentimiento LOPDP.
    await p.goto(`${entorno.base}/pacientes.html`, { waitUntil: 'domcontentloaded' });
    await p.click('#btn-nuevo');
    await p.waitForSelector('#form-paciente');
    const cedulaAdmision = `ADM${sello}1`;
    await p.type('#p-nombres', 'María');
    await p.type('#p-apellidos', 'Admisión Médico');
    await p.type('#p-cedula', cedulaAdmision);
    await fijar(p, '#p-nacimiento', '1985-07-20');
    await p.type('#p-telefono', '0987654321');
    await p.type('#p-alergias', 'Penicilina');
    await p.click('#btn-guardar-paciente');
    await p.waitForFunction(() => document.querySelector('#dlg-paciente')?.open === false, {
      timeout: 20000,
    });
    const admision = await admin(`/api/patients/paginated?cedula=${encodeURIComponent(cedulaAdmision)}`);
    assert.equal(admision.items.length, 1);
    const pacienteAdmision = admision.items[0];
    await p.goto(`${entorno.base}/paciente.html?id=${encodeURIComponent(pacienteAdmision.id)}`, {
      waitUntil: 'domcontentloaded',
    });
    await p.waitForSelector('#form-datos');
    assert.equal(
      await p.$eval('[name="consentimiento_datos"]', (nodo) => nodo.checked),
      false,
      'El consentimiento debe iniciar sin marcar'
    );
    assert.ok(await p.$('#imprimir-consentimiento'), 'Se debe poder imprimir antes de marcar');
    assert.ok(await p.$('#subir-evidencia'), 'Se debe poder subir evidencia antes de marcar');

    const archivoEvidencia = resolve(
      'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2',
      'evidencia-consentimiento.png'
    );
    writeFileSync(
      archivoEvidencia,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      )
    );
    const entradaEvidencia = await p.$('#archivo-evidencia');
    assert.ok(entradaEvidencia, 'Debe existir el campo para subir la evidencia');
    await entradaEvidencia.uploadFile(archivoEvidencia);
    await esperarToast(p, 'Evidencia firmada guardada');
    await p.waitForSelector('a[href*="consentimiento-evidencia"]', { timeout: 20000 });

    const dbSinConsentimiento = new DatabaseSync(entorno.dbFile);
    const antesDeMarcar = dbSinConsentimiento
      .prepare(
        'SELECT consentimiento_datos, consentimiento_evidencia_path FROM patients WHERE id = ?'
      )
      .get(pacienteAdmision.id);
    dbSinConsentimiento.close();
    assert.equal(
      antesDeMarcar.consentimiento_datos,
      null,
      'La evidencia debe poder cargarse antes de marcar el consentimiento'
    );
    assert.ok(
      antesDeMarcar.consentimiento_evidencia_path,
      'La evidencia debe quedar guardada antes de marcar'
    );

    await p.click('[name="consentimiento_datos"]');
    await p.click('#form-datos button[type="submit"]');
    await esperarToast(p, 'Datos guardados');
    const dbLectura = new DatabaseSync(entorno.dbFile);
    const consentimiento = dbLectura
      .prepare('SELECT consentimiento_datos FROM patients WHERE id = ?')
      .get(pacienteAdmision.id)?.consentimiento_datos;
    dbLectura.close();
    assert.ok(consentimiento, 'Debe registrarse el consentimiento LOPDP');

    // El botón de impresión pregunta qué consentimiento imprimir.
    await p.click('#imprimir-consentimiento');
    await p.waitForSelector('#consentimiento-opcion', { timeout: 10000 });
    const opcionesConsentimiento = await p.$$eval('#consentimiento-opcion option', (nodos) =>
      nodos.map((nodo) => nodo.textContent.trim())
    );
    assert.ok(opcionesConsentimiento.some((texto) => /LOPDP/i.test(texto)));
    assert.ok(
      opcionesConsentimiento.some((texto) => !/LOPDP/i.test(texto)),
      'El selector debe incluir las plantillas de consentimiento activas'
    );
    await p.click('.modal [data-cerrar-modal]');
    await p.waitForFunction(() => !document.querySelector('.modal'));

    await p.goto(
      `${entorno.base}/consentimiento-datos.html?id=${encodeURIComponent(pacienteAdmision.id)}`,
      { waitUntil: 'domcontentloaded' }
    );
    await p.waitForSelector('#consentimiento-doc .hoja-impresion__head', { timeout: 20000 });
    const textoConsentimiento = await p.$eval('#consentimiento-doc', (n) => n.innerText);
    assert.match(textoConsentimiento, /CONSENTIMIENTO DE TRATAMIENTO DE DATOS/i);
    assert.match(textoConsentimiento, /Datos de la paciente/i);
    assert.match(textoConsentimiento, new RegExp(pacienteAdmision.apellidos, 'i'));
    console.log('✓ 2. Admisión, consentimiento LOPDP, impresión y evidencia firmada');

    // 3. Consulta con signos vitales, diagnóstico y plan.
    const adulto = await crearPaciente(admin, {
      nombres: 'Ana',
      apellidos: 'Consulta Médico',
      fecha_nacimiento: '1992-01-05',
    });
    const citaAdulto = await crearCita(admin, adulto.id, medico, 1);
    await abrirFicha(p, entorno.base, adulto.id, citaAdulto, 'consulta');
    await p.waitForFunction(
      () => document.querySelector('#iniciar-consulta') || document.querySelector('#form-consulta'),
      { timeout: 20000 }
    );
    if (await p.$('#iniciar-consulta')) {
      await p.click('#iniciar-consulta');
      await p.waitForSelector('#form-consulta', { timeout: 20000 });
    }
    await p.type('[name="motivo"]', 'Dolor pélvico de tres días');
    await p.type('[name="enfermedad_actual"]', 'Dolor cólico, sin fiebre.');
    await p.type('[name="pa_sis"]', '118');
    await p.type('[name="pa_dia"]', '76');
    await p.type('[name="peso"]', '62');
    await p.type('[name="talla"]', '165');
    await p.type('#dx-cie', 'N94.6');
    await p.type('#dx-desc', 'Dismenorrea');
    await p.click('#dx-agregar');
    await p.type('[name="plan"]', 'Analgesia y control en 7 días.');
    await p.type('[name="indicaciones"]', 'Signos de alarma.');
    await p.click('#guardar-borrador');
    await esperarToast(p, 'Borrador guardado');
    await p.waitForSelector('#form-consulta', { timeout: 20000 });
    const citaDetalle = await admin(`/api/appointments/${encodeURIComponent(citaAdulto)}`);
    const recordId = citaDetalle.historia.id;
    const historia = await admin(`/api/clinical-records/${encodeURIComponent(recordId)}`);
    assert.equal(historia.datos.pa_sis, '118');
    assert.match(historia.datos.diagnosticos[0].cie, /N94/);
    assert.equal(await p.$eval('[name="imc"]', (n) => n.value), '22.8');
    await p.screenshot({ path: `${capturas}\\24-medico-consulta.png` });
    console.log('✓ 3. Consulta: vitales, IMC, CIE-10 y plan guardados');

    // 4. Firma, bloqueo de edición y nota aclaratoria.
    await p.click('#firmar-consulta');
    await confirmar(p);
    await p.waitForFunction(
      () => /firmada/i.test(document.querySelector('#panel-tab')?.innerText || ''),
      { timeout: 25000 }
    );
    assert.equal(await p.$('#form-consulta'), null);
    let bloqueada = false;
    try {
      await admin(`/api/clinical-records/${encodeURIComponent(recordId)}`, {
        method: 'PATCH',
        body: { notas: 'Intento de cambio' },
      });
    } catch (error) {
      bloqueada = error.status === 409 || /→ 409:/.test(error.message);
    }
    assert.equal(bloqueada, true, 'La consulta firmada debe rechazar cambios con 409');
    await p.click('#agregar-addenda');
    await p.waitForSelector('#addenda-texto');
    await p.type('#addenda-texto', 'Se aclara que la paciente toleró bien el tratamiento.');
    await p.click('#addenda-guardar');
    await esperarToast(p, 'Nota aclaratoria guardada');
    await p.waitForFunction(
      () => document.querySelector('#panel-tab')?.innerText.includes('Se aclara que la paciente'),
      { timeout: 15000 }
    );
    const dbAddenda = new DatabaseSync(entorno.dbFile);
    const addendas = dbAddenda
      .prepare('SELECT COUNT(*) AS n FROM clinical_addenda WHERE record_id = ?')
      .get(recordId).n;
    dbAddenda.close();
    assert.ok(addendas >= 1);
    console.log('✓ 4. Firma inmutable y nota aclaratoria visible');

    // 5. Receta con DCI, cantidad e impresión A5.
    await p.click('#tabs-ficha button[data-tab="receta"]');
    await p.waitForSelector('#form-receta', { timeout: 25000 });
    await p.click('#rx-libre');
    await p.evaluate(() => {
      const valores = {
        medicamento: 'Ibuprofeno',
        dci: 'Ibuprofeno 400 mg',
        cantidad: '15',
        unidad: 'tabletas',
        indicaciones: '1 tableta cada 8 horas por 5 días',
      };
      for (const input of document.querySelectorAll('#rx-items [data-k]')) {
        if (valores[input.dataset.k]) {
          input.value = valores[input.dataset.k];
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
    await p.click('#form-receta button[type="submit"]');
    await esperarToast(p, 'Receta guardada');
    const recetas = await admin(`/api/patients/${encodeURIComponent(adulto.id)}/recetas`);
    assert.ok(recetas.length >= 1);
    await p.goto(`${entorno.base}/receta.html?id=${encodeURIComponent(recetas[0].id)}`, {
      waitUntil: 'domcontentloaded',
    });
    await p.waitForSelector('.receta-isim');
    const recetaTexto = await p.$eval('.receta-isim', (n) => n.innerText);
    assert.match(recetaTexto, /RECETA MÉDICA/i);
    assert.match(recetaTexto, /Ibuprofeno/);
    assert.match(recetaTexto, /Cantidad:/i);
    await p.screenshot({ path: `${capturas}\\25-medico-receta.png` });
    console.log('✓ 5. Receta emitida e impresión A5 con DCI y cantidad');

    // 6. Pedido de ecografía e impresión A5 vertical.
    await p.goto(
      `${entorno.base}/paciente.html?id=${encodeURIComponent(adulto.id)}&cita=${encodeURIComponent(citaAdulto)}&tab=pedidos`,
      { waitUntil: 'domcontentloaded' }
    );
    await p.waitForSelector('#form-pedido', { timeout: 25000 });
    await p.type('#form-pedido [name="descripcion"]', 'Ecografía transvaginal de control.');
    await p.click('#form-pedido button[type="submit"]');
    await esperarToast(p, 'Pedido creado');
    const pedidos = await admin(`/api/patients/${encodeURIComponent(adulto.id)}/pedidos`);
    assert.ok(pedidos.length >= 1);
    await p.goto(`${entorno.base}/pedido.html?id=${encodeURIComponent(pedidos[0].id)}`, {
      waitUntil: 'domcontentloaded',
    });
    await p.waitForSelector('.hoja-impresion');
    const pedidoTexto = await p.$eval('.hoja-impresion', (n) => n.innerText);
    assert.match(pedidoTexto, /PEDIDO DE EXAMEN/i);
    assert.match(pedidoTexto, /Ecografía transvaginal/);
    console.log('✓ 6. Pedido de ecografía e impresión A5 vertical');

    // 7. Certificado de atención e impresión A4.
    await p.goto(
      `${entorno.base}/paciente.html?id=${encodeURIComponent(adulto.id)}&cita=${encodeURIComponent(citaAdulto)}&tab=certificados`,
      { waitUntil: 'domcontentloaded' }
    );
    await p.waitForSelector('#nuevo-certificado', { timeout: 25000 });
    await p.click('#nuevo-certificado');
    await p.waitForSelector('#cert-guardar');
    await p.select('#cert-tipo', 'atencion');
    await p.type('#cert-diagnostico', 'Dismenorrea');
    await p.type('#cert-dias', '3');
    await p.click('#cert-guardar');
    await esperarToast(p, 'Certificado');
    const certificados = await admin(
      `/api/patients/${encodeURIComponent(adulto.id)}/certificados`
    );
    assert.ok(certificados.length >= 1);
    await p.goto(`${entorno.base}/certificado.html?id=${encodeURIComponent(certificados[0].id)}`, {
      waitUntil: 'domcontentloaded',
    });
    await p.waitForSelector('.hoja-impresion');
    const certificadoTexto = await p.$eval('.hoja-impresion', (n) => n.innerText);
    assert.match(certificadoTexto, /CERTIFICADO DE ATENCIÓN/i);
    assert.match(certificadoTexto, /Dismenorrea/);
    console.log('✓ 7. Certificado de atención e impresión A4');

    // 8. Paciente menor: representante, aviso y consentimiento antes de la cita.
    const menor = await crearPaciente(admin, {
      nombres: 'Menor',
      apellidos: 'Consentimiento',
      fecha_nacimiento: '2012-06-01',
      representante1_nombre: 'Madre Responsable',
      representante1_cedula: `REP${sello}`,
      representante1_parentesco: 'Madre',
    });
    const citaMenor = await crearCita(admin, menor.id, medico, 2);
    await abrirFicha(p, entorno.base, menor.id, citaMenor, 'consulta');
    await p.waitForSelector('.ficha-warn', { timeout: 20000 });
    assert.match(await p.$eval('.phead__menor', (n) => n.textContent), /menor de edad/i);
    assert.match(await p.$eval('.ficha-warn', (n) => n.innerText), /pendiente/i);
    await p.click('#tabs-ficha button[data-tab="consentimientos"]');
    await p.waitForSelector('#generar-ci', { timeout: 20000 });
    await p.click('#generar-ci');
    await p.waitForFunction(
      () => /Pendiente de firma/i.test(document.querySelector('#panel-tab')?.innerText || ''),
      { timeout: 20000 }
    );
    const documentos = await admin(`/api/patients/${encodeURIComponent(menor.id)}/documents`);
    assert.ok(documentos.length >= 1);
    const sesion = await admin(
      `/api/documents/${encodeURIComponent(documentos[0].id)}/sign-session`,
      { method: 'POST', body: {} }
    );
    assert.match(sesion.url, /\/firma\.html\?t=/);
    console.log('✓ 8. Menor: aviso persistente y consentimiento generado para firmar');

    // 9. Búsqueda, ficha multipestaña y móvil.
    await p.goto(`${entorno.base}/pacientes.html`, { waitUntil: 'domcontentloaded' });
    await p.type('#buscar-cedula', adulto.cedula);
    await p.click('#form-filtros-pacientes button[type="submit"]');
    await p.waitForFunction(
      (cedula) =>
        [...document.querySelectorAll('.patient-card')].some((card) =>
          card.innerText.includes(cedula)
        ),
      { timeout: 20000 },
      adulto.cedula
    );
    await p.evaluate((cedula) => {
      const tarjeta = [...document.querySelectorAll('.patient-card')].find((card) =>
        card.innerText.includes(cedula)
      );
      const enlace = [...(tarjeta?.querySelectorAll('a') || [])].find((a) =>
        /^Ficha$/i.test(a.textContent.trim())
      );
      enlace?.click();
    }, adulto.cedula);
    await p.waitForFunction(() => location.pathname === '/paciente.html', { timeout: 20000 });
    await p.waitForSelector('#tabs-ficha button', { timeout: 25000 });
    assert.match(await p.$eval('.phead .nm', (n) => n.textContent), /Consulta Médico/);
    for (const tab of ['signos', 'historia', 'consulta', 'receta', 'examenes', 'pedidos', 'consentimientos', 'certificados', 'datos']) {
      await p.click(`#tabs-ficha button[data-tab="${tab}"]`);
      await esperar(250);
      const texto = await p.$eval('#panel-tab', (n) => n.innerText);
      assert.doesNotMatch(texto, /No se pudo cargar/);
      if (tab === 'historia') {
        await p.waitForSelector('#panel-tab table.tbl', { timeout: 15000 });
        const cabeceras = await p.$$eval('#panel-tab table.tbl thead th', (nodos) =>
          nodos.map((nodo) => nodo.textContent.trim())
        );
        for (const cabecera of [
          'Motivo / descripción',
          'Diagnóstico / CIE-10',
          'Recetas',
          'Exámenes',
          'Pedidos',
        ]) {
          assert.ok(cabeceras.includes(cabecera), `Falta la columna ${cabecera}`);
        }
      }
    }

    // Las secciones nuevas quedan divididas: historial a la izquierda y alta a la derecha.
    const borrador = await crearPaciente(admin, {
      nombres: 'Borrador',
      apellidos: 'Signos Vitales',
      fecha_nacimiento: '1994-04-04',
    });
    const citaBorrador = await crearCita(admin, borrador.id, medico, 3);
    await admin(`/api/appointments/${encodeURIComponent(citaBorrador)}/start-consultation`, {
      method: 'POST',
      body: {},
    });
    await p.goto(
      `${entorno.base}/paciente.html?id=${encodeURIComponent(borrador.id)}&cita=${encodeURIComponent(citaBorrador)}&tab=signos`,
      { waitUntil: 'domcontentloaded' }
    );
    await p.waitForSelector('#panel-tab .ficha-split #form-signos', { timeout: 20000 });
    await p.screenshot({ path: `${capturas}\\29-signos-escritorio.png` });
    await p.click('#tabs-ficha button[data-tab="examenes"]');
    await p.waitForSelector('#panel-tab .ficha-split #form-examen', { timeout: 15000 });
    await p.screenshot({ path: `${capturas}\\30-examenes-escritorio.png` });
    await p.click('#tabs-ficha button[data-tab="pedidos"]');
    await p.waitForSelector('#panel-tab .ficha-split #form-pedido', { timeout: 15000 });
    await p.screenshot({ path: `${capturas}\\31-pedidos-escritorio.png` });
    await p.click('#tabs-ficha button[data-tab="consentimientos"]');
    await p.waitForSelector('#panel-tab .ficha-split #generar-ci', { timeout: 15000 });
    await p.screenshot({ path: `${capturas}\\32-consentimientos-escritorio.png` });
    await p.setViewport({ width: 390, height: 844 });
    await p.goto(`${entorno.base}/paciente.html?id=${encodeURIComponent(adulto.id)}`, {
      waitUntil: 'domcontentloaded',
    });
    await p.waitForSelector('#form-datos', { timeout: 20000 });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2),
      false
    );
    await p.screenshot({ path: `${capturas}\\26-medico-movil.png` });
    console.log('✓ 9. Búsqueda, 9 pestañas y ficha sin desbordamiento en móvil');

    // 10. Errores visibles, accesibilidad y auditoría.
    await p.setViewport({ width: 1440, height: 900 });
    await p.waitForSelector('#form-datos', { timeout: 20000 });
    await p.evaluate(() => {
      const nombres = document.querySelector('[name="nombres"]');
      nombres.value = '';
      nombres.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await p.click('#form-datos button[type="submit"]');
    await p.waitForFunction(() => document.querySelector('#error-datos')?.hidden === false, {
      timeout: 10000,
    });
    const errorVisible = await p.evaluate(() => ({
      texto: document.querySelector('#error-datos')?.innerText || '',
      aria: document.querySelector('[name="nombres"]')?.getAttribute('aria-invalid'),
    }));
    assert.match(errorVisible.texto, /obligatorios/i);
    assert.equal(errorVisible.aria, 'true');

    const dbAuditoria = new DatabaseSync(entorno.dbFile);
    const acciones = dbAuditoria
      .prepare("SELECT DISTINCT accion FROM audit_log WHERE accion IN ('consulta_finalizada','receta_guardada','pedido_creado','certificado_creado','addenda_creada','documento_creado')")
      .all()
      .map((fila) => fila.accion);
    dbAuditoria.close();
    for (const accion of ['consulta_finalizada', 'receta_guardada', 'pedido_creado', 'certificado_creado', 'addenda_creada']) {
      assert.ok(acciones.includes(accion), `Falta auditoría: ${accion}`);
    }
    console.log('✓ 10. Errores visibles, aria-invalid y auditoría completa');

    assert.equal(errores.length, 0, errores.join(' | '));
    console.log('');
    console.log('10/10 ESCENARIOS DE USABILIDAD MÉDICA COMPLETADOS');
  } finally {
    await navegador.close();
    await entorno.limpiar();
    rmSync(dataTest, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('E2E DE USABILIDAD MÉDICA FALLÓ:', error.message);
  process.exitCode = 1;
});
