import { db, nowIso, uid } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { requireUser } from './auth.js';

/**
 * Catálogos del sistema anterior que usa el frontend ISIM para el CIE-10
 * automático y el recetario.
 */

function texto(valor, max = 80) {
  return String(valor ?? '').trim().slice(0, max);
}

function parsearDatos(valor) {
  if (!valor) return null;
  try {
    const datos = JSON.parse(valor);
    return datos && typeof datos === 'object' ? datos : null;
  } catch {
    return null;
  }
}

function itemsEsquema(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map((item) => ({
      med_id: item?.med_id ?? null,
      comercial: texto(item?.comercial ?? item?.medicamento ?? item?.nombre, 200),
      generico: texto(item?.generico ?? item?.dci, 200),
      forma: texto(item?.forma, 80),
      via: texto(item?.via, 80),
      unidad: texto(item?.unidad, 40),
      cantidad: texto(item?.cantidad, 40),
      indicacion: texto(item?.indicacion ?? item?.indicaciones, 500),
    }))
    .filter((item) => item.comercial || item.generico);
}

/** Convierte una fila de catalogo_tratamientos en el esquema que usa la UI. */
function esquemaPublico(fila) {
  const datos = parsearDatos(fila.datos) || {};
  const items = Array.isArray(datos.items) && datos.items.length
    ? itemsEsquema(datos.items)
    : fila.medicina
      ? itemsEsquema([
          {
            comercial: fila.medicina,
            generico: fila.dci,
            forma: fila.forma,
            via: fila.via,
            cantidad: fila.cantidad,
            indicacion: [fila.dosis, fila.frecuencia, fila.duracion, fila.advertencia]
              .filter(Boolean)
              .join(' · '),
          },
        ])
      : [];

  return {
    id: fila.id,
    nombre: fila.nombre || '',
    diagnostico: datos.diagnostico ?? fila.descripcion ?? '',
    cie: datos.cie ?? '',
    recomendaciones: datos.recomendaciones ?? '',
    para_pareja: datos.para_pareja ? 1 : 0,
    items,
  };
}

function normalizarEsquema(body) {
  const nombre = texto(body?.nombre, 200);
  if (!nombre) throw new HttpError(400, 'El nombre del esquema es obligatorio');
  const items = itemsEsquema(body?.items);
  if (!items.length) throw new HttpError(400, 'Agrega al menos un medicamento al esquema');
  return {
    nombre,
    diagnostico: texto(body?.diagnostico, 300),
    cie: texto(body?.cie, 40),
    recomendaciones: texto(body?.recomendaciones, 3000),
    para_pareja: body?.para_pareja ? 1 : 0,
    items,
  };
}

const MAX_GRUPO_MOTIVO = 80;
const MAX_TEXTO_MOTIVO = 120;

/** Normaliza y valida el orden de un motivo dentro de su grupo. */
function normalizarOrdenMotivo(valor, porDefecto) {
  if (valor === undefined || valor === null || valor === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 999) {
    throw new HttpError(400, 'El orden debe ser un número entero entre 1 y 999');
  }
  return numero;
}

function textoMotivo(valor, campo) {
  const original = String(valor ?? '').trim();
  const maximo = campo === 'grupo' ? MAX_GRUPO_MOTIVO : MAX_TEXTO_MOTIVO;
  if (original.length > maximo) {
    throw new HttpError(
      400,
      `${campo === 'grupo' ? 'El grupo' : 'El motivo'} no puede superar ${maximo} caracteres`
    );
  }
  return original.slice(0, maximo);
}

/** Hay un duplicado activo cuando coinciden grupo y texto sin tildes ni mayúsculas. */
function motivoDuplicado({ grupo, motivo, excluirId = null }) {
  const fila = db
    .prepare(
      `SELECT id FROM motivos_cita
       WHERE activo = 1
         AND sin_tildes(TRIM(grupo)) = sin_tildes(TRIM(?))
         AND sin_tildes(TRIM(motivo)) = sin_tildes(TRIM(?))
         ${excluirId ? 'AND id != ?' : ''}
       LIMIT 1`
    )
    .get(grupo, motivo, ...(excluirId ? [excluirId] : []));
  return Boolean(fila);
}

function siguienteOrdenMotivo(grupo) {
  return db
    .prepare(
      `SELECT COALESCE(MAX(orden), 0) + 1 AS orden
       FROM motivos_cita
       WHERE sin_tildes(TRIM(grupo)) = sin_tildes(TRIM(?))`
    )
    .get(grupo).orden;
}

