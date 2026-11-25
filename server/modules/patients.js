import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { db, nowIso, sha256, uid } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { calcularEdad, esMenorDeEdad, representantesDe } from '../lib/edad.js';
import { nombreArchivoSeguro, parseArchivoDataUrl } from '../lib/files.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { requireUser } from './auth.js';

const MAX_EVIDENCIA = 8 * 1024 * 1024;

const CAMPOS = [
  'cedula',
  'nombres',
  'apellidos',
  'fecha_nacimiento',
  'sexo',
  'tipo_doc',
  'telefono',
  'email',
  'direccion',
  'ocupacion',
  'estado_civil',
  'ciudad',
  'instruccion',
  'nacionalidad',
  'etnia',
  'seguro',
  'parroquia',
  'canton',
  'provincia',
  'contacto_nombre',
  'contacto_parentesco',
  'contacto_telefono',
  'empresa',
  'puesto',
  'hc_numero',
  'alergias',
  'fum',
  'embarazada',
  'embarazo_nota',
  'ant_personales',
  'ant_quirurgicos',
  'ant_familiares',
  'grupo_sanguineo',
  'habitos',
  'medicacion_habitual',
  'menarquia',
  'ciclos',
  'gestas',
  'partos',
  'cesareas',
  'abortos',
  'hijos_vivos',
  'mac',
  'ivsa',
  'parejas',
  'ultimo_pap',
  'ultima_mamografia',
  'consentimiento_datos',
  'nota_importante',
  'notas',
  'representante1_nombre',
  'representante1_cedula',
  'representante1_parentesco',
  'representante1_telefono',
  'representante2_nombre',
  'representante2_cedula',
  'representante2_parentesco',
  'representante2_telefono',
];

function limpiar(valor, max = 200) {
  return String(valor ?? '').trim().slice(0, max);
}

function normalizar(body) {
  const data = {};
  for (const campo of CAMPOS) {
    if (body[campo] === undefined) continue;
    const maximo = [
      'notas',
      'alergias',
      'ant_personales',
      'ant_quirurgicos',
      'ant_familiares',
      'habitos',
      'medicacion_habitual',
      'nota_importante',
      'embarazo_nota',
      'consentimiento_datos',
    ].includes(campo)
      ? 2000
      : campo === 'estado_civil'
        ? 40
        : 200;
    data[campo] = limpiar(body[campo], campo.endsWith('_telefono') ? 30 : maximo);
  }
  if (data.sexo && !['F', 'M', 'X'].includes(data.sexo)) data.sexo = '';
  if (data.tipo_doc && !['cedula', 'pasaporte', 'otro'].includes(data.tipo_doc)) {
    data.tipo_doc = 'cedula';
  }
  if (data.fecha_nacimiento && !/^\d{4}-\d{2}-\d{2}$/.test(data.fecha_nacimiento)) {
    throw new HttpError(400, 'La fecha de nacimiento debe tener el formato AAAA-MM-DD');
  }
  if (data.fum && !/^\d{4}-\d{2}-\d{2}$/.test(data.fum)) {
    throw new HttpError(400, 'La FUM debe tener el formato AAAA-MM-DD');
  }
  if (data.embarazada !== undefined) {
    data.embarazada = ['1', 'true', 'on', 'si', 'sí'].includes(
      String(data.embarazada).trim().toLowerCase()
    )
      ? 1
      : 0;
  }
  return data;
}

function validar(data, { parcial = false } = {}) {
  if (!parcial || data.cedula !== undefined) {
    if (!data.cedula) throw new HttpError(400, 'La cédula es obligatoria');
  }
  if (!parcial || data.nombres !== undefined) {
    if (!data.nombres) throw new HttpError(400, 'Los nombres son obligatorios');
  }
  if (!parcial || data.apellidos !== undefined) {
    if (!data.apellidos) throw new HttpError(400, 'Los apellidos son obligatorios');
  }
}

/**
 * Los pacientes menores de 18 años deben tener registrado al menos un
 * representante legal (el segundo es opcional): es quien firma los consentimientos.
 */
