import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';
import {
  fechaValida,
  leerDump,
  normalizarCedula,
  resumirDump,
  separarNombre,
} from '../server/lib/migracion/oldDb.js';

/**
 * E2E de migración de base de datos.
 *
 * Usa un subconjunto representativo de old_db.sql (pacientes válidos, sin cédula,
 * cédulas duplicadas, fechas inválidas, citas con y sin consulta, canceladas,
 * exámenes y recetas). Migra, vuelve a migrar, borra la base conservando los
 * usuarios, migra de nuevo y compara la base antigua con la nueva.
 */

const DEMO_CEDULA = '0603456789';
const MODO_COMPLETO = process.env.MIGRATION_FULL === '1';
const archivosLimpiar = [];
let entorno = null;

function texto(valor) {
  return String(valor ?? '').trim();
}

function normalizarTexto(valor) {
  return texto(valor).replace(/\s+/g, ' ').toUpperCase();
}

function tieneMojibake(valor) {
  return /Ã|Â|â€|�|\uFFFD/.test(String(valor ?? ''));
}

function aIso(fecha, hora = '09:00') {
  const dia = fechaValida(fecha);
  if (!dia) return null;
  const coincidencia = String(hora || '').match(/^(\d{1,2}):(\d{2})/);
  const hh = coincidencia ? coincidencia[1].padStart(2, '0') : '09';
  const mm = coincidencia ? coincidencia[2] : '00';
  const resultado = new Date(`${dia}T${hh}:${mm}:00-05:00`);
  return Number.isNaN(resultado.getTime()) ? null : resultado.toISOString();
}

function horaDe(valor) {
  const coincidencia = String(valor || '').match(/(?:T|\s)(\d{2}):(\d{2})/);
  if (!coincidencia) return null;
  if (coincidencia[1] === '00' && coincidencia[2] === '00') return null;
  return `${coincidencia[1]}:${coincidencia[2]}`;
}

function normalizarSexo(valor) {
  const sexo = normalizarTexto(valor);
  if (['F', 'FEMENINO', 'MUJER'].includes(sexo)) return 'F';
  if (['M', 'MASCULINO', 'HOMBRE'].includes(sexo)) return 'M';
  if (['X', 'OTRO', 'OTRA'].includes(sexo)) return 'X';
  return '';
}

function estadoEsperado(fila, fechaHora) {
  const consulta = texto(fila.consultacod);
  const tieneConsulta = consulta && consulta !== '0';
  const novedad = normalizarTexto(fila.novedad);
  if (novedad.includes('CANCEL')) return 'cancelada';
  if (novedad.includes('SIN TURNO')) return 'no_asistio';
  if (tieneConsulta) return 'atendida';
  if (new Date(fechaHora).getTime() < Date.now()) return 'atendida';
  if (normalizarTexto(fila.con) === 'OK') return 'confirmada';
  return 'programada';
}

function tipoExamen(valor) {
  const tipo = normalizarTexto(valor);
  if (tipo.includes('ECOGRAF') || tipo.includes('IMAGEN')) return 'imagen';
  if (tipo.includes('LABORATOR')) return 'laboratorio';
  if (tipo.includes('COLPOSCOP') || tipo.includes('CLINIC')) return 'clinico';
  return 'otro';
}

function ultimosDatosGenerales(filas) {
  const mapa = new Map();
  for (const fila of filas) {
    const codigo = texto(fila.nombrecod);
    if (!codigo) continue;
    const anterior = mapa.get(codigo);
    const fecha = fechaValida(fila.cambiofec) || '0000-00-00';
    if (!anterior || fecha >= anterior.fecha) {
      mapa.set(codigo, { fecha, fila });
    }
  }
  return new Map([...mapa.entries()].map(([codigo, item]) => [codigo, item.fila]));
}

function sqlValor(valor) {
  if (valor === null || valor === undefined) return 'NULL';
  const escapado = String(valor)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0');
  return `'${escapado}'`;
}

