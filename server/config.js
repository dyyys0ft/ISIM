import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const paquete = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// Identificador de compilación: cambia con cada despliegue. En la plataforma
// conviene definir BUILD_ID con el hash del commit; si no, se usa la marca de
// tiempo más reciente de los archivos que forman la aplicación.
function ultimaModificacion(directorio) {
  let marca = 0;
  try {
    for (const relativo of readdirSync(directorio, { recursive: true })) {
      try {
        const info = statSync(resolve(directorio, relativo));
        if (info.isFile()) marca = Math.max(marca, info.mtimeMs);
      } catch {
        // archivo eliminado durante el arranque
      }
    }
  } catch {
    // carpeta no disponible
  }
  return marca;
}

function calcularBuildId() {
  const porEntorno =
    process.env.BUILD_ID ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    '';
  if (porEntorno) return String(porEntorno).slice(0, 40);

  const archivos = [
    'package.json',
    'server/index.js',
    'server/config.js',
    'public/js/chrome.js',
    'public/js/version.js',
    'public/css/isim.css',
  ];
  const marca = Math.max(
    0,
    ...archivos.map((archivo) => {
      try {
        return statSync(resolve(root, archivo)).mtimeMs;
      } catch {
        return 0;
      }
    }),
    ...['server', 'public'].map((carpeta) => ultimaModificacion(resolve(root, carpeta)))
  );
  return `${paquete.version}-${Math.round(marca).toString(36)}`;
}

export const APP_INFO = {
  sistema: 'ISIM · Sistema de Consentimientos',
  version: paquete.version,
  buildId: calcularBuildId(),
  desarrolladoPor: 'dyyys0ft con <3',
  potenciadoPor: 'OpenCode DeepSeek V4.1 Flash',
  stack: 'HTML5 · CSS · JavaScript · Node.js · SQLite · WebSocket',
};

function urlPublica() {
  if (process.env.PUBLIC_URL) return String(process.env.PUBLIC_URL).replace(/\/+$/, '');
  if (process.env.RENDER_EXTERNAL_URL) {
    return String(process.env.RENDER_EXTERNAL_URL).replace(/\/+$/, '');
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`.replace(/\/+$/, '');
  }
  if (process.env.FLY_APP_NAME) {
    return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  }
  return '';
}

// DATA_DIR permite mover la base, las firmas y los archivos a un disco
// persistente (Render, Railway, Fly.io o un VPS) sin cambiar el código.
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : resolve(root, 'data');

export const config = {
  root,
  publicDir: resolve(root, 'public'),
  dataDir,
  firmaDir: resolve(dataDir, 'firmas'),
  medicoFirmaDir: resolve(dataDir, 'firmas-medicos'),
  fotosDir: resolve(dataDir, 'fotos'),
  sistemaDir: resolve(dataDir, 'sistema'),
  historiasDir: resolve(dataDir, 'historias'),
  logoFile: resolve(dataDir, 'sistema', 'logo.png'),
  dbFile: process.env.DB_FILE || resolve(dataDir, 'sgcpm.db'),
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  httpsPort: Number(process.env.HTTPS_PORT || 3443),
  httpsPfx: resolve(dataDir, 'sistema', 'https', 'server.pfx'),
  httpsPassphraseFile: resolve(dataDir, 'sistema', 'https', 'passphrase.txt'),
  // Por defecto el QR usa HTTP para que el celular no tenga que instalar nada.
  qrHttps: process.env.QR_HTTPS === '1',
  publicUrl: urlPublica(),
  sessionTtlMs: 8 * 60 * 60 * 1000, // jornada laboral
  signTtlMs: 10 * 60 * 1000, // vigencia del enlace de firma
  maxJsonBytes: 16 * 1024 * 1024,
  maxSqlBytes: Number(process.env.MAX_SQL_MB || 150) * 1024 * 1024,
};

for (const dir of [
  config.dataDir,
  config.firmaDir,
  config.medicoFirmaDir,
  config.fotosDir,
  config.sistemaDir,
  config.historiasDir,
  resolve(config.sistemaDir, 'https'),
]) {
  mkdirSync(dir, { recursive: true });
}
