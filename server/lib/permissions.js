import { db } from '../db/index.js';
import { HttpError } from './http.js';
import { CATALOGO_PERMISOS, PERMISOS, ROLES_POR_DEFECTO } from './permisosCatalogo.js';

export { CATALOGO_PERMISOS, PERMISOS, ROLES_POR_DEFECTO };

const cachePermisos = new Map();

/** Limpia la caché cuando se crea, edita o elimina un rol. */
export function invalidarCachePermisos() {
  cachePermisos.clear();
}

/**
 * Permisos efectivos de un usuario según su rol en la tabla role_permissions.
 * Se cachean por rol y también en el objeto del usuario durante la petición.
 */
export function permisosDe(usuario) {
  if (!usuario) return [];
  // El administrador siempre conserva acceso total, aunque su rol se edite.
  if (usuario.rol === 'admin') return Object.values(PERMISOS);
  if (Array.isArray(usuario.__permisos)) return usuario.__permisos;

  if (!cachePermisos.has(usuario.rol)) {
    const filas = db
      .prepare('SELECT permiso FROM role_permissions WHERE role_slug = ?')
      .all(usuario.rol);
    cachePermisos.set(
      usuario.rol,
      filas.map((fila) => fila.permiso)
    );
  }

  const permisos = cachePermisos.get(usuario.rol);
  Object.defineProperty(usuario, '__permisos', {
    value: permisos,
    enumerable: false,
    configurable: true,
  });

  return permisos;
}

export function puede(usuario, permiso) {
  return permisosDe(usuario).includes(permiso);
}

/** Lanza 403 si el usuario no tiene el permiso indicado. */
export function exigir(usuario, permiso) {
  if (!puede(usuario, permiso)) {
    throw new HttpError(403, 'Tu rol no tiene permiso para esta acción');
  }
}

/** Lanza 403 si el usuario no tiene ninguno de los permisos indicados. */
export function exigirAlguno(usuario, permisos) {
  if (!permisos.some((permiso) => puede(usuario, permiso))) {
    throw new HttpError(403, 'Tu rol no tiene permiso para esta acción');
  }
}
