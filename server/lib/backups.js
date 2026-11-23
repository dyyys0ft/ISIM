import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { db, nowIso, uid } from '../db/index.js';
import { audit } from './audit.js';

/**
 * Respaldos cifrados de ISIM.
 *
 * El contenedor es un archivo `.isimbk` con:
 *   ISIMBK2
 *   {"v":2,"kdf":"scrypt","salt":"…","iv":"…","creado":"…"}
 *   <ciphertext AES-256-GCM>
 *   <tag de 16 bytes>
 *
 * Dentro del contenido cifrado va un manifiesto con la lista de archivos y sus
 * tamaños, seguido de los bytes de cada archivo. La base se incluye siempre
 * mediante un snapshot consistente de SQLite (VACUUM INTO).
 */

const MAGIC = 'ISIMBK2';
const FRECUENCIAS = ['manual', '6h', '12h', 'diario', 'semanal'];
const CLAVE_ARCHIVO = 'respaldo.key';
const PATRON_RESPALDO = /^isim-.*\.isimbk$/;

let ejecutando = false;
let temporizador = null;
let cacheTamanos = { cuando: 0, datos: null };

function leer(clave) {
  return db.prepare('SELECT valor FROM settings WHERE clave = ?').get(clave)?.valor ?? null;
}

function guardar(clave, valor) {
  db.prepare(
    `INSERT OR REPLACE INTO settings (clave, valor, actualizado_en) VALUES (?, ?, ?)`
  ).run(clave, valor ?? '', nowIso());
}

function directorioPorDefecto() {
  return resolve(config.dataDir, 'backups-cifrados');
}

export function leerConfig() {
  const frecuencia = leer('respaldos_frecuencia');
  return {
    directorio: leer('respaldos_directorio') || directorioPorDefecto(),
    incluirFirmas: leer('respaldos_incluir_firmas') !== '0',
    incluirHistorias: leer('respaldos_incluir_historias') !== '0',
    incluirConfiguracion: leer('respaldos_incluir_configuracion') !== '0',
    frecuencia: FRECUENCIAS.includes(frecuencia) ? frecuencia : 'diario',
    hora: leer('respaldos_hora') || '22:00',
    dia: Number(leer('respaldos_dia') ?? 1),
    conservar: Number(leer('respaldos_conservar') || 14),
    ultimoEn: leer('respaldos_ultimo_en'),
    proximoEn: leer('respaldos_proximo_en'),
    ultimoArchivo: leer('respaldos_ultimo_archivo'),
    ultimoEstado: leer('respaldos_ultimo_estado'),
    ultimoError: leer('respaldos_ultimo_error'),
  };
}

export function calcularProximo(cfg, desde = new Date()) {
  if (cfg.frecuencia === 'manual') return null;
  if (cfg.frecuencia === '6h') return new Date(desde.getTime() + 6 * 60 * 60 * 1000);
  if (cfg.frecuencia === '12h') return new Date(desde.getTime() + 12 * 60 * 60 * 1000);

  const [hora, minuto] = String(cfg.hora || '22:00')
    .split(':')
    .map(Number);
  const siguiente = new Date(desde);
  siguiente.setSeconds(0, 0);
  siguiente.setHours(Number.isFinite(hora) ? hora : 22, Number.isFinite(minuto) ? minuto : 0, 0, 0);

  if (cfg.frecuencia === 'diario') {
    if (siguiente <= desde) siguiente.setDate(siguiente.getDate() + 1);
    return siguiente;
  }

  const dia = Math.min(6, Math.max(0, Number(cfg.dia) || 0));
  const delta = (dia - siguiente.getDay() + 7) % 7;
  siguiente.setDate(siguiente.getDate() + (delta === 0 && siguiente <= desde ? 7 : delta));
  return siguiente;
}

export function validarDirectorio(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto || !isAbsolute(texto)) {
    throw new Error('El directorio de respaldos debe ser una ruta absoluta');
  }

  const directorio = resolve(texto);
  mkdirSync(directorio, { recursive: true });
  try {
    accessSync(directorio, constants.W_OK);
  } catch {
    throw new Error('El directorio de respaldos no tiene permisos de escritura');
  }

  const fuentes = ['firmas', 'firmas-medicos', 'fotos', 'historias', 'sistema'].map((carpeta) =>
    resolve(config.dataDir, carpeta)
  );
  for (const fuente of fuentes) {
    if (directorio === fuente || directorio.startsWith(`${fuente}${sep}`)) {
      throw new Error(
        'El directorio de respaldos no puede estar dentro de una carpeta que se respalda'
      );
    }
  }

  return directorio;
}

