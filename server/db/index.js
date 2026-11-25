import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { moduloDe, tipoAccionDe } from '../lib/auditTaxonomy.js';
import {
  esUsernameValido,
  hashSecret,
  normalizarUsername,
  usernameDesdeNombre,
} from '../lib/passwords.js';

export const db = new DatabaseSync(config.dbFile);

// Búsquedas de pacientes sin distinguir mayúsculas ni tildes.
db.function('sin_tildes', (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
);

// Configuración para varios usuarios simultáneos:
// - WAL permite leer mientras otro usuario escribe.
// - busy_timeout hace que SQLite espere en lugar de fallar con "database is locked".
// - synchronous NORMAL es seguro con WAL y más rápido que FULL.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 15000;');
db.exec('PRAGMA wal_autocheckpoint = 1000;');
db.exec('PRAGMA journal_size_limit = 67108864;');
db.exec('PRAGMA temp_store = MEMORY;');
db.exec('PRAGMA cache_size = -20000;');
db.exec(readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8'));

// La lista blanca de IPs puede venir de una versión anterior sin estos campos.
const columnasIps = new Set(
  db.prepare('PRAGMA table_info(ips_permitidas)').all().map((columna) => columna.name)
);
for (const [nombre, tipo] of [
  ['mac', 'TEXT'],
  ['ultimo_acceso_en', 'TEXT'],
  ['accesos', 'INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!columnasIps.has(nombre)) {
    db.exec(`ALTER TABLE ips_permitidas ADD COLUMN ${nombre} ${tipo};`);
  }
}

// Los consentimientos nuevos se enlazan a la cita que los originó.
const columnasDocumentosCita = new Set(
  db.prepare('PRAGMA table_info(documents)').all().map((columna) => columna.name)
);
if (!columnasDocumentosCita.has('appointment_id')) {
  db.exec(
    'ALTER TABLE documents ADD COLUMN appointment_id TEXT REFERENCES appointments(id);'
  );
}
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_documents_appointment ON documents(appointment_id);'
);

// Campos de la nueva UI ISIM en columnas reales (además del JSON de respaldo).
function agregarColumnas(tabla, definiciones) {
  const existentes = new Set(
    db.prepare(`PRAGMA table_info(${tabla})`).all().map((columna) => columna.name)
  );
  for (const [nombre, tipo] of definiciones) {
    if (!existentes.has(nombre)) {
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${tipo};`);
    }
  }
}

agregarColumnas('clinical_records', [
  ['datos', 'TEXT'],
  ['enfermedad_actual', 'TEXT'],
  ['pa_sis', 'TEXT'],
  ['pa_dia', 'TEXT'],
  ['fc', 'TEXT'],
  ['fr', 'TEXT'],
  ['temp', 'TEXT'],
  ['sat', 'TEXT'],
  ['peso', 'TEXT'],
  ['talla', 'TEXT'],
  ['imc', 'TEXT'],
  ['fum', 'TEXT'],
  ['embarazo', 'INTEGER NOT NULL DEFAULT 0'],
  ['eg', 'TEXT'],
  ['fpp', 'TEXT'],
  ['au', 'TEXT'],
  ['fcf', 'TEXT'],
  ['presentacion', 'TEXT'],
  ['edemas', 'TEXT'],
  ['examen_fisico', 'TEXT'],
  ['examen_gineco', 'TEXT'],
  ['plan', 'TEXT'],
  ['proxima_cita', 'TEXT'],
]);

agregarColumnas('prescriptions', [
  ['datos', 'TEXT'],
  ['numero', 'INTEGER'],
  ['diagnostico', 'TEXT'],
  ['cie10', 'TEXT'],
  ['alergias', 'TEXT'],
  ['recomendaciones', 'TEXT'],
  ['para_pareja', 'INTEGER NOT NULL DEFAULT 0'],
  ['anulada_en', 'TEXT'],
  ['anulada_por', 'TEXT'],
  ['motivo_anulacion', 'TEXT'],
]);

agregarColumnas('prescription_items', [['unidad', 'TEXT']]);

agregarColumnas('patients', [
  ['fum', 'TEXT'],
  ['tipo_doc', "TEXT NOT NULL DEFAULT 'cedula'"],
  ['instruccion', 'TEXT'],
  ['nacionalidad', 'TEXT'],
  ['etnia', 'TEXT'],
  ['seguro', 'TEXT'],
  ['parroquia', 'TEXT'],
  ['canton', 'TEXT'],
  ['provincia', 'TEXT'],
  ['contacto_nombre', 'TEXT'],
  ['contacto_parentesco', 'TEXT'],
  ['contacto_telefono', 'TEXT'],
  ['empresa', 'TEXT'],
  ['puesto', 'TEXT'],
  ['hc_numero', 'TEXT'],
  ['ant_personales', 'TEXT'],
  ['ant_quirurgicos', 'TEXT'],
  ['ant_familiares', 'TEXT'],
  ['consentimiento_datos', 'TEXT'],
  ['nota_importante', 'TEXT'],
]);

agregarColumnas('appointments', [
  ['jornada', 'TEXT'],
  ['tipo', "TEXT NOT NULL DEFAULT 'normal'"],
  ['cupo', 'INTEGER NOT NULL DEFAULT 1'],
  ['motivo_grupo', 'TEXT'],
]);

// Motivos de cita iniciales para la nueva agenda.
const totalMotivos = db.prepare('SELECT COUNT(*) AS n FROM motivos_cita').get().n;
if (!totalMotivos) {
  const insertarMotivo = db.prepare(
    `INSERT INTO motivos_cita (id, grupo, motivo, orden, activo, creado_en)
     VALUES (?, ?, ?, ?, 1, ?)`
  );
  const ahoraMotivos = new Date().toISOString();
  [
    ['Consultas', 'Consulta general'],
    ['Consultas', 'Control / seguimiento'],
    ['Consultas', 'Primera vez'],
    ['Estudios', 'Ecografía'],
    ['Estudios', 'Laboratorio'],
    ['Procedimientos', 'Colposcopia'],
    ['Procedimientos', 'Procedimiento ginecológico'],
    ['Emergencias', 'Emergencia'],
  ].forEach(([grupo, motivo], indice) => {
    insertarMotivo.run(
      `motivo-${indice + 1}`,
      grupo,
      motivo,
      indice + 1,
      ahoraMotivos
    );
  });
}

// Rellena las columnas nuevas a partir del JSON en bases ya existentes.
const textoDato = (valor, max = 5000) =>
  String(valor ?? '').trim().slice(0, max) || null;

try {
  const registros = db
    .prepare(
      `SELECT id, patient_id, datos, embarazo
       FROM clinical_records
       WHERE datos IS NOT NULL AND datos != ''`
    )
    .all();

  const actualizarConsulta = db.prepare(
    `UPDATE clinical_records SET
       enfermedad_actual = COALESCE(enfermedad_actual, ?),
       pa_sis = COALESCE(pa_sis, ?), pa_dia = COALESCE(pa_dia, ?),
       fc = COALESCE(fc, ?), fr = COALESCE(fr, ?), temp = COALESCE(temp, ?),
       sat = COALESCE(sat, ?), peso = COALESCE(peso, ?), talla = COALESCE(talla, ?),
       imc = COALESCE(imc, ?), fum = COALESCE(fum, ?), eg = COALESCE(eg, ?),
       fpp = COALESCE(fpp, ?), au = COALESCE(au, ?), fcf = COALESCE(fcf, ?),
       presentacion = COALESCE(presentacion, ?), edemas = COALESCE(edemas, ?),
       examen_fisico = COALESCE(examen_fisico, ?),
       examen_gineco = COALESCE(examen_gineco, ?),
       plan = COALESCE(plan, ?), proxima_cita = COALESCE(proxima_cita, ?)
     WHERE id = ?`
  );
  const marcarEmbarazo = db.prepare(
    'UPDATE clinical_records SET embarazo = 1 WHERE id = ? AND embarazo = 0'
  );
  const contarDiagnosticos = db.prepare(
    'SELECT COUNT(*) AS n FROM clinical_diagnoses WHERE record_id = ?'
  );
  const insertarDiagnostico = db.prepare(
    `INSERT INTO clinical_diagnoses
       (id, record_id, cie10, descripcion, tipo, orden, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const fila of registros) {
    let datos;
    try {
      datos = JSON.parse(fila.datos);
    } catch {
      continue;
    }
    if (!datos || typeof datos !== 'object') continue;

    actualizarConsulta.run(
      textoDato(datos.enfermedad_actual),
      textoDato(datos.pa_sis, 20),
      textoDato(datos.pa_dia, 20),
      textoDato(datos.fc, 20),
      textoDato(datos.fr, 20),
      textoDato(datos.temp, 20),
      textoDato(datos.sat, 20),
      textoDato(datos.peso, 20),
      textoDato(datos.talla, 20),
      textoDato(datos.imc, 20),
      textoDato(datos.fum, 20),
      textoDato(datos.eg, 80),
      textoDato(datos.fpp, 20),
      textoDato(datos.au, 20),
      textoDato(datos.fcf, 20),
      textoDato(datos.presentacion, 120),
      textoDato(datos.edemas, 200),
      textoDato(datos.examen_fisico),
      textoDato(datos.examen_gineco),
      textoDato(datos.plan),
      textoDato(datos.proxima_cita, 20),
      fila.id
    );
    if (datos.embarazo) marcarEmbarazo.run(fila.id);

    if (Array.isArray(datos.diagnosticos) && contarDiagnosticos.get(fila.id).n === 0) {
      datos.diagnosticos.forEach((item, indice) => {
        const cie = textoDato(item?.cie, 20);
        const descripcion = textoDato(item?.desc, 500);
        if (!cie && !descripcion) return;
        insertarDiagnostico.run(
          `${fila.id}-dx-${indice + 1}`,
          fila.id,
          cie,
          descripcion,
          item?.tipo === 'DEF' ? 'DEF' : 'PRE',
          indice + 1,
          new Date().toISOString()
        );
      });
    }
  }

  const recetas = db
    .prepare(
      `SELECT id, datos FROM prescriptions
       WHERE datos IS NOT NULL AND datos != ''`
    )
    .all();
  const actualizarReceta = db.prepare(
    `UPDATE prescriptions SET
       diagnostico = COALESCE(diagnostico, ?),
       cie10 = COALESCE(cie10, ?),
       alergias = COALESCE(alergias, ?),
       recomendaciones = COALESCE(recomendaciones, ?)
     WHERE id = ?`
  );
  const marcarPareja = db.prepare(
    'UPDATE prescriptions SET para_pareja = 1 WHERE id = ? AND para_pareja = 0'
  );

  for (const fila of recetas) {
    let datos;
    try {
      datos = JSON.parse(fila.datos);
    } catch {
      continue;
    }
    if (!datos || typeof datos !== 'object') continue;
    actualizarReceta.run(
      textoDato(datos.diagnostico),
      textoDato(datos.cie, 40),
      textoDato(datos.alergias),
      textoDato(datos.recomendaciones),
      fila.id
    );
    if (datos.para_pareja) marcarPareja.run(fila.id);
  }

  // Numeración consecutiva para recetas creadas antes de la nueva UI.
  const recetasSinNumero = db
    .prepare('SELECT id FROM prescriptions WHERE numero IS NULL ORDER BY creado_en ASC')
    .all();
  let siguienteNumero = db
    .prepare('SELECT COALESCE(MAX(numero), 0) AS n FROM prescriptions')
    .get().n;
  const asignarNumero = db.prepare('UPDATE prescriptions SET numero = ? WHERE id = ?');
  for (const fila of recetasSinNumero) {
    siguienteNumero += 1;
    asignarNumero.run(siguienteNumero, fila.id);
  }

  // Completa diagnóstico, CIE-10, alergias y recomendaciones desde la historia.
  const recetasIncompletas = db
    .prepare(
      `SELECT pr.id, pr.record_id,
              cr.diagnostico AS cr_diagnostico,
              cr.recomendaciones AS cr_recomendaciones,
              p.alergias AS paciente_alergias,
              (SELECT cd.cie10 FROM clinical_diagnoses cd
               WHERE cd.record_id = pr.record_id
               ORDER BY CASE WHEN cd.tipo = 'DEF' THEN 0 ELSE 1 END, cd.orden ASC
               LIMIT 1) AS dx_cie
       FROM prescriptions pr
       JOIN clinical_records cr ON cr.id = pr.record_id
       JOIN patients p ON p.id = pr.patient_id
       WHERE pr.diagnostico IS NULL OR pr.cie10 IS NULL
          OR pr.alergias IS NULL OR pr.recomendaciones IS NULL`
    )
    .all();
  const completarReceta = db.prepare(
    `UPDATE prescriptions SET
       diagnostico = COALESCE(diagnostico, ?),
       cie10 = COALESCE(cie10, ?),
       alergias = COALESCE(alergias, ?),
       recomendaciones = COALESCE(recomendaciones, ?)
     WHERE id = ?`
  );
  for (const fila of recetasIncompletas) {
    completarReceta.run(
      textoDato(fila.cr_diagnostico),
      textoDato(fila.dx_cie, 40),
      textoDato(fila.paciente_alergias),
      textoDato(fila.cr_recomendaciones),
      fila.id
    );
  }

  db.prepare(
    `UPDATE patients SET fum = (
       SELECT cr.fum FROM clinical_records cr
       WHERE cr.patient_id = patients.id AND cr.fum IS NOT NULL AND cr.fum != ''
       ORDER BY cr.fecha DESC LIMIT 1
     )
     WHERE fum IS NULL
       AND EXISTS (
         SELECT 1 FROM clinical_records cr
         WHERE cr.patient_id = patients.id AND cr.fum IS NOT NULL AND cr.fum != ''
       )`
  ).run();
} catch (error) {
  console.error('[db] No se pudieron completar los datos de la nueva UI:', error.message);
}

// Permite actualizar únicamente los campos de copia sin romper la inmutabilidad
// del contenido firmado.
db.exec(`
  DROP TRIGGER IF EXISTS trg_signature_no_update;
  CREATE TRIGGER trg_signature_no_update
  BEFORE UPDATE ON signatures
  WHEN OLD.id IS NOT NEW.id
    OR OLD.sign_session_id IS NOT NEW.sign_session_id
    OR OLD.document_id IS NOT NEW.document_id
    OR OLD.version_id IS NOT NEW.version_id
    OR OLD.patient_snapshot IS NOT NEW.patient_snapshot
    OR OLD.user_snapshot IS NOT NEW.user_snapshot
    OR OLD.gestionado_por IS NOT NEW.gestionado_por
    OR OLD.gestionado_nombre IS NOT NEW.gestionado_nombre
    OR OLD.gestionado_rol IS NOT NEW.gestionado_rol
    OR OLD.documento_titulo IS NOT NEW.documento_titulo
    OR OLD.firma_png_path IS NOT NEW.firma_png_path
    OR OLD.firma_hash IS NOT NEW.firma_hash
    OR OLD.documento_hash IS NOT NEW.documento_hash
    OR OLD.firmado_en IS NOT NEW.firmado_en
    OR OLD.ip IS NOT NEW.ip
    OR OLD.user_agent IS NOT NEW.user_agent
  BEGIN
    SELECT RAISE(ABORT, 'Una firma no puede modificarse');
  END;
`);

// Migraciones incrementales para bases creadas con versiones anteriores.
const columnasFirma = new Set(
  db.prepare('PRAGMA table_info(signatures)').all().map((columna) => columna.name)
);
for (const [nombre, tipo] of [
  ['gestionado_por', 'TEXT'],
  ['gestionado_nombre', 'TEXT'],
  ['gestionado_rol', 'TEXT'],
  ['documento_titulo', 'TEXT'],
]) {
  if (!columnasFirma.has(nombre)) {
    db.exec(`ALTER TABLE signatures ADD COLUMN ${nombre} ${tipo}`);
  }
}

// Las restricciones CHECK de roles solo se pueden cambiar reconstruyendo la tabla.
const tablaUsuarios = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
  .get();
const columnasUsuarios = new Set(
  db.prepare('PRAGMA table_info(users)').all().map((columna) => columna.name)
);

// LEGACY-EXCEPTION: users-rol-enfermero
// Migración histórica: reconstruyó users para ampliar el CHECK. No repetir.
if (tablaUsuarios && !String(tablaUsuarios.sql).includes("'enfermero'")) {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA legacy_alter_table = ON;');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      CREATE TABLE users_nuevo (
        id                    TEXT PRIMARY KEY,
        nombre                TEXT NOT NULL,
        cedula                TEXT UNIQUE,
        username              TEXT UNIQUE COLLATE NOCASE,
        password_hash         TEXT,
        rol                   TEXT NOT NULL DEFAULT 'operador'
                              CHECK (rol IN ('admin', 'medico', 'operador', 'lectura', 'enfermero')),
        pin_hash              TEXT NOT NULL,
        activo                INTEGER NOT NULL DEFAULT 1,
        firma_png_path        TEXT,
        firma_hash            TEXT,
        firma_actualizada_en  TEXT,
        senecit               TEXT,
        especialidad          TEXT,
        foto_png_path         TEXT,
        foto_actualizada_en   TEXT,
        ultimo_acceso_en      TEXT,
        creado_en             TEXT NOT NULL,
        actualizado_en        TEXT NOT NULL
      )
    `);

    const destino = [
      'id',
      'nombre',
      'cedula',
      'username',
      'password_hash',
      'rol',
      'pin_hash',
      'activo',
      'firma_png_path',
      'firma_hash',
      'firma_actualizada_en',
      'senecit',
      'especialidad',
      'foto_png_path',
      'foto_actualizada_en',
      'ultimo_acceso_en',
      'creado_en',
      'actualizado_en',
    ];
    const origen = destino
      .map((columna) => (columnasUsuarios.has(columna) ? columna : 'NULL'))
      .join(', ');

    db.exec(
      `INSERT INTO users_nuevo (${destino.join(', ')}) SELECT ${origen} FROM users`
    );
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_nuevo RENAME TO users');
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // sin transacción activa
    }
    throw error;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF;');
    db.exec('PRAGMA foreign_keys = ON;');
  }
  console.log('[db] migración aplicada: roles y firma del médico');
}
// END-LEGACY-EXCEPTION

const columnasUsuariosAhora = new Set(
  db.prepare('PRAGMA table_info(users)').all().map((columna) => columna.name)
);
for (const [nombre, tipo] of [
  ['username', 'TEXT'],
  ['password_hash', 'TEXT'],
  ['firma_png_path', 'TEXT'],
  ['firma_hash', 'TEXT'],
  ['firma_actualizada_en', 'TEXT'],
  ['senecit', 'TEXT'],
  ['especialidad', 'TEXT'],
  ['foto_png_path', 'TEXT'],
  ['foto_actualizada_en', 'TEXT'],
  ['ultimo_acceso_en', 'TEXT'],
]) {
  if (!columnasUsuariosAhora.has(nombre)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${nombre} ${tipo}`);
  }
}

// Los roles ahora son dinámicos y viven en la tabla roles. La restricción CHECK
// antigua limitaba users.rol a cinco valores fijos; hay que reconstruir la tabla.
const tablaUsuariosRol = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
  .get();
// LEGACY-EXCEPTION: users-roles-dinamicos
// Migración histórica: reconstruyó users para quitar el CHECK fijo. No repetir.
if (tablaUsuariosRol && /CHECK\s*\(\s*rol\s+IN/i.test(String(tablaUsuariosRol.sql))) {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('PRAGMA legacy_alter_table = ON;');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('DROP TABLE IF EXISTS users_nuevo;');
    db.exec(`
      CREATE TABLE users_nuevo (
        id                    TEXT PRIMARY KEY,
        nombre                TEXT NOT NULL,
        cedula                TEXT UNIQUE,
        username              TEXT UNIQUE COLLATE NOCASE,
        password_hash         TEXT,
        rol                   TEXT NOT NULL DEFAULT 'operador',
        pin_hash              TEXT NOT NULL,
        activo                INTEGER NOT NULL DEFAULT 1,
        firma_png_path        TEXT,
        firma_hash            TEXT,
        firma_actualizada_en  TEXT,
        senecit               TEXT,
        especialidad          TEXT,
        foto_png_path         TEXT,
        foto_actualizada_en   TEXT,
        ultimo_acceso_en      TEXT,
        creado_en             TEXT NOT NULL,
        actualizado_en        TEXT NOT NULL
      );
    `);
    db.exec(`
      INSERT INTO users_nuevo
        (id, nombre, cedula, username, password_hash, rol, pin_hash, activo,
         firma_png_path, firma_hash, firma_actualizada_en, senecit, especialidad,
         foto_png_path, foto_actualizada_en, ultimo_acceso_en, creado_en, actualizado_en)
      SELECT id, nombre, cedula, username, password_hash, rol, pin_hash, activo,
             firma_png_path, firma_hash, firma_actualizada_en, senecit, especialidad,
             foto_png_path, foto_actualizada_en, ultimo_acceso_en, creado_en, actualizado_en
      FROM users;
    `);
    db.exec('DROP TABLE users;');
    db.exec('ALTER TABLE users_nuevo RENAME TO users;');
    db.exec('COMMIT');
    console.log('[db] migración aplicada: roles dinámicos');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // sin transacción abierta
    }
    throw error;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF;');
    db.exec('PRAGMA foreign_keys = ON;');
  }
}
// END-LEGACY-EXCEPTION

