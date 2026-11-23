import { db } from '../db/index.js';

export const MODOS_FIRMA = ['paciente', 'medico', 'ambas'];

/**
 * Configuración rápida de firmas:
 * - paciente: solo firma la paciente.
 * - medico: solo firma el profesional (la paciente no firma en pantalla).
 * - ambas: firma de la paciente y del profesional.
 */
export function modoFirma() {
  const valor = db.prepare("SELECT valor FROM settings WHERE clave = 'firma_modo'").get()?.valor;
  return MODOS_FIRMA.includes(valor) ? valor : 'ambas';
}

export function usaFirmaPaciente(modo = modoFirma()) {
  return modo === 'paciente' || modo === 'ambas';
}

export function usaFirmaMedico(modo = modoFirma()) {
  return modo === 'medico' || modo === 'ambas';
}

export function normalizarModoFirma(valor) {
  return MODOS_FIRMA.includes(valor) ? valor : null;
}
