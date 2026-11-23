import { mkdirSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { db, nowIso, tx, uid } from '../../db/index.js';
import { config } from '../../config.js';
import { hashSecret, normalizarUsername } from '../passwords.js';
import {
  fechaValida,
  normalizarCedula,
  separarNombre,
} from './oldDb.js';

function texto(valor, max = null) {
  const limpio = String(valor ?? '').trim();
  if (!max) return limpio;
  return limpio.slice(0, max);
}

function normalizarTexto(valor) {
  return texto(valor).replace(/\s+/g, ' ').toUpperCase();
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

function fechaHoraIso(valor) {
  const textoValor = String(valor || '');
  const fecha = fechaValida(textoValor.slice(0, 10));
  if (!fecha) return null;
  const hora = horaDe(textoValor) || '09:00';
  return aIso(fecha, hora);
}

function normalizarSexo(valor) {
  const sexo = String(valor || '').trim().toUpperCase();
  if (['F', 'FEMENINO', 'MUJER'].includes(sexo)) return 'F';
  if (['M', 'MASCULINO', 'HOMBRE'].includes(sexo)) return 'M';
  if (['X', 'OTRO', 'OTRA'].includes(sexo)) return 'X';
  return '';
}

function agregarNotas(partes) {
  return partes.filter(Boolean).join('\n');
}

function mapearTipoExamen(tipo) {
  const valor = String(tipo || '').toUpperCase();
  if (valor.includes('ECOGRAF') || valor.includes('IMAGEN')) return 'imagen';
  if (valor.includes('LABORATOR')) return 'laboratorio';
  if (valor.includes('COLPOSCOP') || valor.includes('CLINIC')) return 'clinico';
  return 'otro';
}

function formatearReceta(filas) {
  const lineas = filas
    .map((fila) => {
      const medicina = texto(fila.medicina) || texto(fila.dci);
      const dci = texto(fila.dci);
      const presentacion = [
        texto(fila.cantidad) && texto(fila.cantidad) !== '0'
          ? `${texto(fila.cantidad)} ${texto(fila.forma)}`.trim()
          : texto(fila.forma),
        medicina,
        dci && dci !== medicina ? `(${dci})` : '',
        texto(fila.dosis),
        texto(fila.frecuencia),
        texto(fila.duracion),
        texto(fila.via),
        texto(fila.advertencia) ? `Advertencia: ${texto(fila.advertencia)}` : '',
      ].filter(Boolean);
      return presentacion.length ? `- ${presentacion.join(' · ')}` : '';
    })
    .filter(Boolean);

  return lineas.length ? lineas.join('\n') : null;
}

function cargarMapa(entidad) {
  return new Map(
    db
      .prepare('SELECT old_id, new_id FROM migration_map WHERE entidad = ?')
      .all(entidad)
      .map((fila) => [fila.old_id, fila.new_id])
  );
}

const insertMapa = db.prepare(
  `INSERT OR IGNORE INTO migration_map (entidad, old_id, new_id, run_id, creado_en)
   VALUES (?, ?, ?, ?, ?)`
);

function guardarMapa(entidad, oldId, newId, runId) {
  insertMapa.run(entidad, String(oldId), newId, runId, nowIso());
}

function ultimosDatosGenerales(datosgen) {
  const mapa = new Map();
  for (const fila of datosgen) {
    const codigo = String(fila.nombrecod || '');
    if (!codigo) continue;
    const anterior = mapa.get(codigo);
    const fecha = fechaValida(fila.cambiofec) || '0000-00-00';
    if (!anterior || fecha >= anterior.fecha) {
      mapa.set(codigo, { fecha, fila });
    }
  }
  return new Map([...mapa.entries()].map(([codigo, item]) => [codigo, item.fila]));
}

function normalizarUsuarioLegado(valor) {
  return normalizarUsername(valor)
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 32);
}

function usuariosDeDump(tablas) {
  const mapa = new Map();

  const agregar = (codigo, nombre, perfil, fuente, transaccion = null, clave = null) => {
    const usuario = normalizarUsuarioLegado(codigo);
    if (!usuario) return;
    const actual = mapa.get(usuario);
    if (!actual) {
      mapa.set(usuario, {
        codigo: usuario,
        nombre: texto(nombre) || usuario,
        perfil: texto(perfil),
        clave: texto(clave),
        fuentes: new Set([fuente]),
        transaccion: transaccion || null,
      });
      return;
    }

    if ((!actual.nombre || actual.nombre === actual.codigo) && texto(nombre)) {
      actual.nombre = texto(nombre);
    }
    if (!actual.perfil && texto(perfil)) actual.perfil = texto(perfil);
    if (!actual.clave && texto(clave)) actual.clave = texto(clave);
    if (!actual.transaccion && transaccion) actual.transaccion = transaccion;
    actual.fuentes.add(fuente);
  };

  for (const fila of tablas.get('sistema') || []) {
    agregar(
      fila.codigouser || fila.usuario,
      fila.nombreuser,
      fila.perfil,
      'sistema',
      fila.transaccion,
      fila.claveuser
    );
  }

  for (const tabla of ['datos', 'datosgen', 'citamedica', 'cons', 'examenes', 'receta']) {
    for (const fila of tablas.get(tabla) || []) {
      agregar(fila.usuario, fila.usuario, '', tabla, fila.transaccion);
    }
  }

  return [...mapa.values()];
}

function rolUsuarioLegado(usuario) {
  const referencia = normalizarTexto(
    `${usuario.codigo} ${usuario.nombre} ${usuario.perfil}`
  );
  if (/DOCTOR|MEDIC|CONSULTORIO/.test(referencia)) return 'medico';
  if (usuario.codigo === 'adminis' || usuario.codigo === 'admin') return 'admin';
  return 'operador';
}

function generarPasswordMigracion() {
  const mayus = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const minus = 'abcdefghijkmnopqrstuvwxyz';
  const numeros = '23456789';
  const simbolos = '!@#$%*-_=+';
  const todos = mayus + minus + numeros + simbolos;
  const elegir = (conjunto) => conjunto[randomInt(0, conjunto.length)];
  const caracteres = [elegir(mayus), elegir(minus), elegir(numeros), elegir(simbolos)];
  while (caracteres.length < 16) caracteres.push(elegir(todos));
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join('');
}

export function escribirCredencialesMigracion(credenciales, runId) {
  if (!credenciales.length) return null;
  const carpeta = resolve(config.dataDir, 'backups');
  mkdirSync(carpeta, { recursive: true });
  const archivo = resolve(
    carpeta,
    `credenciales-migracion-${runId || Date.now()}.csv`
  );
  const filas = [
    ['Nombre', 'Usuario', 'Rol', 'Contraseña', 'Origen'],
    ...credenciales.map((item) => [
      item.nombre,
      item.usuario,
      item.rol,
      item.password,
      item.origen,
    ]),
  ];
  const csv = `\uFEFF${filas
    .map((fila) => fila.map((valor) => `"${String(valor).replaceAll('"', '""')}"`).join(','))
    .join('\r\n')}\r\n`;
  writeFileSync(archivo, csv, 'utf8');
  return relative(config.dataDir, archivo).replace(/\\/g, '/');
}

export function migrarUsuarios(tablas, runId, { conservarClavesAntiguas = false } = {}) {
  const resumen = {
    insertados: 0,
    reutilizados: 0,
    omitidos: 0,
    archivoCredenciales: null,
    clavesAntiguasConservadas: conservarClavesAntiguas,
  };
  const credenciales = [];
  const mapa = cargarMapa('user');
  const existentes = new Map(
    db
      .prepare('SELECT id, username, rol FROM users')
      .all()
      .map((fila) => [normalizarUsername(fila.username), fila])
  );

  for (const usuario of usuariosDeDump(tablas)) {
    if (mapa.has(usuario.codigo)) {
      resumen.reutilizados += 1;
      continue;
    }

    const existente = existentes.get(usuario.codigo);
    if (existente) {
      guardarMapa('user', usuario.codigo, existente.id, runId);
      mapa.set(usuario.codigo, existente.id);
      resumen.reutilizados += 1;
      continue;
    }

    const password = conservarClavesAntiguas
      ? usuario.clave || '12345'
      : generarPasswordMigracion();
    const hash = hashSecret(password);
    const rol = rolUsuarioLegado(usuario);
    const id = uid();
    const creado = fechaHoraIso(usuario.transaccion) || nowIso();

    db.prepare(
      `INSERT INTO users
         (id, nombre, cedula, username, password_hash, rol, pin_hash, activo, creado_en, actualizado_en)
       VALUES (?, ?, NULL, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, usuario.nombre, usuario.codigo, hash, rol, hash, creado, creado);

    guardarMapa('user', usuario.codigo, id, runId);
    mapa.set(usuario.codigo, id);
    credenciales.push({
      nombre: usuario.nombre,
      usuario: usuario.codigo,
      rol,
      password,
      origen: [...usuario.fuentes].join(', '),
    });
    resumen.insertados += 1;
  }

  return { resumen, credenciales };
}

