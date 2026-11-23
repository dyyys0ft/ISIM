import { db, nowIso, tx } from '../../db/index.js';

const CAMPOS_FUSION = [
  'nombres',
  'apellidos',
  'fecha_nacimiento',
  'sexo',
  'telefono',
  'email',
  'direccion',
  'ocupacion',
  'estado_civil',
  'ciudad',
  'alergias',
  'representante1_nombre',
  'representante1_cedula',
  'representante1_parentesco',
  'representante1_telefono',
  'representante2_nombre',
  'representante2_cedula',
  'representante2_parentesco',
  'representante2_telefono',
];

function baseCedula(cedula) {
  const valor = String(cedula || '');
  if (valor.startsWith('DUP-')) return valor.slice(4, 14);
  if (valor.startsWith('SIN-CED-')) return null;
  return /^\d{10}$/.test(valor) ? valor : null;
}

function cedulaValida(cedula) {
  return /^\d{10}$/.test(String(cedula || '')) && !String(cedula).startsWith('DUP-');
}

function valorVacio(valor) {
  return valor === null || valor === undefined || String(valor).trim() === '';
}

function combinarNotas(actual, nueva) {
  const lineas = new Set(
    [actual, nueva]
      .filter((valor) => !valorVacio(valor))
      .flatMap((valor) => String(valor).split(/\r?\n/))
      .map((linea) => linea.trim())
      .filter(Boolean)
  );
  return lineas.size ? [...lineas].join('\n') : null;
}

