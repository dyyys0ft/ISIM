import { existsSync } from 'node:fs';
import { db } from '../db/index.js';
import { config } from '../config.js';

const NOMBRE_CENTRO_POR_DEFECTO = 'ISIM-Instituto de la Salud Integral de la Mujer';

/** URL pública del logo del sistema; usa el logo ISIM si no hay uno configurado. */
export function logoActual() {
  const fila = db
    .prepare("SELECT valor FROM settings WHERE clave = 'logo_actualizado_en'")
    .get();
  if (!fila?.valor || !existsSync(config.logoFile)) return '/img/isim-logo.png';
  return `/api/settings/logo?v=${encodeURIComponent(fila.valor)}`;
}

/** Nombre configurado del centro médico. */
export function nombreCentro() {
  const fila = db.prepare("SELECT valor FROM settings WHERE clave = 'centro_nombre'").get();
  const nombre = fila?.valor?.trim();
  return nombre || NOMBRE_CENTRO_POR_DEFECTO;
}

/** Dirección configurada del centro médico, o null si está vacía. */
export function direccionCentro() {
  const fila = db.prepare("SELECT valor FROM settings WHERE clave = 'centro_direccion'").get();
  const direccion = fila?.valor?.trim();
  return direccion || null;
}

/** Texto del pie de página configurado, o null si está vacío. */
export function textoPieActual() {
  const fila = db.prepare("SELECT valor FROM settings WHERE clave = 'pie_texto'").get();
  const texto = fila?.valor?.trim();
  return texto || null;
}
