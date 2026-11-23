import { unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, nowIso, tx, uid } from '../db/index.js';
import { config } from '../config.js';

const NOMBRES = [
  'María', 'Ana', 'Sofía', 'Camila', 'Valentina', 'Daniela', 'Fernanda', 'Gabriela',
  'Andrea', 'Carolina', 'Paola', 'Verónica', 'Lucía', 'Mónica', 'Patricia', 'Elena',
  'Rosa', 'Carmen', 'Silvia', 'Natalia', 'Alejandra', 'Beatriz', 'Cristina', 'Diana',
  'Erika', 'Fátima', 'Gloria', 'Helena', 'Irene', 'Julia', 'Karen', 'Lorena',
];

const APELLIDOS = [
  'Pérez', 'Jiménez', 'García', 'Rodríguez', 'Martínez', 'López', 'González', 'Hernández',
  'Torres', 'Ramírez', 'Flores', 'Vargas', 'Castro', 'Rojas', 'Mendoza', 'Guamán',
  'Paredes', 'Salazar', 'Cevallos', 'Morales', 'Ortiz', 'Silva', 'Núñez', 'Cabrera',
  'Villacís', 'Chávez', 'Andrade', 'Freire', 'Álvarez', 'Zambrano', 'Yánez', 'Tapia',
];

const MOTIVOS = [
  'Control ginecológico',
  'Control de embarazo',
  'Ecografía obstétrica',
  'Colposcopia',
  'Control post procedimiento',
  'Dolor pélvico',
  'Seguimiento de tratamiento',
  'Consejería en salud sexual',
  'Control de mujer sana',
  'Biopsia cervical',
];

const DIAGNOSTICOS = [
  'Control normal',
  'Vaginosis bacteriana',
  'Candidiasis vaginal',
  'Embarazo de evolución normal',
  'Displasia cervical leve',
  'Quiste ovárico funcional',
  'Síndrome de ovario poliquístico',
  'Miomatosis uterina',
  'Infección urinaria',
  'Control post quirúrgico',
];

const TRATAMIENTOS = [
  'Tratamiento sintomático por 7 días.',
  'Control y observación clínica.',
  'Tratamiento antibiótico según cultivo.',
  'Manejo expectante con controles.',
  'Terapia hormonal según indicación.',
  'Seguimiento con ecografía en 4 semanas.',
];

const RECETAS = [
  'Paracetamol 500 mg cada 8 horas por 5 días.',
  'Ibuprofeno 400 mg cada 8 horas por 3 días.',
  'Óvulos vaginales según indicación por 7 noches.',
  'Antibiótico oral según prescripción por 7 días.',
  'Ácido fólico 1 mg diario.',
  'No requiere medicación por ahora.',
];

const INDICACIONES = [
  'Hidratación, reposo relativo y control en 7 días.',
  'Evitar relaciones sexuales por 2 semanas.',
  'Acudir a emergencia si presenta dolor intenso o sangrado abundante.',
  'Realizar los exámenes solicitados y volver con resultados.',
  'Mantener controles prenatales mensuales.',
  'Dieta balanceada y actividad física moderada.',
];

const RECOMENDACIONES = [
  'Control en 30 días.',
  'Control en 15 días con resultados.',
  'Acudir a emergencia si presenta signos de alarma.',
  'Continuar tratamiento y regresar si no mejora.',
  'Mantener seguimiento mensual.',
];

const EXAMENES = [
  'Hemograma completo',
  'Perfil bioquímico',
  'Examen de orina',
  'Cultivo vaginal',
  'Ecografía transvaginal',
  'Ecografía obstétrica',
  'Citología cervical',
  'Biopsia de cuello uterino',
  'Test de embarazo',
  'Perfil hormonal',
];

const TIPOS_EXAMEN = ['clinico', 'laboratorio', 'imagen', 'otro'];
const ESTADOS_EXAMEN = ['solicitado', 'recibido', 'evaluado'];

const MOTIVOS_REAGENDA = [
  'Llegó tarde y no se pudo atender',
  'Tuvo que irse antes',
  'El médico no pudo atender',
  'Emergencia médica',
  'Problema de transporte',
  'Paciente no se presentó',
  'Otro motivo indicado por secretaría',
];

