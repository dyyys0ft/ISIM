import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guard de evolución de la base de datos.
 *
 * Regla del proyecto:
 * 1. no romper relaciones existentes;
 * 2. no alterar FK, PK ni CHECK existentes;
 * 3. solo agregar tablas, columnas opcionales, índices y relaciones nuevas.
 *
 * Las migraciones históricas que reconstruyeron tablas están marcadas con
 * LEGACY-EXCEPTION y son la única excepción permitida.
 */

const raiz = resolve(import.meta.dirname, '..');
const archivos = [
  resolve(raiz, 'server/db/index.js'),
  resolve(raiz, 'server/db/schema.sql'),
  resolve(raiz, 'server/db/seed.js'),
  ...readdirSync(resolve(raiz, 'server/lib/migracion'))
    .filter((nombre) => nombre.endsWith('.js'))
    .map((nombre) => resolve(raiz, 'server/lib/migracion', nombre)),
];

const patrones = [
  ['DROP TABLE', /\bDROP\s+TABLE\b/i],
  ['DROP VIEW', /\bDROP\s+VIEW\b/i],
  ['DROP COLUMN', /\bDROP\s+COLUMN\b/i],
  ['DROP INDEX', /\bDROP\s+INDEX\b/i],
  ['RENAME TO', /\bRENAME\s+TO\b/i],
  ['PRAGMA foreign_keys = OFF', /PRAGMA\s+foreign_keys\s*=\s*OFF/i],
  ['PRAGMA legacy_alter_table = ON', /PRAGMA\s+legacy_alter_table\s*=\s*ON/i],
  ['CREATE TABLE *_nuevo', /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?\w+_nuevo/i],
  ['reconstruirTablaSinVistas(...)', /reconstruirTablaSinVistas\s*\(\s*['"]/],
];

const INICIO = /\/\/ LEGACY-EXCEPTION: ([^\n]+)/g;
const FIN = /\/\/ END-LEGACY-EXCEPTION/g;

let excepciones = 0;
const fallos = [];

for (const archivo of archivos) {
  const texto = readFileSync(archivo, 'utf8');
  const inicios = [...texto.matchAll(INICIO)];
  const fines = [...texto.matchAll(FIN)];
  excepciones += inicios.length;

  assert.equal(
    inicios.length,
    fines.length,
    `${archivo}: bloques LEGACY-EXCEPTION sin cierre`
  );

  for (const inicio of inicios) {
    assert.ok(
      inicio[1].trim().length >= 6,
      `${archivo}: la excepción debe tener un identificador`
    );
  }

  const limpio = texto.replace(/\/\/ LEGACY-EXCEPTION:[\s\S]*?\/\/ END-LEGACY-EXCEPTION/g, '');

  for (const [nombre, patron] of patrones) {
    const coincidencia = patron.exec(limpio);
    if (!coincidencia) continue;
    const linea = limpio.slice(0, coincidencia.index).split('\n').length;
    fallos.push(`${archivo}:${linea}: ${nombre}`);
  }
}

assert.equal(
  fallos.length,
  0,
  `Migraciones destructivas fuera de LEGACY-EXCEPTION:\n${fallos.join('\n')}`
);
assert.ok(excepciones >= 5, 'Deben existir las excepciones históricas documentadas');

const schema = readFileSync(resolve(raiz, 'server/db/schema.sql'), 'utf8');
assert.match(schema, /PRAGMA\s+foreign_keys\s*=\s*ON/i, 'schema.sql debe activar las FK');

console.log(`✓ ${archivos.length} archivos revisados`);
console.log(`✓ ${excepciones} excepciones históricas marcadas y justificadas`);
console.log('✓ Sin DROP, RENAME, PRAGMA OFF ni reconstrucciones fuera de excepciones');
console.log('REGLA DE EVOLUCIÓN DE BD OK');
