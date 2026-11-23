import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { config } from '../config.js';
import { decodificarTexto } from './encoding.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.crt': 'application/x-x509-ca-cert',
  '.cer': 'application/x-x509-ca-cert',
  '.pem': 'application/x-pem-file',
};

export function json(res, status, data, extraHeaders = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': MIME['.json'],
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

export async function readJson(req, limit = 2 * 1024 * 1024) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.includes('application/json')) {
    throw new HttpError(415, 'Se esperaba contenido JSON');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'La petición es demasiado grande');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

export async function readRaw(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'El archivo es demasiado grande');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key) out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, options = {}) {
  const { maxAge, path = '/', httpOnly = true, sameSite = 'Lax', secure = false } = options;
  let cookie = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge != null) cookie += `; Max-Age=${Math.floor(maxAge)}`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  const previous = res.getHeader('Set-Cookie');
  const list = previous ? [].concat(previous) : [];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const source = pattern.replace(/\/:([A-Za-z_]+)/g, (_, key) => {
      keys.push(key);
      return '/([^/]+)';
    });
    routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
  }

  async function handle(req, res, url) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    let route = null;
    let params = {};

    for (const candidate of routes) {
      if (candidate.method !== method) continue;
      const match = candidate.regex.exec(url.pathname);
      if (!match) continue;
      route = candidate;
      params = Object.fromEntries(
        candidate.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])])
      );
      break;
    }

    if (!route) throw new HttpError(404, 'Recurso no encontrado');

    let body = {};
    let rawBody = null;
    const hasBody =
      Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding']);
    if (hasBody && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const tipo = String(req.headers['content-type'] || '').toLowerCase();
      if (tipo.includes('application/sql')) {
        body = { sql: decodificarTexto(await readRaw(req, config.maxSqlBytes)) };
      } else if (url.pathname === '/api/whatsapp/webhook') {
        rawBody = await readRaw(req, config.maxJsonBytes);
        try {
          body = JSON.parse(rawBody.toString('utf8'));
        } catch {
          throw new HttpError(400, 'JSON inválido');
        }
      } else {
        body = await readJson(req, config.maxJsonBytes);
      }
    }

    const ctx = {
      req,
      res,
      url,
      params,
      body,
      rawBody,
      user: null,
      ok(data, status = 200) {
        json(res, status, data);
      },
    };

    const result = await route.handler(ctx);
    if (result !== undefined && !res.headersSent) json(res, 200, result);
  }

  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),
    handle,
  };
}

export async function serveStatic(req, res, url, rootDir) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Ruta inválida');
  }

  if (pathname === '/') pathname = '/index.html';

  const root = resolve(rootDir);
  const candidates = [pathname];
  if (!extname(pathname)) candidates.push(`${pathname}.html`);

  for (const candidate of candidates) {
    const file = resolve(root, `.${candidate}`);
    if (file !== root && !file.startsWith(root + sep)) continue;

    try {
      const info = await stat(file);
      if (!info.isFile()) continue;

      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      });

      if (req.method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
      return;
    } catch {
      // continúa con el siguiente candidato
    }
  }

  res.writeHead(404, { 'content-type': MIME['.html'] });
  res.end('<!doctype html><meta charset="utf-8"><title>404</title><h1>404 — Página no encontrada</h1>');
}
