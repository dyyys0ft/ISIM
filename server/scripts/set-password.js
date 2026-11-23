import { db, nowIso } from '../db/index.js';
import { hashSecret, validarPassword } from '../lib/passwords.js';

const [identificador, password] = process.argv.slice(2);

if (!identificador || !password) {
  console.error('Uso: npm run password -- <usuario|cédula|nombre> <nueva contraseña>');
  process.exit(1);
}

try {
  validarPassword(password);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const usuario = db
  .prepare(
    `SELECT id, nombre, username, rol
     FROM users
     WHERE username = ? COLLATE NOCASE OR cedula = ? OR nombre LIKE ?
     ORDER BY activo DESC, nombre COLLATE NOCASE
     LIMIT 1`
  )
  .get(identificador, identificador, `%${identificador}%`);

if (!usuario) {
  console.error(`No se encontró un usuario con “${identificador}”.`);
  process.exit(1);
}

db.prepare('UPDATE users SET password_hash = ?, actualizado_en = ? WHERE id = ?').run(
  hashSecret(password),
  nowIso(),
  usuario.id
);

console.log(
  `Contraseña actualizada para ${usuario.nombre} (@${usuario.username}, ${usuario.rol}).`
);
