import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extraerRespaldo } from '../lib/backups.js';

/**
 * Restaura un respaldo cifrado de ISIM.
 *
 * Uso:
 *   node server/scripts/restaurar-respaldo.js <archivo.isimbk> <carpeta-destino> \
 *     [--clave <isim-respaldo.key>] [--force]
 *
 * Por defecto usa la clave del servidor en data/sistema/respaldo.key.
 */

const argumentos = process.argv.slice(2);
const posicionales = argumentos.filter((valor) => !valor.startsWith('--'));
const indiceClave = argumentos.indexOf('--clave');
const force = argumentos.includes('--force');

const [archivo, destino] = posicionales;

if (!archivo || !destino) {
  console.error(
    'Uso: node server/scripts/restaurar-respaldo.js <archivo.isimbk> <carpeta-destino> [--clave <archivo.key>] [--force]'
  );
  process.exit(1);
}

let clave = null;
if (indiceClave >= 0) {
  const rutaClave = argumentos[indiceClave + 1];
  if (!rutaClave) {
    console.error('Falta la ruta de la clave después de --clave');
    process.exit(1);
  }
  const contenido = readFileSync(resolve(rutaClave), 'utf8');
  const linea = contenido
    .split(/\r?\n/)
    .map((texto) => texto.trim())
    .filter((texto) => texto && !texto.startsWith('#'))
    .at(-1);
  clave = Buffer.from(linea || '', 'base64');
  if (clave.length !== 32) {
    console.error('La clave indicada no es válida');
    process.exit(1);
  }
}

try {
  const resultado = await extraerRespaldo(resolve(archivo), resolve(destino), {
    clave,
    force,
  });

  console.log('');
  console.log('RESPALDO RESTAURADO');
  console.log(`  Archivo : ${resolve(archivo)}`);
  console.log(`  Destino : ${resolve(destino)}`);
  console.log(`  Creado  : ${resultado.manifiesto.creado || '—'}`);
  console.log(`  Items   : ${(resultado.manifiesto.items || []).join(', ')}`);
  console.log(`  Archivos: ${resultado.extraidos.length}`);
  for (const extraido of resultado.extraidos) console.log(`    - ${extraido}`);
  console.log('');
  console.log('La base restaurada queda como sgcpm.db dentro del destino.');
  console.log('Para usarla, detén el sistema y reemplaza data/sgcpm.db con la copia.');
} catch (error) {
  console.error('');
  console.error('NO SE PUDO RESTAURAR:', error.message);
  process.exit(1);
}
