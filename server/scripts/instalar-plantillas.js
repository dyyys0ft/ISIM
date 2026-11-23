import { db, nowIso, tx, uid } from '../db/index.js';

const BLOQUE_FIRMAS = `
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
</div>`;

function datosPaciente() {
  return `
<h3>1. Datos de la paciente</h3>
<p>
  <strong>Nombre:</strong> {{paciente.nombre_completo}}<br>
  <strong>Cédula de Identidad:</strong> {{paciente.cedula}}<br>
  <strong>Edad:</strong> {{paciente.edad_texto}}<br>
  <strong>Fecha de nacimiento:</strong> {{paciente.fecha_nacimiento}}<br>
  <strong>Teléfono:</strong> {{paciente.telefono}}<br>
  <strong>Dirección:</strong> {{paciente.direccion}}
</p>`;
}

function declaracion(procedimiento) {
  return `
<h3>7. Declaración y autorización</h3>
{{#adulto}}
<p>
  Yo, <strong>{{paciente.nombre_completo}}</strong>, con Cédula de Identidad
  <strong>{{paciente.cedula}}</strong>, de <strong>{{paciente.edad_texto}}</strong>, en pleno uso de mis
  facultades, declaro que he recibido información clara, suficiente y comprensible sobre
  ${procedimiento}. He comprendido los beneficios esperados, las posibles molestias,
  consecuencias y riesgos descritos, así como las alternativas y la posibilidad de requerir
  estudios o tratamientos adicionales. He tenido la oportunidad de formular preguntas y todas
  han sido respondidas satisfactoriamente. En consecuencia, otorgo mi consentimiento libre,
  informado y voluntario.
</p>
{{/adulto}}
{{#menor}}
<p>
  Yo, <strong>{{paciente.representante1_nombre}}</strong>, con Cédula de Identidad
  <strong>{{paciente.representante1_cedula}}</strong>, en calidad de
  <strong>{{paciente.representante1_parentesco}}</strong> y representante legal de
  <strong>{{paciente.nombre_completo}}</strong>, quien es menor de edad
  (<strong>{{paciente.edad_texto}}</strong>), declaro que he recibido información clara,
  suficiente y comprensible sobre ${procedimiento}. He comprendido los beneficios esperados,
  las posibles molestias, consecuencias y riesgos descritos, así como las alternativas y la
  posibilidad de requerir estudios o tratamientos adicionales. He tenido la oportunidad de
  formular preguntas y todas han sido respondidas satisfactoriamente. En consecuencia, otorgo
  el consentimiento en nombre e interés superior de la paciente menor de edad.
</p>
{{/menor}}
<p>
  Autorizo al personal de salud de {{institucion}} a realizar el procedimiento descrito, así
  como las maniobras, estudios complementarios y tratamientos que resulten necesarios durante
  su ejecución, dentro de los estándares de atención institucional.
</p>`;
}

function bloqueMenor() {
  return `
{{#menor}}
<h3>8. Datos del representante legal</h3>
<p>
  <strong>Nombre:</strong> {{paciente.representante1_nombre}}<br>
  <strong>Cédula de Identidad:</strong> {{paciente.representante1_cedula}}<br>
  <strong>Parentesco:</strong> {{paciente.representante1_parentesco}}<br>
  <strong>Teléfono:</strong> {{paciente.representante1_telefono}}
</p>
<p>
  El representante legal arriba identificado declara actuar en nombre de la paciente menor de
  edad, haber comprendido la información entregada y autorizar la realización del
  procedimiento. La firma del representante legal consta al pie del presente documento.
</p>
{{/menor}}`;
}

function crearPlantilla({ titulo, descripcion, duracion, beneficios, molestias, consecuencias, indicaciones, recomendaciones, procedimiento }) {
  return `
<p class="doc-fecha-carta">Riobamba, {{fecha}}</p>
<h2>${titulo}</h2>
<p class="doc-meta">{{institucion}}</p>

${datosPaciente()}

<h3>2. Descripción del procedimiento</h3>
<p>${descripcion}</p>
<p><strong>Duración estimada:</strong> ${duracion}</p>

<h3>3. Beneficios esperados</h3>
<p>${beneficios}</p>

<h3>4. Posibles molestias</h3>
<p>${molestias}</p>

<h3>5. Posibles consecuencias y riesgos</h3>
<p>${consecuencias}</p>

<h3>6. Indicaciones, cuidados y signos de alarma</h3>
<p>${indicaciones}</p>
<p>${recomendaciones}</p>

${declaracion(procedimiento)}

${bloqueMenor()}

${BLOQUE_FIRMAS}
`;
}

