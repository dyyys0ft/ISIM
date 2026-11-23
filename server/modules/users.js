import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, nowIso, sha256, uid } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { parsePngDataUrl } from '../lib/images.js';
import { hashSecret, validarPassword, validarUsername, verifySecret } from '../lib/passwords.js';
import { cerrarSesionesTiempoReal } from '../lib/sessionEvents.js';
import { requireUser } from './auth.js';

function limpiar(valor, max = 160) {
  return String(valor ?? '').trim().slice(0, max);
}

function rolValido(valor) {
  const slug = limpiar(valor, 32).toLowerCase();
  const rol = db.prepare('SELECT slug FROM roles WHERE slug = ?').get(slug);
  if (!rol) throw new HttpError(400, 'El rol seleccionado no existe');
  return rol.slug;
}

function requireAdmin(ctx) {
  const user = requireUser(ctx);
  exigir(user, PERMISOS.USUARIOS_GESTIONAR);
  return user;
}

function usernameDisponible(username, exceptoId = null) {
  const actual = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
    .get(username);
  if (actual && actual.id !== exceptoId) {
    throw new HttpError(409, 'Ese nombre de usuario ya está en uso');
  }
}

function esUsernameDuplicado(error) {
  return String(error?.message || '').includes('UNIQUE constraint failed: users.username');
}

function normalizarEspecialidad(valor) {
  const texto = String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!texto) return null;
  if (texto.split(' ').filter(Boolean).length > 100) {
    throw new HttpError(400, 'La especialidad no puede superar las 100 palabras');
  }
  return texto.slice(0, 800);
}

function esCedulaDuplicada(error) {
  return String(error?.message || '').includes('UNIQUE constraint failed: users.cedula');
}

function guardarFotoUsuario(userId, ctx) {
  const buffer = parsePngDataUrl(ctx.body?.image, {
    minBytes: 300,
    maxBytes: 2 * 1024 * 1024,
  });

  const relativa = `fotos/usuario-${userId}.png`;
  const absoluta = resolve(config.dataDir, relativa);
  mkdirSync(dirname(absoluta), { recursive: true });
  writeFileSync(absoluta, buffer);

  const ts = nowIso();
  const resultado = db
    .prepare(
      'UPDATE users SET foto_png_path = ?, foto_actualizada_en = ?, actualizado_en = ? WHERE id = ?'
    )
    .run(relativa, ts, ts, userId);

  if (!resultado.changes) throw new HttpError(404, 'Usuario no encontrado');
  return { fotoUrl: `/api/users/${userId}/foto?v=${encodeURIComponent(ts)}` };
}

function borrarFotoUsuario(userId) {
  const actual = db.prepare('SELECT foto_png_path FROM users WHERE id = ?').get(userId);
  if (!actual) throw new HttpError(404, 'Usuario no encontrado');

  if (actual.foto_png_path) {
    const absoluta = resolve(config.dataDir, actual.foto_png_path);
    if (absoluta.startsWith(resolve(config.dataDir))) {
      try {
        unlinkSync(absoluta);
      } catch {
        // el archivo pudo no existir
      }
    }
  }

  db.prepare(
    'UPDATE users SET foto_png_path = NULL, foto_actualizada_en = NULL, actualizado_en = ? WHERE id = ?'
  ).run(nowIso(), userId);
}

