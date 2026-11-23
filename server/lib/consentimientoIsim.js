import { db, nowIso, uid } from '../db/index.js';

/**
 * Plantilla de consentimiento informado con la estructura del frontend ISIM
 * (Form. 024 / AM 5316). Se usa por defecto para los consentimientos nuevos;
 * el administrador puede editarla o duplicarla por procedimiento.
 */

export const NOMBRE_PLANTILLA_ISIM = 'Consentimiento informado ISIM — Form. 024';

export const TEXTOS_POR_DEFECTO = {
  declaracion:
    'Yo, {{paciente.nombre_completo}}, con Cédula de Identidad {{paciente.cedula}}, declaro que he recibido información clara, suficiente y comprensible sobre el procedimiento, sus beneficios, riesgos, alternativas y consecuencias; que he tenido la oportunidad de formular preguntas y que estas fueron respondidas satisfactoriamente. En consecuencia, otorgo mi consentimiento libre, informado y voluntario para la realización del procedimiento.',
  negativa:
    'La paciente o su representante legal manifiesta que NO otorga el consentimiento para el procedimiento, después de haber recibido la información correspondiente.',
  revocatoria:
    'La paciente o su representante legal revoca el consentimiento otorgado para el procedimiento, dejando constancia de su decisión.',
};

export function textosConsentimientoActuales() {
  const leer = (clave, porDefecto) =>
    db.prepare('SELECT valor FROM settings WHERE clave = ?').get(clave)?.valor?.trim() ||
    porDefecto;

  return {
    declaracion: leer('consentimiento_declaracion', TEXTOS_POR_DEFECTO.declaracion),
    negativa: leer('consentimiento_negativa', TEXTOS_POR_DEFECTO.negativa),
    revocatoria: leer('consentimiento_revocatoria', TEXTOS_POR_DEFECTO.revocatoria),
  };
}