export function guardarConfig(datos) {
  const directorio = validarDirectorio(datos.directorio);
  const frecuencia = FRECUENCIAS.includes(datos.frecuencia) ? datos.frecuencia : 'diario';
  const hora = /^\d{2}:\d{2}$/.test(String(datos.hora || '')) ? String(datos.hora) : '22:00';
  const dia = Math.min(6, Math.max(0, Number(datos.dia) || 0));
  const conservar = Math.min(60, Math.max(1, Number(datos.conservar) || 14));

  guardar('respaldos_directorio', directorio);
  guardar('respaldos_incluir_firmas', datos.incluirFirmas !== false ? '1' : '0');
  guardar('respaldos_incluir_historias', datos.incluirHistorias !== false ? '1' : '0');
  guardar('respaldos_incluir_configuracion', datos.incluirConfiguracion !== false ? '1' : '0');
  guardar('respaldos_frecuencia', frecuencia);
  guardar('respaldos_hora', hora);
  guardar('respaldos_dia', String(dia));
  guardar('respaldos_conservar', String(conservar));

  const proximo = calcularProximo({ ...leerConfig(), frecuencia, hora, dia }, new Date());
  guardar('respaldos_proximo_en', proximo ? proximo.toISOString() : '');
  cacheTamanos = { cuando: 0, datos: null };

  return leerConfig();
}

export function obtenerClave({ crear = true } = {}) {
  const ruta = resolve(config.sistemaDir, CLAVE_ARCHIVO);
  if (existsSync(ruta)) {
    const clave = Buffer.from(readFileSync(ruta, 'utf8').trim(), 'base64');
    if (clave.length === 32) return clave;
  }
  if (!crear) return null;

  const clave = randomBytes(32);
  mkdirSync(config.sistemaDir, { recursive: true });
  writeFileSync(ruta, `${clave.toString('base64')}\n`, { mode: 0o600 });
  return clave;
}

export function huellaClave() {
  const clave = obtenerClave({ crear: false });
  if (!clave) return null;
  return createHash('sha256').update(clave).digest('hex').slice(0, 16).toUpperCase();
}

export function textoClave() {
  return [
    '# Clave de respaldos ISIM',
    '# Guárdala fuera del servidor. Sin esta clave los respaldos no se pueden abrir.',
    obtenerClave().toString('base64'),
    '',
  ].join('\n');
}

function sumarCarpeta(ruta) {
  if (!existsSync(ruta)) return 0;
  let total = 0;
  for (const entrada of readdirSync(ruta, { withFileTypes: true })) {
    const absoluta = resolve(ruta, entrada.name);
    if (entrada.isDirectory()) total += sumarCarpeta(absoluta);
    else if (entrada.isFile()) {
      try {
        total += statSync(absoluta).size;
      } catch {
        // archivo eliminado durante el cálculo
      }
    }
  }
  return total;
}

export function tamanosFuentes() {
  if (Date.now() - cacheTamanos.cuando < 60_000 && cacheTamanos.datos) {
    return cacheTamanos.datos;
  }

  const base =
    (existsSync(config.dbFile) ? statSync(config.dbFile).size : 0) +
    (existsSync(`${config.dbFile}-wal`) ? statSync(`${config.dbFile}-wal`).size : 0);
  let configuracion = 0;
  const sistema = resolve(config.dataDir, 'sistema');
  if (existsSync(sistema)) {
    for (const entrada of readdirSync(sistema, { withFileTypes: true })) {
      if (!entrada.isFile() || entrada.name === CLAVE_ARCHIVO) continue;
      try {
        configuracion += statSync(resolve(sistema, entrada.name)).size;
      } catch {
        // archivo eliminado
      }
    }
  }

  const datos = {
    base,
    firmas:
      sumarCarpeta(resolve(config.dataDir, 'firmas')) +
      sumarCarpeta(resolve(config.dataDir, 'firmas-medicos')) +
      sumarCarpeta(resolve(config.dataDir, 'fotos')),
    historias: sumarCarpeta(resolve(config.dataDir, 'historias')),
    configuracion,
  };
  datos.total = datos.base + datos.firmas + datos.historias + datos.configuracion;

  cacheTamanos = { cuando: Date.now(), datos };
  return datos;
}

function selloArchivo(iso) {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}