// Migración de autenticación: del PIN único a usuario + contraseña.
// La contraseña inicial de cada usuario existente es su PIN anterior.
{
  const usuariosAuth = db
    .prepare('SELECT id, nombre, cedula, username, password_hash, pin_hash FROM users')
    .all();

  if (usuariosAuth.length) {
    const usados = new Set();
    let migrados = 0;

    for (const fila of usuariosAuth) {
      const usernameAnterior = normalizarUsername(fila.username);
      let username = usernameAnterior;

      if (!esUsernameValido(username)) {
        username = usernameDesdeNombre(fila.nombre, fila.cedula);
      }

      const base = username.slice(0, 28);
      let sufijo = 2;
      while (usados.has(username)) {
        username = `${base}.${sufijo}`;
        sufijo += 1;
      }
      usados.add(username);

      const cambioUsuario = username !== usernameAnterior;
      const cambioPassword = !fila.password_hash;

      if (cambioUsuario) {
        db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, fila.id);
        console.log(`[db] usuario de acceso: ${fila.nombre} → ${username}`);
      }

      if (cambioPassword) {
        const hash = fila.pin_hash || hashSecret('Cambiar1234');
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, fila.id);
        migrados += 1;
      }
    }

    if (migrados || usuariosAuth.some((fila) => !fila.username)) {
      console.log(
        `[db] autenticación migrada a usuario y contraseña (${migrados} cuenta(s)). ` +
          'La contraseña inicial es el PIN anterior; cámbiala al ingresar.'
      );
    }
  }

  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);'
  );
}

