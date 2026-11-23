import { existsSync, readFileSync } from 'node:fs';
import { config } from '../config.js';

/** Se activa cuando el servidor HTTPS arrancó correctamente. */
export const estadoHttps = { activo: false };

export function cargarCertificadoHttps() {
  if (!existsSync(config.httpsPfx) || !existsSync(config.httpsPassphraseFile)) return null;

  try {
    return {
      pfx: readFileSync(config.httpsPfx),
      passphrase: readFileSync(config.httpsPassphraseFile, 'utf8').trim(),
    };
  } catch (error) {
    console.error('[https] No se pudo leer el certificado:', error.message);
    return null;
  }
}

export function httpsActivo() {
  return estadoHttps.activo;
}