function listarCarpeta(carpeta, prefijo, archivos) {
  const base = resolve(config.dataDir, carpeta);
  if (!existsSync(base)) return;

  const recorrer = (actual) => {
    for (const entrada of readdirSync(actual, { withFileTypes: true })) {
      const absoluta = resolve(actual, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(absoluta);
        continue;
      }
      if (!entrada.isFile()) continue;
      const relativa = `${prefijo}/${absoluta.slice(base.length + 1).split(sep).join('/')}`;
      archivos.push({ ruta: relativa, absoluta, bytes: statSync(absoluta).size });
    }
  };

  recorrer(base);
}

function aplicarRetencion(directorio, conservar) {
  const archivos = readdirSync(directorio, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && PATRON_RESPALDO.test(entrada.name))
    .map((entrada) => ({
      nombre: entrada.name,
      mtime: statSync(resolve(directorio, entrada.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const viejo of archivos.slice(Math.max(1, conservar))) {
    try {
      unlinkSync(resolve(directorio, viejo.nombre));
    } catch {
      // el archivo pudo eliminarse manualmente
    }
  }
}

async function escribirContenedor({ archivo, archivos, items, clave, creado }) {
  const temporal = `${archivo}.tmp`;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const llave = scryptSync(clave, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', llave, iv);
  const salida = createWriteStream(temporal, { mode: 0o600 });
  const hash = createHash('sha256');

  let errorSalida = null;
  salida.on('error', (error) => {
    errorSalida = error;
  });

  const escribir = (buffer) =>
    new Promise((resolvePromise, rejectPromise) => {
      if (!buffer || !buffer.length) return resolvePromise();
      if (errorSalida) return rejectPromise(errorSalida);
      salida.write(buffer, (error) => (error ? rejectPromise(error) : resolvePromise()));
    });

  const escribirPlano = async (buffer) => {
    hash.update(buffer);
    await escribir(cipher.update(buffer));
  };

  try {
    const cabecera = JSON.stringify({
      v: 2,
      kdf: 'scrypt',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      creado,
    });
    await escribir(Buffer.from(`${MAGIC}\n${cabecera}\n`, 'utf8'));

    const manifiesto = Buffer.from(
      JSON.stringify({
        v: 2,
        items,
        archivos: archivos.map(({ ruta, bytes }) => ({ ruta, bytes })),
      }),
      'utf8'
    );
    const longitud = Buffer.alloc(4);
    longitud.writeUInt32BE(manifiesto.length);
    await escribirPlano(longitud);
    await escribirPlano(manifiesto);

    for (const entrada of archivos) {
      for await (const bloque of createReadStream(entrada.absoluta)) {
        await escribirPlano(bloque);
      }
    }

    await escribir(cipher.final());
    await escribir(cipher.getAuthTag());
    await new Promise((resolvePromise, rejectPromise) =>
      salida.end((error) => (error ? rejectPromise(error) : resolvePromise()))
    );
    renameSync(temporal, archivo);

    return { bytes: statSync(archivo).size, hash: hash.digest('hex') };
  } catch (error) {
    try {
      salida.destroy();
    } catch {
      // sin efecto
    }
    if (existsSync(temporal)) {
      try {
        unlinkSync(temporal);
      } catch {
        // sin efecto
      }
    }
    throw error;
  }
}

export async function crearRespaldo({ user = null, automatico = false } = {}) {
  if (ejecutando) throw new Error('Ya hay un respaldo en curso');
  ejecutando = true;

  const id = uid();
  const creado = nowIso();
  const cfg = leerConfig();
  let temporalDb = null;
  let rutaFinal = null;

  try {
    const directorio = validarDirectorio(cfg.directorio);
    const clave = obtenerClave();
    const items = ['base'];
    if (cfg.incluirFirmas) items.push('firmas');
    if (cfg.incluirHistorias) items.push('historias');
    if (cfg.incluirConfiguracion) items.push('configuracion');

    const carpetaTemporal = resolve(config.dataDir, 'tmp');
    mkdirSync(carpetaTemporal, { recursive: true });
    temporalDb = resolve(carpetaTemporal, `respaldo-${id}.db`);
    db.exec(`VACUUM INTO '${temporalDb.replace(/'/g, "''")}'`);

    const archivos = [
      { ruta: 'sgcpm.db', absoluta: temporalDb, bytes: statSync(temporalDb).size },
    ];
    if (cfg.incluirFirmas) {
      listarCarpeta('firmas', 'firmas', archivos);
      listarCarpeta('firmas-medicos', 'firmas-medicos', archivos);
      listarCarpeta('fotos', 'fotos', archivos);
    }
    if (cfg.incluirHistorias) listarCarpeta('historias', 'historias', archivos);
    if (cfg.incluirConfiguracion) {
      const sistema = resolve(config.dataDir, 'sistema');
      if (existsSync(sistema)) {
        for (const entrada of readdirSync(sistema, { withFileTypes: true })) {
          if (!entrada.isFile() || entrada.name === CLAVE_ARCHIVO) continue;
          const absoluta = resolve(sistema, entrada.name);
          archivos.push({
            ruta: `sistema/${entrada.name}`,
            absoluta,
            bytes: statSync(absoluta).size,
          });
        }
      }
    }

    rutaFinal = resolve(directorio, `isim-${selloArchivo(creado)}.isimbk`);
    if (existsSync(rutaFinal)) {
      rutaFinal = resolve(directorio, `isim-${selloArchivo(creado)}-${id.slice(0, 6)}.isimbk`);
    }

    const resultado = await escribirContenedor({
      archivo: rutaFinal,
      archivos,
      items,
      clave,
      creado,
    });

    db.prepare(
      `INSERT INTO backups
         (id, archivo, ruta, bytes, hash, items, estado, error, creado_por, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, 'ok', NULL, ?, ?)`
    ).run(
      id,
      basename(rutaFinal),
      rutaFinal,
      resultado.bytes,
      resultado.hash,
      JSON.stringify(items),
      user?.id ?? null,
      creado
    );

    guardar('respaldos_ultimo_en', creado);
    guardar('respaldos_ultimo_archivo', basename(rutaFinal));
    guardar('respaldos_ultimo_estado', 'ok');
    guardar('respaldos_ultimo_error', '');
    const proximo = calcularProximo(cfg, new Date());
    guardar('respaldos_proximo_en', proximo ? proximo.toISOString() : '');
    aplicarRetencion(directorio, cfg.conservar);
    cacheTamanos = { cuando: 0, datos: null };

    audit(user?.id ?? null, 'respaldo_creado', 'backups', id, {
      archivo: basename(rutaFinal),
      items,
      bytes: resultado.bytes,
      automatico,
    });

    return {
      id,
      archivo: basename(rutaFinal),
      ruta: rutaFinal,
      bytes: resultado.bytes,
      hash: resultado.hash,
      items,
      creadoEn: creado,
      proximoEn: proximo ? proximo.toISOString() : null,
    };
  } catch (error) {
    try {
      db.prepare(
        `INSERT INTO backups
           (id, archivo, ruta, bytes, hash, items, estado, error, creado_por, creado_en)
         VALUES (?, ?, ?, 0, NULL, NULL, 'error', ?, ?, ?)`
      ).run(
        id,
        rutaFinal ? basename(rutaFinal) : '',
        rutaFinal || '',
        String(error.message || 'Error desconocido').slice(0, 500),
        user?.id ?? null,
        creado
      );
    } catch {
      // si la base está bloqueada, no se puede registrar el error
    }
    guardar('respaldos_ultimo_estado', 'error');
    guardar('respaldos_ultimo_error', String(error.message || '').slice(0, 500));
    audit(user?.id ?? null, 'respaldo_error', 'backups', id, {
      error: String(error.message || '').slice(0, 300),
      automatico,
    });
    throw error;
  } finally {
    ejecutando = false;
    if (temporalDb && existsSync(temporalDb)) {
      try {
        unlinkSync(temporalDb);
      } catch {
        // sin efecto
      }
    }
    if (rutaFinal && existsSync(`${rutaFinal}.tmp`)) {
      try {
        unlinkSync(`${rutaFinal}.tmp`);
      } catch {
        // sin efecto
      }
    }
  }
}

function leerCabecera(archivo) {
  const fd = openSync(archivo, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const leidos = readSync(fd, buffer, 0, buffer.length, 0);
    const texto = buffer.subarray(0, leidos).toString('utf8');
    const finPrimera = texto.indexOf('\n');
    const finSegunda = finPrimera >= 0 ? texto.indexOf('\n', finPrimera + 1) : -1;
    if (finPrimera < 0 || finSegunda < 0 || texto.slice(0, finPrimera) !== MAGIC) {
      throw new Error('El archivo no es un respaldo válido de ISIM');
    }
    const cabecera = JSON.parse(texto.slice(finPrimera + 1, finSegunda));
    return {
      cabecera,
      headerBytes: Buffer.byteLength(texto.slice(0, finSegunda + 1), 'utf8'),
    };
  } finally {
    closeSync(fd);
  }
}

export async function verificarRespaldo(nombre) {
  const cfg = leerConfig();
  const archivo = String(nombre ?? '').trim();
  if (!archivo || basename(archivo) !== archivo) {
    throw new Error('Nombre de respaldo no válido');
  }
  const ruta = resolve(cfg.directorio, archivo);
  if (!ruta.startsWith(`${resolve(cfg.directorio)}${sep}`) || !existsSync(ruta)) {
    throw new Error('Respaldo no encontrado');
  }

  const clave = obtenerClave({ crear: false });
  if (!clave) throw new Error('No se encontró la clave de respaldos');

  const { cabecera, headerBytes } = leerCabecera(ruta);
  const tamano = statSync(ruta).size;
  if (tamano <= headerBytes + 16) throw new Error('El respaldo está incompleto');

  const tag = Buffer.alloc(16);
  const fd = openSync(ruta, 'r');
  try {
    readSync(fd, tag, 0, 16, tamano - 16);
  } finally {
    closeSync(fd);
  }

  const llave = scryptSync(clave, Buffer.from(cabecera.salt, 'hex'), 32);
  const decipher = createDecipheriv('aes-256-gcm', llave, Buffer.from(cabecera.iv, 'hex'));
  decipher.setAuthTag(tag);

  const hash = createHash('sha256');
  let buffer = Buffer.alloc(0);
  let longitudManifiesto = null;
  let manifiesto = null;

  return new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(ruta, { start: headerBytes, end: tamano - 17 });

    stream.on('data', (bloque) => {
      try {
        const plano = decipher.update(bloque);
        if (!plano.length) return;
        hash.update(plano);

        if (manifiesto) return;
        buffer = Buffer.concat([buffer, plano]);
        if (longitudManifiesto === null && buffer.length >= 4) {
          longitudManifiesto = buffer.readUInt32BE(0);
        }
        if (
          longitudManifiesto !== null &&
          buffer.length >= 4 + longitudManifiesto
        ) {
          manifiesto = JSON.parse(
            buffer.subarray(4, 4 + longitudManifiesto).toString('utf8')
          );
          buffer = Buffer.alloc(0);
        }
      } catch (error) {
        stream.destroy();
        rejectPromise(error);
      }
    });

    stream.on('error', rejectPromise);
    stream.on('end', () => {
      try {
        const final = decipher.final();
        if (final.length) hash.update(final);
        if (!manifiesto) throw new Error('El manifiesto del respaldo no se encontró');
        resolvePromise({
          ok: true,
          archivo,
          bytes: tamano,
          hash: hash.digest('hex'),
          manifiesto,
        });
      } catch (error) {
        rejectPromise(
          new Error('No se pudo verificar el respaldo: clave incorrecta o archivo alterado')
        );
      }
    });
  });
}

function jsonSeguro(valor) {
  try {
    return valor ? JSON.parse(valor) : null;
  } catch {
    return null;
  }
}

/**
 * Descifra un respaldo y extrae su contenido en la carpeta indicada.
 * Se usa desde el script de restauración, no desde la interfaz.
 */
export async function extraerRespaldo(rutaArchivo, destino, { clave = null, force = false } = {}) {
  if (!existsSync(rutaArchivo)) throw new Error('El respaldo no existe');

  const maestra = clave || obtenerClave({ crear: false });
  if (!maestra) throw new Error('No se encontró la clave de respaldos');

  const { cabecera, headerBytes } = leerCabecera(rutaArchivo);
  const tamano = statSync(rutaArchivo).size;
  if (tamano <= headerBytes + 16) throw new Error('El respaldo está incompleto');

  const tag = Buffer.alloc(16);
  const fd = openSync(rutaArchivo, 'r');
  try {
    readSync(fd, tag, 0, 16, tamano - 16);
  } finally {
    closeSync(fd);
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    scryptSync(maestra, Buffer.from(cabecera.salt, 'hex'), 32),
    Buffer.from(cabecera.iv, 'hex')
  );
  decipher.setAuthTag(tag);

  const temporal = resolve(config.dataDir, 'tmp', `restauracion-${Date.now()}.bin`);
  mkdirSync(dirname(temporal), { recursive: true });
  const salida = createWriteStream(temporal, { mode: 0o600 });

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const stream = createReadStream(rutaArchivo, {
        start: headerBytes,
        end: tamano - 17,
      });
      stream.on('data', (bloque) => {
        try {
          const plano = decipher.update(bloque);
          if (plano.length) salida.write(plano);
        } catch (error) {
          stream.destroy();
          rejectPromise(error);
        }
      });
      stream.on('error', rejectPromise);
      stream.on('end', () => {
        try {
          const final = decipher.final();
          if (final.length) salida.write(final);
          salida.end(resolvePromise);
        } catch (error) {
          rejectPromise(error);
        }
      });
    });
  } catch {
    try {
      salida.destroy();
    } catch {
      // sin efecto
    }
    try {
      unlinkSync(temporal);
    } catch {
      // sin efecto
    }
    throw new Error('No se pudo descifrar el respaldo: clave incorrecta o archivo alterado');
  }

  let manifiesto;
  let longitudManifiesto = 0;
  const lector = openSync(temporal, 'r');
  try {
    const cabeceraManifiesto = Buffer.alloc(4);
    readSync(lector, cabeceraManifiesto, 0, 4, 0);
    longitudManifiesto = cabeceraManifiesto.readUInt32BE(0);
    const contenido = Buffer.alloc(longitudManifiesto);
    readSync(lector, contenido, 0, longitudManifiesto, 4);
    manifiesto = JSON.parse(contenido.toString('utf8'));
  } finally {
    closeSync(lector);
  }

  const destinoAbsoluto = resolve(destino);
  mkdirSync(destinoAbsoluto, { recursive: true });

  const destinos = manifiesto.archivos.map((entrada) => {
    const relativa = String(entrada.ruta).replaceAll('\\', '/');
    const archivoDestino = resolve(destinoAbsoluto, relativa);
    if (!archivoDestino.startsWith(`${destinoAbsoluto}${sep}`)) {
      throw new Error('El respaldo contiene una ruta insegura');
    }
    return { ...entrada, archivoDestino };
  });

  if (!force) {
    const existentes = destinos.filter((entrada) => existsSync(entrada.archivoDestino));
    if (existentes.length) {
      throw new Error(
        `Ya existe ${existentes[0].archivoDestino}. Usa --force para sobrescribir.`
      );
    }
  }

  let offset = 4 + longitudManifiesto;

  const extraidos = [];
  try {
    for (const entrada of destinos) {
      mkdirSync(dirname(entrada.archivoDestino), { recursive: true });
      await pipeline(
        createReadStream(temporal, { start: offset, end: offset + entrada.bytes - 1 }),
        createWriteStream(entrada.archivoDestino)
      );
      offset += entrada.bytes;
      extraidos.push(entrada.archivoDestino);
    }
  } finally {
    try {
      unlinkSync(temporal);
    } catch {
      // sin efecto
    }
  }

  return { manifiesto, extraidos };
}

