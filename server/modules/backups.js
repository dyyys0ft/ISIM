import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { requireUser } from './auth.js';
import {
  crearRespaldo,
  guardarConfig,
  huellaClave,
  leerConfig,
  listarRespaldos,
  tamanosFuentes,
  textoClave,
  verificarRespaldo,
} from '../lib/backups.js';

function estadoRespaldos(user) {
  return {
    ...leerConfig(),
    huellaClave: huellaClave(),
    tamanos: tamanosFuentes(),
    respaldos: listarRespaldos(),
    puedeGestionar: true,
    usuario: user?.username || null,
  };
}

export function routes(router) {
  router.get('/api/settings/backups', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_VER);
    return estadoRespaldos(user);
  });

  router.post('/api/settings/backups/config', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    let config;
    try {
      config = guardarConfig({
        directorio: ctx.body?.directorio,
        frecuencia: ctx.body?.frecuencia,
        hora: ctx.body?.hora,
        dia: ctx.body?.dia,
        conservar: ctx.body?.conservar,
        incluirFirmas: ctx.body?.incluirFirmas === true,
        incluirHistorias: ctx.body?.incluirHistorias === true,
        incluirConfiguracion: ctx.body?.incluirConfiguracion === true,
      });
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    audit(user.id, 'respaldos_configurados', 'settings', 'respaldos', {
      directorio: config.directorio,
      frecuencia: config.frecuencia,
      conservar: config.conservar,
      items: {
        firmas: config.incluirFirmas,
        historias: config.incluirHistorias,
        configuracion: config.incluirConfiguracion,
      },
    });

    return estadoRespaldos(user);
  });

  router.post('/api/settings/backups/run', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    let resultado;
    try {
      resultado = await crearRespaldo({ user });
    } catch (error) {
      throw new HttpError(409, error.message);
    }

    return { ...estadoRespaldos(user), resultado };
  });

  router.post('/api/settings/backups/verify', async (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_VER);

    let resultado;
    try {
      resultado = await verificarRespaldo(ctx.body?.archivo);
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    audit(user.id, 'respaldo_verificado', 'backups', null, {
      archivo: resultado.archivo,
      hash: resultado.hash,
    });

    return resultado;
  });

  router.get('/api/settings/backups/clave', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const contenido = textoClave();
    audit(user.id, 'clave_respaldos_descargada', 'settings', 'respaldos', null);

    ctx.res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': 'attachment; filename="isim-respaldo.key"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    ctx.res.end(contenido);
  });
}