const CUERPO = `
<div class="consentimiento-isim">
  <div class="consentimiento-meta">
    <div><span>Establecimiento</span><strong>{{institucion}}</strong></div>
    <div><span>Servicio</span><strong>Ginecología y Obstetricia</strong></div>
    <div><span>Paciente</span><strong>{{paciente.nombre_completo}}</strong></div>
    <div><span>C.I. / HCU</span><strong>{{paciente.cedula}}</strong></div>
    <div><span>Edad</span><strong>{{paciente.edad_texto}}</strong></div>
    <div><span>Tipo de atención</span><strong>Ambulatoria</strong></div>
  </div>

  <h2 class="consentimiento-titulo">CONSENTIMIENTO INFORMADO</h2>

  <section class="consentimiento-seccion">
    <h3>1. Nombre del procedimiento</h3>
    <p>Procedimiento indicado por el profesional tratante: ________________________________________</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>2. En qué consiste</h3>
    <p>El procedimiento consiste en la atención médica indicada por el profesional tratante, con el objetivo de prevenir, diagnosticar o tratar la condición clínica de la paciente. La explicación detallada fue proporcionada de forma verbal y comprensible antes de la firma.</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>3. Cómo se realiza</h3>
    <p>Se realizará en las instalaciones de {{institucion}}, por personal capacitado, con la técnica y los insumos correspondientes al procedimiento indicado.</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>4. Duración aproximada</h3>
    <p>La duración será la estimada por el profesional tratante según la complejidad del procedimiento.</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>5. Beneficios</h3>
    <p>Los beneficios esperados incluyen la mejoría de la condición clínica, el alivio de síntomas y la prevención de complicaciones, según corresponda al procedimiento indicado.</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>6. Riesgos</h3>
    <p><strong>Frecuentes (poco graves):</strong> molestia, dolor leve, sangrado leve, inflamación o reacción local.</p>
    <p><strong>Poco frecuentes (graves):</strong> infección, sangrado importante, lesión de estructuras vecinas o reacciones adversas a medicamentos.</p>
    <p><strong>Específicos de la paciente:</strong> ______________________________________________</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>7. Alternativas al procedimiento</h3>
    <p>Se informaron las alternativas disponibles, incluyendo tratamiento médico, observación u otros procedimientos, así como sus ventajas y desventajas.</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>8. Manejo posterior y responsabilidades de la paciente</h3>
    <p>La paciente se compromete a seguir las indicaciones, controles y signos de alarma explicados por el profesional tratante.</p>
  </section>

  <section class="consentimiento-seccion">
    <h3>9. Consecuencias posibles si no se realiza</h3>
    <p>La no realización del procedimiento puede implicar persistencia o progresión de la condición clínica y el riesgo de complicaciones relacionadas.</p>
  </section>

  <div class="consentimiento-declaracion">
    <strong>DECLARACIÓN DE CONSENTIMIENTO INFORMADO</strong>
    <p>{{consentimiento.declaracion}}</p>
    <p class="consentimiento-fecha">Fecha: {{fecha}} &nbsp;&nbsp;&nbsp; Hora: {{hora}}</p>
  </div>

  <div class="doc-firmas"></div>
  <div class="consentimiento-huella">Huella<br>(si no sabe firmar)</div>

  {{#menor}}
  <div class="consentimiento-representante">
    <strong>Representante legal</strong>
    <p>{{paciente.representante1_nombre}} · C.I. {{paciente.representante1_cedula}}<br>
    Parentesco: {{paciente.representante1_parentesco}} · Teléfono: {{paciente.representante1_telefono}}</p>
    <p>El consentimiento es otorgado por el representante legal del paciente menor de edad.</p>
  </div>
  {{/menor}}

  <div class="consentimiento-negativa">
    <strong>NEGATIVA DEL CONSENTIMIENTO INFORMADO</strong>
    <p>{{consentimiento.negativa}}</p>
    <div class="consentimiento-firmas">
      <div><span class="linea"></span><small>Paciente o representante<br>Nombre y C.I.</small></div>
      <div><span class="linea"></span><small>Profesional tratante<br>Firma y sello</small></div>
      <div><span class="linea"></span><small>Testigo (si la paciente no desea firmar)<br>Nombre y C.I.</small></div>
    </div>
    <p class="consentimiento-fecha">Fecha: ____ / ____ / ________</p>
  </div>

  <div class="consentimiento-revocatoria">
    <strong>REVOCATORIA DEL CONSENTIMIENTO INFORMADO</strong>
    <p>{{consentimiento.revocatoria}}</p>
    <div class="consentimiento-firmas">
      <div><span class="linea"></span><small>Paciente o representante<br>Nombre y C.I.</small></div>
      <div><span class="linea"></span><small>Profesional que recibe<br>Firma y sello</small></div>
    </div>
    <p class="consentimiento-fecha">Fecha: ____ / ____ / ________</p>
  </div>

  <p class="consentimiento-nota">Este documento forma parte de la historia clínica de la paciente. Formulario de consentimiento informado (estructura del Form. 024, AM 5316).</p>
</div>
`;

function actualizarPlaceholders(cuerpo) {
  let resultado = String(cuerpo || '');

  resultado = resultado.replace(
    /<p>Yo, <strong>\{\{paciente\.nombre_completo\}\}<\/strong>[\s\S]*?para la realización del procedimiento\.<\/p>/,
    '<p>{{consentimiento.declaracion}}</p>'
  );
  resultado = resultado.replace(
    /<p>La paciente o su representante legal manifiesta que NO otorga el consentimiento[\s\S]*?información correspondiente\.<\/p>/,
    '<p>{{consentimiento.negativa}}</p>'
  );
  resultado = resultado.replace(
    /<p>La paciente o su representante legal revoca el consentimiento otorgado[\s\S]*?de su decisión\.<\/p>/,
    '<p>{{consentimiento.revocatoria}}</p>'
  );

  return resultado;
}

export function ensureConsentimientoIsim() {
  const existente = db
    .prepare('SELECT id, cuerpo_html FROM templates WHERE nombre = ?')
    .get(NOMBRE_PLANTILLA_ISIM);
  if (existente) {
    if (!existente.cuerpo_html.includes('{{consentimiento.declaracion}}')) {
      const actualizado = actualizarPlaceholders(existente.cuerpo_html);
      if (actualizado !== existente.cuerpo_html) {
        db.prepare('UPDATE templates SET cuerpo_html = ? WHERE id = ?').run(
          actualizado,
          existente.id
        );
      }
    }
    return existente.id;
  }

  const id = uid();
  db.prepare(
    `INSERT INTO templates (id, nombre, tipo, cuerpo_html, firma_modo, activo, creado_en)
     VALUES (?, ?, 'consentimiento', ?, 'ambas', 1, ?)`
  ).run(id, NOMBRE_PLANTILLA_ISIM, CUERPO, nowIso());

  return id;
}