const PLANTILLAS = [
  {
    nombre: 'Chequeo ginecológico — control de mujer sana',
    tipo: 'ginecologia',
    titulo: 'CONSENTIMIENTO INFORMADO — CHEQUEO GINECOLÓGICO Y CONTROL DE MUJER SANA',
    descripcion:
      'El chequeo ginecológico es una evaluación integral de la salud femenina. Comprende anamnesis dirigida, examen físico general y ginecológico, inspección vulvar, especuloscopía, toma de citología cervical (Papanicolaou) cuando está indicada, tacto bimanual y, según el caso, ecografía pélvica y pruebas de laboratorio. Su finalidad es detectar de forma temprana alteraciones del tracto genital inferior, lesiones precancerosas, infecciones, alteraciones hormonales y otras condiciones, y orientar medidas de prevención y tratamiento oportuno.',
    duracion: '20 a 30 minutos, según los estudios complementarios que se realicen.',
    beneficios:
      'Permite la detección temprana de lesiones precancerosas del cuello uterino, infecciones vaginales o cervicales, alteraciones hormonales, masas pélvicas y otras condiciones ginecológicas. Facilita la consejería en salud sexual y reproductiva, la prevención y el tratamiento oportuno, y contribuye a reducir la morbimortalidad por cáncer cervical.',
    molestias:
      'Puede presentarse presión pélvica, molestia leve durante la colocación del espéculo, sensación de roce al tomar la citología y un manchado vaginal transitorio. La ecografía pélvica puede producir molestia por la presión del transductor o requerir vejiga llena.',
    consecuencias:
      'Las molestias suelen ser leves y transitorias. Puede aparecer sangrado leve o manchado vaginal, molestia pélvica o, excepcionalmente, infección. Los resultados pueden ser falsos negativos o falsos positivos, lo que puede requerir repetir estudios, colposcopia, biopsia o tratamientos adicionales. La citología no diagnostica todas las enfermedades ginecológicas.',
    indicaciones:
      'Informe si está embarazada, si tiene sangrado activo, infección vaginal, alergias, uso de anticoagulantes o antecedentes de cirugía ginecológica. Para la citología, evite relaciones sexuales, tampones, cremas o duchas vaginales durante las 48 a 72 horas previas, salvo indicación médica. Acuda con vejiga vacía si se realizará ecografía transabdominal.',
    recomendaciones:
      'Si presenta dolor intenso, sangrado abundante, fiebre, secreción fétida, malestar general o cualquier síntoma que le preocupe, acuda de inmediato al médico o al servicio de emergencia. No reemplace los controles periódicos por la ausencia de síntomas.',
    procedimiento: 'el chequeo ginecológico y los estudios complementarios indicados',
  },
  {
    nombre: 'Control de embarazo y ecografía obstétrica',
    tipo: 'obstetricia',
    titulo: 'CONSENTIMIENTO INFORMADO — CONTROL DE EMBARAZO Y ECOGRAFÍA OBSTÉTRICA',
    descripcion:
      'El control prenatal incluye historia obstétrica, evaluación de signos vitales, examen abdominal, auscultación del latido fetal y ecografía obstétrica por vía transabdominal o transvaginal según la edad gestacional. La ecografía permite evaluar viabilidad, número de fetos, edad gestacional, biometría fetal, placenta, líquido amniótico y cuello uterino. Según los hallazgos, pueden indicarse estudios complementarios y controles más frecuentes.',
    duracion: '20 a 40 minutos, según la vía de abordaje y los hallazgos.',
    beneficios:
      'Permite confirmar la viabilidad y la edad gestacional, evaluar el crecimiento fetal, la placenta y el líquido amniótico, detectar embarazo múltiple, malformaciones mayores, restricción del crecimiento y otras complicaciones. Facilita la planificación de controles, la consejería y la toma de decisiones informadas durante el embarazo.',
    molestias:
      'Puede presentarse gel frío, presión abdominal, necesidad de vejiga llena en algunos estudios y molestia leve durante la ecografía transvaginal. La posición fetal o la anatomía materna pueden dificultar la visualización y requerir repetir el estudio.',
    consecuencias:
      'La ecografía obstétrica no utiliza radiación ionizante y se considera segura cuando es realizada por personal capacitado. Sin embargo, tiene limitaciones: puede no detectar todas las malformaciones o alteraciones, puede generar hallazgos incidentales y, en ocasiones, resultados falsos positivos o falsos negativos. No reemplaza otros controles prenatales ni garantiza un resultado fetal normal.',
    indicaciones:
      'Informe si presenta sangrado, dolor, pérdida de líquido, fiebre, disminución de movimientos fetales, antecedentes de complicaciones obstétricas, alergias o enfermedades maternas. Acuda con acompañante si lo desea y traiga los estudios previos.',
    recomendaciones:
      'Si presenta sangrado vaginal, dolor intenso, fiebre, pérdida de líquido, disminución de los movimientos fetales, cefalea intensa, visión borrosa o cualquier signo de alarma, acuda de inmediato al servicio de emergencia obstétrica.',
    procedimiento: 'el control prenatal y la ecografía obstétrica indicada',
  },
  {
    nombre: 'Colposcopia y biopsia cervical',
    tipo: 'colposcopia',
    titulo: 'CONSENTIMIENTO INFORMADO — COLPOSCOPIA Y BIOPSIA CERVICAL',
    descripcion:
      'La colposcopia es un estudio que permite visualizar el cuello uterino, la vagina y la vulva mediante un colposcopio, previa aplicación de ácido acético y lugol. Cuando se identifican áreas sospechosas, se realiza una biopsia dirigida y, si está indicada, un curetaje endocervical. Las muestras se envían a anatomía patológica para confirmar el diagnóstico y orientar el tratamiento.',
    duracion: '20 a 30 minutos, según el número de biopsias y la complejidad del caso.',
    beneficios:
      'Permite identificar lesiones precancerosas o cancerosas, infecciones y otras alteraciones del tracto genital inferior. La biopsia confirma el diagnóstico, define la conducta y contribuye a la prevención y al tratamiento oportuno del cáncer cervical.',
    molestias:
      'Puede presentarse molestia por la colocación del espéculo, ardor transitorio por el ácido acético, cólico leve, sangrado o manchado después de la biopsia y flujo vaginal durante la cicatrización.',
    consecuencias:
      'Puede aparecer sangrado leve o moderado, dolor, infección o cicatrización local. Los resultados pueden requerir seguimiento, tratamiento, repetir la biopsia o realizar otros estudios. Excepcionalmente puede presentarse sangrado abundante o complicaciones que requieran atención médica.',
    indicaciones:
      'Informe si está embarazada, tiene alergias, usa anticoagulantes, presenta infección vaginal activa o sangrado. No use tampones, cremas vaginales ni tenga relaciones sexuales durante las 48 a 72 horas previas, salvo indicación médica. Después de la biopsia, evite tampones y relaciones sexuales durante el tiempo que le indique el profesional.',
    recomendaciones:
      'Si presenta sangrado abundante, fiebre, dolor intenso, secreción fétida o malestar general, acuda de inmediato al médico o al servicio de emergencia. Cumpla con el control posterior para revisar los resultados de anatomía patológica.',
    procedimiento: 'la colposcopia y la biopsia cervical indicada',
  },
  {
    nombre: 'Fulguración cervical con asa LEEP',
    tipo: 'leeplaser',
    titulo: 'CONSENTIMIENTO INFORMADO — FULGURACIÓN CERVICAL CON ASA LEEP (LEEP/LLETZ)',
    descripcion:
      'La fulguración cervical con asa LEEP (procedimiento de escisión electroquirúrgica con asa) es una técnica que permite extirpar la zona de transformación del cuello uterino y controlar el sangrado mediante energía eléctrica. Se realiza bajo anestesia local, en ambiente clínico y con medidas de asepsia. La muestra obtenida se envía a anatomía patológica para confirmar el diagnóstico y los márgenes de resección.',
    duracion: '20 a 40 minutos, según la extensión de la lesión y la respuesta al procedimiento.',
    beneficios:
      'Permite tratar lesiones displásicas del cuello uterino, extirpar la lesión y obtener confirmación diagnóstica en una sola intervención. Reduce el riesgo de progresión a cáncer cervical y facilita el seguimiento con controles citológicos y colposcópicos.',
    molestias:
      'Puede presentarse molestia durante la anestesia local, cólicos similares a los menstruales, sangrado o manchado y flujo vaginal durante el proceso de cicatrización.',
    consecuencias:
      'Puede aparecer sangrado, infección, dolor, estenosis cervical, cicatrización o recurrencia de la lesión. Son necesarios controles posteriores y, en algunos casos, tratamientos adicionales. Existe una asociación con mayor riesgo de parto prematuro en embarazos futuros. Excepcionalmente pueden presentarse lesiones de órganos vecinos o complicaciones anestésicas.',
    indicaciones:
      'Informe si está embarazada, tiene alergias, usa anticoagulantes, presenta infección activa o sangrado. No use tampones ni tenga relaciones sexuales durante 4 a 6 semanas después del procedimiento, salvo indicación médica. Evite esfuerzos físicos intensos y utilice toallas sanitarias durante el sangrado.',
    recomendaciones:
      'Si presenta sangrado abundante, coágulos grandes, fiebre, dolor intenso, secreción fétida o malestar general, acuda de inmediato al médico o al servicio de emergencia. Asista a sus controles para evaluar la cicatrización y el resultado de la biopsia.',
    procedimiento: 'la fulguración cervical con asa LEEP y el estudio anatomopatológico de la muestra',
  },
  {
    nombre: 'Láser vaginal y PRP intravaginal',
    tipo: 'laserprp',
    titulo: 'CONSENTIMIENTO INFORMADO — LÁSER VAGINAL Y PRP INTRAVAGINAL',
    descripcion:
      'El procedimiento combina la aplicación de láser vaginal (CO2 o erbio) para remodelar la mucosa y favorecer la regeneración tisular, con la aplicación intravaginal de plasma rico en plaquetas (PRP) obtenido de sangre autóloga. El PRP se obtiene mediante venopunción, centrifugación y activación, y se aplica en el mismo acto clínico bajo medidas de asepsia. Según el caso, puede requerir varias sesiones.',
    duracion: '40 a 60 minutos, incluyendo la toma de sangre, el procesamiento del PRP y la aplicación.',
    beneficios:
      'Puede mejorar la atrofia y sequedad vaginal, la elasticidad, la lubricación, los síntomas de laxitud y algunos aspectos de la función sexual. El PRP aporta factores de crecimiento que favorecen la regeneración de los tejidos. Los resultados son variables, no están garantizados y pueden requerir sesiones adicionales.',
    molestias:
      'Puede presentarse calor, ardor o punzadas durante la aplicación, cólicos leves, flujo vaginal, manchado y sensibilidad local. La venopunción puede producir dolor o hematoma en el sitio de punción.',
    consecuencias:
      'Puede aparecer irritación, infección, sangrado, flujo, molestias transitorias o resultados parciales. Al ser PRP autólogo, el riesgo de reacción alérgica es bajo, pero no nulo. No se garantiza un resultado estético o funcional determinado y pueden ser necesarias varias sesiones o tratamientos complementarios.',
    indicaciones:
      'Informe si está embarazada o en lactancia, si tiene infección vaginal activa, cáncer ginecológico, trastornos de coagulación, enfermedad hematológica o tratamiento anticoagulante. Evite relaciones sexuales, tampones y duchas vaginales durante 7 a 14 días, según indicación médica. Mantenga higiene genital y evite productos irritantes.',
    recomendaciones:
      'Si presenta fiebre, dolor intenso, sangrado abundante, secreción fétida o malestar general, acuda de inmediato al médico o al servicio de emergencia. Asista a los controles programados para evaluar la respuesta y definir nuevas sesiones.',
    procedimiento: 'la aplicación de láser vaginal y PRP intravaginal',
  },
  {
    nombre: 'Control y seguimiento de tratamiento',
    tipo: 'seguimiento',
    titulo: 'CONSENTIMIENTO INFORMADO — CONTROL Y SEGUIMIENTO DE TRATAMIENTO',
    descripcion:
      'La consulta de control y seguimiento tiene como finalidad evaluar la evolución clínica, la adherencia y la tolerancia al tratamiento indicado. Comprende interrogatorio dirigido, examen físico y ginecológico cuando corresponde, revisión de resultados y, si es necesario, estudios de laboratorio, ecografía u otras pruebas. Con base en los hallazgos se ajusta el plan terapéutico y se define el intervalo del próximo control.',
    duracion: '15 a 30 minutos, según los estudios y la complejidad del seguimiento.',
    beneficios:
      'Permite valorar la respuesta al tratamiento, detectar complicaciones o efectos adversos, ajustar la medicación, prevenir recaídas y mantener la continuidad de la atención. Facilita la educación en salud, la adherencia terapéutica y la derivación oportuna cuando se requiere.',
    molestias:
      'Dependen del examen realizado. Puede haber molestia por la colocación del espéculo, la toma de muestras, la palpación, la ecografía o la venopunción. La mayoría de las molestias son leves y transitorias.',
    consecuencias:
      'La evaluación clínica tiene limitaciones y puede requerir estudios adicionales. Los resultados pueden motivar cambios de tratamiento, derivación a otra especialidad o la necesidad de repetir controles. El seguimiento no garantiza la curación ni evita por sí solo las recaídas; su utilidad depende de la continuidad y de la adherencia al plan indicado.',
    indicaciones:
      'Traiga los resultados de estudios previos, la lista de medicamentos y las indicaciones anteriores. Informe efectos adversos, nuevas molestias, cambios en el estado de salud, embarazo o cualquier tratamiento iniciado por otro profesional.',
    recomendaciones:
      'Si presenta empeoramiento de los síntomas, efectos adversos importantes, fiebre, dolor intenso, sangrado anormal o cualquier signo de alarma, comuníquese de inmediato con su médico o acuda al servicio de emergencia. No suspenda ni modifique el tratamiento sin indicación profesional.',
    procedimiento: 'el control y seguimiento del tratamiento indicado',
  },
];