export function routes(router) {
  router.get('/api/users', (ctx) => {
    requireAdmin(ctx);
    return db
      .prepare(
        `SELECT u.id, u.nombre, u.cedula, u.username, u.rol, u.activo, u.creado_en, u.senecit, u.especialidad,
                u.firma_png_path IS NOT NULL AS tiene_firma,
                u.foto_png_path IS NOT NULL AS tiene_foto,
                u.foto_actualizada_en,
                (SELECT COUNT(*) FROM signatures s WHERE s.gestionado_por = u.id) AS firmas
         FROM users u
         ORDER BY u.activo DESC, u.nombre COLLATE NOCASE`
      )
      .all();
  });

  // Médicos activos para asignarlos como responsable de un documento.
  router.get('/api/medicos', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);
    return db
      .prepare(
        `SELECT id, nombre, cedula, senecit, especialidad, firma_png_path IS NOT NULL AS tiene_firma
         FROM users
         WHERE rol = 'medico' AND activo = 1
         ORDER BY nombre COLLATE NOCASE`
      )
      .all();
  });

  // Edición del propio perfil: nunca altera documentos ya firmados.
  router.patch('/api/users/me', (ctx) => {
    const user = requireUser(ctx);
    const nombre = limpiar(ctx.body?.nombre);
    const cedula = limpiar(ctx.body?.cedula, 20);
    const esMedico = user.rol === 'medico';
    const senecit = esMedico ? limpiar(ctx.body?.senecit, 40) : null;
    const especialidad = esMedico ? normalizarEspecialidad(ctx.body?.especialidad) : null;

    if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
    if (!cedula) throw new HttpError(400, 'La cédula es obligatoria');

    try {
      db.prepare(
        `UPDATE users
         SET nombre = ?, cedula = ?, senecit = ?, especialidad = ?, actualizado_en = ?
         WHERE id = ?`
      ).run(nombre, cedula, senecit || null, especialidad, nowIso(), user.id);
    } catch (error) {
      if (esCedulaDuplicada(error)) throw new HttpError(409, 'Esa cédula ya está registrada');
      throw error;
    }

    audit(user.id, 'perfil_actualizado', 'users', user.id, null);
    ctx.ok({ id: user.id, nombre, cedula, senecit: senecit || '', especialidad: especialidad || '', rol: user.rol });
  });

  router.post('/api/users/me/password', (ctx) => {
    const user = requireUser(ctx);
    const actual = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);

    if (!verifySecret(ctx.body?.passwordActual, actual.password_hash)) {
      throw new HttpError(401, 'La contraseña actual no es correcta');
    }

    const nuevo = validarPassword(ctx.body?.passwordNuevo);
    if (nuevo === String(ctx.body?.passwordActual)) {
      throw new HttpError(400, 'La nueva contraseña debe ser diferente de la actual');
    }

    db.prepare('UPDATE users SET password_hash = ?, actualizado_en = ? WHERE id = ?').run(
      hashSecret(nuevo),
      nowIso(),
      user.id
    );

    audit(user.id, 'password_cambiada', 'users', user.id, null);
    ctx.ok({ ok: true });
  });

  // Firma precargada del profesional (solo roles con permiso firma.medico).
  router.post('/api/users/me/firma', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.FIRMA_MEDICO);

    const buffer = parsePngDataUrl(ctx.body?.image, {
      minBytes: 300,
      maxBytes: 2 * 1024 * 1024,
    });

    const relativa = `firmas-medicos/usuario-${user.id}.png`;
    const absoluta = resolve(config.dataDir, relativa);
    mkdirSync(dirname(absoluta), { recursive: true });
    writeFileSync(absoluta, buffer);

    const ts = nowIso();
    db.prepare(
      `UPDATE users
       SET firma_png_path = ?, firma_hash = ?, firma_actualizada_en = ?, actualizado_en = ?
       WHERE id = ?`
    ).run(relativa, sha256(buffer), ts, ts, user.id);

    audit(user.id, 'firma_medico_guardada', 'users', user.id, null);
    ctx.ok({ firmaUrl: `/api/users/${user.id}/firma?v=${encodeURIComponent(ts)}` });
  });

  router.delete('/api/users/me/firma', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.FIRMA_MEDICO);

    const actual = db.prepare('SELECT firma_png_path FROM users WHERE id = ?').get(user.id);
    if (actual?.firma_png_path) {
      const absoluta = resolve(config.dataDir, actual.firma_png_path);
      if (absoluta.startsWith(resolve(config.dataDir))) {
        try {
          unlinkSync(absoluta);
        } catch {
          // el archivo pudo no existir
        }
      }
    }

    db.prepare(
      `UPDATE users
       SET firma_png_path = NULL, firma_hash = NULL, firma_actualizada_en = NULL, actualizado_en = ?
       WHERE id = ?`
    ).run(nowIso(), user.id);

    audit(user.id, 'firma_medico_eliminada', 'users', user.id, null);
    ctx.ok({ ok: true });
  });

  router.get('/api/users/:id/firma', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);

    const destino = db
      .prepare('SELECT id, firma_png_path FROM users WHERE id = ?')
      .get(ctx.params.id);
    if (!destino?.firma_png_path) throw new HttpError(404, 'El usuario no tiene firma registrada');

    const absoluta = resolve(config.dataDir, destino.firma_png_path);
    if (!absoluta.startsWith(resolve(config.dataDir)) || !existsSync(absoluta)) {
      throw new HttpError(404, 'No se encontró el archivo de la firma');
    }

    const buffer = readFileSync(absoluta);
    ctx.res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': buffer.length,
      'cache-control': 'private, max-age=60',
    });
    ctx.res.end(buffer);
  });

  // Foto del usuario: cada uno la suya; ADMIN también puede cambiarla a otros.
  router.post('/api/users/me/foto', (ctx) => {
    const user = requireUser(ctx);
    const resultado = guardarFotoUsuario(user.id, ctx);
    audit(user.id, 'foto_actualizada', 'users', user.id, null);
    ctx.ok(resultado);
  });

  router.delete('/api/users/me/foto', (ctx) => {
    const user = requireUser(ctx);
    borrarFotoUsuario(user.id);
    audit(user.id, 'foto_eliminada', 'users', user.id, null);
    ctx.ok({ ok: true });
  });

  router.post('/api/users/:id/foto', (ctx) => {
    const admin = requireAdmin(ctx);
    const resultado = guardarFotoUsuario(ctx.params.id, ctx);
    audit(admin.id, 'foto_actualizada', 'users', ctx.params.id, null);
    ctx.ok(resultado);
  });

  router.delete('/api/users/:id/foto', (ctx) => {
    const admin = requireAdmin(ctx);
    borrarFotoUsuario(ctx.params.id);
    audit(admin.id, 'foto_eliminada', 'users', ctx.params.id, null);
    ctx.ok({ ok: true });
  });

  router.get('/api/users/:id/foto', (ctx) => {
    requireUser(ctx);
    const destino = db
      .prepare('SELECT foto_png_path FROM users WHERE id = ?')
      .get(ctx.params.id);
    if (!destino?.foto_png_path) throw new HttpError(404, 'El usuario no tiene foto registrada');

    const absoluta = resolve(config.dataDir, destino.foto_png_path);
    if (!absoluta.startsWith(resolve(config.dataDir)) || !existsSync(absoluta)) {
      throw new HttpError(404, 'No se encontró la foto del usuario');
    }

    const buffer = readFileSync(absoluta);
    ctx.res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': buffer.length,
      'cache-control': 'private, max-age=60',
    });
    ctx.res.end(buffer);
  });

  router.post('/api/users', (ctx) => {
    const admin = requireAdmin(ctx);
    const nombre = limpiar(ctx.body?.nombre);
    const cedula = limpiar(ctx.body?.cedula, 20);
    const rol = rolValido(ctx.body?.rol || 'operador');
    const username = validarUsername(ctx.body?.username);
    const password = validarPassword(ctx.body?.password);
    usernameDisponible(username);
    const esMedico = rol === 'medico';
    const senecit = esMedico ? limpiar(ctx.body?.senecit, 40) || null : null;
    const especialidad = esMedico ? normalizarEspecialidad(ctx.body?.especialidad) : null;

    if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
    if (!cedula) throw new HttpError(400, 'La cédula es obligatoria');

    const id = uid();
    const ts = nowIso();
    const passwordHash = hashSecret(password);
    try {
      db.prepare(
        `INSERT INTO users
           (id, nombre, cedula, username, password_hash, rol, pin_hash, activo, senecit, especialidad, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(
        id,
        nombre,
        cedula,
        username,
        passwordHash,
        rol,
        passwordHash,
        senecit,
        especialidad,
        ts,
        ts
      );
    } catch (error) {
      if (esUsernameDuplicado(error)) {
        throw new HttpError(409, 'Ese nombre de usuario ya está en uso');
      }
      if (esCedulaDuplicada(error)) throw new HttpError(409, 'Esa cédula ya está registrada');
      throw error;
    }

    audit(admin.id, 'usuario_creado', 'users', id, { rol, username });
    ctx.ok({ id, username }, 201);
  });

  router.patch('/api/users/:id', (ctx) => {
    const admin = requireAdmin(ctx);
    const actual = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Usuario no encontrado');

    const cambios = {};

    if (ctx.body?.nombre !== undefined) {
      const nombre = limpiar(ctx.body.nombre);
      if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
      cambios.nombre = nombre;
    }

    if (ctx.body?.cedula !== undefined) {
      const cedula = limpiar(ctx.body.cedula, 20);
      if (!cedula) throw new HttpError(400, 'La cédula es obligatoria');
      cambios.cedula = cedula;
    }

    if (ctx.body?.username !== undefined) {
      const username = validarUsername(ctx.body.username);
      usernameDisponible(username, actual.id);
      cambios.username = username;
    }

    if (ctx.body?.rol !== undefined) {
      cambios.rol = rolValido(ctx.body.rol);
    }

    if (ctx.body?.activo !== undefined) {
      cambios.activo = ctx.body.activo ? 1 : 0;
    }

    if (ctx.body?.senecit !== undefined) {
      cambios.senecit = limpiar(ctx.body.senecit, 40) || null;
    }

    if (ctx.body?.especialidad !== undefined) {
      cambios.especialidad = normalizarEspecialidad(ctx.body.especialidad);
    }

    if (!Object.keys(cambios).length) throw new HttpError(400, 'No hay cambios para guardar');

    const rolFinal = cambios.rol ?? actual.rol;
    const activoFinal = cambios.activo ?? actual.activo;

    // SENECYT y especialidad solo tienen sentido para médicos.
    if (rolFinal !== 'medico') {
      cambios.senecit = null;
      cambios.especialidad = null;
    }

    if (actual.id === admin.id && (rolFinal !== 'admin' || activoFinal !== 1)) {
      throw new HttpError(400, 'No puedes quitarte tu propio acceso de administrador');
    }

    if (actual.rol === 'admin' && (rolFinal !== 'admin' || activoFinal !== 1)) {
      const otros = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE rol = 'admin' AND activo = 1 AND id != ?")
        .get(actual.id).n;
      if (otros === 0) throw new HttpError(400, 'Debe existir al menos un administrador activo');
    }

    const campos = Object.keys(cambios).map((columna) => `${columna} = ?`);
    const valores = Object.values(cambios);
    campos.push('actualizado_en = ?');
    valores.push(nowIso(), actual.id);

    try {
      db.prepare(`UPDATE users SET ${campos.join(', ')} WHERE id = ?`).run(...valores);
    } catch (error) {
      if (esUsernameDuplicado(error)) {
        throw new HttpError(409, 'Ese nombre de usuario ya está en uso');
      }
      if (esCedulaDuplicada(error)) throw new HttpError(409, 'Esa cédula ya está registrada');
      throw error;
    }

    audit(admin.id, 'usuario_editado', 'users', actual.id, { campos: Object.keys(cambios) });
    ctx.ok({ ok: true });
  });

  router.post('/api/users/:id/password', (ctx) => {
    const admin = requireAdmin(ctx);
    const usuario = db
      .prepare('SELECT id, nombre FROM users WHERE id = ?')
      .get(ctx.params.id);
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');

    const password = validarPassword(ctx.body?.password);
    const sesiones = db
      .prepare('SELECT id FROM sessions WHERE user_id = ?')
      .all(usuario.id)
      .map((sesion) => sesion.id);

    db.prepare('UPDATE users SET password_hash = ?, actualizado_en = ? WHERE id = ?').run(
      hashSecret(password),
      nowIso(),
      usuario.id
    );
    if (sesiones.length) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(usuario.id);
      cerrarSesionesTiempoReal(sesiones, 'password_restablecida');
    }

    audit(admin.id, 'password_restablecida', 'users', usuario.id, null);
    ctx.ok({ ok: true });
  });
}
