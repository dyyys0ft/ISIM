import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Secretario/a: solo agenda y admisión.
 * Administrador: acceso total.
 */
const entorno = await crearEntornoE2E();
try {
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

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
    await p.setViewport({ width: 1440, height: 900 });
    await p.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-ingresar');
    await p.type('#login-usuario', 'recepcion');
    await p.type('#login-password', '1236');
    await p.click('#btn-ingresar');
    await p.waitForFunction(() => location.pathname === '/agenda.html');
    await p.waitForSelector('.top .nav', { timeout: 20000 });

    const menu = await p.evaluate(() => ({
      items: [...document.querySelectorAll('.top .nav > a, .top .nav > details > summary')].map(
        (nodo) => nodo.textContent.trim()
      ),
      grupos: Object.fromEntries(
        [...document.querySelectorAll('.top .nav details')].map((detalle) => [
          detalle.querySelector('summary')?.textContent.trim(),
          [...detalle.querySelectorAll('.nav-panel a')].map((a) => a.textContent.trim()),
        ])
      ),
    }));
    assert.deepEqual(menu.items, ['Agenda', 'Mi cuenta']);
    assert.equal(menu.grupos.Documentos, undefined);
    assert.equal(menu.grupos['Ajustes del sistema'], undefined);

    const accesos = await p.evaluate(async () => {
      const estado = async (ruta) => (await fetch(ruta, { credentials: 'same-origin' })).status;
      return {
        citas: await estado('/api/appointments'),
        pacientes: await estado('/api/patients'),
        documentos: await estado('/api/documents'),
        historias: await estado('/api/clinical-records'),
        ajustes: await estado('/api/settings'),
      };
    });
    assert.equal(accesos.citas, 200);
    assert.equal(accesos.pacientes, 200);
    assert.equal(accesos.documentos, 403);
    assert.equal(accesos.historias, 403);
    assert.equal(accesos.ajustes, 403);
    console.log('✓ Secretario/a: menú Agenda, admisión y citas; sin documentos, historias ni ajustes');

    // Administrador: acceso total, incluso a módulos restringidos al secretario.
    const total = await admin('/api/auth/me');
    assert.ok(total.permisos.includes('documentos.ver'));
    assert.ok(total.permisos.includes('historias.gestionar'));
    assert.ok(total.permisos.includes('usuarios.gestionar'));

    for (const ruta of [
      '/api/documents',
      '/api/clinical-history/patients?limit=1',
      '/api/settings',
      '/api/users',
    ]) {
      const respuesta = await admin(ruta);
      assert.ok(respuesta !== undefined, `El administrador debe leer ${ruta}`);
    }
    console.log('✓ Administrador: permisos y endpoints completos');
  } finally {
    await navegador.close();
  }
  console.log('');
  console.log('PERMISOS DE SECRETARIO/A Y ADMIN OK');
} finally {
  await entorno.limpiar();
}
