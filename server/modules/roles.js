import { db, nowIso, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import {
  CATALOGO_PERMISOS,
  PERMISOS,
  exigir,
  invalidarCachePermisos,
  puede,
} from '../lib/permissions.js';
import { requireUser } from './auth.js';

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PERMISOS_VALIDOS = new Set(
  CATALOGO_PERMISOS.flatMap((grupo) => grupo.permisos.map((item) => item.permiso))
);

function limpiar(valor, max = 160) {
  return String(valor ?? '').trim().slice(0, max);
}

function slugDesdeNombre(nombre) {
  const base = limpiar(nombre, 80)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 32);

  return base.length >= 3 ? base : `rol.${Date.now().toString(36).slice(-6)}`;
}

function validarSlug(valor) {
  const slug = limpiar(valor, 32).toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new HttpError(
      400,
      'El código del rol debe tener entre 3 y 32 caracteres: minúsculas, números, punto, guion o guion bajo'
    );
  }
  return slug;
}

function validarPermisos(valor) {
  if (!Array.isArray(valor)) {
    throw new HttpError(400, 'Los permisos deben enviarse como una lista');
  }

  const permisos = [...new Set(valor.map((permiso) => String(permiso).trim()))];
  for (const permiso of permisos) {
    if (!PERMISOS_VALIDOS.has(permiso)) {
      throw new HttpError(400, `El permiso “${permiso}” no existe`);
    }
  }
  return permisos;
}

function permisosDeRol(slug) {
  return db
    .prepare('SELECT permiso FROM role_permissions WHERE role_slug = ? ORDER BY permiso')
    .all(slug)
    .map((fila) => fila.permiso);
}

function rolConDetalle(slug) {
  const rol = db.prepare('SELECT * FROM roles WHERE slug = ?').get(slug);
  if (!rol) throw new HttpError(404, 'Rol no encontrado');

  const usuarios = db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE rol = ?')
    .get(slug).n;

  return { ...rol, usuarios, permisos: permisosDeRol(slug) };
}

function guardarPermisos(slug, permisos) {
  db.prepare('DELETE FROM role_permissions WHERE role_slug = ?').run(slug);
  const insertar = db.prepare(
    'INSERT INTO role_permissions (role_slug, permiso) VALUES (?, ?)'
  );
  for (const permiso of permisos) insertar.run(slug, permiso);
}

function protegerRolAdmin(slug, permisos) {
  if (slug !== 'admin' || permisos === undefined) return;
  if (
    !permisos.includes(PERMISOS.USUARIOS_GESTIONAR) ||
    !permisos.includes(PERMISOS.CONFIGURACION_GESTIONAR)
  ) {
    throw new HttpError(
      400,
      'El rol Administrador debe conservar los permisos de usuarios y configuración para evitar un bloqueo total'
    );
  }
}