function contarReferencias(patientId) {
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM appointments WHERE patient_id = ?) +
         (SELECT COUNT(*) FROM clinical_records WHERE patient_id = ?) +
         (SELECT COUNT(*) FROM documents WHERE patient_id = ?) AS total`
    )
    .get(patientId, patientId, patientId).total;
}

function elegirPaciente(pacientes, base = null) {
  return [...pacientes].sort((a, b) => {
    const exactoA = base && a.cedula === base ? 1 : 0;
    const exactoB = base && b.cedula === base ? 1 : 0;
    if (exactoA !== exactoB) return exactoB - exactoA;

    const cedulaA = cedulaValida(a.cedula) ? 1 : 0;
    const cedulaB = cedulaValida(b.cedula) ? 1 : 0;
    if (cedulaA !== cedulaB) return cedulaB - cedulaA;

    const completaA = a.datos_incompletos ? 0 : 1;
    const completaB = b.datos_incompletos ? 0 : 1;
    if (completaA !== completaB) return completaB - completaA;

    const refsA = contarReferencias(a.id);
    const refsB = contarReferencias(b.id);
    if (refsA !== refsB) return refsB - refsA;

    return String(a.creado_en).localeCompare(String(b.creado_en));
  })[0];
}

function fusionarPacientes(survivorId, duplicados, resumen) {
  if (!duplicados.length) return;

  const survivor = db.prepare('SELECT * FROM patients WHERE id = ?').get(survivorId);
  const campos = { ...survivor };
  let notas = survivor.notas;
  let detalle = survivor.datos_incompletos_detalle;

  for (const duplicado of duplicados) {
    for (const campo of CAMPOS_FUSION) {
      if (valorVacio(campos[campo]) && !valorVacio(duplicado[campo])) {
        campos[campo] = duplicado[campo];
      }
    }
    notas = combinarNotas(notas, duplicado.notas);
    detalle = combinarNotas(detalle, duplicado.datos_incompletos_detalle);
  }

  const idsDuplicados = duplicados.map((fila) => fila.id);
  const marcadores = idsDuplicados.map(() => '?').join(', ');

  db.prepare(
    `UPDATE appointments SET patient_id = ? WHERE patient_id IN (${marcadores})`
  ).run(survivorId, ...idsDuplicados);
  db.prepare(
    `UPDATE clinical_records SET patient_id = ? WHERE patient_id IN (${marcadores})`
  ).run(survivorId, ...idsDuplicados);
  db.prepare(
    `UPDATE documents SET patient_id = ? WHERE patient_id IN (${marcadores})`
  ).run(survivorId, ...idsDuplicados);
  db.prepare(
    `UPDATE migration_map SET new_id = ?
     WHERE entidad = 'patient' AND new_id IN (${marcadores})`
  ).run(survivorId, ...idsDuplicados);
  db.prepare(`DELETE FROM patients WHERE id IN (${marcadores})`).run(...idsDuplicados);

  const columnas = [...CAMPOS_FUSION];
  const actualizaciones = columnas.map((campo) => `${campo} = ?`).join(', ');
  db.prepare(
    `UPDATE patients
     SET ${actualizaciones}, notas = ?, datos_incompletos_detalle = ?,
         fecha_registro_informacion = COALESCE(fecha_registro_informacion, ?),
         actualizado_en = ?
     WHERE id = ?`
  ).run(
    ...columnas.map((campo) => campos[campo] ?? null),
    notas,
    detalle,
    nowIso().slice(0, 10),
    nowIso(),
    survivorId
  );

  resumen.pacientesEliminados += idsDuplicados.length;
}

function fusionarPorCedula(resumen) {
  const filas = db.prepare('SELECT * FROM patients WHERE demo = 0').all();
  const grupos = new Map();

  for (const paciente of filas) {
    const base = baseCedula(paciente.cedula);
    if (!base) continue;
    if (!grupos.has(base)) grupos.set(base, []);
    grupos.get(base).push(paciente);
  }

  for (const [base, grupo] of grupos.entries()) {
    if (grupo.length < 2) continue;
    const survivor = elegirPaciente(grupo, base);
    const duplicados = grupo.filter((fila) => fila.id !== survivor.id);
    fusionarPacientes(survivor.id, duplicados, resumen);
    if (survivor.cedula !== base && cedulaValida(base)) {
      const ocupada = db
        .prepare('SELECT id FROM patients WHERE cedula = ? AND id != ?')
        .get(base, survivor.id);
      if (!ocupada) {
        db.prepare('UPDATE patients SET cedula = ? WHERE id = ?').run(base, survivor.id);
      }
    }
    resumen.gruposCedula += 1;
  }
}

function fusionarPorNombre(resumen) {
  const filas = db
    .prepare(
      `SELECT * FROM patients
       WHERE demo = 0 AND fecha_nacimiento IS NOT NULL AND fecha_nacimiento != ''`
    )
    .all();
  const grupos = new Map();

  for (const paciente of filas) {
    const clave = `${String(paciente.nombres || '').trim().toUpperCase()}|${String(
      paciente.apellidos || ''
    )
      .trim()
      .toUpperCase()}|${paciente.fecha_nacimiento}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(paciente);
  }

  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const cedulasValidas = new Set(
      grupo.map((fila) => fila.cedula).filter((cedula) => cedulaValida(cedula))
    );
    if (cedulasValidas.size > 1) continue;

    const survivor = elegirPaciente(grupo);
    const duplicados = grupo.filter((fila) => fila.id !== survivor.id);
    fusionarPacientes(survivor.id, duplicados, resumen);

    const base = baseCedula(survivor.cedula);
    if (base && survivor.cedula !== base) {
      const ocupada = db
        .prepare('SELECT id FROM patients WHERE cedula = ? AND id != ?')
        .get(base, survivor.id);
      if (!ocupada) {
        db.prepare('UPDATE patients SET cedula = ? WHERE id = ?').run(base, survivor.id);
      }
    }
    resumen.gruposNombre += 1;
  }
}