const columnasPacientesAhora = new Set(
  db.prepare('PRAGMA table_info(patients)').all().map((columna) => columna.name)
);
for (const nombre of [
  'representante1_nombre',
  'representante1_cedula',
  'representante1_parentesco',
  'representante1_telefono',
  'representante2_nombre',
  'representante2_cedula',
  'representante2_parentesco',
  'representante2_telefono',
]) {
  if (!columnasPacientesAhora.has(nombre)) {
    db.exec(`ALTER TABLE patients ADD COLUMN ${nombre} TEXT`);
  }
}
for (const nombre of [
  'consentimiento_evidencia_path',
  'consentimiento_evidencia_mime',
  'consentimiento_evidencia_hash',
  'consentimiento_evidencia_nombre',
  'consentimiento_evidencia_en',
]) {
  if (!columnasPacientesAhora.has(nombre)) {
    db.exec(`ALTER TABLE patients ADD COLUMN ${nombre} TEXT`);
    columnasPacientesAhora.add(nombre);
  }
}
if (!columnasPacientesAhora.has('demo')) {
  db.exec('ALTER TABLE patients ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
}
if (!columnasPacientesAhora.has('datos_incompletos')) {
  db.exec('ALTER TABLE patients ADD COLUMN datos_incompletos INTEGER NOT NULL DEFAULT 0');
}
if (!columnasPacientesAhora.has('datos_incompletos_detalle')) {
  db.exec('ALTER TABLE patients ADD COLUMN datos_incompletos_detalle TEXT');
}
// Datos de embarazo a nivel de paciente (aditivos; no tocan el historial clínico).
if (!columnasPacientesAhora.has('embarazada')) {
  db.exec('ALTER TABLE patients ADD COLUMN embarazada INTEGER NOT NULL DEFAULT 0');
}
if (!columnasPacientesAhora.has('embarazo_nota')) {
  db.exec('ALTER TABLE patients ADD COLUMN embarazo_nota TEXT');
}
for (const columna of ['ocupacion', 'estado_civil', 'ciudad', 'fecha_registro_informacion']) {
  if (!columnasPacientesAhora.has(columna)) {
    db.exec(`ALTER TABLE patients ADD COLUMN ${columna} TEXT`);
  }
}

const columnasDocumentos = new Set(
  db.prepare('PRAGMA table_info(documents)').all().map((columna) => columna.name)
);
const columnasPlantillas = new Set(
  db.prepare('PRAGMA table_info(templates)').all().map((columna) => columna.name)
);
if (!columnasPlantillas.has('firma_modo')) {
  db.exec("ALTER TABLE templates ADD COLUMN firma_modo TEXT NOT NULL DEFAULT 'ambas'");
}
if (!columnasDocumentos.has('medico_firma_path')) {
  db.exec('ALTER TABLE documents ADD COLUMN medico_firma_path TEXT');
}
if (!columnasDocumentos.has('medico_id')) {
  db.exec('ALTER TABLE documents ADD COLUMN medico_id TEXT');
}
if (!columnasDocumentos.has('codigo')) {
  db.exec('ALTER TABLE documents ADD COLUMN codigo TEXT');
}
if (!columnasDocumentos.has('anulado_en')) {
  db.exec('ALTER TABLE documents ADD COLUMN anulado_en TEXT');
}
if (!columnasDocumentos.has('firma_modo')) {
  db.exec("ALTER TABLE documents ADD COLUMN firma_modo TEXT NOT NULL DEFAULT 'ambas'");
}

const columnasFirmasAhora = new Set(
  db.prepare('PRAGMA table_info(signatures)').all().map((columna) => columna.name)
);
for (const [nombre, definicion] of [
  ['copia_solicitada', 'INTEGER NOT NULL DEFAULT 0'],
  ['copia_entregada', 'INTEGER NOT NULL DEFAULT 0'],
  ['copia_actualizada_en', 'TEXT'],
]) {
  if (!columnasFirmasAhora.has(nombre)) {
    db.exec(`ALTER TABLE signatures ADD COLUMN ${nombre} ${definicion}`);
  }
}

const columnasAdjuntosClinicos = new Set(
  db.prepare('PRAGMA table_info(clinical_attachments)').all().map((columna) => columna.name)
);
if (!columnasAdjuntosClinicos.has('exam_id')) {
  db.exec('ALTER TABLE clinical_attachments ADD COLUMN exam_id TEXT');
}
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_clinical_attachments_exam ON clinical_attachments(exam_id);'
);

