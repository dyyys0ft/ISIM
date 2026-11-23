import { db, nowIso, sha256, tx, uid } from './index.js';
import { hashSecret } from '../lib/passwords.js';
import { ROLES_POR_DEFECTO } from '../lib/permisosCatalogo.js';
import { pathToFileURL } from 'node:url';

const PLANTILLA = `
<p class="doc-fecha-carta">Riobamba, {{fecha}}</p>
<h2>CONSENTIMIENTO INFORMADO PARA PROCEDIMIENTO MÉDICO</h2>
<p class="doc-meta">{{institucion}}</p>

<h3>1. Datos de la paciente</h3>
<p>
  <strong>Nombre:</strong> {{paciente.nombre_completo}}<br>
  <strong>Cédula de Identidad:</strong> {{paciente.cedula}}<br>
  <strong>Fecha de nacimiento:</strong> {{paciente.fecha_nacimiento}}<br>
  <strong>Teléfono:</strong> {{paciente.telefono}}
</p>

<h3>2. Procedimiento</h3>
<p>Se realizará el procedimiento indicado por el profesional tratante, previa explicación de su naturaleza, objetivos y alcance. El procedimiento se ejecutará en las instalaciones del {{institucion}} con el personal capacitado para ello.</p>

<h3>3. Beneficios, riesgos y alternativas</h3>
<p>He comprendido los beneficios esperados, así como los riesgos y molestias que pueden presentarse, entre ellos dolor, sangrado leve, infección o reacciones adversas poco frecuentes. Se me han explicado las alternativas disponibles y las consecuencias de no realizar el procedimiento.</p>

<h3>4. Declaración y autorización</h3>
<p>Yo, <strong>{{paciente.nombre_completo}}</strong>, con Cédula de Identidad <strong>{{paciente.cedula}}</strong>, declaro que la información recibida ha sido clara, suficiente y comprensible; que he tenido la oportunidad de formular preguntas y que estas fueron respondidas satisfactoriamente. En consecuencia, <strong>otorgo mi consentimiento libre, informado y voluntario</strong> para la realización del procedimiento.</p>
<p>Autorizo además el registro de mi firma y de mi información clínica en el sistema institucional, con fines de respaldo y trazabilidad.</p>

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

const PLANTILLA_CERTIFICADO = `
<p class="doc-fecha-carta">Riobamba, {{fecha}} a las {{hora}}</p>
<h2>CERTIFICADO MÉDICO</h2>
<p class="doc-meta">{{institucion}}</p>
<hr>
<p>
  El profesional que suscribe, <strong>{{usuario.nombre}}</strong>, con Cédula de Identidad
  <strong>{{usuario.cedula}}</strong>, especialidad <strong>{{usuario.especialidad}}</strong>,
  código SENECYT <strong>{{usuario.senecit}}</strong>,
</p>
<h3>CERTIFICA QUE:</h3>
<p>
  La paciente <strong>{{paciente.nombre_completo}}</strong>, con Cédula de Identidad
  <strong>{{paciente.cedula}}</strong>, de <strong>{{paciente.edad_texto}}</strong>, recibió
  atención médica en esta institución el <strong>{{fecha}}</strong> a las
  <strong>{{hora}}</strong>.
</p>
<h3>Motivo de la atención</h3>
<p>
  Consulta médica, evaluación clínica y valoración integral de la paciente en la fecha y hora
  indicadas.
</p>
<h3>Diagnóstico y observaciones</h3>
<p>
  El diagnóstico, las observaciones y las indicaciones correspondientes constan en la historia
  clínica institucional y fueron comunicados de forma clara y oportuna a la paciente.
</p>
<h3>Indicaciones</h3>
<p>
  La paciente recibió las indicaciones y recomendaciones correspondientes a su estado de salud.
</p>
<div class="doc-sello">
  <strong>VÁLIDO ÚNICAMENTE CON EL SELLO DE RECEPCIÓN</strong>
  <span>Este certificado no tiene validez sin el sello de recepción de la institución.</span>
</div>
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