function fusionarHistorias(resumen) {
  const grupos = db
    .prepare(
      `SELECT patient_id, fecha,
              lower(trim(COALESCE(motivo_consulta, ''))) AS motivo,
              lower(trim(COALESCE(diagnostico, ''))) AS diagnostico,
              lower(trim(COALESCE(notas, ''))) AS notas,
              lower(trim(COALESCE(receta, ''))) AS receta,
              COUNT(*) AS total
       FROM clinical_records
       GROUP BY patient_id, fecha, motivo, diagnostico, notas, receta
       HAVING total > 1`
    )
    .all();

  for (const grupo of grupos) {
    const registros = db
      .prepare(
        `SELECT * FROM clinical_records
         WHERE patient_id = ? AND fecha = ?
           AND lower(trim(COALESCE(motivo_consulta, ''))) = ?
           AND lower(trim(COALESCE(diagnostico, ''))) = ?
           AND lower(trim(COALESCE(notas, ''))) = ?
           AND lower(trim(COALESCE(receta, ''))) = ?`
      )
      .all(
        grupo.patient_id,
        grupo.fecha,
        grupo.motivo,
        grupo.diagnostico,
        grupo.notas,
        grupo.receta
      );

    if (registros.length < 2) continue;

    const conAnexos = registros.map((registro) => ({
      ...registro,
      anexos:
        db
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM clinical_exams WHERE record_id = ?) +
               (SELECT COUNT(*) FROM clinical_attachments WHERE record_id = ?) AS total`
          )
          .get(registro.id, registro.id).total,
    }));
    conAnexos.sort((a, b) => b.anexos - a.anexos || String(a.creado_en).localeCompare(String(b.creado_en)));
    const survivor = conAnexos[0];
    const duplicados = conAnexos.slice(1).map((fila) => fila.id);
    const marcadores = duplicados.map(() => '?').join(', ');

    for (const registro of conAnexos.slice(1)) {
      const notas = combinarNotas(survivor.notas, registro.notas);
      const receta = combinarNotas(survivor.receta, registro.receta);
      const detalle = {
        notas,
        receta,
        diagnostico: survivor.diagnostico || registro.diagnostico || null,
        tratamiento: survivor.tratamiento || registro.tratamiento || null,
        indicaciones: survivor.indicaciones || registro.indicaciones || null,
        recomendaciones: survivor.recomendaciones || registro.recomendaciones || null,
      };
      db.prepare(
        `UPDATE clinical_records
         SET notas = ?, receta = ?, diagnostico = ?, tratamiento = ?,
             indicaciones = ?, recomendaciones = ?
         WHERE id = ?`
      ).run(
        detalle.notas,
        detalle.receta,
        detalle.diagnostico,
        detalle.tratamiento,
        detalle.indicaciones,
        detalle.recomendaciones,
        survivor.id
      );
    }

    db.prepare(
      `UPDATE clinical_exams SET record_id = ? WHERE record_id IN (${marcadores})`
    ).run(survivor.id, ...duplicados);
    db.prepare(
      `UPDATE clinical_attachments SET record_id = ? WHERE record_id IN (${marcadores})`
    ).run(survivor.id, ...duplicados);
    db.prepare(
      `UPDATE migration_map SET new_id = ?
       WHERE entidad = 'clinical_record' AND new_id IN (${marcadores})`
    ).run(survivor.id, ...duplicados);
    db.prepare(`DELETE FROM clinical_records WHERE id IN (${marcadores})`).run(...duplicados);

    resumen.historiasEliminadas += duplicados.length;
  }
}

export function previsualizarDuplicados() {
  const pacientesCedula = db.prepare(`
    SELECT COUNT(*) grupos, COALESCE(SUM(n), 0) total FROM (
      SELECT COUNT(*) n FROM (
        SELECT CASE WHEN cedula LIKE 'DUP-%' THEN substr(cedula, 5, 10) ELSE cedula END AS base
        FROM patients
        WHERE demo = 0
          AND (cedula LIKE 'DUP-%' OR (length(cedula) = 10 AND cedula NOT LIKE 'SIN-CED-%'))
      )
      GROUP BY base HAVING n > 1
    )
  `).get();

  const historias = db.prepare(`
    SELECT COUNT(*) grupos, COALESCE(SUM(n), 0) total FROM (
      SELECT COUNT(*) n
      FROM clinical_records
      GROUP BY patient_id, fecha,
               lower(trim(COALESCE(motivo_consulta, ''))),
               lower(trim(COALESCE(diagnostico, ''))),
               lower(trim(COALESCE(notas, ''))),
               lower(trim(COALESCE(receta, '')))
      HAVING n > 1
    )
  `).get();

  return {
    pacientes: {
      grupos: pacientesCedula.grupos,
      registros: pacientesCedula.total,
      eliminables: Math.max(0, pacientesCedula.total - pacientesCedula.grupos),
    },
    historias: {
      grupos: historias.grupos,
      registros: historias.total,
      eliminables: Math.max(0, historias.total - historias.grupos),
    },
  };
}

export function depurarDuplicados() {
  const resumen = {
    gruposCedula: 0,
    gruposNombre: 0,
    pacientesEliminados: 0,
    historiasEliminadas: 0,
  };

  tx(() => {
    fusionarPorCedula(resumen);
    fusionarPorNombre(resumen);
    fusionarHistorias(resumen);
    db.exec('PRAGMA optimize;');
  });

  return resumen;
}