export function listarRespaldos() {
  return db
    .prepare('SELECT * FROM backups ORDER BY creado_en DESC LIMIT 100')
    .all()
    .map((fila) => ({
      id: fila.id,
      archivo: fila.archivo,
      bytes: fila.bytes,
      hash: fila.hash,
      items: jsonSeguro(fila.items) || [],
      estado: fila.estado,
      error: fila.error,
      creadoEn: fila.creado_en,
      existe: fila.ruta ? existsSync(fila.ruta) : false,
    }));
}

export async function ejecutarSiCorresponde() {
  const cfg = leerConfig();
  if (cfg.frecuencia === 'manual' || ejecutando) return null;

  if (!cfg.proximoEn) {
    const proximo = calcularProximo(cfg, new Date());
    guardar('respaldos_proximo_en', proximo ? proximo.toISOString() : '');
    return null;
  }

  if (new Date(cfg.proximoEn).getTime() > Date.now()) return null;
  return crearRespaldo({ user: null, automatico: true });
}

export function iniciarProgramador() {
  if (temporizador) return;
  temporizador = setInterval(() => {
    ejecutarSiCorresponde().catch((error) => {
      console.error('[respaldos] Error en el respaldo programado:', error.message);
    });
  }, 60_000);
  temporizador.unref?.();

  setTimeout(() => {
    ejecutarSiCorresponde().catch((error) => {
      console.error('[respaldos] Error al recuperar el respaldo pendiente:', error.message);
    });
  }, 5_000).unref?.();
}

export function detenerProgramador() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