const USUARIOS = [
  {
    nombre: 'Administrador del sistema',
    cedula: '0600000001',
    username: 'administrador',
    password: '1234',
    rol: 'admin',
  },
  {
    nombre: 'Dra. Verónica Salazar',
    cedula: '0601234567',
    username: 'veronica',
    password: '1235',
    rol: 'medico',
  },
  {
    nombre: 'Recepción — Ana Torres',
    cedula: '0607654321',
    username: 'recepcion',
    password: '1236',
    rol: 'operador',
  },
];

// Cuentas solicitadas: ADMIN con control total y dos usuarios de solo lectura.
const USUARIOS_EXTRA = [
  { nombre: 'ADMIN', cedula: '0600000002', username: 'admin', password: '54321', rol: 'admin' },
  {
    nombre: 'Lector Uno — Solo lectura',
    cedula: '0600000003',
    username: 'lector1',
    password: '1111',
    rol: 'lectura',
  },
  {
    nombre: 'Lector Dos — Solo lectura',
    cedula: '0600000004',
    username: 'lector2',
    password: '2222',
    rol: 'lectura',
  },
];

function renderDemo(html, patient, user) {
  const fecha = new Date().toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' });
  const valores = {
    'paciente.nombres': patient.nombres,
    'paciente.apellidos': patient.apellidos,
    'paciente.nombre_completo': `${patient.nombres} ${patient.apellidos}`,
    'paciente.cedula': patient.cedula,
    'paciente.fecha_nacimiento': patient.fecha_nacimiento || '',
    'paciente.telefono': patient.telefono || '',
    institucion: 'ISIM-Instituto de la Salud Integral de la Mujer',
    'usuario.nombre': user.nombre,
    'usuario.cedula': user.cedula || '',
    'usuario.senecit': user.senecit || '',
    'usuario.especialidad': user.especialidad || '',
    fecha,
  };
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => valores[key] ?? m);
}