export function migrarTablas(tablas, { runId = null, conservarClavesAntiguas = false } = {}) {
  const resumen = {
    pacientes: { insertados: 0, reutilizados: 0, omitidos: 0 },
    citas: { insertadas: 0, omitidas: 0 },
    citasHistoricas: { insertadas: 0, omitidas: 0 },
    consultas: { insertadas: 0, omitidas: 0 },
    examenes: { insertados: 0, omitidos: 0 },
    recetasAgrupadas: 0,
    catalogos: { diagnosticos: 0, medicinas: 0, tratamientos: 0, informes: 0 },
    usuarios: {
      insertados: 0,
      reutilizados: 0,
      omitidos: 0,
      archivoCredenciales: null,
      clavesAntiguasConservadas: conservarClavesAntiguas,
    },
    advertencias: [],
  };

  const advertir = (mensaje) => {
    if (resumen.advertencias.length < 80) resumen.advertencias.push(mensaje);
  };

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

  const mapaPacientes = cargarMapa('patient');
  const mapaCitas = cargarMapa('appointment');
  const mapaRegistros = cargarMapa('clinical_record');
  const mapaExamenes = cargarMapa('clinical_exam');

  const cedulasUsadas = new Set(
    db.prepare('SELECT cedula FROM patients').all().map((fila) => fila.cedula)
  );
  const registrosExistentes = new Map(
    db
      .prepare('SELECT id, appointment_id FROM clinical_records')
      .all()
      .map((fila) => [fila.appointment_id, fila.id])
  );

  const datosGenerales = ultimosDatosGenerales(datosgen);
  const alergiasPaciente = new Map();
  const nombresPorCodigo = new Map();
  for (const cita of citas) {
    const alergia = texto(cita.alergia);
    if (alergia) alergiasPaciente.set(String(cita.nombrecod), alergia);
    if (texto(cita.nombrecod) && texto(cita.nombres)) {
      nombresPorCodigo.set(texto(cita.nombrecod), texto(cita.nombres));
    }
  }
  for (const examen of examenes) {
    if (texto(examen.nombrecod) && texto(examen.nombres)) {
      nombresPorCodigo.set(texto(examen.nombrecod), texto(examen.nombres));
    }
  }
  for (const consulta of consultas) {
    const codigo = texto(consulta.nombrecod);
    if (codigo && !nombresPorCodigo.has(codigo)) {
      nombresPorCodigo.set(codigo, `Paciente histórico ${codigo}`);
    }
  }

  const insertPaciente = db.prepare(
    `INSERT INTO patients
       (id, cedula, nombres, apellidos, fecha_nacimiento, sexo, telefono, email,
        direccion, ocupacion, estado_civil, ciudad, fecha_registro_informacion,
        alergias, notas, datos_incompletos, datos_incompletos_detalle,
        activo, demo, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
  );

  const insertCita = db.prepare(
    `INSERT INTO appointments
       (id, patient_id, medico_id, fecha_hora, duracion_min, motivo, estado,
        motivo_reagenda, notas, demo, creado_por, creado_en, actualizado_en)
     VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, 0, NULL, ?, ?)`
  );

  const insertRegistro = db.prepare(
    `INSERT INTO clinical_records
       (id, appointment_id, patient_id, medico_id, fecha, duracion_estimada_min,
        motivo_consulta, notas, diagnostico, tratamiento, receta, indicaciones,
        recomendaciones, demo, creado_por, creado_en, actualizado_en)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
  );

  const insertExamen = db.prepare(
    `INSERT INTO clinical_exams
       (id, record_id, patient_id, nombre, tipo, descripcion, indicaciones, estado, observaciones,
        referencias_archivo, demo, creado_por, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, NULL, ?, ?)`
  );

  const insertDiagnostico = db.prepare(
    `INSERT OR IGNORE INTO catalogo_diagnosticos
       (id, legacy_id, cie10, diagnostico, observacion, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const insertMedicina = db.prepare(
    `INSERT OR IGNORE INTO catalogo_medicinas
       (id, legacy_id, medicina, dci, forma, via, dosis, frecuencia, duracion,
        advertencia, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertTratamiento = db.prepare(
    `INSERT OR IGNORE INTO catalogo_tratamientos
       (id, legacy_id, nombre, descripcion, cantidad, medicina, dci, forma, via,
        dosis, frecuencia, duracion, advertencia, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertInforme = db.prepare(
    `INSERT OR IGNORE INTO catalogo_informes
       (id, legacy_id, nombre, informe, observacion, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const citaPorConsulta = new Map();
  for (const cita of citas) {
    const consulta = texto(cita.consultacod);
    if (consulta && consulta !== '0') citaPorConsulta.set(consulta, String(cita.codigo));
  }

  const recetasPorConsulta = new Map();
  const recetasPorCita = new Map();
  for (const receta of recetas) {
    const consulta = texto(receta.conscod);
    const cita = texto(receta.citacod);
    if (consulta && consulta !== '0') {
      if (!recetasPorConsulta.has(consulta)) recetasPorConsulta.set(consulta, []);
      recetasPorConsulta.get(consulta).push(receta);
    } else if (cita && cita !== '0') {
      if (!recetasPorCita.has(cita)) recetasPorCita.set(cita, []);
      recetasPorCita.get(cita).push(receta);
    }
  }

  const cie10 = new Map();
  for (const diagnostico of diagnosticos) {
    const codigo = texto(diagnostico.cie10).toUpperCase();
    if (codigo && !cie10.has(codigo)) {
      cie10.set(codigo, texto(diagnostico.diagnostico));
    }
  }

  const registroPorCita = new Map();
  const pacienteDeCita = new Map();
  const citaPorCodigo = new Map();
  let credencialesUsuarios = [];

  tx(() => {
    const usuariosMigrados = migrarUsuarios(tablas, runId, { conservarClavesAntiguas });
    resumen.usuarios = usuariosMigrados.resumen;
    credencialesUsuarios = usuariosMigrados.credenciales;

    // Catálogos primero, para poder enriquecer diagnósticos.
    for (const fila of diagnosticos) {
      const resultado = insertDiagnostico.run(
        uid(),
        texto(fila.diagcod) || null,
        texto(fila.cie10) || null,
        texto(fila.diagnostico) || 'Sin descripción',
        texto(fila.observ) || null,
        nowIso()
      );
      resumen.catalogos.diagnosticos += resultado.changes;
    }

    for (const fila of medicinas) {
      const resultado = insertMedicina.run(
        uid(),
        texto(fila.medicod) || null,
        texto(fila.medicina) || null,
        texto(fila.dci) || null,
        texto(fila.forma) || null,
        texto(fila.via) || null,
        texto(fila.dosis) || null,
        texto(fila.frecuencia) || null,
        texto(fila.duracion) || null,
        texto(fila.advertencia) || null,
        nowIso()
      );
      resumen.catalogos.medicinas += resultado.changes;
    }

    for (const fila of tratamientos) {
      const resultado = insertTratamiento.run(
        uid(),
        texto(fila.tratcod) || null,
        texto(fila.nombre) || null,
        texto(fila.descripcion) || null,
        Number(fila.cantidad || 0) || null,
        texto(fila.medicina) || null,
        texto(fila.dci) || null,
        texto(fila.forma) || null,
        texto(fila.via) || null,
        texto(fila.dosis) || null,
        texto(fila.frecuencia) || null,
        texto(fila.duracion) || null,
        texto(fila.advertencia) || null,
        nowIso()
      );
      resumen.catalogos.tratamientos += resultado.changes;
    }

    for (const fila of informes) {
      const resultado = insertInforme.run(
        uid(),
        texto(fila.infocod) || null,
        texto(fila.nombre) || null,
        texto(fila.informe) || null,
        texto(fila.observacion) || null,
        nowIso()
      );
      resumen.catalogos.informes += resultado.changes;
    }

    // Pacientes
    for (const fila of datos) {
      const oldId = texto(fila.codigo);
      if (!oldId) continue;
      if (mapaPacientes.has(oldId)) {
        resumen.pacientes.reutilizados += 1;
        continue;
      }

      const nombreCompleto = texto(fila.nombres);
      const { nombres, apellidos } = separarNombre(nombreCompleto);
      const general = datosGenerales.get(oldId) || {};
      const fechaEnSexo = !fechaValida(fila.fnac) && fechaValida(fila.sexo);
      const fechaNacimiento = fechaValida(fila.fnac) || (fechaEnSexo ? fechaValida(fila.sexo) : null);
      const sexo = normalizarSexo(fechaEnSexo ? '' : fila.sexo);

      let cedula = normalizarCedula(fila.cedula);
      const detalle = [];
      if (!cedula || cedula.length < 6) {
        cedula = `SIN-CED-${oldId}`;
        detalle.push('Sin cédula válida');
      } else if (cedula.length !== 10) {
        detalle.push('Cédula incompleta');
      }

      if (cedulasUsadas.has(cedula)) {
        cedula = `DUP-${cedula}-${oldId}`;
        detalle.push('Cédula duplicada');
      }

      if (!fechaNacimiento) detalle.push('Fecha de nacimiento pendiente');
      else if (fechaEnSexo) detalle.push('Fecha de nacimiento recuperada de columna antigua');
      if (!sexo) detalle.push('Sexo pendiente');
      if (!nombres || !apellidos) detalle.push('Nombre incompleto');

      const telefono =
        texto(general.celular) || texto(general.telefono) || texto(fila.celular) || null;
      const email = texto(general.mail) || null;
      const direccion = texto(general.direccion) || texto(fila.lugar) || null;
      const notas = agregarNotas([
        texto(general.referencia) ? `Referencia: ${texto(general.referencia)}` : '',
        texto(fila.lugar) ? `Lugar anterior: ${texto(fila.lugar)}` : '',
      ]).slice(0, 1000);
      const fechaRegistro =
        fechaValida(general.cambiofec) || fechaValida(fila.transaccion) || nowIso().slice(0, 10);

      const id = uid();
      const creado = fechaHoraIso(fila.transaccion) || nowIso();
      insertPaciente.run(
        id,
        cedula,
        nombres || nombreCompleto || 'Paciente sin nombre',
        apellidos || '',
        fechaNacimiento,
        sexo,
        telefono,
        email,
        direccion,
        texto(general.ocupacion) || null,
        texto(general.ecivil) || null,
        texto(general.ciudad) || null,
        fechaRegistro,
        alergiasPaciente.get(oldId) || null,
        notas || null,
        detalle.length ? 1 : 0,
        detalle.length ? detalle.join('; ') : null,
        creado,
        creado
      );
      cedulasUsadas.add(cedula);
      mapaPacientes.set(oldId, id);
      guardarMapa('patient', oldId, id, runId);
      resumen.pacientes.insertados += 1;
    }

    // Pacientes referenciados en citas o exámenes que no existen en `datos`.
    for (const [codigo, nombreCompleto] of nombresPorCodigo.entries()) {
      if (!codigo || mapaPacientes.has(codigo)) continue;

      const { nombres, apellidos } = separarNombre(nombreCompleto);
      const id = uid();
      const creado = nowIso();
      const cedula = `SIN-CED-${codigo}`;
      if (cedulasUsadas.has(cedula)) continue;
      insertPaciente.run(
        id,
        cedula,
        nombres || nombreCompleto || 'Paciente sin nombre',
        apellidos || '',
        null,
        '',
        null,
        null,
        null,
        null,
        null,
        null,
        nowIso().slice(0, 10),
        null,
        `Paciente referenciado en el sistema anterior (código ${codigo}) sin ficha completa.`,
        1,
        'Sin cédula válida; Fecha de nacimiento pendiente; Sexo pendiente; Ficha creada desde una cita o examen',
        creado,
        creado
      );
      cedulasUsadas.add(cedula);
      mapaPacientes.set(codigo, id);
      guardarMapa('patient', codigo, id, runId);
      resumen.pacientes.insertados += 1;
    }

    // Citas de citamedica
    for (const fila of citas) {
      const oldId = texto(fila.codigo);
      if (!oldId) continue;
      if (mapaCitas.has(oldId)) {
        resumen.citas.omitidas += 1;
        continue;
      }

      const pacienteId = mapaPacientes.get(texto(fila.nombrecod));
      if (!pacienteId) {
        resumen.citas.omitidas += 1;
        advertir(`Cita ${oldId} omitida: paciente ${fila.nombrecod} no encontrado`);
        continue;
      }

      let fecha = fechaValida(fila.citafec);
      let fechaAproximada = false;
      if (!fecha) {
        fecha = fechaValida(fila.transaccion) || '2000-01-01';
        fechaAproximada = true;
      }

      const hora = texto(fila.horario) || horaDe(fila.transaccion) || '09:00';
      const fechaHora = aIso(fecha, hora);
      if (!fechaHora) {
        resumen.citas.omitidas += 1;
        advertir(`Cita ${oldId} omitida: fecha/hora inválida`);
        continue;
      }

      const consulta = texto(fila.consultacod);
      const tieneConsulta = consulta && consulta !== '0';
      const novedad = texto(fila.novedad).toUpperCase();
      let estado = 'programada';
      if (novedad.includes('CANCEL')) estado = 'cancelada';
      else if (novedad.includes('SIN TURNO')) estado = 'no_asistio';
      else if (tieneConsulta) estado = 'atendida';
      else if (new Date(fechaHora).getTime() < Date.now()) estado = 'atendida';
      else if (texto(fila.con).toUpperCase() === 'OK') estado = 'confirmada';

      const id = uid();
      const notas = agregarNotas([
        '[Migrado del sistema anterior]',
        texto(fila.tipo) ? `Tipo: ${texto(fila.tipo)}` : '',
        texto(fila.lugar) ? `Lugar: ${texto(fila.lugar)}` : '',
        texto(fila.observ) ? `Observación: ${texto(fila.observ)}` : '',
        fechaAproximada ? 'Fecha original inválida; se usó 2000-01-01' : '',
      ]).slice(0, 2000);
      const creado = fechaHoraIso(fila.transaccion) || fechaHora;

      insertCita.run(
        id,
        pacienteId,
        fechaHora,
        20,
        texto(fila.motivo) || 'Consulta histórica',
        estado,
        notas || null,
        creado,
        creado
      );

      mapaCitas.set(oldId, id);
      citaPorCodigo.set(oldId, { id, pacienteId, fechaHora });
      pacienteDeCita.set(oldId, pacienteId);
      if (tieneConsulta) registroPorCita.set(oldId, null);
      guardarMapa('appointment', oldId, id, runId);
      resumen.citas.insertadas += 1;
    }

    // Consultas sin cita: crear una cita histórica
    for (const fila of consultas) {
      const oldCons = texto(fila.codigo);
      if (!oldCons) continue;
      if (citaPorConsulta.has(oldCons)) continue;

      const oldCitaSintetica = `CONS-${oldCons}`;
      if (mapaCitas.has(oldCitaSintetica)) continue;

      const pacienteId = mapaPacientes.get(texto(fila.nombrecod));
      if (!pacienteId) {
        resumen.citasHistoricas.omitidas += 1;
        continue;
      }

      let fecha = fechaValida(fila.fechacon) || fechaValida(fila.transaccion);
      let fechaAproximada = false;
      if (!fecha) {
        fecha = '2000-01-01';
        fechaAproximada = true;
      }

      const hora = horaDe(fila.transaccion) || '09:00';
      const fechaHora = aIso(fecha, hora);
      if (!fechaHora) {
        resumen.citasHistoricas.omitidas += 1;
        continue;
      }

      const id = uid();
      const creado = fechaHoraIso(fila.transaccion) || fechaHora;
      insertCita.run(
        id,
        pacienteId,
        fechaHora,
        20,
        texto(fila.motivo) || 'Consulta histórica',
        'atendida',
        fechaAproximada
          ? 'Cita histórica creada durante la migración. La fecha original era inválida; se usó 2000-01-01.'
          : 'Cita histórica creada durante la migración: la consulta no tenía cita en el sistema anterior.',
        creado,
        creado
      );

      mapaCitas.set(oldCitaSintetica, id);
      citaPorConsulta.set(oldCons, oldCitaSintetica);
      citaPorCodigo.set(oldCitaSintetica, { id, pacienteId, fechaHora });
      pacienteDeCita.set(oldCitaSintetica, pacienteId);
      guardarMapa('appointment', oldCitaSintetica, id, runId);
      resumen.citasHistoricas.insertadas += 1;
    }

    // Consultas clínicas
    for (const fila of consultas) {
      const oldCons = texto(fila.codigo);
      if (!oldCons) continue;
      if (mapaRegistros.has(oldCons)) {
        resumen.consultas.omitidas += 1;
        continue;
      }

      const pacienteId = mapaPacientes.get(texto(fila.nombrecod));
      if (!pacienteId) {
        resumen.consultas.omitidas += 1;
        continue;
      }

      const oldCita = citaPorConsulta.get(oldCons);
      const citaId = oldCita ? mapaCitas.get(oldCita) : null;
      if (!citaId) {
        resumen.consultas.omitidas += 1;
        advertir(`Consulta ${oldCons} omitida: no se pudo crear su cita`);
        continue;
      }

      const yaExiste = registrosExistentes.get(citaId);
      if (yaExiste) {
        mapaRegistros.set(oldCons, yaExiste);
        guardarMapa('clinical_record', oldCons, yaExiste, runId);
        resumen.consultas.omitidas += 1;
        continue;
      }

      const fecha = fechaValida(fila.fechacon) || citaPorCodigo.get(oldCita)?.fechaHora || nowIso();
      const diagnosticOriginal = texto(fila.diagnostico);
      const cie10Codigo = texto(fila.cie10).toUpperCase();
      const diagnosticoCatalogo = cie10Codigo ? cie10.get(cie10Codigo) : null;
      let diagnosticoFinal =
        texto(fila.cie10d) || diagnosticoCatalogo || diagnosticOriginal || null;
      if (diagnosticoFinal && /^\d{4}-\d{2}-\d{2}/.test(diagnosticoFinal)) {
        diagnosticoFinal = null;
      }

      const lineasReceta = [
        ...(recetasPorConsulta.get(oldCons) || []),
        ...(recetasPorCita.get(oldCita) || []),
      ];
      const receta = formatearReceta(lineasReceta);

      const notas = agregarNotas([
        texto(fila.sintomas) ? `Síntomas: ${texto(fila.sintomas)}` : '',
        texto(fila.observ) ? `Observación: ${texto(fila.observ)}` : '',
        texto(fila.examen) ? `Exámenes solicitados: ${texto(fila.examen)}` : '',
        texto(fila.alergia) ? `Alergia: ${texto(fila.alergia)}` : '',
        diagnosticOriginal && diagnosticOriginal !== diagnosticoFinal
          ? `Diagnóstico original: ${diagnosticOriginal}`
          : '',
      ]);

      const id = uid();
      const creado = fechaHoraIso(fila.transaccion) || fecha;
      insertRegistro.run(
        id,
        citaId,
        pacienteId,
        fecha,
        20,
        texto(fila.motivo) || null,
        notas || null,
        diagnosticoFinal,
        null,
        receta,
        null,
        texto(fila.proxima) || null,
        creado,
        creado
      );

      mapaRegistros.set(oldCons, id);
      registrosExistentes.set(citaId, id);
      if (oldCita) registroPorCita.set(oldCita, id);
      guardarMapa('clinical_record', oldCons, id, runId);
      resumen.consultas.insertadas += 1;
      if (receta) resumen.recetasAgrupadas += 1;
    }

    // Exámenes
    for (const fila of examenes) {
      const oldExamen = texto(fila.examencod);
      const oldCita = texto(fila.citacod);
      if (!oldExamen || !oldCita) continue;

      const claveMapa = `${oldExamen}-${oldCita}`;
      if (mapaExamenes.has(claveMapa)) {
        resumen.examenes.omitidos += 1;
        continue;
      }

      const citaId = mapaCitas.get(oldCita);
      if (!citaId) {
        resumen.examenes.omitidos += 1;
        advertir(`Examen ${oldExamen} omitido: cita ${oldCita} no encontrada`);
        continue;
      }

      let registroId = registroPorCita.get(oldCita);
      if (!registroId) {
        const pacienteId = pacienteDeCita.get(oldCita);
        const yaExiste =
          registrosExistentes.get(citaId) ||
          db.prepare('SELECT id FROM clinical_records WHERE appointment_id = ?').get(citaId)?.id;
        if (yaExiste) {
          registroId = yaExiste;
          registroPorCita.set(oldCita, registroId);
          registrosExistentes.set(citaId, registroId);
        } else if (pacienteId) {
          const cita = citaPorCodigo.get(oldCita);
          registroId = uid();
          const fecha = cita?.fechaHora || nowIso();
          insertRegistro.run(
            registroId,
            citaId,
            pacienteId,
            fecha,
            20,
            'Registro creado para asociar exámenes migrados',
            'Registro generado automáticamente durante la migración.',
            null,
            null,
            null,
            null,
            null,
            fecha,
            fecha
          );
          guardarMapa('clinical_record', `CITA-${oldCita}`, registroId, runId);
          registroPorCita.set(oldCita, registroId);
          registrosExistentes.set(citaId, registroId);
        }
      }

      if (!registroId) {
        resumen.examenes.omitidos += 1;
        continue;
      }

      const informe = texto(fila.informe);
      const referencias = [
        texto(fila.imagen1n),
        texto(fila.imagen2n),
        texto(fila.nombreo1),
        texto(fila.nombreo2),
      ].filter(Boolean);
      const observaciones = informe || null;

      const id = uid();
      const fecha =
        fechaHoraIso(fila.examenfec) ||
        fechaHoraIso(fila.transaccion) ||
        citaPorCodigo.get(oldCita)?.fechaHora ||
        nowIso();
      insertExamen.run(
        id,
        registroId,
        pacienteDeCita.get(oldCita) || null,
        texto(fila.tipo) || 'Examen migrado',
        mapearTipoExamen(fila.tipo),
        'Examen importado del sistema anterior.',
        informe ? 'evaluado' : 'recibido',
        observaciones,
        referencias.length ? JSON.stringify(referencias) : null,
        fecha,
        fecha
      );

      mapaExamenes.set(claveMapa, id);
      guardarMapa('clinical_exam', claveMapa, id, runId);
      resumen.examenes.insertados += 1;
    }
  });

  if (credencialesUsuarios.length) {
    resumen.usuarios.archivoCredenciales = escribirCredencialesMigracion(
      credencialesUsuarios,
      runId
    );
  }

  return resumen;
}