export function routes(router) {
  // Nombres para etiquetas de la interfaz. Cualquier usuario autenticado.
  router.get('/api/roles/nombres', (ctx) => {
    requireUser(ctx);
    return db
      .prepare('SELECT slug, nombre FROM roles ORDER BY nombre COLLATE NOCASE')
      .all();
  });

  // Catálogo completo para Ajustes → Tipos de acceso.
  router.get('/api/roles', (ctx) => {
    const user = requireUser(ctx);
    if (
      !puede(user, PERMISOS.CONFIGURACION_VER) &&
      !puede(user, PERMISOS.USUARIOS_GESTIONAR)
    ) {
      throw new HttpError(403, 'Tu rol no tiene permiso para ver los roles');
    }

    const roles = db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM users u WHERE u.rol = r.slug) AS usuarios
         FROM roles r
         ORDER BY r.protegido DESC, r.nombre COLLATE NOCASE`
      )
      .all()
      .map((rol) => ({ ...rol, permisos: permisosDeRol(rol.slug) }));

    return { roles, catalogo: CATALOGO_PERMISOS };
  });

  router.post('/api/roles', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const nombre = limpiar(ctx.body?.nombre, 80);
    if (!nombre) throw new HttpError(400, 'El nombre del rol es obligatorio');
    const descripcion = limpiar(ctx.body?.descripcion, 300) || null;
    const slug = ctx.body?.slug
      ? validarSlug(ctx.body.slug)
      : slugDesdeNombre(nombre);
    const permisos = validarPermisos(ctx.body?.permisos || []);

    if (db.prepare('SELECT 1 FROM roles WHERE slug = ?').get(slug)) {
      throw new HttpError(409, 'Ya existe un rol con ese código');
    }

    const ts = nowIso();
    tx(() => {
      db.prepare(
        `INSERT INTO roles (slug, nombre, descripcion, protegido, activo, creado_en, actualizado_en)
         VALUES (?, ?, ?, 0, 1, ?, ?)`
      ).run(slug, nombre, descripcion, ts, ts);
      guardarPermisos(slug, permisos);
    });

    audit(user.id, 'rol_creado', 'roles', slug, {
      permisos: permisos.length,
    });
    invalidarCachePermisos();
    ctx.ok(rolConDetalle(slug), 201);
  });

  router.patch('/api/roles/:slug', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const actual = db.prepare('SELECT * FROM roles WHERE slug = ?').get(ctx.params.slug);
    if (!actual) throw new HttpError(404, 'Rol no encontrado');

    const cambios = {};
    if (ctx.body?.nombre !== undefined) {
      const nombre = limpiar(ctx.body.nombre, 80);
      if (!nombre) throw new HttpError(400, 'El nombre del rol es obligatorio');
      cambios.nombre = nombre;
    }
    if (ctx.body?.descripcion !== undefined) {
      cambios.descripcion = limpiar(ctx.body.descripcion, 300) || null;
    }

    let permisos;
    if (ctx.body?.permisos !== undefined) {
      permisos = validarPermisos(ctx.body.permisos);
      protegerRolAdmin(actual.slug, permisos);
    }

    if (!Object.keys(cambios).length && permisos === undefined) {
      throw new HttpError(400, 'No hay cambios para guardar');
    }

    const ts = nowIso();
    tx(() => {
      if (Object.keys(cambios).length) {
        const campos = Object.keys(cambios).map((campo) => `${campo} = ?`);
        campos.push('actualizado_en = ?');
        db.prepare(`UPDATE roles SET ${campos.join(', ')} WHERE slug = ?`).run(
          ...Object.values(cambios),
          ts,
          actual.slug
        );
      } else {
        db.prepare('UPDATE roles SET actualizado_en = ? WHERE slug = ?').run(ts, actual.slug);
      }

      if (permisos !== undefined) guardarPermisos(actual.slug, permisos);
    });

    audit(user.id, 'rol_editado', 'roles', actual.slug, {
      campos: Object.keys(cambios),
      permisos: permisos?.length,
    });
    invalidarCachePermisos();
    ctx.ok(rolConDetalle(actual.slug));
  });

  router.delete('/api/roles/:slug', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const actual = db.prepare('SELECT * FROM roles WHERE slug = ?').get(ctx.params.slug);
    if (!actual) throw new HttpError(404, 'Rol no encontrado');
    if (actual.protegido) {
      throw new HttpError(409, 'Los roles del sistema no se pueden eliminar');
    }

    const usuarios = db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE rol = ?')
      .get(actual.slug).n;
    if (usuarios > 0) {
      throw new HttpError(
        409,
        `No se puede eliminar el rol: tiene ${usuarios} usuario(s) asignado(s)`
      );
    }

    db.prepare('DELETE FROM roles WHERE slug = ?').run(actual.slug);
    audit(user.id, 'rol_eliminado', 'roles', actual.slug, null);
    invalidarCachePermisos();
    ctx.ok({ ok: true });
  });
}
