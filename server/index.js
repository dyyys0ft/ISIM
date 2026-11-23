import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { APP_INFO, config } from './config.js';
import { createRouter, json, serveStatic, HttpError } from './lib/http.js';
import { ipLocal } from './lib/red.js';
import { attachSignatureSocket } from './ws/hub.js';
import { cargarCertificadoHttps, estadoHttps, httpsActivo } from './lib/https.js';
import { ensureSeed } from './db/seed.js';
import { ensureConsentimientoIsim } from './lib/consentimientoIsim.js';
import { routes as authRoutes } from './modules/auth.js';
import { routes as patientRoutes } from './modules/patients.js';
import { routes as documentRoutes } from './modules/documents.js';
import { routes as userRoutes } from './modules/users.js';
import { routes as roleRoutes } from './modules/roles.js';
import { routes as registryRoutes } from './modules/registry.js';
import { routes as settingsRoutes } from './modules/settings.js';
import { routes as templateRoutes } from './modules/templates.js';
import { routes as dashboardRoutes } from './modules/dashboard.js';
import { routes as agendaRoutes } from './modules/agenda.js';
import { routes as migrationRoutes } from './modules/migration.js';
import { routes as prescriptionRoutes } from './modules/prescriptions.js';
import { routes as shareRoutes } from './modules/shares.js';
import { routes as crmRoutes } from './modules/crm.js';
import { routes as reportRoutes } from './modules/reports.js';
import { routes as redRoutes } from './modules/red.js';
import { routes as backupRoutes } from './modules/backups.js';
import { routes as catalogRoutes } from './modules/catalogs.js';
import { routes as fichaRoutes } from './modules/ficha.js';
import { detenerProgramador, iniciarProgramador } from './lib/backups.js';
import {
  ipDelCliente,
  accesoPermitido,
  recargarControlIp,
  registrarAccesoIp,
} from './lib/control-ip.js';
import { iniciarProxy, cerrarProxy } from './lib/puerto-acceso.js';

ensureSeed();
ensureConsentimientoIsim();
recargarControlIp();

const RECURSO_BLOQUEO = '/img/acceso-denegado.svg';
const PAGINA_BLOQUEO = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceso denegado · ISIM</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef4fa;color:#0f172a;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:1.5rem;box-sizing:border-box}
  main{max-width:42rem;width:100%;text-align:center}
  img{display:block;width:100%;height:auto;border-radius:1.25rem;box-shadow:0 18px 45px #0f172a26}
  p{margin:1.5rem auto 0;max-width:34rem;line-height:1.6;color:#475569}
  strong{color:#0f172a}
</style></head>
<body><main>
<img src="${RECURSO_BLOQUEO}" alt="Acceso denegado: sitio en mantenimiento">
<p><strong>Su dirección IP no está autorizada.</strong><br>
El sistema puede estar en mantenimiento o su equipo aún no está en la lista de acceso.
Solicite al administrador que lo agregue.</p>
</main></body></html>`;

const router = createRouter();
router.get('/api/health', () => ({
  ok: true,
  version: APP_INFO.version,
  buildId: APP_INFO.buildId,
  hora: new Date().toISOString(),
}));
authRoutes(router);
patientRoutes(router);
documentRoutes(router);
userRoutes(router);
roleRoutes(router);
registryRoutes(router);
settingsRoutes(router);
redRoutes(router);
backupRoutes(router);
catalogRoutes(router);
fichaRoutes(router);
templateRoutes(router);
dashboardRoutes(router);
agendaRoutes(router);
migrationRoutes(router);
prescriptionRoutes(router);
shareRoutes(router);
crmRoutes(router);
reportRoutes(router);

async function manejarSolicitud(req, res) {
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    json(res, 400, { error: 'Solicitud inválida' });
    return;
  }

  // Control de acceso por IP: se aplica a TODO (API, páginas y descargas)
  // antes de cualquier redirección o despacho. El loopback siempre pasa para
  // que el administrador local no quede fuera del sistema.
  const ipCliente = ipDelCliente(req);
  // La imagen de "acceso denegado" debe poder cargarse aunque la IP esté bloqueada.
  if (url.pathname !== RECURSO_BLOQUEO && !accesoPermitido(ipCliente)) {
    console.warn(
      `[red] Acceso bloqueado desde ${ipCliente || 'desconocida'}: ${req.method} ${url.pathname}`
    );
    if (url.pathname.startsWith('/api/')) {
      json(res, 403, {
        error: 'Acceso denegado: esta IP no está autorizada para ingresar al sistema.',
      });
    } else {
      res.writeHead(403, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(PAGINA_BLOQUEO);
    }
    return;
  }

  registrarAccesoIp(ipCliente);

  // Si HTTPS está disponible, las páginas se sirven siempre por HTTPS.
  // El certificado para el celular se deja por HTTP para poder descargarlo.
  const esDescargaCertificado =
    url.pathname === '/isim-ca.crt' ||
    url.pathname === '/isim-ca.cer' ||
    url.pathname === '/isim-ca.pem';

  if (
    config.qrHttps &&
    httpsActivo() &&
    (req.method === 'GET' || req.method === 'HEAD') &&
    !url.pathname.startsWith('/api/') &&
    !esDescargaCertificado
  ) {
    const host = String(req.headers.host || '').split(':')[0];
    res.writeHead(302, {
      location: `https://${host}:${config.httpsPort}${req.url}`,
    });
    res.end();
    return;
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      await router.handle(req, res, url);
    } else {
      await serveStatic(req, res, url, config.publicDir);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      json(res, error.status, { error: error.message });
      return;
    }

    // Varios usuarios pueden coincidir en el mismo instante de escritura.
    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(String(error?.message || ''))) {
      console.error('[db] base de datos ocupada:', error.message);
      if (!res.headersSent) {
        json(res, 503, { error: 'El sistema está ocupado. Intenta de nuevo en unos segundos.' });
      } else {
        res.end();
      }
      return;
    }

    console.error('[error]', error);
    if (!res.headersSent) json(res, 500, { error: 'Error interno del servidor' });
    else res.end();
  }
}

