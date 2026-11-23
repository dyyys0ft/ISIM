import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, nowIso, sha256, tx, uid } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { PERMISOS, exigir } from '../lib/permissions.js';
import { requireUser } from './auth.js';
import { direccionCentro, logoActual, nombreCentro, textoPieActual } from '../lib/branding.js';
import { normalizarModoFirma, usaFirmaPaciente } from '../lib/firmas.js';
import {
  calcularEdad,
  esMenorDeEdad,
  representantePrincipal,
  representantesDe,
} from '../lib/edad.js';
import { ipLocal, urlBasePublica } from '../lib/red.js';
import { textosConsentimientoActuales } from '../lib/consentimientoIsim.js';

const CONTENIDO_BASE = `
<p class="doc-fecha-carta">Riobamba, {{fecha}}</p>
<h2>CONSENTIMIENTO INFORMADO</h2>
<p class="doc-meta"><strong>Institución:</strong> {{institucion}}</p>
<hr>
<p>Yo, <strong>{{paciente.nombre_completo}}</strong>, con Cédula de Identidad <strong>{{paciente.cedula}}</strong>, en pleno uso de mis facultades, declaro que he sido informada/o de manera clara, suficiente y oportuna sobre el procedimiento médico que se me realizará, sus beneficios, riesgos, alternativas y cuidados posteriores.</p>
<p>Autorizo al personal de salud de {{institucion}} a realizar el procedimiento descrito, así como los procedimientos adicionales que resulten necesarios durante su ejecución.</p>
<p>Se me ha dado la oportunidad de formular preguntas y todas han sido respondidas satisfactoriamente.</p>
<div class="doc-firmas">
  <div class="firma-celda" data-firma="paciente">
    <span class="firma-linea"></span>
    <span class="firma-rol">Firma de la paciente</span>
    <strong class="firma-nombre">{{paciente.nombre_completo}}</strong>
    <small class="firma-cedula">C.I. {{paciente.cedula}}</small>
  </div>
  <div class="firma-celda" data-firma="medico">
    <span class="firma-linea"></span>
    <span class="firma-rol">Firma del profesional</span>
    <strong class="firma-nombre">{{usuario.nombre}}</strong>
    <small class="firma-especialidad">Especialidad: {{usuario.especialidad}}</small>
    <small class="firma-cedula">C.I. {{usuario.cedula}}</small>
    <small class="firma-senecit">{{usuario.senecit}}</small>
  </div>
</div>
`;

function escaparHtml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function datosDocumento(valor) {
  if (!valor) return null;
  try {
    const datos = JSON.parse(valor);
    return datos && typeof datos === 'object' ? datos : null;
  } catch {
    return null;
  }
}

