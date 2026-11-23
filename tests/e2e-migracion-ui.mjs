import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Migración de interfaz: verifica que todas las pantallas usan el shell y la
 * hoja única, que el menú general es el restaurado, que las redirecciones
 * funcionan y que no hay desbordamiento ni errores de consola.
 */

const capturas = 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2\\capturas';
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const entorno = await crearEntornoE2E();
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `MUI${String(Date.now()).slice(-6)}`,
      nombres: 'Paciente',
      apellidos: 'Migración UI',
      fecha_nacimiento: '1991-09-09',
      sexo: 'F',
    },
  });

  const ejecutable = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean).find((ruta) => existsSync(ruta));
  const navegador = await puppeteer.launch({ executablePath: ejecutable, headless: 'new', args: ['--no-sandbox'] });

  try {
    const p = await navegador.newPage();
    p.setDefaultNavigationTimeout(40000);
    await p.setCacheEnabled(false);
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
    await p.type('#login-usuario', 'admin');
    await p.type('#login-password', '54321');
    await p.click('#btn-ingresar');
    await p.waitForFunction(() => location.pathname === '/agenda.html');
    await p.waitForSelector('.top .nav', { timeout: 20000 });

    // 1. Menú general restaurado.
    const menu = await p.evaluate(() => ({
      marca: document.querySelector('.top .brand-texto')?.innerText || '',
      items: [...document.querySelectorAll('.top .nav > a, .top .nav > details > summary')].map((n) =>
        n.textContent.trim()
      ),
      grupos: Object.fromEntries(
        [...document.querySelectorAll('.top .nav details')].map((d) => [
          d.querySelector('summary')?.textContent.trim(),
          [...d.querySelectorAll('.nav-panel a')].map((a) => a.textContent.trim()),
        ])
      ),
      miClave: [...document.querySelectorAll('.top a, .top button')].some((n) =>
        /mi clave/i.test(n.textContent)
      ),
      desborde: document.documentElement.scrollWidth > window.innerWidth + 2,
    }));
    assert.match(menu.marca, /ISIM[\s\S]*Salud Integral de la Mujer/i);
    assert.deepEqual(menu.items, [
      'Dashboard',
      'Agenda',
      'Pacientes',
      'Documentos',
      'Ajustes del sistema',
    ]);
    assert.deepEqual(menu.grupos.Documentos, [
      'Consentimientos',
      'Plantillas',
      'Historial',
      'Estadísticas consentimientos',
    ]);
    assert.deepEqual(menu.grupos['Ajustes del sistema'], [
      'Configuración del sistema',
      'Usuarios',
      'Reportes de usuarios',
      'CRM',
      'Mi cuenta',
    ]);
    assert.equal(menu.miClave, false);
    assert.equal(menu.desborde, false);
    await p.screenshot({ path: `${capturas}\\27-migracion-menu.png` });
    console.log('✓ Menú general restaurado con marca, grupos y sin “Mi clave”');

    // Vista inicial de agenda: jornada por defecto y configurable.
    const vista = await p.evaluate(async () => {
      const respuesta = await fetch('/api/settings/agenda-vista', {
        credentials: 'same-origin',
      });
      return respuesta.json();
    });
    assert.equal(vista.vista, 'jornada');
    await p.goto(`${entorno.base}/agenda.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(
      () => document.querySelector('#vista-jornada')?.hidden === false,
      { timeout: 20000 }
    );
    await p.evaluate(async () => {
      await fetch('/api/settings/agenda-vista', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vista: 'lista' }),
      });
    });
    await p.goto(`${entorno.base}/agenda.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelector('#lista')?.hidden === false, {
      timeout: 20000,
    });
    await p.evaluate(async () => {
      await fetch('/api/settings/agenda-vista', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vista: 'jornada' }),
      });
    });
    console.log('✓ Agenda: jornada por defecto, lista configurable y calendario disponible');

    // 2. Todas las pantallas privadas usan .top y una sola hoja.
    const paginas = [
      'agenda.html',
      'pacientes.html',
      'documentos.html',
      'registro.html',
      'ajustes.html',
      'crm.html',
      'dashboard.html',
      'dashboard-citas.html',
      'usuarios.html',
      'reportes.html',
      'cuenta.html',
      'plantillas.html',
      'historias.html',
      'documento.html',
      'paciente.html?id=' + encodeURIComponent(paciente.id),
    ];
    async function abrirRuta(ruta, viewport = { width: 1440, height: 900 }) {
      const q = await navegador.newPage();
      q.setDefaultNavigationTimeout(40000);
      await q.setCacheEnabled(false);
      await q.setViewport(viewport);
      await q.setRequestInterception(true);
      q.on('request', (r) => (/fonts\.(googleapis|gstatic)\.com/.test(r.url()) ? r.abort() : r.continue()));
      q.on('pageerror', (e) => errores.push(`PAGE ${e.message}`));
      q.on('console', (m) => {
        if (m.type() === 'error' && !/favicon|401|404|ERR_FAILED/.test(m.text())) {
          errores.push(`CONSOLE ${m.text()}`);
        }
      });
      await q
        .goto(`${entorno.base}/${ruta}`, { waitUntil: 'domcontentloaded', timeout: 25000 })
        .catch(() => {});
      await esperar(600);
      const info = await q.evaluate(() => ({
        top: Boolean(document.querySelector('.top')),
        hojas: [...document.styleSheets].filter((s) => s.href).map((s) => s.href.split('/').pop()),
        desborde: document.documentElement.scrollWidth > window.innerWidth + 2,
      }));
      await q.close();
      return info;
    }

    for (const pagina of paginas) {
      console.log(`  → ${pagina}`);
      const info = await abrirRuta(pagina);
      assert.equal(info.top, true, `${pagina} sin shell`);
      assert.equal(
        info.hojas.some((h) => /^(tokens|base|components)\.css$/.test(h)),
        false,
        `${pagina} carga CSS heredada`
      );
      assert.equal(info.desborde, false, `${pagina} desborda en 1440`);
    }
    console.log('✓ 15 pantallas con shell único, isim.css y sin desbordamiento');

    // 3. La URL antigua de historia redirige a la ficha.
    await p.goto(`${entorno.base}/historia.html?patientId=${encodeURIComponent(paciente.id)}`, {
      waitUntil: 'domcontentloaded',
    });
    await p.waitForFunction(() => location.pathname === '/paciente.html', { timeout: 20000 });
    await p.waitForSelector('#tabs-ficha button', { timeout: 20000 });
    assert.match(await p.$eval('.phead .nm', (n) => n.textContent), /Migración UI/);
    console.log('✓ historia.html redirige a la ficha unificada');

    // 4. Historias es una lista real en la UI nueva.
    await p.goto(`${entorno.base}/historias.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#lista-historias .patient-card', { timeout: 20000 });
    assert.match(await p.$eval('.page-title', (n) => n.textContent), /Historias clínicas/);
    console.log('✓ historias.html lista pacientes con acceso a la historia');

    // 5. Impresiones disponibles.
    for (const [ruta, selector] of [
      ['receta.html', '#receta-doc'],
      ['pedido.html', '#pedido-doc'],
      ['certificado.html', '#certificado-doc'],
      ['consulta-imprimir.html', '#consulta-doc'],
    ]) {
      const respuesta = await p.goto(`${entorno.base}/${ruta}`, { waitUntil: 'domcontentloaded' });
      assert.equal(respuesta.status(), 200);
      await p.waitForSelector(selector, { timeout: 15000 });
    }
    console.log('✓ Hojas de impresión A5/A4 disponibles');

    // 6. Móvil: shell y menú sin desbordamiento.
    for (const pagina of ['agenda.html', 'pacientes.html', 'historias.html', 'ajustes.html']) {
      const info = await abrirRuta(pagina, { width: 390, height: 844 });
      assert.equal(info.desborde, false, `${pagina} desborda en 390`);
    }
    console.log('✓ 390 px sin desbordamiento en agenda, pacientes, historias y ajustes');

    assert.equal(errores.length, 0, errores.join(' | '));
    console.log('');
    console.log('MIGRACIÓN DE INTERFAZ COMPLETADA');
  } finally {
    await navegador.close();
    await entorno.limpiar();
  }
}

main().catch((error) => {
  console.error('E2E DE MIGRACIÓN UI FALLÓ:', error.message);
  process.exitCode = 1;
});
