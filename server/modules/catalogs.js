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
