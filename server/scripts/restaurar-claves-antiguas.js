import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { config } from '../config.js';
import { db, nowIso, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { hashSecret, normalizarUsername } from '../lib/passwords.js';
import { leerDump } from '../lib/migracion/oldDb.js';

/**
 * Restaura en producción las claves de los usuarios que existían en la tabla
 * `sistema` de old_db.sql. Solo se aplica a usuarios ya migrados.
 */
const tablas = leerDump(resolve('old_db.sql'));
const cambiados = [];
const omitidos = [];

tx(() => {
  for (const fila of tablas.get('sistema') || []) {
    const usuario = normalizarUsername(fila.codigouser || fila.usuario);
    const password = String(fila.claveuser ?? '').trim();
    if (!usuario || !password) continue;

    const existente = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(usuario);
    if (!existente) {
      omitidos.push(usuario);
      continue;
    }

    db.prepare('UPDATE users SET password_hash = ?, actualizado_en = ? WHERE id = ?').run(
      hashSecret(password),
      nowIso(),
      existente.id
    );

    cambiados.push({
      nombre: String(fila.nombreuser || usuario).trim(),
      usuario,
      contrasena: password,
      origen: 'sistema',
    });
  }
});

const sello = new Date().toISOString().replace(/[:.]/g, '-');
const carpeta = resolve(config.dataDir, 'backups');
mkdirSync(carpeta, { recursive: true });
const archivo = resolve(carpeta, `credenciales-antiguas-${sello}.csv`);
const filas = [
  ['Nombre', 'Usuario', 'Contraseña', 'Origen'],
  ...cambiados.map((item) => [item.nombre, item.usuario, item.contrasena, item.origen]),
];
writeFileSync(
  archivo,
  `\uFEFF${filas
    .map((fila) => fila.map((valor) => `"${String(valor).replaceAll('"', '""')}"`).join(','))
    .join('\r\n')}\r\n`,
  'utf8'
);

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (admin) {
  audit(admin.id, 'claves_antiguas_restauradas', 'users', null, {
    cantidad: cambiados.length,
    archivoCredenciales: relative(config.dataDir, archivo).replace(/\\/g, '/'),
  });
}

console.log(
  JSON.stringify(
    {
      restaurados: cambiados.map(({ nombre, usuario }) => ({ nombre, usuario })),
      omitidos,
      archivoCredenciales: relative(config.dataDir, archivo).replace(/\\/g, '/'),
    },
    null,
    2
  )
);