function validarRepresentantes(data) {
  if (!esMenorDeEdad(data.fecha_nacimiento)) return;
  if (!data.representante1_nombre || !data.representante1_cedula) {
    throw new HttpError(
      400,
      'El paciente es menor de edad: registra el representante legal 1 (nombre y cédula).'
    );
  }
}

function conDatosCalculados(paciente) {
  if (!paciente) return paciente;
  const {
    consentimiento_evidencia_path,
    consentimiento_evidencia_hash,
    ...datos
  } = paciente;
  const tieneMarca = Boolean(String(paciente.consentimiento_datos ?? '').trim());
  const tieneEvidencia = Boolean(String(consentimiento_evidencia_path ?? '').trim());
  return {
    ...datos,
    consentimientoEstado: {
      marca: tieneMarca,
      evidencia: tieneEvidencia,
      pendienteEvidencia: !tieneEvidencia,
      estado: tieneEvidencia
        ? 'con_evidencia'
        : tieneMarca
          ? 'pendiente_evidencia'
          : 'sin_marca',
    },
    consentimientoEvidencia: consentimiento_evidencia_path
      ? {
          nombre: paciente.consentimiento_evidencia_nombre || 'Evidencia firmada',
          mime: paciente.consentimiento_evidencia_mime || '',
          subidoEn: paciente.consentimiento_evidencia_en || '',
          url: `/api/patients/${paciente.id}/consentimiento-evidencia`,
        }
      : null,
    edad: calcularEdad(paciente.fecha_nacimiento),
    es_menor: esMenorDeEdad(paciente.fecha_nacimiento),
    representantes: representantesDe(paciente),
  };
}

function esConflicto(error) {
  return String(error?.message || '').includes('UNIQUE constraint failed: patients.cedula');
}

/** Escapa los comodines de LIKE para que el término se busque literalmente. */
function escaparLike(valor) {
  return String(valor ?? '').replace(/[!%_]/g, (caracter) => `!${caracter}`);
}

/**
 * Divide la búsqueda libre en términos. Cada término se exige por separado
 * (AND) para que “nombres apellidos” y “apellidos nombres” encuentren igual,
 * sin importar tildes ni mayúsculas. Se limita la cantidad y longitud para no
 * construir consultas enormes desde el autocomplete.
 */