const httpServer = createHttpServer(manejarSolicitud);
attachSignatureSocket(httpServer);

const certificado = cargarCertificadoHttps();
let httpsServer = null;

if (certificado) {
  try {
    httpsServer = createHttpsServer(certificado, manejarSolicitud);
    attachSignatureSocket(httpsServer);
  } catch (error) {
    console.error('[https] No se pudo crear el servidor seguro:', error.message);
    httpsServer = null;
  }
}

httpServer.listen(config.port, config.host, () => {
  const visible = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log('');
  console.log('  ISIM · Sistema de Consentimientos');
  console.log(`  HTTP:  http://${visible}:${config.port}`);
  if (httpsServer) {
    console.log(`  HTTPS: https://${visible}:${config.httpsPort}`);
  }
  if (config.host === '0.0.0.0') {
    const ip = ipLocal();
    if (ip) {
      console.log(`  Red local: http://${ip}:${config.port}`);
      if (httpsServer) console.log(`  Red local: https://${ip}:${config.httpsPort}`);
    }
    console.log('  Red local habilitada (usa la IP del equipo para firmar desde una tablet).');
  }
  console.log('');
});

if (httpsServer) {
  httpsServer.on('error', (error) => {
    console.error('[https] Error del servidor seguro:', error.message);
  });

  httpsServer.listen(config.httpsPort, config.host, () => {
    estadoHttps.activo = true;
    console.log(`  Certificado HTTPS activo en el puerto ${config.httpsPort}.`);
  });
}

// El puerto elegido desde Ajustes se expone en caliente al arrancar.
iniciarProxy().catch((error) => {
  console.error('[red] No se pudo iniciar el puerto de acceso:', error.message);
});

iniciarProgramador();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\nCerrando servidor…');
    detenerProgramador();
    cerrarProxy();
    let pendientes = httpsServer ? 2 : 1;
    const terminar = () => {
      pendientes -= 1;
      if (pendientes <= 0) process.exit(0);
    };

    httpServer.close(terminar);
    if (httpsServer) httpsServer.close(terminar);
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