/** Crea los datos mínimos para que el sistema arranque y pueda probarse. Idempotente. */
export function ensureSeed() {
  const ts = nowIso();
  // Solo las pruebas siembran usuarios y pacientes demo. Una instalación nueva
  // arranca sin usuarios para que la pantalla de acceso ofrezca la instalación.
  const sembrarDemo = process.env.ISIM_SEMILLA === '1';

  if (sembrarDemo && db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const insert = db.prepare(
      `INSERT INTO users
         (id, nombre, cedula, username, password_hash, rol, pin_hash, activo, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    for (const user of USUARIOS) {
      const hash = hashSecret(user.password);
      insert.run(uid(), user.nombre, user.cedula, user.username, hash, user.rol, hash, ts, ts);
    }
    console.log('[seed] usuarios iniciales creados (acceso: admin / 54321)');
  }

  for (const usuario of sembrarDemo ? USUARIOS_EXTRA : []) {
    const existe = db
      .prepare('SELECT id FROM users WHERE cedula = ? OR nombre = ? OR username = ?')
      .get(usuario.cedula, usuario.nombre, usuario.username);
    if (existe) continue;

    const hash = hashSecret(usuario.password);
    db.prepare(
      `INSERT INTO users
         (id, nombre, cedula, username, password_hash, rol, pin_hash, activo, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      uid(),
      usuario.nombre,
      usuario.cedula,
      usuario.username,
      hash,
      usuario.rol,
      hash,
      ts,
      ts
    );

    console.log(`[seed] usuario ${usuario.username} (${usuario.rol}) creado`);
  }

  // Roles y permisos iniciales. Los roles del sistema se pueden editar, pero
  // no eliminar; solo se crean si faltan para no pisar cambios del administrador.
  const rolesFaltantes = ROLES_POR_DEFECTO.filter(
    (rol) => !db.prepare('SELECT 1 FROM roles WHERE slug = ?').get(rol.slug)
  );

  if (rolesFaltantes.length) {
    tx(() => {
      const insertRol = db.prepare(
        `INSERT INTO roles (slug, nombre, descripcion, protegido, activo, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      );
      const insertPermiso = db.prepare(
        'INSERT OR IGNORE INTO role_permissions (role_slug, permiso) VALUES (?, ?)'
      );

      for (const rol of rolesFaltantes) {
        insertRol.run(rol.slug, rol.nombre, rol.descripcion || null, rol.protegido ? 1 : 0, ts, ts);
        for (const permiso of rol.permisos) insertPermiso.run(rol.slug, permiso);
      }
    });
    console.log(
      `[seed] ${rolesFaltantes.length} rol(es) y sus permisos iniciales creados`
    );
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM templates').get().n === 0) {
    db.prepare(
      `INSERT INTO templates (id, nombre, tipo, cuerpo_html, activo, creado_en)
       VALUES (?, ?, 'consentimiento', ?, 1, ?)`
    ).run(uid(), 'Consentimiento informado general', PLANTILLA, ts);
  } else {
    // Actualiza la plantilla sembrada original sin tocar plantillas personalizadas.
    const plantilla = db
      .prepare("SELECT id, cuerpo_html FROM templates WHERE nombre = 'Consentimiento informado general'")
      .get();
    if (
      plantilla &&
      ((plantilla.cuerpo_html.includes('Instituto de la Mujer Riobamba') &&
        !plantilla.cuerpo_html.includes('Cédula de Identidad')) ||
        (!plantilla.cuerpo_html.includes('firma-especialidad') &&
          (plantilla.cuerpo_html.includes('firma-celda') ||
            plantilla.cuerpo_html.includes('Firma de la paciente'))))
    ) {
      db.prepare('UPDATE templates SET cuerpo_html = ? WHERE id = ?').run(PLANTILLA, plantilla.id);
      console.log('[seed] plantilla general actualizada al nuevo formato');
    }
  }

  const certificado = db
    .prepare("SELECT id FROM templates WHERE nombre = 'Certificado médico'")
    .get();
  if (!certificado) {
    db.prepare(
      `INSERT INTO templates (id, nombre, tipo, cuerpo_html, firma_modo, activo, creado_en)
       VALUES (?, 'Certificado médico', 'certificado', ?, 'medico', 1, ?)`
    ).run(uid(), PLANTILLA_CERTIFICADO, ts);
    console.log('[seed] plantilla de certificado médico creada');
  }

  if (sembrarDemo && db.prepare('SELECT COUNT(*) AS n FROM patients').get().n === 0) {
    const patientId = uid();
    db.prepare(
      `INSERT INTO patients
         (id, cedula, nombres, apellidos, fecha_nacimiento, sexo, telefono, email, direccion, alergias, notas, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, '1992-04-18', 'F', '0991234567', 'paciente.demo@correo.local', 'Riobamba, Chimborazo', 'Penicilina', 'Paciente de demostración', ?, ?)`
    ).run(patientId, '0603456789', 'María Fernanda', 'Guamán Paredes', ts, ts);

    const user = db.prepare("SELECT * FROM users WHERE rol = 'medico' LIMIT 1").get();
    const template = db.prepare('SELECT * FROM templates LIMIT 1').get();
    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    const html = renderDemo(template.cuerpo_html, patient, user);

    const documentId = uid();
    const versionId = uid();
    tx(() => {
      db.prepare(
        `INSERT INTO documents
           (id, patient_id, template_id, titulo, estado, version_actual, created_by, creado_en, actualizado_en)
         VALUES (?, ?, ?, 'Consentimiento informado — Ecografía pélvica', 'borrador', 1, ?, ?, ?)`
      ).run(documentId, patientId, template.id, user.id, ts, ts);

      db.prepare(
        `INSERT INTO document_versions
           (id, document_id, numero, contenido_html, hash, estado, creado_por, creado_en)
         VALUES (?, ?, 1, ?, ?, 'borrador', ?, ?)`
      ).run(versionId, documentId, html, sha256(html), user.id, ts);
    });
    console.log('[seed] paciente y documento de demostración creados');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureSeed();
  console.log('[seed] listo');
}

