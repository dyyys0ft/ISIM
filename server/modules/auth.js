import { randomBytes } from 'node:crypto';
import { db, nowIso, tx, uid } from '../db/index.js';
import { config } from '../config.js';
import { HttpError, parseCookies, setCookie } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { permisosDe } from '../lib/permissions.js';
import { logoActual } from '../lib/branding.js';
import { whatsappConfigurado } from '../lib/whatsapp.js';
import {
  hashSecret,
  normalizarUsername,
  validarPassword,
  validarUsername,
  verifySecret,
} from '../lib/passwords.js';
import {
  cerrarSesionTiempoReal,
  cerrarSesionesTiempoReal,
  registrarConexionSesion,
} from '../lib/sessionEvents.js';

export const SESSION_COOKIE = 'sgcpm_sid';

export function createSession(userId) {
  const id = randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, creada_en, expira_en) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    new Date(now).toISOString(),
    new Date(now + config.sessionTtlMs).toISOString()
  );
  return id;
}

export function requireUser(ctx) {
  const token = parseCookies(ctx.req)[SESSION_COOKIE];
  if (!token) throw new HttpError(401, 'Debes iniciar sesión');

  const session = db.prepare('SELECT id, user_id, expira_en FROM sessions WHERE id = ?').get(token);
  if (!session) throw new HttpError(401, 'Sesión no válida');

  if (session.expira_en <= nowIso()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    throw new HttpError(401, 'La sesión expiró');
  }

  const user = db
    .prepare(
      'SELECT id, nombre, username, cedula, rol, senecit, especialidad FROM users WHERE id = ? AND activo = 1'
    )
    .get(session.user_id);
  if (!user) throw new HttpError(401, 'Usuario inactivo');

  ctx.user = user;
  ctx.sessionId = session.id;
  return user;
}

