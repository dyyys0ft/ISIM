import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, nowIso, uid } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { leerDump, parsearDump, resumirDump } from '../lib/migracion/oldDb.js';

import { migrarTablas } from '../lib/migracion/migrar.js';
import { depurarDuplicados, previsualizarDuplicados } from '../lib/migracion/depurar.js';
import { requireUser } from './auth.js';

function carpetaMigracion() {
  const carpeta = resolve(config.dataDir, 'migracion');
  mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

function nombreSeguro(nombre) {
  return String(nombre || 'old_db.sql')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .slice(0, 180);
}

function serializar(resumen) {
  return JSON.stringify(resumen ?? {});
}

export function routes(router) {
  router.post('/api/migration/old-db/analyze', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const sql = String(ctx.body?.sql || '');
    if (!sql.trim()) {
      throw new HttpError(400, 'Selecciona un archivo old_db.sql válido');
    }

    const id = uid();
    const archivo = resolve(carpetaMigracion(), `${id}.sql`);
    writeFileSync(archivo, sql, 'utf8');

    let tablas;
    try {
      tablas = parsearDump(sql);
    } catch (error) {
      throw new HttpError(400, `No se pudo leer el archivo SQL: ${error.message}`);
    }

    const resumen = resumirDump(tablas);
    const creado = nowIso();
    db.prepare(
      `INSERT INTO migration_runs
         (id, nombre_archivo, archivo, estado, resumen, creado_por, creado_en)
       VALUES (?, ?, ?, 'analizado', ?, ?, ?)`
    ).run(
      id,
      nombreSeguro(ctx.req.headers['x-nombre-archivo']),
      archivo,
      serializar(resumen),
      user.id,
      creado
    );

    audit(user.id, 'migracion_analizada', 'migration_runs', id, {
      archivo: nombreSeguro(ctx.req.headers['x-nombre-archivo']),
      pacientes: resumen.pacientes?.total,
      citas: resumen.citas?.total,
      consultas: resumen.consultas?.total,
    });

    ctx.ok({ id, estado: 'analizado', resumen });
  });

  router.post('/api/migration/old-db/run', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const id = String(ctx.body?.id || '').trim();
    if (!id) throw new HttpError(400, 'Falta el identificador del análisis');

    const corrida = db.prepare('SELECT * FROM migration_runs WHERE id = ?').get(id);
    if (!corrida) throw new HttpError(404, 'Análisis de migración no encontrado');
    if (corrida.estado === 'completado') {
      throw new HttpError(409, 'Esta migración ya fue completada');
    }
    if (!existsSync(corrida.archivo)) {
      throw new HttpError(404, 'El archivo SQL ya no está disponible');
    }

    db.prepare(
      "UPDATE migration_runs SET estado = 'migrando', error = NULL WHERE id = ?"
    ).run(id);

    const carpetaRespaldo = resolve(config.dataDir, 'backups');
    mkdirSync(carpetaRespaldo, { recursive: true });
    const respaldo = resolve(
      carpetaRespaldo,
      `sgcpm-antes-migracion-${id.slice(0, 8)}.db`
    );

    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      copyFileSync(config.dbFile, respaldo);
    } catch (error) {
      db.prepare("UPDATE migration_runs SET estado = 'error', error = ? WHERE id = ?").run(
        `No se pudo crear el respaldo: ${error.message}`,
        id
      );
      throw new HttpError(500, 'No se pudo crear el respaldo antes de migrar');
    }

    try {
      const tablas = leerDump(corrida.archivo);
      const origen = resumirDump(tablas);
      const resumen = migrarTablas(tablas, {
        runId: id,
        conservarClavesAntiguas: ctx.body?.conservarClavesAntiguas === true,
      });
      const resumenFinal = { ...resumen, origen, respaldo };
      const finalizado = nowIso();

      db.prepare(
        `UPDATE migration_runs
         SET estado = 'completado', resumen = ?, finalizado_en = ?
         WHERE id = ?`
      ).run(serializar(resumenFinal), finalizado, id);

      audit(user.id, 'migracion_completada', 'migration_runs', id, resumenFinal);
      ctx.ok({ id, estado: 'completado', resumen: resumenFinal });
    } catch (error) {
      db.prepare(
        "UPDATE migration_runs SET estado = 'error', error = ?, finalizado_en = ? WHERE id = ?"
      ).run(String(error.message || error), nowIso(), id);
      throw new HttpError(500, `La migración falló: ${error.message}`);
    }
  });

  router.get('/api/migration/duplicados', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);
    return previsualizarDuplicados();
  });

  router.post('/api/migration/depurar', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    const antes = previsualizarDuplicados();
    if (!antes.pacientes.eliminables && !antes.historias.eliminables) {
      return { ok: true, antes, resumen: null, mensaje: 'No hay duplicados pendientes' };
    }

    const carpetaRespaldo = resolve(config.dataDir, 'backups');
    mkdirSync(carpetaRespaldo, { recursive: true });
    const respaldo = resolve(
      carpetaRespaldo,
      `sgcpm-antes-depuracion-${nowIso().replace(/[:.]/g, '-')}.db`
    );

    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    copyFileSync(config.dbFile, respaldo);

    const resumen = depurarDuplicados();
    audit(user.id, 'duplicados_depurados', 'migration_runs', null, {
      antes,
      resumen,
      respaldo,
    });
    ctx.ok({ ok: true, antes, resumen, respaldo });
  });

  router.get('/api/migration/old-db/runs', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.CONFIGURACION_GESTIONAR);

    return db
      .prepare(
        `SELECT id, nombre_archivo, estado, resumen, error, creado_en, finalizado_en
         FROM migration_runs
         ORDER BY creado_en DESC
         LIMIT 10`
      )
      .all()
      .map((fila) => ({
        ...fila,
        resumen: fila.resumen ? JSON.parse(fila.resumen) : null,
      }));
  });
}