const columnasHistoriasClinicas = new Set(
  db.prepare('PRAGMA table_info(clinical_records)').all().map((columna) => columna.name)
);
for (const nombre of ['tratamiento', 'receta', 'indicaciones']) {
  if (!columnasHistoriasClinicas.has(nombre)) {
    db.exec(`ALTER TABLE clinical_records ADD COLUMN ${nombre} TEXT`);
  }
}
if (!columnasHistoriasClinicas.has('duracion_estimada_min')) {
  db.exec(
    'ALTER TABLE clinical_records ADD COLUMN duracion_estimada_min INTEGER NOT NULL DEFAULT 30'
  );
}
if (!columnasHistoriasClinicas.has('demo')) {
  db.exec('ALTER TABLE clinical_records ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
}
if (!columnasHistoriasClinicas.has('actualizado_por')) {
  db.exec('ALTER TABLE clinical_records ADD COLUMN actualizado_por TEXT');
}

const columnasExamenesClinicos = new Set(
  db.prepare('PRAGMA table_info(clinical_exams)').all().map((columna) => columna.name)
);
if (!columnasExamenesClinicos.has('tipo')) {
  db.exec("ALTER TABLE clinical_exams ADD COLUMN tipo TEXT NOT NULL DEFAULT 'clinico'");
}
if (!columnasExamenesClinicos.has('demo')) {
  db.exec('ALTER TABLE clinical_exams ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
}
if (!columnasExamenesClinicos.has('referencias_archivo')) {
  db.exec('ALTER TABLE clinical_exams ADD COLUMN referencias_archivo TEXT');
}
if (!columnasExamenesClinicos.has('patient_id')) {
  db.exec('ALTER TABLE clinical_exams ADD COLUMN patient_id TEXT');
}
if (!columnasExamenesClinicos.has('descripcion')) {
  db.exec('ALTER TABLE clinical_exams ADD COLUMN descripcion TEXT');
}

if (!columnasAdjuntosClinicos.has('patient_id')) {
  db.exec('ALTER TABLE clinical_attachments ADD COLUMN patient_id TEXT');
}

db.exec(`
  UPDATE clinical_exams
  SET patient_id = (
    SELECT patient_id FROM clinical_records WHERE clinical_records.id = clinical_exams.record_id
  )
  WHERE patient_id IS NULL;

  UPDATE clinical_attachments
  SET patient_id = (
    SELECT patient_id FROM clinical_records WHERE clinical_records.id = clinical_attachments.record_id
  )
  WHERE patient_id IS NULL;

  CREATE INDEX IF NOT EXISTS idx_clinical_exams_patient
    ON clinical_exams(patient_id, creado_en DESC);
  CREATE INDEX IF NOT EXISTS idx_clinical_attachments_patient
    ON clinical_attachments(patient_id, creado_en DESC);
  CREATE INDEX IF NOT EXISTS idx_clinical_attachments_exam
    ON clinical_attachments(exam_id, creado_en DESC);
`);

// LEGACY-EXCEPTION: helper-reconstruir-tabla
// Utilidad histórica para reconstruir tablas. Prohibida en migraciones nuevas.
/**
 * SQLite no permite renombrar una tabla mientras una vista la referencia.
 * Guarda las definiciones de las vistas afectadas, las elimina y las recrea
 * al terminar la reconstrucción.
 */
function reconstruirTablaSinVistas(tabla, reconstruir) {
  const vistas = db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'view' AND sql IS NOT NULL AND sql LIKE ?`
    )
    .all(`%${tabla}%`);

  for (const vista of vistas) db.exec(`DROP VIEW IF EXISTS "${vista.name}";`);
  try {
    reconstruir();
  } finally {
    for (const vista of vistas) db.exec(vista.sql);
  }
}
// END-LEGACY-EXCEPTION

// Los estados de cita cambiaron; SQLite obliga a reconstruir la tabla para
// modificar la restricción CHECK.
const tablaCitas = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'appointments'")
  .get();
// LEGACY-EXCEPTION: appointments-estados
// Migración histórica: reconstruyó appointments para ampliar el CHECK. No repetir.
if (tablaCitas && !String(tablaCitas.sql).includes("'en_progreso'")) {
  reconstruirTablaSinVistas('appointments', () => {
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec('DROP TABLE IF EXISTS appointments_nuevo;');
      db.exec(`
        CREATE TABLE appointments_nuevo (
          id             TEXT PRIMARY KEY,
          patient_id     TEXT NOT NULL REFERENCES patients(id),
          medico_id      TEXT REFERENCES users(id),
          fecha_hora     TEXT NOT NULL,
          duracion_min   INTEGER NOT NULL DEFAULT 30,
          motivo         TEXT,
          estado         TEXT NOT NULL DEFAULT 'programada'
                         CHECK (estado IN ('programada', 'confirmada', 'en_progreso', 'atendida',
                                           'cancelada', 'reagendada', 'no_asistio')),
          notas          TEXT,
          creado_por     TEXT REFERENCES users(id),
          creado_en      TEXT NOT NULL,
          actualizado_en TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO appointments_nuevo
          (id, patient_id, medico_id, fecha_hora, duracion_min, motivo, estado, notas,
           creado_por, creado_en, actualizado_en)
        SELECT id, patient_id, medico_id, fecha_hora, duracion_min, motivo, estado, notas,
               creado_por, creado_en, actualizado_en
        FROM appointments;
      `);
      db.exec('DROP TABLE appointments;');
      db.exec('ALTER TABLE appointments_nuevo RENAME TO appointments;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_fecha ON appointments(fecha_hora);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_medico ON appointments(medico_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_estado ON appointments(estado);');
      db.exec('COMMIT');
      console.log('[db] migración aplicada: estados de cita');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // sin transacción abierta
      }
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  });
}
// END-LEGACY-EXCEPTION

const columnasCitasAhora = new Set(
  db.prepare('PRAGMA table_info(appointments)').all().map((columna) => columna.name)
);
if (!columnasCitasAhora.has('motivo_reagenda')) {
  db.exec('ALTER TABLE appointments ADD COLUMN motivo_reagenda TEXT');
}
if (!columnasCitasAhora.has('demo')) {
  db.exec('ALTER TABLE appointments ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_patients_demo ON patients(demo);');
db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_demo ON appointments(demo);');
db.exec('CREATE INDEX IF NOT EXISTS idx_clinical_records_demo ON clinical_records(demo);');
db.exec('CREATE INDEX IF NOT EXISTS idx_clinical_exams_demo ON clinical_exams(demo);');

// Código legible y único para cada consentimiento existente.
const documentosSinCodigo = db
  .prepare("SELECT id, creado_en FROM documents WHERE codigo IS NULL OR codigo = '' ORDER BY creado_en")
  .all();

for (const documento of documentosSinCodigo) {
  const anio = new Date(documento.creado_en).getFullYear() || new Date().getFullYear();
  const prefijo = `ISIM-${anio}-`;
  const ultimo = db
    .prepare("SELECT codigo FROM documents WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1")
    .get(`${prefijo}%`);
  const numero = ultimo ? Number(ultimo.codigo.slice(prefijo.length)) + 1 : 1;
  const codigo = `${prefijo}${String(numero).padStart(6, '0')}`;
  db.prepare('UPDATE documents SET codigo = ? WHERE id = ?').run(codigo, documento.id);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_codigo ON documents(codigo);');

db.prepare(
  "UPDATE documents SET anulado_en = actualizado_en WHERE estado = 'anulado' AND anulado_en IS NULL"
).run();

// ---------------------------------------------------------------------------
// UI v2 · Migraciones aditivas (idempotentes)
// ---------------------------------------------------------------------------
function columnasDe(tabla) {
  return new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((columna) => columna.name));
}

const columnasPacientesV2 = columnasDe('patients');
for (const nombre of [
  'grupo_sanguineo',
  'habitos',
  'medicacion_habitual',
  'menarquia',
  'ciclos',
  'gestas',
  'partos',
  'cesareas',
  'abortos',
  'hijos_vivos',
  'mac',
  'ivsa',
  'parejas',
  'ultimo_pap',
  'ultima_mamografia',
]) {
  if (!columnasPacientesV2.has(nombre)) {
    db.exec(`ALTER TABLE patients ADD COLUMN ${nombre} TEXT`);
  }
}

const columnasDocumentosV2 = columnasDe('documents');
if (!columnasDocumentosV2.has('numero')) {
  db.exec('ALTER TABLE documents ADD COLUMN numero INTEGER');
}
if (!columnasDocumentosV2.has('subtipo')) {
  db.exec("ALTER TABLE documents ADD COLUMN subtipo TEXT NOT NULL DEFAULT 'consentimiento'");
}
if (!columnasDocumentosV2.has('datos')) {
  db.exec('ALTER TABLE documents ADD COLUMN datos TEXT');
}

const columnasItemsRecetaV2 = columnasDe('prescription_items');
if (!columnasItemsRecetaV2.has('dci')) {
  db.exec('ALTER TABLE prescription_items ADD COLUMN dci TEXT');
}
if (!columnasItemsRecetaV2.has('concentracion')) {
  db.exec('ALTER TABLE prescription_items ADD COLUMN concentracion TEXT');
}

const columnasExamenesV2 = columnasDe('clinical_exams');
if (!columnasExamenesV2.has('pedido_id')) {
  db.exec('ALTER TABLE clinical_exams ADD COLUMN pedido_id TEXT');
}

const columnasEsquemasV2 = columnasDe('catalogo_tratamientos');
if (!columnasEsquemasV2.has('datos')) {
  db.exec('ALTER TABLE catalogo_tratamientos ADD COLUMN datos TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS clinical_orders (
    id             TEXT PRIMARY KEY,
    numero         INTEGER NOT NULL,
    patient_id     TEXT NOT NULL REFERENCES patients(id),
    record_id      TEXT REFERENCES clinical_records(id) ON DELETE SET NULL,
    tipo           TEXT NOT NULL
                   CHECK (tipo IN ('ecografia', 'colposcopia', 'biopsia', 'laboratorio')),
    fecha          TEXT NOT NULL,
    datos          TEXT,
    estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente', 'con_resultado', 'sin_resultado')),
    medico_id      TEXT REFERENCES users(id),
    creado_por     TEXT REFERENCES users(id),
    creado_en      TEXT NOT NULL,
    actualizado_en TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_clinical_orders_patient
    ON clinical_orders(patient_id, fecha DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_clinical_orders_numero ON clinical_orders(numero);
  CREATE INDEX IF NOT EXISTS idx_clinical_exams_pedido ON clinical_exams(pedido_id);

  CREATE TABLE IF NOT EXISTS clinical_addenda (
    id         TEXT PRIMARY KEY,
    record_id  TEXT NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
    texto      TEXT NOT NULL,
    usuario_id TEXT REFERENCES users(id),
    creado_en  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_clinical_addenda_record
    ON clinical_addenda(record_id, creado_en ASC);
`);

// El estado "en sala de espera" exige reconstruir la tabla para ampliar el CHECK.
const tablaCitasV2 = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'appointments'")
  .get();
if (tablaCitasV2 && !String(tablaCitasV2.sql).includes("'en_sala_espera'")) {
  const existentes = columnasDe('appointments');
  const destino = [
    'id',
    'patient_id',
    'medico_id',
    'fecha_hora',
    'duracion_min',
    'motivo',
    'estado',
    'motivo_reagenda',
    'notas',
    'jornada',
    'tipo',
    'cupo',
    'motivo_grupo',
    'demo',
    'creado_por',
    'creado_en',
    'actualizado_en',
  ];
  const copiables = destino.filter((columna) => existentes.has(columna));

  // LEGACY-EXCEPTION: appointments-sala-espera
  // Migración histórica: reconstruyó appointments para el CHECK. No repetir.
  reconstruirTablaSinVistas('appointments', () => {
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec('DROP TABLE IF EXISTS appointments_nuevo;');
      db.exec(`
        CREATE TABLE appointments_nuevo (
          id             TEXT PRIMARY KEY,
          patient_id     TEXT NOT NULL REFERENCES patients(id),
          medico_id      TEXT REFERENCES users(id),
          fecha_hora     TEXT NOT NULL,
          duracion_min   INTEGER NOT NULL DEFAULT 30,
          motivo         TEXT,
          estado         TEXT NOT NULL DEFAULT 'programada'
                         CHECK (estado IN ('programada', 'confirmada', 'en_sala_espera',
                                           'en_progreso', 'atendida', 'cancelada', 'reagendada',
                                           'no_asistio')),
          motivo_reagenda TEXT,
          notas          TEXT,
          jornada        TEXT,
          tipo           TEXT NOT NULL DEFAULT 'normal',
          cupo           INTEGER NOT NULL DEFAULT 1,
          motivo_grupo   TEXT,
          demo           INTEGER NOT NULL DEFAULT 0,
          creado_por     TEXT REFERENCES users(id),
          creado_en      TEXT NOT NULL,
          actualizado_en TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO appointments_nuevo (${copiables.join(', ')})
        SELECT ${copiables.join(', ')} FROM appointments;
      `);
      db.exec('DROP TABLE appointments;');
      db.exec('ALTER TABLE appointments_nuevo RENAME TO appointments;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_fecha ON appointments(fecha_hora);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_medico ON appointments(medico_id);');
      db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_estado ON appointments(estado);');
      db.exec('COMMIT');
      console.log('[db] migración aplicada: estado en sala de espera');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // sin transacción abierta
      }
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  });
  // END-LEGACY-EXCEPTION
}

// Horario y membretes por defecto (los mismos del proyecto final).
const HORARIO_POR_DEFECTO = {
  cupos_por_hora: 2,
  lv: {
    manana: ['09:30', '10:00', '10:30', '11:00', '11:30'],
    tarde: ['15:30', '16:00', '16:30', '17:00', '17:30'],
  },
  sabado: { manana: [], tarde: [] },
  domingo: { manana: [], tarde: [] },
};
const MEMBRETES_POR_DEFECTO = {
  iess: { encabezado: '', pie: '', ciudad: 'Riobamba' },
  atencion: { encabezado: '', pie: '', ciudad: 'Riobamba' },
};

function sembrarAjuste(clave, valor) {
  const existe = db.prepare('SELECT 1 FROM settings WHERE clave = ?').get(clave);
  if (existe) return;
  db.prepare('INSERT INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)').run(
    clave,
    JSON.stringify(valor),
    new Date().toISOString()
  );
}

sembrarAjuste('horario_agenda', HORARIO_POR_DEFECTO);
sembrarAjuste('membretes', MEMBRETES_POR_DEFECTO);

// Migración única de permisos para los roles protegidos.
if (!db.prepare("SELECT 1 FROM settings WHERE clave = 'migracion_permisos_ui_v2'").get()) {
  const asignar = (rol, permisos) => {
    const existe = db.prepare('SELECT 1 FROM roles WHERE slug = ?').get(rol);
    if (!existe) return;
    db.prepare('DELETE FROM role_permissions WHERE role_slug = ?').run(rol);
    const insertar = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_slug, permiso) VALUES (?, ?)'
    );
    for (const permiso of permisos) insertar.run(rol, permiso);
  };

  const base = [
    'pacientes.ver',
    'pacientes.crear',
    'pacientes.editar',
    'agenda.ver',
    'agenda.gestionar',
    'documentos.ver',
    'documentos.crear',
    'documentos.editar',
    'documentos.firmar',
    'registro.ver',
    'configuracion.ver',
  ];

  asignar('operador', [...base, 'pacientes.desactivar']);
  asignar('enfermero', [
    'pacientes.ver',
    'pacientes.crear',
    'pacientes.editar',
    'agenda.ver',
    'agenda.gestionar',
    'historias.resumen',
    'examenes.gestionar',
    'documentos.ver',
    'registro.ver',
  ]);
  asignar('medico', [
    ...base,
    'pacientes.desactivar',
    'documentos.anular',
    'historias.ver',
    'historias.resumen',
    'historias.gestionar',
    'examenes.gestionar',
    'firma.medico',
    'crm.ver',
    'crm.gestionar',
  ]);

  db.prepare(
    'INSERT INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)'
  ).run('migracion_permisos_ui_v2', '1', new Date().toISOString());
  console.log('[db] migración aplicada: permisos de la UI v2');
}

