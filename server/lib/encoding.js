const CP1252 = {
  0x80: '\u20ac',
  0x82: '\u201a',
  0x83: '\u0192',
  0x84: '\u201e',
  0x85: '\u2026',
  0x86: '\u2020',
  0x87: '\u2021',
  0x88: '\u02c6',
  0x89: '\u2030',
  0x8a: '\u0160',
  0x8b: '\u2039',
  0x8c: '\u0152',
  0x8e: '\u017d',
  0x91: '\u2018',
  0x92: '\u2019',
  0x93: '\u201c',
  0x94: '\u201d',
  0x95: '\u2022',
  0x96: '\u2013',
  0x97: '\u2014',
  0x98: '\u02dc',
  0x99: '\u2122',
  0x9a: '\u0161',
  0x9b: '\u203a',
  0x9c: '\u0153',
  0x9e: '\u017e',
  0x9f: '\u0178',
};

const utf8Estricto = new TextDecoder('utf-8', { fatal: true });

function byteWindows1252(byte) {
  if (byte >= 0x80 && byte <= 0x9f) return CP1252[byte] ?? String.fromCharCode(byte);
  return String.fromCharCode(byte);
}

/**
 * Decodifica un archivo SQL que puede estar íntegramente en UTF-8 o mezclar
 * UTF-8 con bytes sueltos en Windows-1252/Latin-1 (algo frecuente en dumps
 * antiguos de MySQL). Los caracteres válidos en UTF-8 se conservan y los bytes
 * inválidos se interpretan como Windows-1252, evitando perder tildes y ñ.
 */
export function decodificarTexto(buffer) {
  if (typeof buffer === 'string') return buffer;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  try {
    return utf8Estricto.decode(bytes);
  } catch {
    // El archivo tiene una mezcla de codificaciones: se procesa por tramos.
  }

  let salida = '';
  let i = 0;

  while (i < bytes.length) {
    const byte = bytes[i];

    if (byte < 0x80) {
      salida += String.fromCharCode(byte);
      i += 1;
      continue;
    }

    const tamano =
      byte >= 0xc2 && byte <= 0xdf
        ? 2
        : byte >= 0xe0 && byte <= 0xef
          ? 3
          : byte >= 0xf0 && byte <= 0xf4
            ? 4
            : 0;

    if (tamano && i + tamano <= bytes.length) {
      try {
        salida += utf8Estricto.decode(bytes.subarray(i, i + tamano));
        i += tamano;
        continue;
      } catch {
        // La secuencia no es UTF-8 válida; el byte se trata como cp1252.
      }
    }

    salida += byteWindows1252(byte);
    i += 1;
  }

  return salida;
}