export function routes(router) {
  // Instalación inicial: el acceso solo se muestra mientras no haya usuarios.
  router.get('/api/setup/estado', () => ({
    requiereInstalacion: db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0,
  }));

  router.post('/api/setup/instalar', (ctx) => {
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
      throw new HttpError(409, 'El sistema ya está instalado');
    }

    const nombre = String(ctx.body?.nombre || '').trim().slice(0, 200);
    const username = validarUsername(ctx.body?.usuario ?? ctx.body?.username);
    const password = validarPassword(ctx.body?.password);
    if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');

    const especialidad = String(ctx.body?.especialidad || '').trim().slice(0, 800) || null;
    const senecit = String(ctx.body?.registro || ctx.body?.senecit || '').trim().slice(0, 40) || null;
    const id = uid();
    const ts = nowIso();
    const hash = hashSecret(password);
    let sessionId;

    tx(() => {
      db.prepare(
        `INSERT INTO users
           (id, nombre, username, password_hash, rol, pin_hash, activo, senecit, especialidad,
            creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, 'admin', ?, 1, ?, ?, ?, ?)`
      ).run(id, nombre, username, hash, hash, senecit, especialidad, ts, ts);
      sessionId = createSession(id);
    });

    db.prepare('UPDATE users SET ultimo_acceso_en = ? WHERE id = ?').run(ts, id);
    setCookie(ctx.res, SESSION_COOKIE, sessionId, { maxAge: config.sessionTtlMs / 1000 });
    audit(id, 'instalacion_inicial', 'users', id, { username });
    ctx.ok(
      {
        id,
        nombre,
        username,
        rol: 'admin',
        permisos: permisosDe({ id, rol: 'admin' }),
      },
      201
    );
  });

  // Último usuario que inició sesión en este equipo (solo para mostrar el último acceso).
  router.get('/api/auth/ultimo', () => {
    const user = db
      .prepare(
        `SELECT id, nombre, rol, ultimo_acceso_en
         FROM users
         WHERE activo = 1 AND ultimo_acceso_en IS NOT NULL
         ORDER BY ultimo_acceso_en DESC
         LIMIT 1`
      )
      .get();
    return user || null;
  });

  router.post('/api/auth/login', (ctx) => {
    const { username, password } = ctx.body || {};
    if (!username || !password) {
      throw new HttpError(400, 'Ingresa tu usuario y contraseña');
    }

    const nombreUsuario = normalizarUsername(username);
    const user = db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND activo = 1')
      .get(nombreUsuario);

    if (!user || !verifySecret(password, user.password_hash)) {
      audit(user?.id ?? null, 'login_fallido', 'users', user?.id ?? null, {
        username: nombreUsuario,
      });
      throw new HttpError(401, 'Usuario o contraseña incorrectos');
    }

    let sessionId;
    const anteriores = db
      .prepare('SELECT id FROM sessions WHERE user_id = ?')
      .all(user.id)
      .map((sesion) => sesion.id);

    tx(() => {
      // Una sola sesión activa por usuario: al entrar desde otro dispositivo
      // se invalida la sesión anterior.
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      sessionId = createSession(user.id);
    });

    // Avisa de inmediato a las pestañas/dispositivos que tenían la sesión anterior.
    cerrarSesionesTiempoReal(anteriores, 'otra_sesion');

    db.prepare('UPDATE users SET ultimo_acceso_en = ? WHERE id = ?').run(nowIso(), user.id);
    setCookie(ctx.res, SESSION_COOKIE, sessionId, { maxAge: config.sessionTtlMs / 1000 });
    audit(user.id, 'login', 'users', user.id, {
      sesionUnica: true,
      sesionesCerradas: anteriores.length,
    });
    ctx.ok({
      id: user.id,
      nombre: user.nombre,
      username: user.username,
      rol: user.rol,
      permisos: permisosDe(user),
    });
  });

  router.get('/api/auth/me', (ctx) => {
    const user = requireUser(ctx);
    const extra = db
      .prepare(
        `SELECT firma_png_path, firma_actualizada_en, foto_png_path, foto_actualizada_en, senecit
         FROM users WHERE id = ?`
      )
      .get(user.id);

    return {
      ...user,
      senecit: extra?.senecit || '',
      permisos: permisosDe(user),
      logoUrl: logoActual(),
      alertasExamenes:
        db
          .prepare("SELECT valor FROM settings WHERE clave = 'alerta_examenes_pendientes'")
          .get()?.valor !== '0',
      whatsappConfigurado: whatsappConfigurado(),
      firmaUrl: extra?.firma_png_path
        ? `/api/users/${user.id}/firma?v=${encodeURIComponent(extra.firma_actualizada_en || '')}`
        : null,
      fotoUrl: extra?.foto_png_path
        ? `/api/users/${user.id}/foto?v=${encodeURIComponent(extra.foto_actualizada_en || '')}`
        : null,
    };
  });

  router.get('/api/auth/session-events', (ctx) => {
    requireUser(ctx);
    const sessionId = ctx.sessionId;

    ctx.res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    ctx.res.write('retry: 5000\n\n');
    ctx.res.write(
      `event: conectado\ndata: ${JSON.stringify({ sessionId })}\n\n`
    );

    const ping = setInterval(() => {
      try {
        ctx.res.write(': ping\n\n');
      } catch {
        // La conexión se cerró.
      }
    }, 20000);

    const limpiar = registrarConexionSesion(sessionId, ctx.res);
    const cerrar = () => {
      clearInterval(ping);
      limpiar();
    };

    ctx.req.on('close', cerrar);
    ctx.res.on('close', cerrar);
    return undefined;
  });

  router.post('/api/auth/logout', (ctx) => {
    const token = parseCookies(ctx.req)[SESSION_COOKIE];
    if (token) {
      const session = db
        .prepare('SELECT user_id FROM sessions WHERE id = ?')
        .get(token);
      if (session) {
        cerrarSesionTiempoReal(token, 'logout');
        db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
        audit(session.user_id, 'logout', 'users', session.user_id, null);
      }
    }
    setCookie(ctx.res, SESSION_COOKIE, '', { maxAge: 0 });
    ctx.ok({ ok: true });
  });
}