export function renderPlantilla(html, { patient, user }) {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const hora = ahora.toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const fechaHora = `${fecha} a las ${hora}`;
  const edad = calcularEdad(patient.fecha_nacimiento);
  const esMenor = esMenorDeEdad(patient.fecha_nacimiento);

  const valores = {
    'paciente.nombres': patient.nombres,
    'paciente.apellidos': patient.apellidos,
    'paciente.nombre_completo': `${patient.nombres} ${patient.apellidos}`,
    'paciente.cedula': patient.cedula,
    'paciente.fecha_nacimiento': patient.fecha_nacimiento || '',
    'paciente.edad': edad ?? '',
    'paciente.edad_texto': edad === null ? 'No registrada' : `${edad} años`,
    'paciente.telefono': patient.telefono || '',
    'paciente.direccion': patient.direccion || '',
    'paciente.representante1_nombre': patient.representante1_nombre || '',
    'paciente.representante1_cedula': patient.representante1_cedula || '',
    'paciente.representante1_parentesco': patient.representante1_parentesco || '',
    'paciente.representante1_telefono': patient.representante1_telefono || '',
    'paciente.representante2_nombre': patient.representante2_nombre || '',
    'paciente.representante2_cedula': patient.representante2_cedula || '',
    'paciente.representante2_parentesco': patient.representante2_parentesco || '',
    'paciente.representante2_telefono': patient.representante2_telefono || '',
    'usuario.nombre': user.nombre,
    'usuario.cedula': user.cedula || '',
    'usuario.senecit': user.senecit || '',
    'usuario.especialidad': user.especialidad || '',
    institucion: nombreCentro(),
    'centro.nombre': nombreCentro(),
    'centro.direccion': direccionCentro() || '',
    fecha,
    hora,
    fecha_hora: fechaHora,
  };

  // Los textos de negativa, revocatoria y declaración son configurables.
  // Se interpolan primero para que admitan datos de la paciente.
  const textosConsentimiento = textosConsentimientoActuales();
  const interpolar = (texto) =>
    String(texto || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (original, clave) =>
      clave in valores ? String(valores[clave] ?? '') : original
    );
  valores['consentimiento.declaracion'] = interpolar(textosConsentimiento.declaracion);
  valores['consentimiento.negativa'] = interpolar(textosConsentimiento.negativa);
  valores['consentimiento.revocatoria'] = interpolar(textosConsentimiento.revocatoria);

  // Bloques condicionales según la edad de la paciente.
  let resultado = String(html || '');
  resultado = resultado.replace(
    /\{\{#adulto\}\}([\s\S]*?)\{\{\/adulto\}\}/g,
    (_, contenido) => (esMenor ? '' : contenido)
  );
  resultado = resultado.replace(
    /\{\{#menor\}\}([\s\S]*?)\{\{\/menor\}\}/g,
    (_, contenido) => (esMenor ? contenido : '')
  );

  return resultado.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (original, clave) =>
    clave in valores ? escaparHtml(valores[clave]) : original
  );
}

function documentoDe(ctx) {
  const doc = db
    .prepare(
      `SELECT d.*, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
              p.fecha_nacimiento, p.sexo, p.telefono, p.email, p.direccion, p.alergias,
              p.representante1_nombre, p.representante1_cedula, p.representante1_parentesco,
              p.representante1_telefono, p.representante2_nombre, p.representante2_cedula,
              p.representante2_parentesco, p.representante2_telefono,
              t.tipo AS template_tipo, t.nombre AS template_nombre
       FROM documents d
       JOIN patients p ON p.id = d.patient_id
       LEFT JOIN templates t ON t.id = d.template_id
       WHERE d.id = ?`
    )
    .get(ctx.params.id);
  if (!doc) throw new HttpError(404, 'Documento no encontrado');
  return doc;
}

function datosDelFirmante(doc) {
  const esMenor = esMenorDeEdad(doc.fecha_nacimiento);
  const principal = esMenor ? representantePrincipal(doc) : null;

  return {
    esMenor,
    edad: calcularEdad(doc.fecha_nacimiento),
    representantes: esMenor ? representantesDe(doc) : [],
    firmante: principal
      ? {
          nombre: principal.nombre,
          cedula: principal.cedula,
          parentesco: principal.parentesco,
          rol: 'Firma del representante legal',
        }
      : null,
  };
}

function medicoDelDocumento(doc) {
  let medicoId = doc.medico_id || doc.created_by;
  let medico = medicoId
    ? db
        .prepare(
          'SELECT id, nombre, cedula, senecit, especialidad, rol, firma_png_path, firma_actualizada_en FROM users WHERE id = ?'
        )
        .get(medicoId)
    : null;

  if (!medico || medico.rol !== 'medico') {
    medico = db
      .prepare(
        `SELECT id, nombre, cedula, senecit, especialidad, rol, firma_png_path, firma_actualizada_en
         FROM users
         WHERE rol = 'medico' AND activo = 1
         ORDER BY nombre COLLATE NOCASE
         LIMIT 1`
      )
      .get();
  }

  return medico || null;
}

function versionActual(doc) {
  return db
    .prepare('SELECT * FROM document_versions WHERE document_id = ? AND numero = ?')
    .get(doc.id, doc.version_actual);
}

function listarDocumentos({ q = '', estado = '', patientId = '', limit = 200 }) {
  const like = `%${q}%`;
  return db
    .prepare(
      `SELECT d.id, d.codigo, d.titulo, d.estado, d.version_actual, d.creado_en, d.actualizado_en,
              p.id AS patient_id, p.nombres, p.apellidos, p.cedula AS paciente_cedula,
              (SELECT v.estado FROM document_versions v
                WHERE v.document_id = d.id AND v.numero = d.version_actual) AS version_estado,
              (SELECT COUNT(*) FROM signatures s WHERE s.document_id = d.id) AS firmas
       FROM documents d
       JOIN patients p ON p.id = d.patient_id
       WHERE (? = '' OR d.titulo LIKE ? OR p.nombres LIKE ? OR p.apellidos LIKE ? OR p.cedula LIKE ? OR d.codigo LIKE ?)
         AND (? = '' OR d.estado = ?)
         AND (? = '' OR d.patient_id = ?)
       ORDER BY d.actualizado_en DESC, d.creado_en DESC
       LIMIT ?`
    )
    .all(q, like, like, like, like, like, estado, estado, patientId, patientId, limit);
}

function siguienteCodigo() {
  const anio = new Date().getFullYear();
  const prefijo = `ISIM-${anio}-`;
  const ultimo = db
    .prepare('SELECT codigo FROM documents WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1')
    .get(`${prefijo}%`);
  const numero = ultimo ? Number(ultimo.codigo.slice(prefijo.length)) + 1 : 1;
  return `${prefijo}${String(numero).padStart(6, '0')}`;
}

export function routes(router) {
  router.get('/api/templates', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);
    return db
      .prepare('SELECT id, nombre, tipo FROM templates WHERE activo = 1 ORDER BY nombre')
      .all();
  });

  router.get('/api/documents', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);
    const params = ctx.url.searchParams;
    return listarDocumentos({
      q: String(params.get('q') || '').trim().slice(0, 80),
      estado: String(params.get('estado') || '').trim(),
      patientId: String(params.get('patientId') || '').trim(),
      limit: Math.min(Number(params.get('limit') || 200), 500),
    });
  });

  router.get('/api/patients/:id/documents', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);
    return listarDocumentos({ patientId: ctx.params.id, limit: 200 });
  });

  function crearDocumento(user, datos) {
    const {
      patientId,
      appointmentId,
      templateId,
      titulo,
      contenidoHtml,
      medicoId,
      subtipo: subtipoCrudo,
      datos: datosDocumento,
    } = datos || {};
    const subtipo = ['consentimiento', 'iess', 'atencion'].includes(subtipoCrudo)
      ? subtipoCrudo
      : 'consentimiento';
    const idPaciente = String(patientId || '').trim();
    if (!idPaciente) throw new HttpError(400, 'Selecciona un paciente válido');

    const patient = db
      .prepare('SELECT * FROM patients WHERE id = ? AND activo = 1')
      .get(idPaciente);
    if (!patient) throw new HttpError(400, 'Selecciona un paciente válido');

    let cita = null;
    if (appointmentId) {
      cita = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
      if (!cita) throw new HttpError(400, 'La cita seleccionada no existe');
      if (cita.patient_id !== patient.id) {
        throw new HttpError(400, 'La cita no corresponde al paciente seleccionado');
      }
    }

    let template = null;
    if (templateId) {
      template = db.prepare('SELECT * FROM templates WHERE id = ? AND activo = 1').get(templateId);
      if (!template) throw new HttpError(400, 'La plantilla seleccionada no existe');
    }

    // Cada plantilla define sus firmas; el ajuste global solo aplica a documentos en blanco.
    const firmaModo = normalizarModoFirma(template?.firma_modo) || 'ambas';
    if (
      usaFirmaPaciente(firmaModo) &&
      esMenorDeEdad(patient.fecha_nacimiento) &&
      !representantePrincipal(patient)
    ) {
      throw new HttpError(
        409,
        'El paciente es menor de edad. Registra al representante legal antes de crear el consentimiento.'
      );
    }

    let profesional = null;
    if (medicoId) {
      profesional = db
        .prepare(
          `SELECT id, nombre, cedula, senecit, especialidad, rol, firma_png_path FROM users
           WHERE id = ? AND rol = 'medico' AND activo = 1`
        )
        .get(medicoId);
      if (!profesional) throw new HttpError(400, 'El médico seleccionado no es válido');
    } else if (user.rol === 'medico') {
      profesional = db
        .prepare('SELECT id, nombre, cedula, senecit, especialidad, rol, firma_png_path FROM users WHERE id = ?')
        .get(user.id);
    } else {
      // Si no se elige médico, se asigna el primer médico activo para que el
      // documento siempre tenga cédula, especialidad y SENECYT del profesional.
      profesional = db
        .prepare(
          `SELECT id, nombre, cedula, senecit, especialidad, rol, firma_png_path
           FROM users
           WHERE rol = 'medico' AND activo = 1
           ORDER BY nombre COLLATE NOCASE
           LIMIT 1`
        )
        .get();
    }

    const cuerpo = String(contenidoHtml || template?.cuerpo_html || CONTENIDO_BASE);
    const html = renderPlantilla(cuerpo, { patient, user: profesional || user });
    if (html.replace(/<[^>]+>/g, '').trim().length < 20) {
      throw new HttpError(400, 'El contenido del documento está vacío');
    }

    const nombre = String(titulo || template?.nombre || 'Consentimiento informado')
      .trim()
      .slice(0, 200);
    const id = uid();
    const versionId = uid();
    const ts = nowIso();
    const emitido = !usaFirmaPaciente(firmaModo);
    const estadoDocumento = emitido ? 'firmado' : 'borrador';
    const estadoVersion = emitido ? 'firmada' : 'borrador';

    // Copia la firma registrada del profesional para que quede precargada y estable.
    let medicoFirmaPath = null;

    if (profesional?.firma_png_path) {
      const origen = resolve(config.dataDir, profesional.firma_png_path);
      if (existsSync(origen)) {
        const relativa = `firmas-medicos/documento-${id}.png`;
        const destino = resolve(config.dataDir, relativa);
        mkdirSync(dirname(destino), { recursive: true });
        copyFileSync(origen, destino);
        medicoFirmaPath = relativa;
      }
    }

    try {
      tx(() => {
        // El código se calcula dentro de la transacción para que dos usuarios
        // no puedan generar el mismo código al mismo tiempo.
        const codigo = siguienteCodigo();
        const numero =
          db
            .prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM documents WHERE subtipo = ?')
            .get(subtipo).n || 1;

        db.prepare(
          `INSERT INTO documents
             (id, patient_id, appointment_id, template_id, titulo, codigo, estado, version_actual,
              medico_id, medico_firma_path, firma_modo, subtipo, numero, datos,
              created_by, creado_en, actualizado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          patient.id,
          cita?.id ?? null,
          template?.id ?? null,
          nombre,
          codigo,
          estadoDocumento,
          profesional?.id ?? null,
          medicoFirmaPath,
          firmaModo,
          subtipo,
          numero,
          datosDocumento == null
            ? null
            : typeof datosDocumento === 'string'
              ? datosDocumento.slice(0, 100000)
              : JSON.stringify(datosDocumento).slice(0, 100000),
          user.id,
          ts,
          ts
        );

        db.prepare(
          `INSERT INTO document_versions
             (id, document_id, numero, contenido_html, hash, estado, creado_por, creado_en)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
        ).run(versionId, id, html, sha256(html), estadoVersion, user.id, ts);
      });
    } catch (error) {
      if (medicoFirmaPath) {
        try {
          unlinkSync(resolve(config.dataDir, medicoFirmaPath));
        } catch {
          // el archivo pudo no haberse copiado
        }
      }
      throw error;
    }

    audit(user.id, 'documento_creado', 'documents', id, { patientId: patient.id });
    return { id, versionId };
  }

  router.post('/api/documents', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_CREAR);
    ctx.ok(crearDocumento(user, ctx.body || {}), 201);
  });

  // Genera el consentimiento de una cita de un paciente menor antes de atenderlo.
  router.post('/api/appointments/:id/consent', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_CREAR);

    const cita = db.prepare('SELECT * FROM appointments WHERE id = ?').get(ctx.params.id);
    if (!cita) throw new HttpError(404, 'Cita no encontrada');

    const patient = db
      .prepare('SELECT * FROM patients WHERE id = ? AND activo = 1')
      .get(cita.patient_id);
    if (!patient) throw new HttpError(404, 'Paciente no encontrada');

    if (!esMenorDeEdad(patient.fecha_nacimiento)) {
      throw new HttpError(400, 'La paciente no es menor de edad');
    }

    const plantilla = db
      .prepare(
        `SELECT * FROM templates
         WHERE activo = 1 AND tipo = 'consentimiento'
         ORDER BY CASE WHEN nombre LIKE 'Consentimiento informado ISIM%' THEN 0 ELSE 1 END,
                  creado_en ASC
         LIMIT 1`
      )
      .get();
    if (!plantilla) {
      throw new HttpError(409, 'No hay una plantilla de consentimiento activa');
    }

    const { id, versionId } = crearDocumento(user, {
      patientId: patient.id,
      appointmentId: cita.id,
      templateId: plantilla.id,
      medicoId: cita.medico_id || undefined,
    });

    audit(user.id, 'consentimiento_generado_cita', 'documents', id, {
      appointmentId: cita.id,
      patientId: patient.id,
    });

    ctx.ok({ id, versionId, appointmentId: cita.id }, 201);
  });

  router.get('/api/documents/:id', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);
    const doc = documentoDe(ctx);
    const versiones = db
      .prepare(
        `SELECT id, numero, contenido_html, hash, estado, creado_en
         FROM document_versions WHERE document_id = ? ORDER BY numero DESC`
      )
      .all(doc.id);
    const firmas = db
      .prepare(
        `SELECT id, version_id, firmado_en, documento_hash, gestionado_por,
                gestionado_nombre, gestionado_rol, copia_solicitada, copia_entregada,
                copia_actualizada_en
         FROM signatures WHERE document_id = ?`
      )
      .all(doc.id);

    const creador = medicoDelDocumento(doc);

    let medicoFirmaUrl = null;
    if (doc.medico_firma_path) {
      medicoFirmaUrl = `/api/documents/${doc.id}/medico-firma?v=${encodeURIComponent(doc.actualizado_en || '')}`;
    } else if (creador?.firma_png_path) {
      medicoFirmaUrl = `/api/users/${creador.id}/firma?v=${encodeURIComponent(creador.firma_actualizada_en || '')}`;
    }

    const datosFirmante = datosDelFirmante(doc);
    const consentEvents = db
      .prepare(
        `SELECT ce.id, ce.tipo, ce.motivo, ce.creado_en, u.nombre AS usuario_nombre
         FROM consent_events ce
         LEFT JOIN users u ON u.id = ce.usuario_id
         WHERE ce.document_id = ?
         ORDER BY ce.creado_en DESC`
      )
      .all(doc.id);
    const esConsentimiento =
      /consentimiento/i.test(doc.titulo || '') ||
      /consentimiento/i.test(doc.template_nombre || '');

    return {
      ...doc,
      datos: datosDocumento(doc.datos),
      esConsentimiento,
      consentEvents,
      consentEstado: consentEvents[0]?.tipo || null,
      firmaModo: doc.firma_modo || 'ambas',
      requiereFirmaPaciente: usaFirmaPaciente(doc.firma_modo || 'ambas'),
      centro: { nombre: nombreCentro(), direccion: direccionCentro() },
      logoUrl: logoActual(),
      pieTexto: textoPieActual(),
      ...datosFirmante,
      medico: creador
        ? {
            id: creador.id,
            nombre: creador.nombre,
            cedula: creador.cedula || '',
            senecit: creador.senecit || '',
            especialidad: creador.especialidad || '',
            firmaUrl: medicoFirmaUrl,
          }
        : null,
      paciente: {
        id: doc.patient_id,
        nombres: doc.nombres,
        apellidos: doc.apellidos,
        cedula: doc.paciente_cedula,
        fecha_nacimiento: doc.fecha_nacimiento,
        sexo: doc.sexo,
        telefono: doc.telefono,
        email: doc.email,
        direccion: doc.direccion,
        alergias: doc.alergias,
        es_menor: datosFirmante.esMenor,
        edad: datosFirmante.edad,
        representantes: datosFirmante.representantes,
      },
      versiones,
      firmas,
    };
  });

  // Datos específicos del consentimiento (riesgos de la paciente) y
  // regeneración del borrador. Si ya está firmado, no se permite modificar.
  router.put('/api/documents/:id/datos', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_EDITAR);
    const doc = documentoDe(ctx);
    if (doc.estado === 'anulado') throw new HttpError(409, 'El documento está anulado');

    const version = db
      .prepare('SELECT * FROM document_versions WHERE document_id = ? AND numero = ?')
      .get(doc.id, doc.version_actual);
    if (!version || version.estado !== 'borrador') {
      throw new HttpError(409, 'El documento ya está firmado y no se puede modificar');
    }

    const riesgos = String(ctx.body?.riesgosEspecificos ?? '').trim().slice(0, 2000);
    const datos = { ...(datosDocumento(doc.datos) || {}), riesgosEspecificos: riesgos };
    const textoRiesgos = riesgos || '______________________________________________';
    const bloque = `<p class="consentimiento-riesgos-especificos"><strong>Específicos de la paciente:</strong> ${escaparHtml(textoRiesgos)}</p>`;

    let html = String(version.contenido_html || '');
    const patron =
      /<p[^>]*>\s*<strong>\s*Específicos de la paciente:\s*<\/strong>[\s\S]*?<\/p>/i;
    if (patron.test(html)) {
      html = html.replace(patron, bloque);
    } else {
      const marcador = html.indexOf('<div class="consentimiento-declaracion"');
      html =
        marcador >= 0
          ? `${html.slice(0, marcador)}${bloque}\n${html.slice(marcador)}`
          : `${html}\n${bloque}`;
    }

    const ts = nowIso();
    tx(() => {
      db.prepare('UPDATE documents SET datos = ?, actualizado_en = ? WHERE id = ?').run(
        JSON.stringify(datos),
        ts,
        doc.id
      );
      db.prepare('UPDATE document_versions SET contenido_html = ?, hash = ? WHERE id = ?').run(
        html,
        sha256(html),
        version.id
      );
    });

    audit(user.id, 'documento_datos_actualizados', 'documents', doc.id, null);
    ctx.ok({ ok: true, datos });
  });

  // Certificados de la paciente (IESS y de atención), guardados como documentos.
  router.get('/api/patients/:id/certificados', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_VER);
    const paciente = db
      .prepare('SELECT id FROM patients WHERE id = ? AND activo = 1')
      .get(ctx.params.id);
    if (!paciente) throw new HttpError(404, 'Paciente no encontrada');

    return db
      .prepare(
        `SELECT id, numero, subtipo, titulo, codigo, estado, datos, creado_en
         FROM documents
         WHERE patient_id = ? AND subtipo IN ('iess', 'atencion')
         ORDER BY creado_en DESC`
      )
      .all(paciente.id)
      .map((fila) => ({ ...fila, datos: datosDocumento(fila.datos) }));
  });

  router.post('/api/patients/:id/certificados', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.HISTORIAS_GESTIONAR);

    const paciente = db
      .prepare('SELECT * FROM patients WHERE id = ? AND activo = 1')
      .get(ctx.params.id);
    if (!paciente) throw new HttpError(404, 'Paciente no encontrada');

    const subtipo = String(ctx.body?.subtipo || '').trim().toLowerCase();
    if (!['iess', 'atencion'].includes(subtipo)) {
      throw new HttpError(400, 'Tipo de certificado no válido');
    }
    const fecha = String(ctx.body?.fecha || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      throw new HttpError(400, 'La fecha del certificado no es válida');
    }

    const plantilla = db
      .prepare(
        `SELECT * FROM templates
         WHERE activo = 1 AND tipo = 'certificado'
         ORDER BY creado_en ASC
         LIMIT 1`
      )
      .get();
    if (!plantilla) throw new HttpError(409, 'No hay una plantilla de certificado activa');

    const datosBase =
      ctx.body?.datos && typeof ctx.body.datos === 'object' ? ctx.body.datos : {};
    const { id, versionId } = crearDocumento(user, {
      patientId: paciente.id,
      templateId: plantilla.id,
      medicoId: ctx.body?.medicoId,
      subtipo,
      datos: { ...datosBase, fecha },
      titulo: subtipo === 'iess' ? 'Certificado IESS' : 'Certificado de atención',
    });

    const fila = db.prepare('SELECT numero FROM documents WHERE id = ?').get(id);
    audit(user.id, 'certificado_creado', 'documents', id, { subtipo, numero: fila?.numero });
    ctx.ok({ id, numero: fila?.numero ?? null, versionId }, 201);
  });

  router.get('/api/documents/:id/medico-firma', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);

    const doc = db
      .prepare('SELECT medico_firma_path FROM documents WHERE id = ?')
      .get(ctx.params.id);
    if (!doc?.medico_firma_path) {
      throw new HttpError(404, 'El documento no tiene firma del profesional');
    }

    const absoluta = resolve(config.dataDir, doc.medico_firma_path);
    if (!absoluta.startsWith(resolve(config.dataDir)) || !existsSync(absoluta)) {
      throw new HttpError(404, 'No se encontró la firma del profesional');
    }

    const buffer = readFileSync(absoluta);
    ctx.res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': buffer.length,
      'cache-control': 'private, max-age=60',
    });
    ctx.res.end(buffer);
  });

  // Editar el contenido. Si la versión actual ya fue firmada, crea una nueva (V2, V3...).
  router.post('/api/documents/:id/versions', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_EDITAR);
    const doc = documentoDe(ctx);
    if (doc.estado === 'anulado') throw new HttpError(409, 'El documento está anulado');

    const contenido = String(ctx.body?.contenidoHtml || '').trim();
    if (contenido.replace(/<[^>]+>/g, '').trim().length < 20) {
      throw new HttpError(400, 'El contenido del documento es demasiado corto');
    }

    const hashEsperado = String(ctx.body?.hashEsperado || '');
    const ts = nowIso();
    const emitido = !usaFirmaPaciente(doc.firma_modo || 'ambas');
    const estadoVersion = emitido ? 'firmada' : 'borrador';
    const estadoDocumento = emitido ? 'firmado' : 'borrador';
    let versionId;
    let numero;

    tx(() => {
      // Releer dentro de la transacción: otro usuario pudo firmar, anular o
      // editar mientras este usuario tenía abierto el editor.
      const docTx = db
        .prepare('SELECT estado, version_actual FROM documents WHERE id = ?')
        .get(doc.id);
      if (!docTx || docTx.estado === 'anulado') {
        throw new HttpError(409, 'El documento está anulado');
      }

      const actual = db
        .prepare('SELECT * FROM document_versions WHERE document_id = ? AND numero = ?')
        .get(doc.id, docTx.version_actual);

      if (
        actual &&
        actual.estado === 'borrador' &&
        hashEsperado &&
        actual.hash !== hashEsperado
      ) {
        throw new HttpError(
          409,
          'Otra persona modificó este documento. Recarga la página antes de guardar.'
        );
      }

      if (actual && actual.estado === 'borrador') {
        db.prepare('UPDATE document_versions SET contenido_html = ?, hash = ? WHERE id = ?').run(
          contenido,
          sha256(contenido),
          actual.id
        );
        versionId = actual.id;
        numero = actual.numero;
      } else {
        if (actual && actual.estado === 'pendiente_firma') {
          // La firma abierta queda invalidada por la edición.
          db.prepare(
            "UPDATE sign_sessions SET estado = 'expirada' WHERE version_id = ? AND estado = 'abierta'"
          ).run(actual.id);
          db.prepare("UPDATE document_versions SET estado = 'borrador' WHERE id = ?").run(actual.id);
        }
        numero = (db.prepare('SELECT MAX(numero) AS n FROM document_versions WHERE document_id = ?').get(doc.id).n || 0) + 1;
        versionId = uid();
        db.prepare(
          `INSERT INTO document_versions
             (id, document_id, numero, contenido_html, hash, estado, creado_por, creado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(versionId, doc.id, numero, contenido, sha256(contenido), estadoVersion, user.id, ts);
      }

      db.prepare(
        'UPDATE documents SET version_actual = ?, estado = ?, actualizado_en = ? WHERE id = ?'
      ).run(numero, estadoDocumento, ts, doc.id);
    });

    audit(user.id, 'documento_version', 'documents', doc.id, { version: numero });
    ctx.ok({ versionId, numero });
  });

  router.post('/api/documents/:id/annul', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_ANULAR);
    const doc = documentoDe(ctx);
    const anuladoEn = nowIso();
    db.prepare(
      "UPDATE documents SET estado = 'anulado', anulado_en = ?, actualizado_en = ? WHERE id = ?"
    ).run(anuladoEn, anuladoEn, doc.id);
    db.prepare(
      "UPDATE document_versions SET estado = 'anulada' WHERE document_id = ? AND estado != 'firmada'"
    ).run(doc.id);
    audit(user.id, 'documento_anulado', 'documents', doc.id, null);
    ctx.ok({ ok: true });
  });

  // Negativa (antes de firmar) o revocatoria (después de firmar) de un
  // consentimiento. El documento se conserva y pasa a estado anulado.
  router.post('/api/documents/:id/consent-event', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_ANULAR);
    const doc = documentoDe(ctx);

    const esConsentimiento =
      /consentimiento/i.test(doc.titulo || '') ||
      doc.template_tipo === 'consentimiento' ||
      /consentimiento/i.test(doc.template_nombre || '');
    if (!esConsentimiento) {
      throw new HttpError(
        409,
        'Solo los consentimientos informados admiten negativa o revocatoria'
      );
    }
    if (doc.estado === 'anulado') {
      throw new HttpError(409, 'El documento ya está anulado');
    }

    const tipo = String(ctx.body?.tipo || '')
      .trim()
      .toLowerCase();
    if (tipo !== 'negativa' && tipo !== 'revocatoria') {
      throw new HttpError(400, 'Indica si es una negativa o una revocatoria');
    }
    if (tipo === 'revocatoria' && doc.estado !== 'firmado') {
      throw new HttpError(409, 'Solo se puede revocar un consentimiento firmado');
    }
    if (tipo === 'negativa' && doc.estado === 'firmado') {
      throw new HttpError(
        409,
        'El consentimiento ya está firmado: registra una revocatoria en lugar de una negativa'
      );
    }

    const motivo = String(ctx.body?.motivo || '').trim().slice(0, 1000) || null;
    const ahora = nowIso();

    tx(() => {
      const docTx = db
        .prepare('SELECT estado FROM documents WHERE id = ?')
        .get(doc.id);
      if (!docTx || docTx.estado === 'anulado') {
        throw new HttpError(409, 'El documento ya está anulado');
      }

      const previo = db
        .prepare(
          `SELECT tipo FROM consent_events
           WHERE document_id = ?
           ORDER BY creado_en DESC, rowid DESC LIMIT 1`
        )
        .get(doc.id);
      if (previo) {
        throw new HttpError(
          409,
          `Ya existe una ${previo.tipo} registrada para este consentimiento`
        );
      }

      db.prepare(
        `INSERT INTO consent_events (id, document_id, tipo, motivo, usuario_id, creado_en)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uid(), doc.id, tipo, motivo, user.id, ahora);

      db.prepare(
        "UPDATE documents SET estado = 'anulado', anulado_en = ?, actualizado_en = ? WHERE id = ?"
      ).run(ahora, ahora, doc.id);
      db.prepare(
        "UPDATE document_versions SET estado = 'anulada' WHERE document_id = ? AND estado != 'firmada'"
      ).run(doc.id);
    });

    audit(
      user.id,
      tipo === 'negativa' ? 'consentimiento_negado' : 'consentimiento_revocado',
      'documents',
      doc.id,
      { tipo, motivo }
    );

    ctx.ok({ ok: true, tipo, consentEstado: tipo, anuladoEn: ahora });
  });

  // Crea el enlace de un solo uso para la pantalla de firma.
  router.post('/api/documents/:id/sign-session', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_FIRMAR);
    const doc = documentoDe(ctx);
    if (doc.estado === 'anulado') throw new HttpError(409, 'El documento está anulado');
    if (!usaFirmaPaciente(doc.firma_modo || 'ambas')) {
      throw new HttpError(
        409,
        'La configuración actual solo usa la firma del profesional: este documento no requiere firma de la paciente.'
      );
    }
    if (esMenorDeEdad(doc.fecha_nacimiento) && !representantePrincipal(doc)) {
      throw new HttpError(
        409,
        'El paciente es menor de edad. Registra al representante legal antes de iniciar la firma.'
      );
    }

    const version = versionActual(doc);
    if (!version) throw new HttpError(409, 'El documento no tiene una versión válida');
    if (version.estado === 'firmada') {
      throw new HttpError(409, 'Esta versión ya está firmada. Crea una nueva versión para corregirla.');
    }

    const token = randomBytes(32).toString('hex');
    const id = uid();
    const ahora = Date.now();
    const expira = new Date(ahora + config.signTtlMs);

    tx(() => {
      db.prepare(
        "UPDATE sign_sessions SET estado = 'expirada' WHERE version_id = ? AND estado = 'abierta'"
      ).run(version.id);

      db.prepare(
        `INSERT INTO sign_sessions (id, document_id, version_id, token_hash, estado, creada_por, creada_en, expira_en)
         VALUES (?, ?, ?, ?, 'abierta', ?, ?, ?)`
      ).run(id, doc.id, version.id, sha256(token), user.id, new Date(ahora).toISOString(), expira.toISOString());

      db.prepare("UPDATE document_versions SET estado = 'pendiente_firma' WHERE id = ?").run(version.id);
      db.prepare("UPDATE documents SET estado = 'pendiente_firma', actualizado_en = ? WHERE id = ?").run(
        new Date(ahora).toISOString(),
        doc.id
      );
    });

    audit(user.id, 'firma_solicitada', 'documents', doc.id, { version: version.numero });
    const rutaFirma = `/firma.html?t=${token}`;
    const basePublica = urlBasePublica(ctx.req);
    const ip = ipLocal();
    ctx.ok(
      {
        token,
        url: rutaFirma,
        urlExterna: `${basePublica}${rutaFirma}`,
        certificadoUrl:
          ip && basePublica.startsWith('https://')
            ? `http://${ip}:${config.port}/isim-ca.crt`
            : null,
        ipLocal: ip,
        expiraEn: expira.toISOString(),
        version: version.numero,
        codigo: doc.codigo,
        titulo: doc.titulo,
      },
      201
    );
  });

  // Información pública para la pantalla de firma (el token es la credencial).
  router.get('/api/sign-sessions/:token', (ctx) => {
    const tokenHash = sha256(ctx.params.token);
    const row = db
      .prepare(
        `SELECT s.id, s.estado, s.expira_en,
                d.id AS document_id, d.codigo, d.titulo, d.created_by, d.medico_id, d.medico_firma_path,
                d.firma_modo, d.actualizado_en AS documento_actualizado_en,
                v.numero, v.contenido_html,
                p.nombres, p.apellidos, p.cedula, p.fecha_nacimiento,
                p.representante1_nombre, p.representante1_cedula, p.representante1_parentesco,
                p.representante1_telefono, p.representante2_nombre, p.representante2_cedula,
                p.representante2_parentesco, p.representante2_telefono
         FROM sign_sessions s
         JOIN documents d ON d.id = s.document_id
         JOIN document_versions v ON v.id = s.version_id
         JOIN patients p ON p.id = d.patient_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash);

    if (!row) throw new HttpError(404, 'El enlace de firma no es válido');
    if (row.estado === 'completada') return { estado: 'completada' };
    if (row.estado !== 'abierta') return { estado: row.estado };
    if (row.expira_en <= nowIso()) {
      db.prepare("UPDATE sign_sessions SET estado = 'expirada' WHERE id = ?").run(row.id);
      return { estado: 'expirada' };
    }

    const creador = medicoDelDocumento(row);

    // La pantalla de firma puede abrirse en otro dispositivo sin sesión:
    // la firma del profesional se incrusta para no depender de la cookie.
    let medicoFirmaUrl = null;
    const rutaFirma = row.medico_firma_path || creador?.firma_png_path;
    if (rutaFirma) {
      const absoluta = resolve(config.dataDir, rutaFirma);
      if (existsSync(absoluta)) {
        medicoFirmaUrl = `data:image/png;base64,${readFileSync(absoluta).toString('base64')}`;
      }
    }

    const datosFirmante = datosDelFirmante(row);

    return {
      estado: 'abierta',
      expiraEn: row.expira_en,
      titulo: row.titulo,
      codigo: row.codigo,
      version: row.numero,
      firmaModo: row.firma_modo || 'ambas',
      contenidoHtml: row.contenido_html,
      centro: { nombre: nombreCentro(), direccion: direccionCentro() },
      logoUrl: logoActual(),
      pieTexto: textoPieActual(),
      medicoFirmaUrl,
      ...datosFirmante,
      medico: creador
        ? {
            id: creador.id,
            nombre: creador.nombre,
            cedula: creador.cedula || '',
            senecit: creador.senecit || '',
            especialidad: creador.especialidad || '',
            firmaUrl: medicoFirmaUrl,
          }
        : null,
      paciente: {
        nombre: `${row.nombres} ${row.apellidos}`,
        nombres: row.nombres,
        apellidos: row.apellidos,
        cedula: row.cedula,
        es_menor: datosFirmante.esMenor,
        edad: datosFirmante.edad,
        representantes: datosFirmante.representantes,
      },
    };
  });

  router.post('/api/sign-sessions/:token/cancel', (ctx) => {
    const tokenHash = sha256(ctx.params.token);
    const session = db.prepare('SELECT * FROM sign_sessions WHERE token_hash = ?').get(tokenHash);
    if (!session) throw new HttpError(404, 'El enlace de firma no es válido');
    if (session.estado !== 'abierta') return { ok: true };

    tx(() => {
      db.prepare("UPDATE sign_sessions SET estado = 'cancelada' WHERE id = ?").run(session.id);
      db.prepare(
        "UPDATE document_versions SET estado = 'borrador' WHERE id = ? AND estado = 'pendiente_firma'"
      ).run(session.version_id);
      db.prepare("UPDATE documents SET estado = 'borrador', actualizado_en = ? WHERE id = ?").run(
        nowIso(),
        session.document_id
      );
    });
    audit(null, 'firma_cancelada', 'documents', session.document_id, { sessionId: session.id });
    ctx.ok({ ok: true });
  });

  // El paciente indica, al terminar de firmar, si desea copia impresa.
  router.post('/api/sign-sessions/:token/copia', (ctx) => {
    const tokenHash = sha256(ctx.params.token);
    const session = db.prepare('SELECT * FROM sign_sessions WHERE token_hash = ?').get(tokenHash);
    if (!session) throw new HttpError(404, 'El enlace de firma no es válido');
    if (session.estado !== 'completada') {
      throw new HttpError(409, 'La firma todavía no se ha completado');
    }

    const firma = db
      .prepare('SELECT id FROM signatures WHERE sign_session_id = ?')
      .get(session.id);
    if (!firma) throw new HttpError(404, 'No se encontró la firma');

    const solicitada = ctx.body?.solicitada ? 1 : 0;
    db.prepare(
      `UPDATE signatures
       SET copia_solicitada = ?, copia_entregada = 0, copia_actualizada_en = ?
       WHERE id = ?`
    ).run(solicitada, nowIso(), firma.id);

    return { ok: true, solicitada: Boolean(solicitada) };
  });

  // Recepción confirma si la copia solicitada fue entregada.
  router.post('/api/documents/:id/copia', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_EDITAR);

    const versionId = String(ctx.body?.versionId || '');
    const firma = db
      .prepare(
        'SELECT id, copia_solicitada FROM signatures WHERE document_id = ? AND version_id = ?'
      )
      .get(ctx.params.id, versionId);

    if (!firma) throw new HttpError(404, 'No hay una firma para esa versión');
    if (!firma.copia_solicitada) {
      throw new HttpError(409, 'El paciente no solicitó copia al firmar');
    }

    const entregada = ctx.body?.entregada ? 1 : 0;
    db.prepare(
      'UPDATE signatures SET copia_entregada = ?, copia_actualizada_en = ? WHERE id = ?'
    ).run(entregada, nowIso(), firma.id);

    audit(user.id, 'copia_entregada', 'documents', ctx.params.id, {
      versionId,
      entregada: Boolean(entregada),
    });
    return { ok: true, entregada: Boolean(entregada) };
  });

  router.get('/api/signatures/:id/image', (ctx) => {
    const user = requireUser(ctx);
    exigir(user, PERMISOS.DOCUMENTOS_VER);
    const firma = db.prepare('SELECT firma_png_path FROM signatures WHERE id = ?').get(ctx.params.id);
    if (!firma) throw new HttpError(404, 'Firma no encontrada');

    const abs = resolve(config.dataDir, firma.firma_png_path);
    if (!abs.startsWith(resolve(config.dataDir))) throw new HttpError(400, 'Ruta inválida');

    let buffer;
    try {
      buffer = readFileSync(abs);
    } catch {
      throw new HttpError(404, 'No se encontró el archivo de la firma');
    }

    ctx.res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': buffer.length,
      'cache-control': 'private, max-age=3600',
    });
    ctx.res.end(buffer);
  });
}

