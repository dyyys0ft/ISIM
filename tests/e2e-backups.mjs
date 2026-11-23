import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de respaldos cifrados.
 *
 * Configura un directorio temporal, genera respaldos solo de la base y con
 * todas las carpetas, comprueba el cifrado, la verificación, la detección de
 * archivos alterados y la retención.
 */

const sello = Date.now();
const DATA_DIR = resolve('data', `e2e-backups-${sello}`);
mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;

let entorno = null;

function directorioRespaldos() {
  return resolve(DATA_DIR, 'respaldos-test');
}

async function configurar(admin, cambios) {
  return admin('/api/settings/backups/config', {
    method: 'POST',
    body: {
      directorio: directorioRespaldos(),
      frecuencia: 'diario',
      hora: '22:00',
      dia: 1,
      conservar: 14,
      incluirFirmas: false,
      incluirHistorias: false,
      incluirConfiguracion: false,
      ...cambios,
    },
  });
}

async function main() {
  // Archivos de prueba en las carpetas que se pueden respaldar.
  mkdirSync(resolve(DATA_DIR, 'firmas'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'historias', 'shard'), { recursive: true });
  mkdirSync(resolve(DATA_DIR, 'sistema'), { recursive: true });
  writeFileSync(resolve(DATA_DIR, 'firmas', 'firma-prueba.png'), Buffer.from('firma-secreta'));
  writeFileSync(resolve(DATA_DIR, 'historias', 'shard', 'examen.pdf'), Buffer.from('%PDF-prueba'));
  writeFileSync(resolve(DATA_DIR, 'sistema', 'logo.png'), Buffer.from('logo-prueba'));

  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  // 1. Solo la base de datos.
  let estado = await configurar(admin, {});
  assert.equal(estado.directorio, directorioRespaldos());
  assert.ok(estado.proximoEn, 'Debe calcular el próximo respaldo');
  assert.equal(estado.incluirFirmas, false);

  const soloBase = await admin('/api/settings/backups/run', { method: 'POST', body: {} });
  assert.deepEqual(soloBase.resultado.items, ['base']);
  const archivoBase = resolve(directorioRespaldos(), soloBase.resultado.archivo);
  assert.ok(existsSync(archivoBase));

  const contenidoBase = readFileSync(archivoBase);
  assert.equal(contenidoBase.subarray(0, 7).toString('utf8'), 'ISIMBK2');
  assert.equal(contenidoBase.includes(Buffer.from('SQLite format 3')), false);
  console.log('✓ Respaldo solo de base: cifrado y sin cabecera SQLite visible');

  const verificacionBase = await admin('/api/settings/backups/verify', {
    method: 'POST',
    body: { archivo: soloBase.resultado.archivo },
  });
  assert.equal(verificacionBase.ok, true);
  assert.deepEqual(verificacionBase.manifiesto.items, ['base']);
  assert.equal(verificacionBase.manifiesto.archivos.length, 1);
  console.log('✓ Verificación del respaldo de base correcta');

  // 2. Respaldo completo con carpetas.
  estado = await configurar(admin, {
    incluirFirmas: true,
    incluirHistorias: true,
    incluirConfiguracion: true,
  });
  assert.equal(estado.incluirFirmas, true);

  const completo = await admin('/api/settings/backups/run', { method: 'POST', body: {} });
  const archivoCompleto = resolve(directorioRespaldos(), completo.resultado.archivo);
  const contenidoCompleto = readFileSync(archivoCompleto);
  assert.equal(contenidoCompleto.includes(Buffer.from('firma-secreta')), false);

  const verificacionCompleta = await admin('/api/settings/backups/verify', {
    method: 'POST',
    body: { archivo: completo.resultado.archivo },
  });
  const rutas = verificacionCompleta.manifiesto.archivos.map((archivo) => archivo.ruta);
  assert.ok(rutas.includes('sgcpm.db'));
  assert.ok(rutas.includes('firmas/firma-prueba.png'));
  assert.ok(rutas.includes('historias/shard/examen.pdf'));
  assert.ok(rutas.includes('sistema/logo.png'));
  assert.ok(!rutas.some((ruta) => ruta.startsWith('sistema/https')));
  console.log(`✓ Respaldo completo: ${rutas.length} archivos, sin certificados HTTPS`);

  // 3. Restauración real con el script de consola.
  const restaurado = resolve(DATA_DIR, 'restaurado');
  const script = resolve('server/scripts/restaurar-respaldo.js');
  const ejecucion = spawnSync(
    process.execPath,
    [
      script,
      archivoCompleto,
      restaurado,
      '--clave',
      resolve(DATA_DIR, 'sistema', 'respaldo.key'),
      '--force',
    ],
    { env: { ...process.env }, encoding: 'utf8' }
  );
  assert.equal(ejecucion.status, 0, ejecucion.stderr || ejecucion.stdout);
  assert.ok(existsSync(resolve(restaurado, 'sgcpm.db')));
  assert.equal(
    readFileSync(resolve(restaurado, 'firmas', 'firma-prueba.png'), 'utf8'),
    'firma-secreta'
  );
  assert.equal(
    readFileSync(resolve(restaurado, 'historias', 'shard', 'examen.pdf'), 'utf8'),
    '%PDF-prueba'
  );
  console.log('✓ Restauración del respaldo verificada (base y carpetas)');

  // 4. Un archivo alterado debe fallar la verificación.
  const manipulada = resolve(directorioRespaldos(), 'isim-manipulado.isimbk');
  copyFileSync(archivoCompleto, manipulada);
  const descriptor = openSync(manipulada, 'r+');
  const posicion = Math.floor(statSync(manipulada).size / 2);
  const byte = Buffer.alloc(1);
  readSync(descriptor, byte, 0, 1, posicion);
  byte[0] ^= 0xff;
  writeSync(descriptor, byte, 0, 1, posicion);
  closeSync(descriptor);

  let errorManipulado = null;
  try {
    await admin('/api/settings/backups/verify', {
      method: 'POST',
      body: { archivo: 'isim-manipulado.isimbk' },
    });
  } catch (error) {
    errorManipulado = error;
  }
  assert.ok(errorManipulado && /→ 400:/.test(errorManipulado.message));
  console.log('✓ Archivo alterado rechazado por la verificación');

  // 4. Retención: conservar solo una copia.
  await configurar(admin, {
    incluirFirmas: true,
    incluirHistorias: true,
    incluirConfiguracion: true,
    conservar: 1,
  });
  await admin('/api/settings/backups/run', { method: 'POST', body: {} });

  const restantes = readdirSync(directorioRespaldos()).filter((nombre) =>
    /^isim-.*\.isimbk$/.test(nombre)
  );
  assert.equal(restantes.length, 1, 'La retención debe dejar una sola copia');
  console.log('✓ Retención aplicada: solo queda una copia');

  // 5. Configuración persistida e historial.
  const final = await admin('/api/settings/backups');
  assert.equal(final.directorio, directorioRespaldos());
  assert.equal(final.incluirFirmas, true);
  assert.equal(final.incluirHistorias, true);
  assert.equal(final.incluirConfiguracion, true);
  assert.equal(final.conservar, 1);
  assert.ok(final.huellaClave, 'Debe existir la huella de la clave');
  assert.ok(final.respaldos.length >= 1);
  assert.ok(final.tamanos.total >= final.tamanos.base);
  console.log(`✓ Configuración persistida · clave ${final.huellaClave}`);

  console.log('');
  console.log('E2E DE RESPALDOS CIFRADOS COMPLETADO');
  console.log(
    JSON.stringify(
      {
        directorio: final.directorio,
        respaldoBase: soloBase.resultado.archivo,
        respaldoCompleto: completo.resultado.archivo,
        archivosIncluidos: rutas.length,
        cifradoVerificado: true,
        archivoAlteradoRechazado: true,
        retencion: 1,
        clave: final.huellaClave,
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
  console.error('E2E DE RESPALDOS CIFRADOS FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-60).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await entorno?.limpiar();
  delete process.env.DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
}
