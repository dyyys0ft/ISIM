import { db, nowIso, uid } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { direccionCentro, logoActual, nombreCentro, textoPieActual } from '../lib/branding.js';
import { renderPlantilla } from './documents.js';
import { normalizarModoFirma } from '../lib/firmas.js';
import { requireUser } from './auth.js';

function limpiar(valor, max = 160) {
  return String(valor ?? '').trim().slice(0, max);
}

function requireGestor(ctx) {
  const user = requireUser(ctx);
  exigir(user, PERMISOS.PLANTILLAS_GESTIONAR);
  return user;
}

export function routes(router) {
  router.get('/api/templates/admin', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.PLANTILLAS_GESTIONAR);
    return db
      .prepare(
        `SELECT id, nombre, tipo, cuerpo_html, firma_modo, activo, creado_en
         FROM templates ORDER BY activo DESC, nombre COLLATE NOCASE`
      )
      .all();
  });

  router.get('/api/templates/:id/preview', (ctx) => {
    const user = requireGestor(ctx);

    const plantilla = db.prepare('SELECT * FROM templates WHERE id = ?').get(ctx.params.id);
    if (!plantilla) throw new HttpError(404, 'Plantilla no encontrada');

    // Paciente ficticia: la vista previa nunca expone datos de pacientes reales.
    const paciente = {
      id: 'paciente-de-prueba',
      nombres: 'Paciente',
      apellidos: 'de Prueba',
      nombre_completo: 'Paciente de Prueba',
      cedula: '9999999999',
      fecha_nacimiento: '1990-05-15',
      sexo: 'F',
      telefono: '0999999999',
      email: 'paciente.prueba@isim.local',
      direccion: 'Dirección de prueba',
      alergias: 'Ninguna',
      representante1_nombre: '',
      representante1_cedula: '',
      representante1_parentesco: '',
      representante1_telefono: '',
      representante2_nombre: '',
      representante2_cedula: '',
      representante2_parentesco: '',
      representante2_telefono: '',
    };

    const medico =
      db
        .prepare(
          `SELECT * FROM users
           WHERE rol = 'medico' AND activo = 1
           ORDER BY nombre COLLATE NOCASE
           LIMIT 1`
        )
        .get() || user;

    return {
      id: plantilla.id,
      nombre: plantilla.nombre,
      tipo: plantilla.tipo,
      html: renderPlantilla(plantilla.cuerpo_html, {
        patient: paciente,
        user: medico || { nombre: 'Profesional de ejemplo' },
      }),
      firmaModo: normalizarModoFirma(plantilla.firma_modo) || 'ambas',
      centro: { nombre: nombreCentro(), direccion: direccionCentro() },
      logoUrl: logoActual(),
      pieTexto: textoPieActual(),
      paciente: {
        nombres: paciente.nombres,
        apellidos: paciente.apellidos,
        cedula: paciente.cedula,
        fecha_nacimiento: paciente.fecha_nacimiento,
        es_menor: false,
        representantes: [],
      },
      medico: medico
        ? {
            id: medico.id,
            nombre: medico.nombre,
            cedula: medico.cedula || '',
            especialidad: medico.especialidad || '',
            senecit: medico.senecit || '',
          }
        : null,
    };
  });

  router.post('/api/templates', (ctx) => {
    const user = requireGestor(ctx);
    const nombre = limpiar(ctx.body?.nombre, 120);
    const tipo = limpiar(ctx.body?.tipo, 40) || 'general';
    const cuerpo = String(ctx.body?.cuerpo_html || '').trim();
    const activo = ctx.body?.activo === false || ctx.body?.activo === 0 ? 0 : 1;
    const firmaModo = normalizarModoFirma(ctx.body?.firmaModo);

    if (!nombre) throw new HttpError(400, 'El nombre de la plantilla es obligatorio');
    if (cuerpo.replace(/<[^>]+>/g, '').trim().length < 20) {
      throw new HttpError(400, 'El contenido de la plantilla es demasiado corto');
    }
    if (ctx.body?.firmaModo !== undefined && !firmaModo) {
      throw new HttpError(400, 'El modo de firma de la plantilla no es válido');
    }

    const id = uid();
    db.prepare(
      `INSERT INTO templates (id, nombre, tipo, cuerpo_html, firma_modo, activo, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, nombre, tipo, cuerpo, firmaModo || 'ambas', activo, nowIso());

    audit(user.id, 'plantilla_creada', 'templates', id, { nombre });
    ctx.ok({ id }, 201);
  });

  router.patch('/api/templates/:id', (ctx) => {
    const user = requireGestor(ctx);
    const actual = db.prepare('SELECT * FROM templates WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Plantilla no encontrada');

    const cambios = {};
    if (ctx.body?.nombre !== undefined) {
      const nombre = limpiar(ctx.body.nombre, 120);
      if (!nombre) throw new HttpError(400, 'El nombre es obligatorio');
      cambios.nombre = nombre;
    }
    if (ctx.body?.tipo !== undefined) cambios.tipo = limpiar(ctx.body.tipo, 40) || 'general';
    if (ctx.body?.cuerpo_html !== undefined) {
      const cuerpo = String(ctx.body.cuerpo_html || '').trim();
      if (cuerpo.replace(/<[^>]+>/g, '').trim().length < 20) {
        throw new HttpError(400, 'El contenido de la plantilla es demasiado corto');
      }
      cambios.cuerpo_html = cuerpo;
    }
    if (ctx.body?.activo !== undefined) cambios.activo = ctx.body.activo ? 1 : 0;
    if (ctx.body?.firmaModo !== undefined) {
      const firmaModo = normalizarModoFirma(ctx.body.firmaModo);
      if (!firmaModo) throw new HttpError(400, 'El modo de firma de la plantilla no es válido');
      cambios.firma_modo = firmaModo;
    }

    if (!Object.keys(cambios).length) throw new HttpError(400, 'No hay cambios para guardar');

    const campos = Object.keys(cambios).map((columna) => `${columna} = ?`);
    const valores = Object.values(cambios);
    valores.push(actual.id);
    db.prepare(`UPDATE templates SET ${campos.join(', ')} WHERE id = ?`).run(...valores);

    audit(user.id, 'plantilla_editada', 'templates', actual.id, null);
    ctx.ok({ ok: true });
  });

  router.delete('/api/templates/:id', (ctx) => {
    const user = requireGestor(ctx);
    const actual = db.prepare('SELECT id FROM templates WHERE id = ?').get(ctx.params.id);
    if (!actual) throw new HttpError(404, 'Plantilla no encontrada');

    // Baja lógica: los documentos creados con ella no se alteran.
    db.prepare('UPDATE templates SET activo = 0 WHERE id = ?').run(actual.id);
    audit(user.id, 'plantilla_desactivada', 'templates', actual.id, null);
    ctx.ok({ ok: true });
  });
}
