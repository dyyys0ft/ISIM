/** Comprueba un permiso devuelto por /api/auth/me. Admin siempre puede. */
export function puede(usuario, permiso) {
  if (usuario?.rol === 'admin') return true;
  return Boolean(usuario?.permisos?.includes(permiso));
}
