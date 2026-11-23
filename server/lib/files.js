import { HttpError } from './http.js';

const TIPOS = {
  'image/png': { ext: 'png', valido: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', valido: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': {
    ext: 'webp',
    valido: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  'application/pdf': {
    ext: 'pdf',
    valido: (b) => b.length > 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
};

export const MIME_PERMITIDOS = Object.keys(TIPOS);

export function nombreArchivoSeguro(nombre, max = 180) {
  return String(nombre || 'archivo')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || 'archivo';
}

/** Decodifica un archivo enviado como data URL base64 y valida su tipo real. */
export function parseArchivoDataUrl(dataUrl, { maxBytes = 8 * 1024 * 1024 } = {}) {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || '').trim());
  if (!match) throw new HttpError(400, 'El archivo debe enviarse en base64');

  const mime = match[1].toLowerCase();
  const tipo = TIPOS[mime];
  if (!tipo) {
    throw new HttpError(
      400,
      'Formato no permitido. Se aceptan imágenes PNG, JPG, WEBP o documentos PDF.'
    );
  }

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new HttpError(400, 'El archivo está vacío');
  if (buffer.length > maxBytes) {
    throw new HttpError(400, `El archivo supera el tamaño máximo de ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  if (!tipo.valido(buffer)) {
    throw new HttpError(400, 'El contenido del archivo no coincide con su formato');
  }

  return { buffer, mime, ext: tipo.ext };
}
