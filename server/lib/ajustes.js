import { db } from '../db/index.js';

/** Lee un ajuste de la tabla settings. */
export function leerAjuste(clave, defecto = null) {
  const fila = db.prepare('SELECT valor FROM settings WHERE clave = ?').get(clave);
  return fila?.valor ?? defecto;
}

/**
 * Por defecto se bloquean las citas simultáneas del mismo médico.
 * Se activa desde Ajustes → Agenda.
 */
export function permitirCitasSimultaneas() {
  return leerAjuste('permitir_citas_simultaneas') === '1';
}