function pick(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

function entero(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function fechaNacimiento() {
  const anio = entero(1955, 2004);
  const mes = String(entero(1, 12)).padStart(2, '0');
  const dia = String(entero(1, 28)).padStart(2, '0');
  return `${anio}-${mes}-${dia}`;
}

function fechaCita(offsetDias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + offsetDias);
  fecha.setHours(entero(7, 18), pick([0, 15, 30, 45]), 0, 0);
  return fecha.toISOString();
}

function estadoCita(offsetDias) {
  const r = Math.random();
  if (offsetDias < 0) {
    if (r < 0.65) return 'atendida';
    if (r < 0.8) return 'cancelada';
    if (r < 0.9) return 'no_asistio';
    return 'reagendada';
  }
  if (offsetDias === 0) {
    if (r < 0.35) return 'programada';
    if (r < 0.6) return 'confirmada';
    if (r < 0.8) return 'en_progreso';
    if (r < 0.9) return 'atendida';
    return 'cancelada';
  }
  if (r < 0.55) return 'programada';
  if (r < 0.85) return 'confirmada';
  if (r < 0.95) return 'reagendada';
  return 'cancelada';
}

function marcarDemo(activo) {
  db.prepare(
    `INSERT OR REPLACE INTO settings (clave, valor, actualizado_en)
     VALUES ('demo_activo', ?, ?)`
  ).run(activo ? '1' : '0', nowIso());
}

export function contarDemo() {
  return {
    demoPacientes: db.prepare('SELECT COUNT(*) AS n FROM patients WHERE demo = 1').get().n,
    demoCitas: db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE demo = 1').get().n,
    demoHistorias: db
      .prepare('SELECT COUNT(*) AS n FROM clinical_records WHERE demo = 1')
      .get().n,
    demoExamenes: db
      .prepare('SELECT COUNT(*) AS n FROM clinical_exams WHERE demo = 1')
      .get().n,
  };
}

function generarDemo() {
  const admin =
    db
      .prepare(
        "SELECT id FROM users WHERE rol = 'admin' AND activo = 1 ORDER BY creado_en LIMIT 1"
      )
      .get() || db.prepare('SELECT id FROM users LIMIT 1').get();
  const adminId = admin?.id ?? null;
  const doctores = db
    .prepare("SELECT id FROM users WHERE rol = 'medico' AND activo = 1")
    .all();
  const medicoIds = doctores.length ? doctores.map((d) => d.id) : [null];

  const insertPaciente = db.prepare(
    `INSERT INTO patients
       (id, cedula, nombres, apellidos, fecha_nacimiento, sexo, telefono, email,
        direccion, notas, demo, activo, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
  );

  const insertCita = db.prepare(
    `INSERT INTO appointments
       (id, patient_id, medico_id, fecha_hora, duracion_min, motivo, estado,
        motivo_reagenda, notas, demo, creado_por, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  );

  const insertHistoria = db.prepare(
    `INSERT INTO clinical_records
       (id, appointment_id, patient_id, medico_id, fecha, duracion_estimada_min,
        motivo_consulta, notas, diagnostico, tratamiento, receta, indicaciones,
        recomendaciones, demo, creado_por, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  );

  const insertExamen = db.prepare(
    `INSERT INTO clinical_exams
       (id, record_id, patient_id, nombre, tipo, descripcion, indicaciones, estado, observaciones, demo,
        creado_por, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  );

  const ts = nowIso();
  const pacientes = [];

  for (let i = 0; i < 1000; i += 1) {
    const id = uid();
    pacientes.push(id);
    insertPaciente.run(
      id,
      String(9900000001 + i),
      pick(NOMBRES),
      `${pick(APELLIDOS)} ${pick(APELLIDOS)}`,
      fechaNacimiento(),
      Math.random() < 0.9 ? 'F' : 'M',
      `09${String(80000000 + i)}`,
      `demo${i + 1}@isim.local`,
      'Riobamba, sector demostración',
      'Paciente de demostración',
      ts,
      ts
    );
  }

  for (let i = 0; i < 5000; i += 1) {
    const citaId = uid();
    const patientId = pick(pacientes);
    const medicoId = pick(medicoIds);
    const offset = entero(-180, 180);
    const estado = estadoCita(offset);
    const duracion = pick([15, 30, 45, 60]);
    const fechaHora = fechaCita(offset);
    const motivo = pick(MOTIVOS);

    insertCita.run(
      citaId,
      patientId,
      medicoId,
      fechaHora,
      duracion,
      motivo,
      estado,
      estado === 'reagendada' ? pick(MOTIVOS_REAGENDA) : null,
      'Cita de demostración',
      adminId,
      ts,
      ts
    );

    if (['cancelada', 'no_asistio'].includes(estado)) continue;

    const recordId = uid();
    insertHistoria.run(
      recordId,
      citaId,
      patientId,
      medicoId,
      fechaHora,
      duracion,
      motivo,
      `Evolución de demostración. ${pick(INDICACIONES)}`,
      pick(DIAGNOSTICOS),
      pick(TRATAMIENTOS),
      pick(RECETAS),
      pick(INDICACIONES),
      pick(RECOMENDACIONES),
      adminId,
      ts,
      ts
    );

    const cantidadExamenes = entero(0, 3);
    for (let j = 0; j < cantidadExamenes; j += 1) {
      const estadoExamen = pick(ESTADOS_EXAMEN);
      insertExamen.run(
        uid(),
        recordId,
        patientId,
        pick(EXAMENES),
        pick(TIPOS_EXAMEN),
        'Examen solicitado en consulta de demostración.',
        'Examen solicitado en consulta de demostración.',
        estadoExamen,
        estadoExamen === 'solicitado'
          ? null
          : 'Resultado revisado en consulta de demostración.',
        adminId,
        ts,
        ts
      );
    }
  }
}

export function desactivarDemo() {
  const antes = contarDemo();
  let resultadoPacientesBloqueados = 0;

  tx(() => {
    const archivos = db
      .prepare(
        `SELECT id, ruta FROM clinical_attachments
         WHERE record_id IN (
           SELECT id FROM clinical_records
           WHERE demo = 1 OR appointment_id IN (SELECT id FROM appointments WHERE demo = 1)
         )`
      )
      .all();

    for (const archivo of archivos) {
      try {
        unlinkSync(resolve(config.dataDir, archivo.ruta));
      } catch {
        // el archivo pudo no existir
      }
    }

    db.prepare(
      `DELETE FROM clinical_attachments
       WHERE record_id IN (
         SELECT id FROM clinical_records
         WHERE demo = 1 OR appointment_id IN (SELECT id FROM appointments WHERE demo = 1)
       )`
    ).run();

    db.prepare(
      `DELETE FROM appointment_notifications
       WHERE appointment_id IN (SELECT id FROM appointments WHERE demo = 1)`
    ).run();

    db.prepare(
      `DELETE FROM clinical_exams
       WHERE demo = 1 OR record_id IN (
         SELECT id FROM clinical_records
         WHERE demo = 1 OR appointment_id IN (SELECT id FROM appointments WHERE demo = 1)
       )`
    ).run();

    db.prepare(
      `DELETE FROM clinical_records
       WHERE demo = 1 OR appointment_id IN (SELECT id FROM appointments WHERE demo = 1)`
    ).run();

    db.prepare('DELETE FROM appointments WHERE demo = 1').run();

    // Una paciente de demostración puede tener documentos reales creados por el
    // usuario. En ese caso se conserva para no romper la integridad referencial.
    const pacientesBloqueados = db
      .prepare(
        `SELECT COUNT(*) AS n FROM patients p
         WHERE p.demo = 1
           AND (
             EXISTS (SELECT 1 FROM documents d WHERE d.patient_id = p.id)
             OR EXISTS (
               SELECT 1 FROM appointments a
               WHERE a.patient_id = p.id AND a.demo = 0
             )
             OR EXISTS (
               SELECT 1 FROM clinical_records cr
               WHERE cr.patient_id = p.id AND cr.demo = 0
             )
           )`
      )
      .get().n;

    db.prepare(
      `DELETE FROM patients
       WHERE demo = 1
         AND id NOT IN (SELECT patient_id FROM documents)
         AND NOT EXISTS (
           SELECT 1 FROM appointments a
           WHERE a.patient_id = patients.id AND a.demo = 0
         )
         AND NOT EXISTS (
           SELECT 1 FROM clinical_records cr
           WHERE cr.patient_id = patients.id AND cr.demo = 0
         )`
    ).run();

    resultadoPacientesBloqueados = pacientesBloqueados;
  });

  marcarDemo(false);
  return { antes, despues: contarDemo(), demoPacientesBloqueados: resultadoPacientesBloqueados };
}

export function activarDemo() {
  desactivarDemo();
  tx(() => generarDemo());
  marcarDemo(true);
  return { demoActivo: true, ...contarDemo() };
}