function serializarTablas(tablas) {
  const partes = [];
  for (const [tabla, filas] of tablas.entries()) {
    if (!filas.length) continue;
    const columnas = Object.keys(filas[0]);
    for (let inicio = 0; inicio < filas.length; inicio += 50) {
      const bloque = filas.slice(inicio, inicio + 50);
      const valores = bloque
        .map((fila) => `(${columnas.map((columna) => sqlValor(fila[columna])).join(', ')})`)
        .join(',\n');
      partes.push(
        `INSERT INTO \`${tabla}\` (${columnas
          .map((columna) => `\`${columna}\``)
          .join(', ')}) VALUES\n${valores};`
      );
    }
  }
  return `${partes.join('\n\n')}\n`;
}

function construirSubconjunto(tablas) {
  const datos = tablas.get('datos') || [];
  const datosgen = tablas.get('datosgen') || [];
  const citas = tablas.get('citamedica') || [];
  const consultas = tablas.get('cons') || [];
  const examenes = tablas.get('examenes') || [];
  const recetas = tablas.get('receta') || [];
  const diagnosticos = tablas.get('diagnostico') || [];
  const medicinas = tablas.get('medicina') || [];
  const tratamientos = tablas.get('tratamiento') || [];
  const informes = tablas.get('informe') || [];

  const codigosDemo = new Set(
    datos
      .filter((fila) => normalizarCedula(fila.cedula) === DEMO_CEDULA)
      .map((fila) => texto(fila.codigo))
  );

  const citasElegidas = [];
  const codigosCita = new Set();
  const agregarCita = (fila) => {
    const codigo = texto(fila?.codigo);
    if (!codigo || codigosCita.has(codigo) || codigosDemo.has(texto(fila.nombrecod))) return;
    codigosCita.add(codigo);
    citasElegidas.push(fila);
  };

  const validas = citas.filter(
    (fila) =>
      fechaValida(fila.citafec) &&
      texto(fila.nombrecod) &&
      !codigosDemo.has(texto(fila.nombrecod))
  );
  const porFecha = [...validas].sort((a, b) =>
    String(a.citafec).localeCompare(String(b.citafec))
  );

  for (const fila of validas.slice(0, 120)) agregarCita(fila);
  for (const fila of porFecha.slice(0, 80)) agregarCita(fila);
  for (const fila of porFecha.slice(-80)) agregarCita(fila);
  for (const fila of validas.filter((fila) => normalizarTexto(fila.novedad).includes('CANCEL')).slice(0, 30)) {
    agregarCita(fila);
  }
  for (const fila of validas.filter((fila) => !texto(fila.consultacod) || texto(fila.consultacod) === '0').slice(0, 40)) {
    agregarCita(fila);
  }
  for (const fila of citas.filter((fila) => !fechaValida(fila.citafec) && texto(fila.nombrecod)).slice(0, 20)) {
    agregarCita(fila);
  }

  const citasFinal = citasElegidas.slice(0, 450);
  const codigosPaciente = new Set(
    citasFinal.map((fila) => texto(fila.nombrecod)).filter(Boolean)
  );

  const cedulas = new Map();
  for (const fila of datos) {
    const cedula = normalizarCedula(fila.cedula);
    if (cedula) cedulas.set(cedula, (cedulas.get(cedula) || 0) + 1);
  }

  const agregarPaciente = (fila) => {
    const codigo = texto(fila.codigo);
    if (codigo && !codigosDemo.has(codigo)) codigosPaciente.add(codigo);
  };

  for (const fila of datos
    .filter(
      (item) =>
        normalizarCedula(item.cedula).length === 10 &&
        cedulas.get(normalizarCedula(item.cedula)) === 1 &&
        fechaValida(item.fnac)
    )
    .slice(0, 120)) {
    agregarPaciente(fila);
  }
  for (const fila of datos.filter((item) => !normalizarCedula(item.cedula)).slice(0, 25)) {
    agregarPaciente(fila);
  }
  for (const fila of datos
    .filter((item) => !fechaValida(item.fnac) && fechaValida(item.sexo))
    .slice(0, 20)) {
    agregarPaciente(fila);
  }
  for (const fila of datos
    .filter((item) => {
      const cedula = normalizarCedula(item.cedula);
      return cedula && cedulas.get(cedula) > 1;
    })
    .slice(0, 15)) {
    agregarPaciente(fila);
  }
  for (const fila of datos
    .filter((item) => /[ÁÉÍÓÚÑáéíóúñ]/.test(String(item.nombres)))
    .slice(0, 25)) {
    agregarPaciente(fila);
  }

  const consultasPorCita = new Set(
    citasFinal
      .map((fila) => texto(fila.consultacod))
      .filter((codigo) => codigo && codigo !== '0')
  );

  const consultasElegidas = [];
  const codigosConsulta = new Set();
  const agregarConsulta = (fila) => {
    const codigo = texto(fila?.codigo);
    if (!codigo || codigosConsulta.has(codigo)) return;
    codigosConsulta.add(codigo);
    consultasElegidas.push(fila);
    if (texto(fila.nombrecod)) codigosPaciente.add(texto(fila.nombrecod));
  };

  for (const fila of consultas) {
    if (consultasPorCita.has(texto(fila.codigo))) agregarConsulta(fila);
  }

  let sinCita = 0;
  for (const fila of consultas) {
    if (sinCita >= 120) break;
    if (
      codigosPaciente.has(texto(fila.nombrecod)) &&
      !consultasPorCita.has(texto(fila.codigo))
    ) {
      agregarConsulta(fila);
      sinCita += 1;
    }
  }

  const consultasFinal = consultasElegidas.slice(0, 700);
  const codigosConsultaFinal = new Set(
    consultasFinal.map((fila) => texto(fila.codigo)).filter(Boolean)
  );

  const examenesFinal = examenes
    .filter((fila) => codigosCita.has(texto(fila.citacod)))
    .slice(0, 300);

  const recetasFinal = recetas
    .filter(
      (fila) =>
        codigosConsultaFinal.has(texto(fila.conscod)) ||
        codigosCita.has(texto(fila.citacod))
    )
    .slice(0, 600);

  const datosFinal = datos.filter((fila) => codigosPaciente.has(texto(fila.codigo)));
  const datosgenFinal = datosgen.filter((fila) =>
    codigosPaciente.has(texto(fila.nombrecod))
  );

  const cie10Usados = new Set(
    consultasFinal.map((fila) => normalizarTexto(fila.cie10)).filter(Boolean)
  );
  const diagnosticosUsados = diagnosticos.filter((fila) =>
    cie10Usados.has(normalizarTexto(fila.cie10).toUpperCase())
  );
  const diagnosticosFinal = [
    ...diagnosticosUsados.slice(0, 300),
    ...diagnosticos
      .filter((fila) => !diagnosticosUsados.includes(fila))
      .slice(0, 200),
  ];

  const tablasSubconjunto = new Map([
    ['datos', datosFinal],
    ['datosgen', datosgenFinal],
    ['citamedica', citasFinal],
    ['cons', consultasFinal],
    ['examenes', examenesFinal],
    ['receta', recetasFinal],
    ['diagnostico', diagnosticosFinal],
    ['medicina', medicinas.slice(0, 100)],
    ['tratamiento', tratamientos],
    ['informe', informes],
    ['sistema', tablas.get('sistema') || []],
  ]);

  return {
    tablas: tablasSubconjunto,
    seleccion: {
      datos: datosFinal,
      citas: citasFinal,
      consultas: consultasFinal,
      examenes: examenesFinal,
      recetas: recetasFinal,
      datosgen: datosgenFinal,
    },
  };
}

function leerSnapshot(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const pacientes = new Map();
  const pacientesNuevoAOld = new Map();

  for (const fila of db
    .prepare(
      `SELECT m.old_id, p.*
       FROM migration_map m JOIN patients p ON p.id = m.new_id
       WHERE m.entidad = 'patient'`
    )
    .all()) {
    const { id, creado_en, actualizado_en, ...datos } = fila;
    pacientes.set(String(fila.old_id), datos);
    pacientesNuevoAOld.set(id, String(fila.old_id));
  }

  const citas = new Map();
  for (const fila of db
    .prepare(
      `SELECT m.old_id, a.*
       FROM migration_map m JOIN appointments a ON a.id = m.new_id
       WHERE m.entidad = 'appointment'`
    )
    .all()) {
    const {
      id,
      patient_id,
      medico_id,
      creado_por,
      creado_en,
      actualizado_en,
      ...datos
    } = fila;
    citas.set(String(fila.old_id), {
      ...datos,
      patient_old_id: pacientesNuevoAOld.get(patient_id) || null,
    });
  }

  const registros = new Map();
  for (const fila of db
    .prepare(
      `SELECT m.old_id, c.*
       FROM migration_map m JOIN clinical_records c ON c.id = m.new_id
       WHERE m.entidad = 'clinical_record'`
    )
    .all()) {
    const {
      id,
      appointment_id,
      patient_id,
      medico_id,
      creado_por,
      creado_en,
      actualizado_en,
      ...datos
    } = fila;
    registros.set(String(fila.old_id), {
      ...datos,
      patient_old_id: pacientesNuevoAOld.get(patient_id) || null,
    });
  }

  const examenes = new Map();
  for (const fila of db
    .prepare(
      `SELECT m.old_id, e.*
       FROM migration_map m JOIN clinical_exams e ON e.id = m.new_id
       WHERE m.entidad = 'clinical_exam'`
    )
    .all()) {
    const {
      id,
      record_id,
      patient_id,
      creado_por,
      creado_en,
      actualizado_en,
      ...datos
    } = fila;
    examenes.set(String(fila.old_id), datos);
  }

  const usuarios = new Map();
  for (const fila of db
    .prepare(
      `SELECT m.old_id, u.username, u.rol, u.activo, u.password_hash
       FROM migration_map m JOIN users u ON u.id = m.new_id
       WHERE m.entidad = 'user'`
    )
    .all()) {
    usuarios.set(String(fila.old_id), {
      username: fila.username,
      rol: fila.rol,
      activo: fila.activo,
      password_hash: fila.password_hash,
    });
  }

  const resumenFila = db
    .prepare(
      `SELECT resumen FROM migration_runs
       WHERE estado = 'completado'
       ORDER BY finalizado_en DESC LIMIT 1`
    )
    .get();
  const resumen = resumenFila?.resumen ? JSON.parse(resumenFila.resumen) : null;

  const conteos = {};
  for (const tabla of [
    'users',
    'patients',
    'appointments',
    'clinical_records',
    'clinical_exams',
    'clinical_attachments',
    'documents',
    'prescriptions',
    'catalogo_diagnosticos',
    'catalogo_medicinas',
    'catalogo_tratamientos',
    'catalogo_informes',
  ]) {
    conteos[tabla] = db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;
  }

  db.close();
  return { pacientes, citas, registros, examenes, usuarios, resumen, conteos };
}

function mapaOrdenado(mapa) {
  return Object.fromEntries([...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function compararSnapshots(a, b, etiqueta) {
  assert.deepEqual(
    mapaOrdenado(a.pacientes),
    mapaOrdenado(b.pacientes),
    `${etiqueta}: pacientes distintos`
  );
  assert.deepEqual(mapaOrdenado(a.citas), mapaOrdenado(b.citas), `${etiqueta}: citas distintas`);
  assert.deepEqual(
    mapaOrdenado(a.registros),
    mapaOrdenado(b.registros),
    `${etiqueta}: consultas distintas`
  );
  assert.deepEqual(
    mapaOrdenado(a.examenes),
    mapaOrdenado(b.examenes),
    `${etiqueta}: exámenes distintos`
  );
  assert.deepEqual(
    mapaOrdenado(a.usuarios),
    mapaOrdenado(b.usuarios),
    `${etiqueta}: usuarios migrados distintos`
  );
}

async function analizarYMigrar(admin, sql) {
  const analisis = await admin('/api/migration/old-db/analyze', {
    method: 'POST',
    rawBody: sql,
    contentType: 'application/sql',
    headers: { 'x-nombre-archivo': 'old-db-subset.sql' },
    timeout: 120000,
  });

  archivosLimpiar.push(`migracion/${analisis.id}.sql`);

  const corrida = await admin('/api/migration/old-db/run', {
    method: 'POST',
    body: { id: analisis.id },
    timeout: 180000,
  });

  if (corrida.resumen?.respaldo) {
    archivosLimpiar.push(
      relative(resolve(entorno.root, 'data'), corrida.resumen.respaldo)
    );
  }
  if (corrida.resumen?.usuarios?.archivoCredenciales) {
    archivosLimpiar.push(corrida.resumen.usuarios.archivoCredenciales);
  }

  return { analisis, corrida };
}

function lecturaUsuarios(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const usuarios = db.prepare('SELECT * FROM users').all();
  db.close();
  return usuarios;
}

async function borrarBaseConservandoUsuarios() {
  const usuariosAntes = lecturaUsuarios(entorno.dbFile);
  await entorno.detener();

  for (const archivo of [
    entorno.dbFile,
    `${entorno.dbFile}-wal`,
    `${entorno.dbFile}-shm`,
  ]) {
    if (existsSync(archivo)) rmSync(archivo, { force: true });
  }

  // Primer arranque: crea esquema, roles, ajustes y plantillas.
  await entorno.iniciar();
  await entorno.detener();

  const db = new DatabaseSync(entorno.dbFile);
  const preservar = new Set([
    'users',
    'roles',
    'role_permissions',
    'settings',
    'templates',
    'audit_log',
    'sqlite_sequence',
    'sqlite_stat1',
  ]);

  const tablas = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((fila) => fila.name);

  db.exec('PRAGMA foreign_keys = OFF;');
  for (const tabla of tablas) {
    if (preservar.has(tabla)) continue;
    db.exec(`DELETE FROM "${tabla}";`);
  }
  db.exec('DELETE FROM users;');

  const columnas = Object.keys(usuariosAntes[0]);
  const insertar = db.prepare(
    `INSERT INTO users (${columnas.map((columna) => `"${columna}"`).join(', ')})
     VALUES (${columnas.map(() => '?').join(', ')})`
  );
  for (const usuario of usuariosAntes) {
    insertar.run(...columnas.map((columna) => usuario[columna]));
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.close();

  await entorno.iniciar();
  return usuariosAntes;
}

function compararContraOrigen(snapshot, subconjunto) {
  const { datos, citas, consultas, datosgen } = subconjunto.seleccion;
  const generales = ultimosDatosGenerales(datosgen);

  const cedulasUsadas = new Set([DEMO_CEDULA]);
  const cedulasEsperadas = new Map();
  const detallesEsperados = new Map();

  for (const fila of datos) {
    const codigo = texto(fila.codigo);
    const detalle = [];
    let cedula = normalizarCedula(fila.cedula);
    if (!cedula || cedula.length < 6) {
      cedula = `SIN-CED-${codigo}`;
      detalle.push('Sin cédula válida');
    } else if (cedula.length !== 10) {
      detalle.push('Cédula incompleta');
    }
    if (cedulasUsadas.has(cedula)) {
      cedula = `DUP-${cedula}-${codigo}`;
      detalle.push('Cédula duplicada');
    }

    const fechaEnSexo = !fechaValida(fila.fnac) && fechaValida(fila.sexo);
    const fechaNacimiento =
      fechaValida(fila.fnac) || (fechaEnSexo ? fechaValida(fila.sexo) : null);
    const sexo = normalizarSexo(fechaEnSexo ? '' : fila.sexo);
    const { nombres, apellidos } = separarNombre(texto(fila.nombres));
    const nombreCompleto = texto(fila.nombres);

    if (!fechaNacimiento) detalle.push('Fecha de nacimiento pendiente');
    else if (fechaEnSexo) detalle.push('Fecha de nacimiento recuperada de columna antigua');
    if (!sexo) detalle.push('Sexo pendiente');
    if (!nombres || !apellidos) detalle.push('Nombre incompleto');

    cedulasUsadas.add(cedula);
    cedulasEsperadas.set(codigo, cedula);
    detallesEsperados.set(codigo, detalle);

    const nuevo = snapshot.pacientes.get(codigo);
    assert.ok(nuevo, `Paciente antiguo ${codigo} no migrado`);

    const esperadoNombres = nombres || nombreCompleto || 'Paciente sin nombre';
    assert.equal(normalizarTexto(nuevo.nombres), normalizarTexto(esperadoNombres));
    assert.equal(normalizarTexto(nuevo.apellidos), normalizarTexto(apellidos));
    assert.equal(nuevo.cedula, cedula, `Cédula distinta en paciente ${codigo}`);
    assert.equal(nuevo.fecha_nacimiento, fechaNacimiento || null);
    assert.equal(nuevo.sexo, sexo);

    const general = generales.get(codigo) || {};
    const telefono =
      texto(general.celular) || texto(general.telefono) || texto(fila.celular) || null;
    const email = texto(general.mail) || null;
    const direccion = texto(general.direccion) || texto(fila.lugar) || null;

    if (telefono) assert.equal(nuevo.telefono, telefono);
    if (email) assert.equal(nuevo.email, email);
    if (direccion) assert.equal(nuevo.direccion, direccion);
    if (texto(general.ocupacion)) assert.equal(nuevo.ocupacion, texto(general.ocupacion));
    if (texto(general.ecivil)) assert.equal(nuevo.estado_civil, texto(general.ecivil));
    if (texto(general.ciudad)) assert.equal(nuevo.ciudad, texto(general.ciudad));
    if (texto(fila.lugar)) assert.match(String(nuevo.notas || ''), /Lugar anterior:/);

    assert.equal(
      Boolean(nuevo.datos_incompletos),
      detalle.length > 0,
      `Marca de datos incompletos distinta en ${codigo}`
    );
    for (const item of detalle) {
      assert.match(String(nuevo.datos_incompletos_detalle || ''), new RegExp(item));
    }

    for (const valor of [
      nuevo.nombres,
      nuevo.apellidos,
      nuevo.direccion,
      nuevo.notas,
      nuevo.alergias,
    ]) {
      assert.ok(!tieneMojibake(valor), `Texto con mojibake en paciente ${codigo}: ${valor}`);
    }
  }

  const pacienteDeCita = new Map(
    citas.map((fila) => [texto(fila.codigo), texto(fila.nombrecod)])
  );

  for (const fila of citas) {
    const codigo = texto(fila.codigo);
    const nuevo = snapshot.citas.get(codigo);
    const pacienteOld = pacienteDeCita.get(codigo);

    if (!nuevo) {
      assert.ok(
        Number(snapshot.resumen?.citas?.omitidas || 0) > 0,
        `Cita antigua ${codigo} no migrada sin justificación`
      );
      continue;
    }

    let fecha = fechaValida(fila.citafec);
    if (!fecha) fecha = fechaValida(fila.transaccion) || '2000-01-01';
    const hora = texto(fila.horario) || horaDe(fila.transaccion) || '09:00';
    const esperadoIso = aIso(fecha, hora);
    assert.ok(esperadoIso, `Fecha/hora inválida en cita ${codigo}`);

    assert.equal(new Date(nuevo.fecha_hora).toISOString(), esperadoIso);
    assert.equal(nuevo.duracion_min, 20);
    assert.equal(nuevo.motivo, texto(fila.motivo) || 'Consulta histórica');
    assert.equal(nuevo.estado, estadoEsperado(fila, esperadoIso));
    assert.equal(nuevo.patient_old_id, pacienteOld);
    assert.match(String(nuevo.notas || ''), /\[Migrado del sistema anterior\]/);
    assert.ok(!tieneMojibake(nuevo.motivo), `Motivo con mojibake en cita ${codigo}`);
    assert.ok(!tieneMojibake(nuevo.notas), `Notas con mojibake en cita ${codigo}`);
  }

  let consultasMigradas = 0;
  for (const fila of consultas) {
    const codigo = texto(fila.codigo);
    const nuevo = snapshot.registros.get(codigo);
    if (!nuevo) continue;
    consultasMigradas += 1;
    assert.equal(nuevo.patient_old_id, texto(fila.nombrecod));
    assert.equal(nuevo.motivo_consulta, texto(fila.motivo) || null);
    const fechaEsperada = fechaValida(fila.fechacon);
    if (fechaEsperada) {
      assert.equal(String(nuevo.fecha).slice(0, 10), fechaEsperada);
    }
    for (const valor of [nuevo.motivo_consulta, nuevo.notas, nuevo.diagnostico, nuevo.receta]) {
      assert.ok(!tieneMojibake(valor), `Texto con mojibake en consulta ${codigo}: ${valor}`);
    }
  }

  assert.equal(
    consultasMigradas,
    [...snapshot.registros.keys()].filter((clave) => !clave.startsWith('CITA-')).length,
    'Todas las consultas migradas deben venir del subconjunto seleccionado'
  );

  let examenesMigrados = 0;
  for (const fila of subconjunto.seleccion.examenes) {
    const clave = `${texto(fila.examencod)}-${texto(fila.citacod)}`;
    const nuevo = snapshot.examenes.get(clave);
    if (!nuevo) continue;
    examenesMigrados += 1;

    const informe = texto(fila.informe);
    const referencias = [
      texto(fila.imagen1n),
      texto(fila.imagen2n),
      texto(fila.nombreo1),
      texto(fila.nombreo2),
    ].filter(Boolean);

    assert.equal(nuevo.nombre, texto(fila.tipo) || 'Examen migrado');
    assert.equal(nuevo.tipo, tipoExamen(fila.tipo));
    assert.equal(nuevo.descripcion, null);
    assert.equal(nuevo.indicaciones, 'Examen importado del sistema anterior.');
    assert.equal(nuevo.estado, informe ? 'evaluado' : 'recibido');
    assert.equal(nuevo.observaciones, informe || null);
    assert.deepEqual(
      nuevo.referencias_archivo ? JSON.parse(nuevo.referencias_archivo) : [],
      referencias
    );
    for (const valor of [nuevo.nombre, nuevo.observaciones]) {
      assert.ok(!tieneMojibake(valor), `Texto con mojibake en examen ${clave}`);
    }
  }

  assert.ok(
    examenesMigrados > 0,
    'Debe migrarse al menos un examen del subconjunto'
  );
  assert.equal(
    examenesMigrados,
    snapshot.examenes.size,
    'Todos los exámenes migrados deben venir de citas seleccionadas'
  );

  // Calendario: los totales del mes deben coincidir con las citas migradas.
  const fechas = [...snapshot.citas.values()]
    .map((cita) => new Date(cita.fecha_hora).getTime())
    .filter((valor) => Number.isFinite(valor));
  assert.ok(fechas.length, 'Debe haber citas migradas para validar el calendario');
  const desde = new Date(Math.min(...fechas)).toISOString();
  const hasta = new Date(Math.max(...fechas)).toISOString();
  return { desde, hasta, generales };
}

async function validarCalendario(admin, snapshot, desde, hasta, { porMes = false } = {}) {
  const porDiaDb = new Map();
  for (const cita of snapshot.citas.values()) {
    const fecha = String(cita.fecha_hora).slice(0, 10);
    porDiaDb.set(fecha, (porDiaDb.get(fecha) || 0) + 1);
  }

  if (porMes) {
    const meses = new Map();
    for (const cita of snapshot.citas.values()) {
      const mes = String(cita.fecha_hora).slice(0, 7);
      meses.set(mes, (meses.get(mes) || 0) + 1);
    }

    let total = 0;
    for (const [mes, esperado] of meses) {
      const [anio, numeroMes] = mes.split('-').map(Number);
      const inicio = new Date(Date.UTC(anio, numeroMes - 1, 1)).toISOString();
      const fin = new Date(Date.UTC(anio, numeroMes, 0, 23, 59, 59, 999)).toISOString();
      const datos = await admin(
        `/api/appointments/calendar?desde=${encodeURIComponent(
          inicio
        )}&hasta=${encodeURIComponent(fin)}&porDia=6&tzOffset=0`
      );
      assert.equal(datos.total, esperado, `Total distinto en ${mes}`);
      for (const dia of datos.dias) {
        assert.equal(dia.total, porDiaDb.get(dia.fecha) || 0, `Total distinto el ${dia.fecha}`);
      }
      total += datos.total;
    }

    assert.equal(total, snapshot.citas.size, 'El calendario mensual debe cubrir todas las citas');
    return;
  }

  const datos = await admin(
    `/api/appointments/calendar?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(
      hasta
    )}&porDia=6&tzOffset=0`
  );

  assert.equal(datos.total, snapshot.citas.size, 'El calendario debe incluir todas las citas migradas');
  assert.equal(
    datos.dias.reduce((suma, dia) => suma + dia.total, 0),
    snapshot.citas.size,
    'La suma de los días debe coincidir con el total'
  );

  for (const dia of datos.dias) {
    assert.equal(dia.total, porDiaDb.get(dia.fecha) || 0, `Total distinto el ${dia.fecha}`);
    assert.ok(dia.citas.length <= 6);
  }
}

function recolectarTexto(snapshot) {
  const valores = [];
  for (const paciente of snapshot.pacientes.values()) {
    valores.push(paciente.nombres, paciente.apellidos, paciente.direccion, paciente.notas, paciente.alergias);
  }
  for (const cita of snapshot.citas.values()) {
    valores.push(cita.motivo, cita.notas);
  }
  for (const registro of snapshot.registros.values()) {
    valores.push(
      registro.motivo_consulta,
      registro.notas,
      registro.diagnostico,
      registro.tratamiento,
      registro.receta,
      registro.indicaciones,
      registro.recomendaciones
    );
  }
  for (const examen of snapshot.examenes.values()) {
    valores.push(examen.nombre, examen.descripcion, examen.observaciones);
  }
  return valores.filter(Boolean);
}

try {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);
  console.log('Leyendo old_db.sql y construyendo subconjunto representativo…');

  const tablasOld = leerDump(resolve('old_db.sql'));
  const resumenCompleto = resumirDump(tablasOld);
  const subconjunto = MODO_COMPLETO
    ? {
        tablas: tablasOld,
        seleccion: {
          datos: tablasOld.get('datos') || [],
          citas: tablasOld.get('citamedica') || [],
          consultas: tablasOld.get('cons') || [],
          examenes: tablasOld.get('examenes') || [],
          recetas: tablasOld.get('receta') || [],
          datosgen: tablasOld.get('datosgen') || [],
        },
      }
    : construirSubconjunto(tablasOld);
  const sqlSubconjunto = serializarTablas(subconjunto.tablas);
  const totalFilas = [...subconjunto.tablas.values()].reduce(
    (suma, filas) => suma + filas.length,
    0
  );

  console.log(
    `${MODO_COMPLETO ? 'Carga completa' : 'Subconjunto'}: ${subconjunto.seleccion.datos.length} pacientes · ` +
      `${subconjunto.seleccion.citas.length} citas · ` +
      `${subconjunto.seleccion.consultas.length} consultas · ` +
      `${subconjunto.seleccion.examenes.length} exámenes · ` +
      `${totalFilas} filas · ${(Buffer.byteLength(sqlSubconjunto) / 1024 / 1024).toFixed(1)} MB`
  );
  console.log(
    `Origen completo: ${resumenCompleto.pacientes.total} pacientes · ` +
      `${resumenCompleto.citas.total} citas · ${resumenCompleto.consultas.total} consultas`
  );

  let admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  // Ciclo 1: migración inicial.
  const ciclo1 = await analizarYMigrar(admin, sqlSubconjunto);
  const snapshot1 = leerSnapshot(entorno.dbFile);
  const { desde, hasta } = compararContraOrigen(snapshot1, subconjunto);
  await validarCalendario(admin, snapshot1, desde, hasta, { porMes: MODO_COMPLETO });

  assert.ok(
    snapshot1.pacientes.size >= subconjunto.seleccion.datos.length,
    'Deben migrarse todos los pacientes seleccionados'
  );
  assert.ok(snapshot1.citas.size > 0);
  assert.ok(snapshot1.registros.size > 0);
  assert.equal(
    ciclo1.corrida.estado,
    'completado'
  );
  assert.ok(
    ciclo1.corrida.resumen.usuarios?.insertados > 0,
    'Deben migrarse los usuarios encontrados en la base antigua'
  );

  const archivoCredenciales = resolve(
    entorno.root,
    'data',
    ciclo1.corrida.resumen.usuarios.archivoCredenciales
  );
  assert.ok(existsSync(archivoCredenciales), 'Debe generarse el archivo de credenciales');
  const textoCredenciales = readFileSync(archivoCredenciales, 'utf8');
  for (const usuario of ['adminis', 'rec', 'doctor2', 'adminin']) {
    assert.ok(
      textoCredenciales.includes(usuario),
      `El usuario antiguo ${usuario} debe aparecer en las credenciales`
    );
  }
  assert.ok(
    !textoCredenciales.includes('12345'),
    'No se deben reutilizar las claves débiles de la base antigua'
  );
  assert.ok(snapshot1.usuarios.size >= 4, 'Debe haber usuarios antiguos mapeados');

  console.log(
    `✓ Usuarios migrados: ${ciclo1.corrida.resumen.usuarios.insertados} nuevos · ` +
      `${ciclo1.corrida.resumen.usuarios.reutilizados} reutilizados`
  );
  console.log(
    `✓ Ciclo 1: ${snapshot1.pacientes.size} pacientes, ${snapshot1.citas.size} citas, ` +
      `${snapshot1.registros.size} consultas, ${snapshot1.examenes.size} exámenes`
  );

  let snapshot3 = snapshot1;
  let ciclo3 = ciclo1;
  let usuariosDespues = null;

  if (!MODO_COMPLETO) {
  // Ciclo 2: repetir la misma migración sin duplicar.
  const ciclo2 = await analizarYMigrar(admin, sqlSubconjunto);
  const snapshot2 = leerSnapshot(entorno.dbFile);
  compararSnapshots(snapshot1, snapshot2, 'Segunda migración');
  assert.equal(ciclo2.corrida.resumen.pacientes.insertados, 0);
  assert.ok(ciclo2.corrida.resumen.citas.omitidas > 0);
  assert.equal(snapshot2.conteos.patients, snapshot1.conteos.patients);
  assert.equal(snapshot2.conteos.appointments, snapshot1.conteos.appointments);
  console.log('✓ Ciclo 2: migración repetida sin duplicados ni cambios');

  // Ciclo 3: borrar la base completa, conservar usuarios y migrar de nuevo.
  const usuariosAntes = await borrarBaseConservandoUsuarios();
  usuariosDespues = lecturaUsuarios(entorno.dbFile);
  assert.equal(usuariosDespues.length, usuariosAntes.length, 'Los usuarios deben conservarse');
  const normalizarUsuarios = (lista) =>
    lista
      .map((u) => ({
        id: u.id,
        nombre: u.nombre,
        username: u.username,
        rol: u.rol,
        activo: u.activo,
        password_hash: u.password_hash,
      }))
      .sort((a, b) => String(a.username).localeCompare(String(b.username)));
  assert.deepEqual(
    normalizarUsuarios(usuariosDespues),
    normalizarUsuarios(usuariosAntes),
    'Los usuarios deben conservar credenciales y roles'
  );

  admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  console.log(`✓ Base borrada y recreada conservando ${usuariosDespues.length} usuarios`);

  const ciclo3 = await analizarYMigrar(admin, sqlSubconjunto);
  snapshot3 = leerSnapshot(entorno.dbFile);
  compararSnapshots(snapshot1, snapshot3, 'Migración tras borrar la base');
  const { desde: desde3, hasta: hasta3 } = compararContraOrigen(snapshot3, subconjunto);
  await validarCalendario(admin, snapshot3, desde3, hasta3);

  assert.equal(ciclo3.corrida.estado, 'completado');
  assert.equal(
    snapshot3.resumen.pacientes.insertados,
    snapshot1.resumen.pacientes.insertados
  );
  assert.equal(snapshot3.resumen.citas.insertadas, snapshot1.resumen.citas.insertadas);
  assert.equal(snapshot3.resumen.consultas.insertadas, snapshot1.resumen.consultas.insertadas);
  assert.equal(snapshot3.resumen.examenes.insertados, snapshot1.resumen.examenes.insertados);
  console.log('✓ Ciclo 3: misma información que la primera migración');
  }

  // Comparación de texto y reporte de posibles mejoras.
  const textos = recolectarTexto(snapshot3);
  const conMojibake = textos.filter(tieneMojibake);
  assert.equal(conMojibake.length, 0, `Texto con mojibake: ${conMojibake.slice(0, 5).join(' | ')}`);

  const pacientesSinCedula = subconjunto.seleccion.datos.filter(
    (fila) => !normalizarCedula(fila.cedula)
  ).length;
  const citasSinConsulta = subconjunto.seleccion.citas.filter(
    (fila) => !texto(fila.consultacod) || texto(fila.consultacod) === '0'
  ).length;
  const fechasInvalidas = subconjunto.seleccion.datos.filter(
    (fila) => !fechaValida(fila.fnac)
  ).length;
  const citasFechaAproximada = subconjunto.seleccion.citas.filter(
    (fila) => !fechaValida(fila.citafec)
  ).length;
  const cedulas = new Map();
  for (const fila of subconjunto.seleccion.datos) {
    const cedula = normalizarCedula(fila.cedula);
    if (cedula) cedulas.set(cedula, (cedulas.get(cedula) || 0) + 1);
  }
  const cedulasDuplicadas = [...cedulas.values()].filter((total) => total > 1).length;
  const citasOrigenMapeadas = subconjunto.seleccion.citas.filter((fila) =>
    snapshot3.citas.has(texto(fila.codigo))
  ).length;
  const citasSinteticas = snapshot3.citas.size - citasOrigenMapeadas;
  const consultasReales = [...snapshot3.registros.keys()].filter(
    (clave) => !clave.startsWith('CITA-')
  ).length;
  const consultasSinteticas = snapshot3.registros.size - consultasReales;
  const advertencias = snapshot3.resumen.advertencias || [];

  console.log('');
  console.log('REPORTE DE CALIDAD DE MIGRACIÓN');
  console.log(`  Pacientes en origen         : ${subconjunto.seleccion.datos.length}`);
  console.log(`  Pacientes en base nueva     : ${snapshot3.pacientes.size}`);
  console.log(`  Citas en origen             : ${subconjunto.seleccion.citas.length}`);
  console.log(`  Citas en base nueva         : ${snapshot3.citas.size} (${citasSinteticas} sintéticas de consultas)`);
  console.log(`  Consultas en origen         : ${subconjunto.seleccion.consultas.length}`);
  console.log(`  Consultas en base nueva     : ${snapshot3.registros.size} (${consultasSinteticas} creadas para exámenes)`);
  console.log(`  Exámenes comparados         : ${snapshot3.examenes.size}`);
  console.log(`  Usuarios migrados           : ${snapshot3.usuarios.size}`);
  console.log(`  Pacientes sin cédula        : ${pacientesSinCedula}`);
  console.log(`  Cédulas duplicadas          : ${cedulasDuplicadas}`);
  console.log(`  Fechas de nacimiento inválidas: ${fechasInvalidas}`);
  console.log(`  Citas con fecha aproximada  : ${citasFechaAproximada}`);
  console.log(`  Citas sin consulta          : ${citasSinConsulta}`);
  console.log(`  Advertencias de migración   : ${advertencias.length}`);
  console.log(`  Texto con mojibake          : 0`);
  console.log('  Agenda/calendario           : totales por día coinciden con la base');
  console.log(
    '  Posibles mejoras            : completar cédulas/fechas de origen; revisar duplicados y citas sin consulta'
  );

  if (advertencias.length) {
    console.log('  Primeras advertencias:');
    for (const advertencia of advertencias.slice(0, 8)) {
      console.log(`    · ${advertencia}`);
    }
  }

  console.log('');
  console.log('E2E DE MIGRACIÓN COMPLETADO');
  console.log(
    JSON.stringify(
      {
        fuente: MODO_COMPLETO
          ? 'old_db.sql (completo)'
          : 'old_db.sql (subconjunto representativo)',
        ciclos: MODO_COMPLETO ? 1 : 3,
        pacientes: snapshot3.pacientes.size,
        citas: snapshot3.citas.size,
        consultas: snapshot3.registros.size,
        examenes: snapshot3.examenes.size,
        usuariosMigrados: snapshot3.usuarios.size,
        usuariosConservados: usuariosDespues ? usuariosDespues.length : snapshot3.conteos.users,
        calendarioConsistente: true,
        textoLimpio: true,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('');
  console.error('E2E DE MIGRACIÓN FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('');
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-60).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await entorno?.limpiar(archivosLimpiar);
}
