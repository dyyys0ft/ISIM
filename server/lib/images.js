import { HttpError } from './http.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Valida y decodifica una imagen PNG enviada como data URL. */
export function parsePngDataUrl(dataUrl, { minBytes = 200, maxBytes = 2 * 1024 * 1024 } = {}) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || '').trim());
  if (!match) throw new HttpError(400, 'La imagen debe enviarse como PNG en base64');

  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (buffer.length < minBytes) throw new HttpError(400, 'La imagen está vacía o es demasiado pequeña');
  if (buffer.length > maxBytes) throw new HttpError(400, 'La imagen supera el tamaño máximo permitido');
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new HttpError(400, 'El archivo no es un PNG válido');
  }

  return buffer;
}

/** Lee ancho y alto del bloque IHDR de un PNG. */
export function pngDimensions(buffer) {
  if (!buffer || buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