export function routes(router) {
  router.get('/api/motivos', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_VER);

    const filas = db
      .prepare(
        `SELECT id, grupo, motivo
         FROM motivos_cita
         WHERE activo = 1
         ORDER BY grupo COLLATE NOCASE, orden ASC, motivo COLLATE NOCASE`
      )
      .all();

    const grupos = new Map();
    for (const fila of filas) {
      const grupo = fila.grupo || 'Consultas';
      if (!grupos.has(grupo)) grupos.set(grupo, []);
      grupos.get(grupo).push({ id: fila.id, motivo: fila.motivo });
    }

    return [...grupos.entries()].map(([grupo, motivos]) => ({ grupo, motivos }));
  });

  // Lectura administrativa: incluye motivos activos e inactivos.
  router.get('/api/motivos/admin', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_MOTIVOS);

    return db
      .prepare(
        `SELECT id, grupo, motivo, orden, activo, creado_en
         FROM motivos_cita
         ORDER BY grupo COLLATE NOCASE, activo DESC, orden ASC, motivo COLLATE NOCASE`
      )
      .all();
  });

  router.post('/api/motivos', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_MOTIVOS);

    const grupo = textoMotivo(ctx.body?.grupo, 'grupo') || 'Consultas';
    const motivo = textoMotivo(ctx.body?.motivo, 'motivo');
    if (!motivo) throw new HttpError(400, 'El texto del motivo es obligatorio');
    if (motivoDuplicado({ grupo, motivo })) {
      throw new HttpError(409, 'Ya existe un motivo activo con ese texto en el grupo.');
    }

    const id = uid();
    const orden = normalizarOrdenMotivo(ctx.body?.orden, siguienteOrdenMotivo(grupo));
    const ahora = nowIso();
    db.prepare(
      `INSERT INTO motivos_cita (id, grupo, motivo, orden, activo, creado_en)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(id, grupo, motivo, orden, ahora);

    audit(user.id, 'agenda_motivo_creado', 'motivos_cita', id, { grupo, motivo, orden });
    ctx.ok({ id, grupo, motivo, orden, activo: 1 }, 201);
  });

  router.patch('/api/motivos/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_MOTIVOS);

    const actual = db.prepare('SELECT * FROM motivos_cita WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Motivo no encontrado');

    const grupo =
      ctx.body?.grupo === undefined
        ? actual.grupo
        : textoMotivo(ctx.body.grupo, 'grupo') || 'Consultas';
    const motivo =
      ctx.body?.motivo === undefined
        ? actual.motivo
        : textoMotivo(ctx.body.motivo, 'motivo');
    if (!motivo) throw new HttpError(400, 'El texto del motivo es obligatorio');

    const orden =
      ctx.body?.orden === undefined
        ? actual.orden
        : normalizarOrdenMotivo(ctx.body.orden, actual.orden);
    const activo =
      ctx.body?.activo === undefined ? actual.activo : ctx.body.activo ? 1 : 0;

    if (activo === 1 && motivoDuplicado({ grupo, motivo, excluirId: actual.id })) {
      throw new HttpError(409, 'Ya existe un motivo activo con ese texto en el grupo.');
    }

    db.prepare(
      `UPDATE motivos_cita
       SET grupo = ?, motivo = ?, orden = ?, activo = ?
       WHERE id = ?`
    ).run(grupo, motivo, orden, activo, actual.id);

    const accion =
      actual.activo === 0 && activo === 1
        ? 'agenda_motivo_reactivado'
        : 'agenda_motivo_editado';
    audit(user.id, accion, 'motivos_cita', actual.id, {
      antes: {
        grupo: actual.grupo,
        motivo: actual.motivo,
        orden: actual.orden,
        activo: actual.activo,
      },
      despues: { grupo, motivo, orden, activo },
    });
    ctx.ok({ ok: true });
  });

  // Baja lógica: las citas guardan el texto del motivo y conservan su historial.
  router.delete('/api/motivos/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.AGENDA_MOTIVOS);

    const actual = db.prepare('SELECT * FROM motivos_cita WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Motivo no encontrado');

    if (actual.activo === 1) {
      db.prepare('UPDATE motivos_cita SET activo = 0 WHERE id = ?').run(actual.id);
      audit(user.id, 'agenda_motivo_desactivado', 'motivos_cita', actual.id, {
        grupo: actual.grupo,
        motivo: actual.motivo,
      });
    }
    ctx.ok({ ok: true });
  });

  router.get('/api/catalogs/diagnoses', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const q = texto(ctx.url.searchParams.get('q'));
    const limite = Math.min(
      Math.max(Number(ctx.url.searchParams.get('limit') || 20), 1),
      50
    );

    if (!q) {
      return db
        .prepare(
          `SELECT cie10 AS cie, diagnostico AS descripcion
           FROM catalogo_diagnosticos
           WHERE cie10 IS NOT NULL AND cie10 != ''
           ORDER BY diagnostico COLLATE NOCASE
           LIMIT ?`
        )
        .all(limite);
    }

    const patron = `%${q}%`;
    return db
      .prepare(
        `SELECT cie10 AS cie, diagnostico AS descripcion
         FROM catalogo_diagnosticos
         WHERE cie10 LIKE ? OR diagnostico LIKE ? OR sin_tildes(diagnostico) LIKE sin_tildes(?)
         ORDER BY CASE WHEN cie10 = ? THEN 0 ELSE 1 END, diagnostico COLLATE NOCASE
         LIMIT ?`
      )
      .all(patron, patron, patron, q.toUpperCase(), limite);
  });

  router.get('/api/catalogs/medications', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);

    const q = texto(ctx.url.searchParams.get('q'));
    const limite = Math.min(
      Math.max(Number(ctx.url.searchParams.get('limit') || 20), 1),
      50
    );
    const patron = `%${q}%`;

    const filas = q
      ? db
          .prepare(
            `SELECT id, medicina, dci, forma, via, dosis, frecuencia, duracion, advertencia
             FROM catalogo_medicinas
             WHERE medicina LIKE ? OR dci LIKE ?
                OR sin_tildes(COALESCE(medicina, '')) LIKE sin_tildes(?)
                OR sin_tildes(COALESCE(dci, '')) LIKE sin_tildes(?)
             ORDER BY medicina COLLATE NOCASE
             LIMIT ?`
          )
          .all(patron, patron, patron, patron, limite)
      : db
          .prepare(
            `SELECT id, medicina, dci, forma, via, dosis, frecuencia, duracion, advertencia
             FROM catalogo_medicinas
             ORDER BY medicina COLLATE NOCASE
             LIMIT ?`
          )
          .all(limite);

    return filas.map((fila) => ({
      id: fila.id,
      comercial: fila.medicina || fila.dci || '',
      generico: fila.dci || '',
      forma: fila.forma || '',
      via: fila.via || '',
      dosis: fila.dosis || '',
      frecuencia: fila.frecuencia || '',
      duracion: fila.duracion || '',
      advertencia: fila.advertencia || '',
      indicacion: [fila.dosis, fila.frecuencia, fila.duracion]
        .filter(Boolean)
        .join(' · '),
      unidad: '',
      cantidad: '',
    }));
  });

  // Recetario: esquemas con varios medicamentos y sus indicaciones.
  router.get('/api/catalogs/esquemas', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);
    return db
      .prepare(
        `SELECT * FROM catalogo_tratamientos
         WHERE COALESCE(nombre, '') != ''
         ORDER BY nombre COLLATE NOCASE`
      )
      .all()
      .map(esquemaPublico);
  });

  router.post('/api/catalogs/esquemas', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);
    const esquema = normalizarEsquema(ctx.body);
    const id = uid();
    const primero = esquema.items[0];

    db.prepare(
      `INSERT INTO catalogo_tratamientos
         (id, nombre, descripcion, cantidad, medicina, dci, forma, via, dosis, frecuencia,
          duracion, advertencia, datos, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      esquema.nombre,
      esquema.diagnostico || null,
      Number(primero.cantidad) || null,
      primero.comercial || null,
      primero.generico || null,
      primero.forma || null,
      primero.via || null,
      null,
      null,
      null,
      null,
      JSON.stringify(esquema),
      nowIso()
    );

    audit(user.id, 'esquema_creado', 'catalogo_tratamientos', id, { nombre: esquema.nombre });
    ctx.ok({ id }, 201);
  });

  router.put('/api/catalogs/esquemas/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);
    const actual = db
      .prepare('SELECT id FROM catalogo_tratamientos WHERE id = ?')
      .get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Esquema no encontrado');

    const esquema = normalizarEsquema(ctx.body);
    const primero = esquema.items[0];
    db.prepare(
      `UPDATE catalogo_tratamientos
       SET nombre = ?, descripcion = ?, cantidad = ?, medicina = ?, dci = ?, forma = ?, via = ?,
           datos = ?
       WHERE id = ?`
    ).run(
      esquema.nombre,
      esquema.diagnostico || null,
      Number(primero.cantidad) || null,
      primero.comercial || null,
      primero.generico || null,
      primero.forma || null,
      primero.via || null,
      JSON.stringify(esquema),
      actual.id
    );

    audit(user.id, 'esquema_editado', 'catalogo_tratamientos', actual.id, {
      nombre: esquema.nombre,
    });
    ctx.ok({ ok: true });
  });

  router.delete('/api/catalogs/esquemas/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);
    const actual = db
      .prepare('SELECT id, nombre FROM catalogo_tratamientos WHERE id = ?')
      .get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Esquema no encontrado');
    db.prepare('DELETE FROM catalogo_tratamientos WHERE id = ?').run(actual.id);
    audit(user.id, 'esquema_eliminado', 'catalogo_tratamientos', actual.id, {
      nombre: actual.nombre,
    });
    ctx.ok({ ok: true });
  });
}