const ts = nowIso();
let insertadas = 0;
let actualizadas = 0;

tx(() => {
  for (const plantilla of PLANTILLAS) {
    const cuerpo = crearPlantilla({
      titulo: plantilla.titulo,
      descripcion: plantilla.descripcion,
      duracion: plantilla.duracion,
      beneficios: plantilla.beneficios,
      molestias: plantilla.molestias,
      consecuencias: plantilla.consecuencias,
      indicaciones: plantilla.indicaciones,
      recomendaciones: plantilla.recomendaciones,
      procedimiento: plantilla.procedimiento,
    });

    const existente = db
      .prepare('SELECT id FROM templates WHERE nombre = ?')
      .get(plantilla.nombre);

    if (existente) {
      db.prepare(
        `UPDATE templates
         SET tipo = ?, cuerpo_html = ?, activo = 1
         WHERE id = ?`
      ).run(plantilla.tipo, cuerpo, existente.id);
      actualizadas += 1;
    } else {
      db.prepare(
        `INSERT INTO templates (id, nombre, tipo, cuerpo_html, activo, creado_en)
         VALUES (?, ?, ?, ?, 1, ?)`
      ).run(uid(), plantilla.nombre, plantilla.tipo, cuerpo, ts);
      insertadas += 1;
    }
  }
});

console.log(
  JSON.stringify(
    {
      plantillas: PLANTILLAS.length,
      insertadas,
      actualizadas,
      nombres: PLANTILLAS.map((p) => p.nombre),
    },
    null,
    2
  )
);
