import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/**
 * Prueba focalizada de la migración de datos `agenda.motivos`.
 *
 * Se ejecuta sobre una copia temporal (nunca sobre data/ ni producción):
 * 1. crea una base sembrada y le quita el permiso/marker para simular la
 *    instalación anterior;
 * 2. respalda la copia antes de migrar;
 * 3. arranca el inicializador, que aplica la migración aditiva;
 * 4. compara conteos old → new, comprueba idempotencia, FK e integridad;
 * 5. verifica que el respaldo conserva el estado anterior.
 */

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporal = mkdtempSync(join(tmpdir(), 'isim-migracion-motivos-'));
const dbFile = resolve(temporal, 'migracion.db');
const respaldo = resolve(temporal, 'respaldo-pre-migracion.db');
const dataDir = temporal;

function inicializar({ semilla = false } = {}) {
  const guion = `
    await import('./server/db/index.js');
    if (${semilla ? 'true' : 'false'}) {
      const { ensureSeed } = await import('./server/db/seed.js');
      ensureSeed();
    }
  `;
  const resultado = spawnSync(process.execPath, ['--input-type=module', '-e', guion], {
    cwd: raiz,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      DB_FILE: dbFile,
      ISIM_SEMILLA: semilla ? '1' : '0',
    },
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(
    resultado.status,
    0,
    `El inicializador falló:\n${resultado.stdout}\n${resultado.stderr}`
  );
  return `${resultado.stdout}\n${resultado.stderr}`;
}

function abrir() {
  return new DatabaseSync(dbFile);
}

function foto(db) {
  const permisos = db
    .prepare('SELECT role_slug, permiso FROM role_permissions ORDER BY role_slug, permiso')
    .all()
    .map((fila) => `${fila.role_slug}|${fila.permiso}`);
  const porRol = Object.fromEntries(
    db
      .prepare('SELECT role_slug, COUNT(*) AS total FROM role_permissions GROUP BY role_slug')
      .all()
      .map((fila) => [fila.role_slug, fila.total])
  );
  return {
    permisos,
    porRol,
    columnas: db
      .prepare('PRAGMA table_info(role_permissions)')
      .all()
      .map((columna) => `${columna.name}:${columna.type}:${columna.notnull}`),
    fk: db.prepare('PRAGMA foreign_key_check').all(),
    integridad: db.prepare('PRAGMA integrity_check').get()?.integrity_check,
  };
}

try {
  console.log(`Copia temporal: ${temporal}`);

  // 1. Base inicial con roles del sistema y todas las migraciones actuales.
  inicializar({ semilla: true });
  const inicial = abrir();
  let antes;
  try {
    assert.ok(
      inicial
        .prepare("SELECT 1 FROM settings WHERE clave = 'migracion_permiso_agenda_motivos_v1'")
        .get(),
      'La base recién creada debe tener el marker de la migración'
    );

    // Simula una instalación anterior: sin marker y sin el permiso nuevo.
    inicial
      .prepare("DELETE FROM settings WHERE clave = 'migracion_permiso_agenda_motivos_v1'")
      .run();
    const borrados = inicial
      .prepare("DELETE FROM role_permissions WHERE permiso = 'agenda.motivos'")
      .run();
    assert.ok(Number(borrados.changes) >= 3, 'Debe quitarse el permiso de los roles sembrados');

    // Respaldo previo (copia consistente, ya sin el permiso nuevo).
    inicial.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    antes = foto(inicial);
    assert.equal(antes.integridad, 'ok');
    assert.deepEqual(antes.fk, []);
    assert.ok(antes.permisos.every((fila) => !fila.endsWith('|agenda.motivos')));
  } finally {
    inicial.close();
  }

  copyFileSync(dbFile, respaldo);
  assert.ok(existsSync(respaldo), 'Debe existir el respaldo previo a la migración');
  const copiaRespaldo = new DatabaseSync(respaldo, { readOnly: true });
  try {
    assert.deepEqual(
      foto(copiaRespaldo).permisos,
      antes.permisos,
      'El respaldo debe conservar exactamente los permisos anteriores'
    );
  } finally {
    copiaRespaldo.close();
  }
  console.log('✓ Respaldo previo con el estado anterior');

  // 2. Primera ejecución de la migración sobre la copia.
  const salida = inicializar();
  const despuesConexion = abrir();
  let despues;
  try {
    despues = foto(despuesConexion);
    assert.ok(
      despuesConexion
        .prepare("SELECT 1 FROM settings WHERE clave = 'migracion_permiso_agenda_motivos_v1'")
        .get(),
      'El marker se guarda solo después de aplicar la migración'
    );

    const nuevos = despues.permisos.filter((fila) => !antes.permisos.includes(fila));
    assert.deepEqual(
      nuevos.toSorted(),
      [
        'admin|agenda.motivos',
        'enfermero|agenda.motivos',
        'operador|agenda.motivos',
      ],
      'Solo se agregan las tres filas nuevas esperadas'
    );
    assert.ok(
      antes.permisos.every((fila) => despues.permisos.includes(fila)),
      'Ningún permiso existente se borra ni se reemplaza'
    );
    assert.equal(
      despues.permisos.length,
      antes.permisos.length + 3,
      'El total aumenta exactamente en las tres filas nuevas'
    );
    for (const rol of ['admin', 'operador', 'enfermero']) {
      assert.equal(
        despues.porRol[rol],
        (antes.porRol[rol] || 0) + 1,
        `${rol} recibe exactamente una fila nueva`
      );
    }
    for (const rol of ['medico', 'lectura']) {
      assert.equal(despues.porRol[rol], antes.porRol[rol], `${rol} no cambia`);
      assert.ok(
        !despues.permisos.includes(`${rol}|agenda.motivos`),
        `${rol} no debe recibir agenda.motivos`
      );
    }
    assert.deepEqual(despues.columnas, antes.columnas, 'No cambia el esquema de la tabla');
    assert.deepEqual(despues.fk, [], 'foreign_key_check debe quedar en 0 filas');
    assert.equal(despues.integridad, 'ok', 'integrity_check debe ser ok');
    assert.match(salida, /migración aplicada: permiso agenda\.motivos/i);
  } finally {
    despuesConexion.close();
  }
  console.log('✓ Migración aditiva: 3 filas nuevas, conteos y FK/integridad correctos');

  // 3. Segunda ejecución: idempotente, sin filas nuevas ni cambios.
  inicializar();
  const segundaConexion = abrir();
  try {
    const segunda = foto(segundaConexion);
    assert.deepEqual(
      segunda.permisos,
      despues.permisos,
      'La segunda ejecución no debe cambiar los permisos'
    );
    assert.deepEqual(segunda.porRol, despues.porRol);
    assert.deepEqual(segunda.fk, []);
    assert.equal(segunda.integridad, 'ok');
    assert.equal(
      segundaConexion
        .prepare(
          "SELECT COUNT(*) AS n FROM role_permissions WHERE permiso = 'agenda.motivos'"
        )
        .get().n,
      3,
      'No se duplican filas por el PRIMARY KEY compuesto'
    );
  } finally {
    segundaConexion.close();
  }
  console.log('✓ Segunda ejecución idempotente sin duplicados');

  console.log('');
  console.log('MIGRACIÓN DE PERMISO AGENDA.MOTIVOS OK');
  console.log(
    JSON.stringify(
      {
        copia: temporal,
        respaldo: respaldo,
        filasAgregadas: ['admin', 'operador', 'enfermero'],
        rolesSinCambio: ['medico', 'lectura'],
        foreignKeyCheck: 0,
        integrityCheck: 'ok',
        idempotente: true,
      },
      null,
      2
    )
  );
} finally {
  rmSync(temporal, { recursive: true, force: true });
}
