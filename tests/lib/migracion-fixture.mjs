import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Resuelve el dump de migración para las pruebas.
 *
 * Si existe `old_db.sql` en la raíz se usa el dump real (comportamiento
 * actual). En worktree/CI sin ese archivo se usa el fixture sintético
 * versionado bajo `tests/fixtures/migracion/`. Nunca se copia el dump real.
 */
export const DUMP_REAL = resolve(import.meta.dirname, '..', '..', 'old_db.sql');
export const DUMP_FIXTURE = resolve(
  import.meta.dirname,
  '..',
  'fixtures',
  'migracion',
  'old_db_fixture.sql'
);

export function resolverDumpMigracion() {
  const existeReal = existsSync(DUMP_REAL);
  const ruta = existeReal ? DUMP_REAL : DUMP_FIXTURE;
  if (!existsSync(ruta)) {
    throw new Error(
      `No se encontró old_db.sql ni el fixture de migración: ${DUMP_FIXTURE}`
    );
  }
  return {
    ruta,
    esFixture: !existeReal,
    nombre: existeReal ? 'old_db.sql' : 'tests/fixtures/migracion/old_db_fixture.sql',
  };
}

/** Comprueba que el fallback es el fixture y que no se copió el dump real. */
export function comprobarOrigenDump(origen) {
  if (origen.esFixture) {
    if (origen.ruta !== DUMP_FIXTURE) {
      throw new Error('El fallback de migración debe usar el fixture versionado');
    }
    if (existsSync(DUMP_REAL)) {
      throw new Error('El fixture no debe usarse si old_db.sql está disponible');
    }
  } else if (origen.ruta !== DUMP_REAL) {
    throw new Error('Con old_db.sql disponible debe usarse el dump real');
  }
  return origen;
}