// Migración única: el secretario/a queda limitado a agenda y admisión.
if (
  !db
    .prepare("SELECT 1 FROM settings WHERE clave = 'migracion_permisos_secretario'")
    .get()
) {
  const permisosSecretario = [
    'pacientes.ver',
    'pacientes.crear',
    'pacientes.editar',
    'agenda.ver',
    'agenda.gestionar',
  ];
  if (db.prepare("SELECT 1 FROM roles WHERE slug = 'operador'").get()) {
    db.prepare("DELETE FROM role_permissions WHERE role_slug = 'operador'").run();
    const insertar = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_slug, permiso) VALUES (?, ?)'
    );
    for (const permiso of permisosSecretario) insertar.run('operador', permiso);
  }
  db.prepare(
    'INSERT INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)'
  ).run('migracion_permisos_secretario', '1', new Date().toISOString());
  console.log('[db] migración aplicada: permisos del secretario/a');
}

// Clasificación de auditoría por módulo y tipo de acción (aditiva).
const columnasAuditoria = new Set(
  db.prepare('PRAGMA table_info(audit_log)').all().map((columna) => columna.name)
);
if (!columnasAuditoria.has('modulo')) {
  db.exec('ALTER TABLE audit_log ADD COLUMN modulo TEXT');
}
if (!columnasAuditoria.has('accion_tipo')) {
  db.exec('ALTER TABLE audit_log ADD COLUMN accion_tipo TEXT');
}
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_audit_modulo ON audit_log(modulo, creado_en DESC)'
);
db.exec(
  'CREATE INDEX IF NOT EXISTS idx_audit_accion_tipo ON audit_log(accion_tipo, creado_en DESC)'
);
if (
  !db
    .prepare("SELECT 1 FROM settings WHERE clave = 'migracion_audit_taxonomia'")
    .get()
) {
  const filas = db.prepare('SELECT id, accion, entidad FROM audit_log').all();
  db.exec('BEGIN');
  try {
    const actualizar = db.prepare(
      'UPDATE audit_log SET modulo = ?, accion_tipo = ? WHERE id = ?'
    );
    for (const fila of filas) {
      actualizar.run(
        moduloDe(fila.accion, fila.entidad),
        tipoAccionDe(fila.accion),
        fila.id
      );
    }
    db.prepare(
      'INSERT INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)'
    ).run('migracion_audit_taxonomia', '1', new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  console.log(`[db] auditoría clasificada: ${filas.length} evento(s)`);
}


export const nowIso = () => new Date().toISOString();
export const uid = () => randomUUID();
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

let transaccionActiva = 0;

function esBloqueoBd(error) {
  const codigo = Number(error?.errcode ?? 0);
  return (
    codigo === 5 ||
    codigo === 6 ||
    /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(String(error?.message || ''))
  );
}

function pausar(ms) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

/**
 * Ejecuta fn dentro de una transacción y devuelve su resultado.
 * BEGIN IMMEDIATE reserva el bloqueo de escritura desde el inicio, evitando
 * que dos usuarios choquen al pasar de lectura a escritura. Si SQLite está
 * ocupado, espera y reintenta.
 */
export function tx(fn) {
  // Las transacciones anidadas reutilizan la transacción exterior.
  if (transaccionActiva > 0) return fn();

  let intento = 0;
  for (;;) {
    try {
      db.exec('BEGIN IMMEDIATE');
      break;
    } catch (error) {
      if (!esBloqueoBd(error) || intento >= 6) throw error;
      intento += 1;
      pausar(40 * intento);
    }
  }

  transaccionActiva += 1;

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('tx() no admite funciones asíncronas');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // la transacción ya pudo haberse cerrado
    }
    throw error;
  } finally {
    transaccionActiva -= 1;
  }
}