function terminosBusqueda(q) {
  return q
    .split(/\s+/)
    .map((termino) => termino.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((termino) => termino.slice(0, 40));
}

function construirFiltroPacientes(params) {
  const q = limpiar(params.get('q'), 80);
  const nombre = limpiar(params.get('nombre'), 80);
  const apellido = limpiar(params.get('apellido'), 80);
  const cedula = limpiar(params.get('cedula'), 30);
  const sinConsentimiento = params.get('sinConsentimiento') === '1';
  const sinEvidencia = params.get('sinEvidencia') === '1';
  const condiciones = [];
  const valores = [];

  if (q) {
    for (const termino of terminosBusqueda(q)) {
      const like = `%${escaparLike(termino)}%`;
      condiciones.push(
        `(sin_tildes(nombres) LIKE sin_tildes(?) ESCAPE '!'
          OR sin_tildes(apellidos) LIKE sin_tildes(?) ESCAPE '!'
          OR cedula LIKE ? ESCAPE '!')`
      );
      valores.push(like, like, like);
    }
  }
  if (nombre) {
    condiciones.push('sin_tildes(nombres) LIKE sin_tildes(?)');
    valores.push(`%${nombre}%`);
  }
  if (apellido) {
    condiciones.push('sin_tildes(apellidos) LIKE sin_tildes(?)');
    valores.push(`%${apellido}%`);
  }
  if (cedula) {
    condiciones.push('cedula LIKE ?');
    valores.push(`%${cedula}%`);
  }
  if (sinConsentimiento) {
    condiciones.push(
      "(consentimiento_datos IS NULL OR TRIM(consentimiento_datos) = '')"
    );
  }
  if (sinEvidencia) {
    condiciones.push(
      "(consentimiento_evidencia_path IS NULL OR TRIM(consentimiento_evidencia_path) = '')"
    );
  }

  return {
    sql: condiciones.length ? `AND ${condiciones.join(' AND ')}` : '',
    valores,
  };
}

function validarCedulaUnica(cedula, excluirId = null) {
  const existente = excluirId
    ? db.prepare('SELECT id FROM patients WHERE cedula = ? AND id != ?').get(cedula, excluirId)
    : db.prepare('SELECT id FROM patients WHERE cedula = ?').get(cedula);
  if (existente) {
    throw new HttpError(409, 'Ya existe una paciente registrada con esa cédula.');
  }
}

export function routes(router) {
  router.get('/api/patients', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_VER);
    const filtro = construirFiltroPacientes(ctx.url.searchParams);
    const limit = Math.min(Number(ctx.url.searchParams.get('limit') || 300), 500);
    return db
      .prepare(
        `SELECT * FROM patients
         WHERE activo = 1
           ${filtro.sql}
         ORDER BY apellidos COLLATE NOCASE, nombres COLLATE NOCASE
         LIMIT ?`
      )
      .all(...filtro.valores, limit)
      .map(conDatosCalculados);
  });

  router.get('/api/patients/paginated', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_VER);

    const filtro = construirFiltroPacientes(ctx.url.searchParams);
    const ordenes = {
      nombre_asc: 'apellidos COLLATE NOCASE ASC, nombres COLLATE NOCASE ASC',
      nombre_desc: 'apellidos COLLATE NOCASE DESC, nombres COLLATE NOCASE DESC',
      cedula_asc: 'cedula ASC',
      cedula_desc: 'cedula DESC',
      fecha_desc:
        'COALESCE(fecha_registro_informacion, actualizado_en, creado_en) DESC, apellidos COLLATE NOCASE ASC',
      fecha_asc:
        'COALESCE(fecha_registro_informacion, actualizado_en, creado_en) ASC, apellidos COLLATE NOCASE ASC',
    };
    const orden = ordenes[String(ctx.url.searchParams.get('orden') || 'nombre_asc')]
      ? String(ctx.url.searchParams.get('orden') || 'nombre_asc')
      : 'nombre_asc';
    const limit = Math.min(Math.max(Number(ctx.url.searchParams.get('limit') || 24), 1), 100);
    const total = db
      .prepare(
        `SELECT COUNT(*) AS n FROM patients
         WHERE activo = 1
           ${filtro.sql}`
      )
      .get(...filtro.valores).n;
    const incompletos = db
      .prepare(
        `SELECT COUNT(*) AS n FROM patients
         WHERE activo = 1 AND datos_incompletos = 1
           ${filtro.sql}`
      )
      .get(...filtro.valores).n;
    const sinConsentimiento = db
      .prepare(
        `SELECT COUNT(*) AS n FROM patients
         WHERE activo = 1
           AND (consentimiento_datos IS NULL OR TRIM(consentimiento_datos) = '')`
      )
      .get().n;
    const sinEvidencia = db
      .prepare(
        `SELECT COUNT(*) AS n FROM patients
         WHERE activo = 1
           AND (consentimiento_evidencia_path IS NULL OR TRIM(consentimiento_evidencia_path) = '')`
      )
      .get().n;
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(Math.max(Number(ctx.url.searchParams.get('page') || 1), 1), pages);

    const items = db
      .prepare(
        `SELECT * FROM patients
         WHERE activo = 1
           ${filtro.sql}
         ORDER BY ${ordenes[orden]}
         LIMIT ? OFFSET ?`
      )
      .all(...filtro.valores, limit, (page - 1) * limit)
      .map(conDatosCalculados);

    return { items, total, incompletos, sinConsentimiento, sinEvidencia, page, pages, limit };
  });

  // Búsqueda de selección: DTO mínimo para autocompletes. No expone contacto,
  // antecedentes, medicación, representantes ni estado clínico. Quien necesite
  // más datos debe pedir el detalle autorizado de la paciente.
  router.get('/api/patients/search', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_VER);
    const filtro = construirFiltroPacientes(ctx.url.searchParams);
    const limit = Math.min(
      Math.max(Number(ctx.url.searchParams.get('limit') || 20), 1),
      50
    );
    return db
      .prepare(
        `SELECT id, nombres, apellidos, cedula, fecha_nacimiento
         FROM patients
         WHERE activo = 1
           ${filtro.sql}
         ORDER BY apellidos COLLATE NOCASE, nombres COLLATE NOCASE
         LIMIT ?`
      )
      .all(...filtro.valores, limit)
      .map((fila) => ({
        ...fila,
        es_menor: esMenorDeEdad(fila.fecha_nacimiento),
      }));
  });

  router.get('/api/patients/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_VER);
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(ctx.params.id);
    if (!patient) throw new HttpError(404, 'Paciente no encontrado');
    return conDatosCalculados(patient);
  });

  // El contacto se muestra enmascarado; cada revelado queda auditado.
  router.post('/api/patients/:id/contacto-visto', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_VER);

    const paciente = db
      .prepare(
        'SELECT id, nombres, apellidos, telefono, email FROM patients WHERE id = ? AND activo = 1'
      )
      .get(ctx.params.id);
    if (!paciente) throw new HttpError(404, 'Paciente no encontrado');

    audit(user.id, 'contacto_paciente_revelado', 'patients', paciente.id, {
      patientId: paciente.id,
      nombre: `${paciente.nombres} ${paciente.apellidos}`.trim(),
      campos: ['telefono', 'email'],
    });
    ctx.ok({ ok: true });
  });

  router.post('/api/patients', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_CREAR);
    const data = normalizar(ctx.body || {});
    validar(data);
    validarRepresentantes(data);
    validarCedulaUnica(data.cedula);

    const id = uid();
    const ts = nowIso();
    try {
      const columnas = [
        'id',
        ...CAMPOS,
        'fecha_registro_informacion',
        'creado_en',
        'actualizado_en',
      ];
      const valores = CAMPOS.map((campo) => {
        if (campo === 'sexo') return data.sexo || '';
        if (campo === 'tipo_doc') return data.tipo_doc || 'cedula';
        if (campo === 'embarazada') return data.embarazada ? 1 : 0;
        return data[campo] ?? null;
      });
      db.prepare(
        `INSERT INTO patients (${columnas.join(', ')})
         VALUES (${columnas.map(() => '?').join(', ')})`
      ).run(id, ...valores, ts, ts, ts);
    } catch (error) {
      if (esConflicto(error)) {
        throw new HttpError(409, 'Ya existe una paciente registrada con esa cédula.');
      }
      throw error;
    }

    audit(user.id, 'paciente_creado', 'patients', id, { cedula: data.cedula });
    ctx.ok({ id }, 201);
  });

  router.patch('/api/patients/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_EDITAR);
    const actual = db.prepare('SELECT * FROM patients WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Paciente no encontrado');

    const data = normalizar(ctx.body || {});
    const merged = { ...actual, ...data };
    validar(merged);
    validarRepresentantes(merged);
    validarCedulaUnica(merged.cedula, actual.id);

    try {
      const campos = CAMPOS.map((campo) => `${campo} = ?`);
      const valores = CAMPOS.map((campo) => {
        if (campo === 'sexo') return merged.sexo || '';
        if (campo === 'tipo_doc') return merged.tipo_doc || 'cedula';
        if (campo === 'embarazada') return merged.embarazada ? 1 : 0;
        return merged[campo] ?? null;
      });
      db.prepare(
        `UPDATE patients SET
           ${campos.join(', ')},
           datos_incompletos = 0, datos_incompletos_detalle = NULL,
           fecha_registro_informacion = ?,
           actualizado_en = ?
         WHERE id = ?`
      ).run(...valores, nowIso(), nowIso(), ctx.params.id);
    } catch (error) {
      if (esConflicto(error)) {
        throw new HttpError(409, 'Ya existe una paciente registrada con esa cédula.');
      }
      throw error;
    }

    audit(user.id, 'paciente_editado', 'patients', ctx.params.id, null);
    ctx.ok({ ok: true });
  });

  // Evidencia firmada del consentimiento LOPDP (foto o PDF).
  router.post('/api/patients/:id/consentimiento-evidencia', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_EDITAR);

    const paciente = db
      .prepare('SELECT * FROM patients WHERE id = ? AND activo = 1')
      .get(ctx.params.id);
    if (!paciente) throw new HttpError(404, 'Paciente no encontrado');

    const nombre = nombreArchivoSeguro(ctx.body?.nombre, 180);
    const { buffer, mime, ext } = parseArchivoDataUrl(ctx.body?.data, {
      maxBytes: MAX_EVIDENCIA,
    });

    const archivoId = uid();
    const shard =
      String(paciente.id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 2) || '00';
    const relPath = `consentimientos/${shard}/${paciente.id}/${archivoId}.${ext}`;
    const absPath = resolve(config.dataDir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, buffer);

    const anterior = paciente.consentimiento_evidencia_path;
    const ahora = nowIso();
    db.prepare(
      `UPDATE patients SET
         consentimiento_evidencia_path = ?,
         consentimiento_evidencia_mime = ?,
         consentimiento_evidencia_hash = ?,
         consentimiento_evidencia_nombre = ?,
         consentimiento_evidencia_en = ?,
         actualizado_en = ?
       WHERE id = ?`
    ).run(relPath, mime, sha256(buffer), nombre, ahora, ahora, paciente.id);

    if (anterior && anterior !== relPath) {
      try {
        unlinkSync(resolve(config.dataDir, anterior));
      } catch {
        // el archivo anterior pudo no existir
      }
    }

    audit(user.id, 'consentimiento_evidencia_subida', 'patients', paciente.id, {
      mime,
      tamano: buffer.length,
    });
    ctx.ok({ ok: true, nombre, mime, subidoEn: ahora }, 201);
  });

  router.get('/api/patients/:id/consentimiento-evidencia', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_VER);

    const paciente = db
      .prepare(
        `SELECT consentimiento_evidencia_path, consentimiento_evidencia_mime,
                consentimiento_evidencia_nombre
         FROM patients WHERE id = ? AND activo = 1`
      )
      .get(ctx.params.id);
    if (!paciente?.consentimiento_evidencia_path) {
      throw new HttpError(404, 'La paciente no tiene evidencia firmada cargada');
    }

    const absoluta = resolve(config.dataDir, paciente.consentimiento_evidencia_path);
    const base = resolve(config.dataDir);
    if (!absoluta.startsWith(base) || !existsSync(absoluta)) {
      throw new HttpError(404, 'No se encontró el archivo de evidencia');
    }

    const buffer = readFileSync(absoluta);
    const descarga = ctx.url.searchParams.get('download') === '1';
    const nombre = encodeURIComponent(
      paciente.consentimiento_evidencia_nombre || 'consentimiento-firmado'
    );
    ctx.res.writeHead(200, {
      'content-type': paciente.consentimiento_evidencia_mime || 'application/octet-stream',
      'content-length': buffer.length,
      'content-disposition': `${descarga ? 'attachment' : 'inline'}; filename*=UTF-8''${nombre}`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    ctx.res.end(buffer);
  });

  router.delete('/api/patients/:id/consentimiento-evidencia', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_EDITAR);

    const paciente = db
      .prepare(
        `SELECT consentimiento_evidencia_path FROM patients WHERE id = ? AND activo = 1`
      )
      .get(ctx.params.id);
    if (!paciente) throw new HttpError(404, 'Paciente no encontrado');

    db.prepare(
      `UPDATE patients SET
         consentimiento_evidencia_path = NULL,
         consentimiento_evidencia_mime = NULL,
         consentimiento_evidencia_hash = NULL,
         consentimiento_evidencia_nombre = NULL,
         consentimiento_evidencia_en = NULL,
         actualizado_en = ?
       WHERE id = ?`
    ).run(nowIso(), ctx.params.id);

    if (paciente.consentimiento_evidencia_path) {
      try {
        unlinkSync(resolve(config.dataDir, paciente.consentimiento_evidencia_path));
      } catch {
        // el archivo pudo no existir
      }
    }
    audit(user.id, 'consentimiento_evidencia_eliminada', 'patients', ctx.params.id, null);
    ctx.ok({ ok: true });
  });

  // Baja lógica: nunca se borra un paciente con documentos asociados.
  router.delete('/api/patients/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PACIENTES_DESACTIVAR);
    const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(ctx.params.id);
    if (!patient) throw new HttpError(404, 'Paciente no encontrado');

    db.prepare('UPDATE patients SET activo = 0, actualizado_en = ? WHERE id = ?').run(
      nowIso(),
      ctx.params.id
    );
    audit(user.id, 'paciente_desactivado', 'patients', ctx.params.id, null);
    ctx.ok({ ok: true });
  });
}