// Actualiza estadísticas internas del planificador de SQLite.
db.exec('PRAGMA optimize;');

/**
 * Adapta los borradores existentes al formato actual: institución, cédula
 * explícita y fecha arriba. Las versiones firmadas no se tocan.
 */
function actualizarBorradores() {
  const filas = db
    .prepare(
      `SELECT v.id, v.contenido_html, p.nombres, p.apellidos, p.cedula
       FROM document_versions v
       JOIN documents d ON d.id = v.document_id
       JOIN patients p ON p.id = d.patient_id
       WHERE v.estado = 'borrador'`
    )
    .all();

  const actualizar = db.prepare(
    'UPDATE document_versions SET contenido_html = ?, hash = ? WHERE id = ?'
  );
  const escapar = (valor) =>
    String(valor ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

  let cambios = 0;

  for (const fila of filas) {
    let html = fila.contenido_html;
    const original = html;

    html = html.replaceAll(
      'Instituto de la Mujer Riobamba',
      'ISIM-Instituto de la Salud Integral de la Mujer'
    );

    if (
      !html.includes('Cédula de Identidad') &&
      /<p>\s*Yo,\s*<strong>[^<]+<\/strong>/.test(html)
    ) {
      html = html.replace(
        /(<p>\s*Yo,\s*<strong>[^<]+<\/strong>),/,
        `$1, con Cédula de Identidad <strong>${escapar(fila.cedula)}</strong>,`
      );
    } else if (!html.includes('Cédula de Identidad') && /<p>\s*Declaro que/.test(html)) {
      const nombre = `${fila.nombres} ${fila.apellidos}`.trim();
      html = html.replace(
        /<p>\s*Declaro que/,
        `<p>Yo, <strong>${escapar(nombre)}</strong>, con Cédula de Identidad <strong>${escapar(
          fila.cedula
        )}</strong>, declaro que`
      );
    }

    const fecha = html.match(/<p class="doc-fecha">([\s\S]*?)<\/p>/);
    if (fecha) {
      html = html.replace(fecha[0], '');
      const bloque = `<p class="doc-fecha-carta">${fecha[1]}</p>`;
      html = html.includes('<h2')
        ? html.replace(/<h2/, `${bloque}\n<h2`)
        : `${bloque}\n${html}`;
    }

    if (html !== original) {
      actualizar.run(html, sha256(html), fila.id);
      cambios += 1;
    }
  }

  if (cambios) {
    console.log(`[db] ${cambios} borrador(es) actualizados al formato actual`);
  }
}

actualizarBorradores();

/**
 * Los datos demográficos que versiones anteriores de la migración dejaron
 * dentro de `notas` se copian a sus columnas y luego se retiran del texto.
 */
function extraerDatosDesdeNotas() {
  const filas = db
    .prepare(
      `SELECT id, notas, ocupacion, estado_civil, ciudad,
              fecha_registro_informacion, actualizado_en
       FROM patients
       WHERE notas IS NOT NULL
         AND (
           notas LIKE '%Ocupaci%'
           OR notas LIKE '%Estado civil%'
           OR notas LIKE '%Ciudad:%'
         )`
    )
    .all();

  const actualizar = db.prepare(
    `UPDATE patients
     SET ocupacion = ?, estado_civil = ?, ciudad = ?,
         fecha_registro_informacion = ?, notas = ?
     WHERE id = ?`
  );

  const patrones = [
    ['ocupacion', /Ocupaci[oó]n\s*:\s*([^\n;|·]+)/i],
    ['estado_civil', /Estado\s+civil\s*:\s*([^\n;|·]+)/i],
    ['ciudad', /Ciudad\s*:\s*([^\n;|·]+)/i],
  ];

  let cambios = 0;
  for (const fila of filas) {
    let notas = String(fila.notas || '');
    const campos = {
      ocupacion: fila.ocupacion,
      estado_civil: fila.estado_civil,
      ciudad: fila.ciudad,
    };
    let encontrado = false;

    for (const [campo, patron] of patrones) {
      const coincidencia = notas.match(patron);
      if (!coincidencia) continue;
      const valor = coincidencia[1].trim();
      if (!campos[campo] && valor) campos[campo] = valor;
      notas = notas.replace(coincidencia[0], '');
      encontrado = true;
    }

    if (!encontrado) continue;

    notas = notas
      .split(/\r?\n/)
      .map((linea) => linea.replace(/^[\s;|·-]+|[\s;|·-]+$/g, ''))
      .filter(Boolean)
      .join('\n')
      .trim();

    const fecha =
      fila.fecha_registro_informacion ||
      (fila.actualizado_en ? String(fila.actualizado_en).slice(0, 10) : nowIso().slice(0, 10));

    actualizar.run(
      campos.ocupacion || null,
      campos.estado_civil || null,
      campos.ciudad || null,
      fecha,
      notas || null,
      fila.id
    );
    cambios += 1;
  }

  if (cambios) {
    console.log(`[db] ${cambios} ficha(s) actualizadas desde notas de migración`);
  }
}

extraerDatosDesdeNotas();

/** Conserva las imágenes referenciadas por la migración en una columna propia. */
function extraerReferenciasArchivo() {
  const filas = db
    .prepare(
      `SELECT id, observaciones
       FROM clinical_exams
       WHERE referencias_archivo IS NULL
         AND observaciones LIKE '%Imágenes referenciadas%'`
    )
    .all();

  const actualizar = db.prepare(
    'UPDATE clinical_exams SET observaciones = ?, referencias_archivo = ? WHERE id = ?'
  );

  let cambios = 0;
  for (const fila of filas) {
    const coincidencia = String(fila.observaciones || '').match(
      /\[Im[áa]genes referenciadas[^\]]*:\s*([^\]]+)\]/i
    );
    if (!coincidencia) continue;
    const referencias = coincidencia[1]
      .split(',')
      .map((nombre) => nombre.trim())
      .filter(Boolean);
    if (!referencias.length) continue;
    const observaciones = String(fila.observaciones || '')
      .replace(coincidencia[0], '')
      .trim();
    actualizar.run(
      observaciones || null,
      JSON.stringify(referencias),
      fila.id
    );
    cambios += 1;
  }

  if (cambios) {
    console.log(`[db] ${cambios} examen(es) con referencias de archivo recuperadas`);
  }
}

extraerReferenciasArchivo();
