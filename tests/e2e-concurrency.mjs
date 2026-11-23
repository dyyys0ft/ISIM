import assert from 'node:assert/strict';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Pruebas E2E de concurrencia.
 *
 * Cada escenario levanta su propio servidor con una base temporal y un puerto
 * aleatorio, crea los usuarios necesarios (A–H) y lanza sus operaciones en
 * paralelo. Al terminar limpia la base y los archivos generados.
 *
 * Comando: npm run test:e2e:concurrency
 */

const resumenEscenarios = [];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function isoEnDias(dias, hora = 8, minuto = 0) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  fecha.setUTCHours(hora, minuto, 0, 0);
  return fecha.toISOString();
}

/** Ejecuta tareas en paralelo con un límite de concurrencia. */
async function ejecutar(tareas, limite = 64) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;
  const inicio = performance.now();

  async function trabajador() {
    for (;;) {
      const indice = siguiente;
      siguiente += 1;
      if (indice >= tareas.length) return;

      const t0 = performance.now();
      try {
        const valor = await tareas[indice]();
        resultados[indice] = { ok: true, valor, ms: performance.now() - t0 };
      } catch (error) {
        resultados[indice] = { ok: false, error, ms: performance.now() - t0 };
      }
    }
  }

  const trabajadores = Math.max(1, Math.min(limite, tareas.length));
  await Promise.all(Array.from({ length: trabajadores }, () => trabajador()));

  return { resultados, ms: performance.now() - inicio };
}

function percentil(ordenados, fraccion) {
  if (!ordenados.length) return 0;
  const posicion = Math.min(
    ordenados.length - 1,
    Math.max(0, Math.ceil(fraccion * ordenados.length) - 1)
  );
  return ordenados[posicion];
}

function resumir(ejecucion) {
  const total = ejecucion.resultados.length;
  const ok = ejecucion.resultados.filter((r) => r.ok).length;
  const tiempos = ejecucion.resultados.map((r) => r.ms).sort((a, b) => a - b);
  return {
    total,
    ok,
    fallos: total - ok,
    ms: ejecucion.ms,
    p50: percentil(tiempos, 0.5),
    p95: percentil(tiempos, 0.95),
    max: tiempos.at(-1) || 0,
    rps: total / (ejecucion.ms / 1000),
  };
}

function exigirSinFallos(ejecucion, etiqueta) {
  const fallos = ejecucion.resultados.filter((r) => !r.ok);
  if (!fallos.length) return;
  const detalle = fallos
    .slice(0, 8)
    .map((f) => f.error.message)
    .join(' | ');
  throw new Error(`${etiqueta}: ${fallos.length}/${ejecucion.resultados.length} fallaron → ${detalle}`);
}

function soloConflictos(ejecucion, cantidadEsperada, etiqueta) {
  const fallos = ejecucion.resultados.filter((r) => !r.ok);
  assert.equal(fallos.length, cantidadEsperada, `${etiqueta}: conflictos inesperados`);
  for (const fallo of fallos) {
    assert.match(
      fallo.error.message,
      /→ 409:/,
      `${etiqueta}: se esperaba un 409 y llegó → ${fallo.error.message}`
    );
  }
}

function ms(valor) {
  return `${valor.toFixed(0)} ms`;
}

async function prepararAdministrador(entorno) {
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  return admin;
}

/** Crea los ocho usuarios A–H y devuelve un cliente HTTP por cada uno. */
async function crearEquipo(entorno, admin) {
  const definiciones = [
    ['A', 'operador'],
    ['B', 'operador'],
    ['C', 'operador'],
    ['D', 'operador'],
    ['E', 'medico'],
    ['F', 'medico'],
    ['G', 'enfermero'],
    ['H', 'enfermero'],
  ];
  const marca = String(Date.now()).slice(-6);
  const equipo = {};

  for (let i = 0; i < definiciones.length; i += 1) {
    const [letra, rol] = definiciones[i];
    const username = `e2e.${letra.toLowerCase()}.${marca}`;
    const password = `Clave${letra}${marca}1`;
    const usuario = await admin('/api/users', {
      method: 'POST',
      body: {
        nombre: `E2E ${letra} · ${rol}`,
        cedula: `E2E${letra}${marca}`,
        username,
        password,
        rol,
        ...(rol === 'medico'
          ? { especialidad: 'Ginecología y obstetricia E2E', senecit: `SEN-${marca}-${letra}` }
          : {}),
      },
    });

    const cliente = entorno.crearCliente();
    await entorno.iniciarSesion(cliente, username, password);
    equipo[letra] = { id: usuario.id, cliente, rol, username, password };
  }

  return equipo;
}

function datosPaciente(cedula, indice, etiqueta) {
  return {
    cedula,
    nombres: `${etiqueta} ${indice + 1}`,
    apellidos: 'PRUEBA CONCURRENCIA',
    fecha_nacimiento: '1990-03-14',
    sexo: 'F',
    telefono: `0999${String(indice).padStart(6, '0')}`.slice(0, 10),
    email: `${cedula.toLowerCase()}@isim.local`,
    direccion: 'Dirección de prueba de concurrencia',
    ocupacion: 'Prueba automatizada',
    estado_civil: 'Soltera/o',
    ciudad: 'Riobamba',
  };
}

async function crearPacientes(cliente, cantidad, prefijo, etiqueta) {
  const tareas = Array.from({ length: cantidad }, (_, i) => () =>
    cliente('/api/patients', {
      method: 'POST',
      body: datosPaciente(`${prefijo}${String(i).padStart(3, '0')}`, i, etiqueta),
    })
  );
  const ejecucion = await ejecutar(tareas, 32);
  exigirSinFallos(ejecucion, `Creación de pacientes ${etiqueta}`);
  return ejecucion.resultados.map((r) => r.valor);
}

async function crearCitasYHistorias(admin, pacientes, medicoId, cantidad, inicioDias = 40) {
  const citas = [];
  const pacientesDeCita = [];
  for (let i = 0; i < cantidad; i += 1) {
    const paciente = pacientes[i % pacientes.length];
    const cita = await admin('/api/appointments', {
      method: 'POST',
      body: {
        patientId: paciente.id,
        medicoId,
        fechaHora: isoEnDias(inicioDias, 7 + i, 0),
        duracionMin: 30,
        motivo: `Base concurrencia ${i + 1}`,
        estado: 'programada',
      },
    });
    citas.push(cita);
    pacientesDeCita.push(paciente.id);
  }

  const historias = [];
  for (let i = 0; i < citas.length; i += 1) {
    const historia = await admin('/api/clinical-records', {
      method: 'POST',
      body: {
        appointmentId: citas[i].id,
        motivoConsulta: `Motivo base ${i + 1}`,
        notas: `Notas base ${i + 1}`,
        diagnostico: `Diagnóstico base ${i + 1}`,
      },
    });
    historias.push({ id: historia.id, patient_id: pacientesDeCita[i] });
  }

  return { citas, historias };
}

function intercalar(grupos) {
  const claves = Object.keys(grupos);
  const maximo = Math.max(...claves.map((clave) => grupos[clave].length));
  const tareas = [];
  for (let i = 0; i < maximo; i += 1) {
    for (const clave of claves) {
      const tarea = grupos[clave][i];
      if (tarea) tareas.push(tarea);
    }
  }
  return tareas;
}

// ---------------------------------------------------------------------------
// Escenario 1 · Registro concurrente de pacientes
// ---------------------------------------------------------------------------

async function escenarioRegistroPacientes() {
  const entorno = await crearEntornoE2E();
  try {
    const admin = await prepararAdministrador(entorno);
    const equipo = await crearEquipo(entorno, admin);
    const prefijo = `RC${String(Date.now()).slice(-6)}`;
    const usuarios = ['A', 'B', 'C', 'D'];
    const porUsuario = 25;

    const tareas = [];
    for (let i = 0; i < porUsuario; i += 1) {
      for (const letra of usuarios) {
        const indice = usuarios.indexOf(letra) * porUsuario + i;
        tareas.push(() =>
          equipo[letra].cliente('/api/patients', {
            method: 'POST',
            body: datosPaciente(
              `${prefijo}${letra}${String(i).padStart(2, '0')}`,
              indice,
              `REGISTRO ${letra}`
            ),
          })
        );
      }
    }

    const ejecucion = await ejecutar(tareas, 40);
    exigirSinFallos(ejecucion, 'Registro concurrente de pacientes');

    const ids = ejecucion.resultados.map((r) => r.valor.id);
    assert.equal(new Set(ids).size, usuarios.length * porUsuario, 'Los IDs deben ser únicos');

    const listado = await admin(
      `/api/patients?cedula=${encodeURIComponent(prefijo)}&limit=500`
    );
    assert.equal(listado.length, usuarios.length * porUsuario, 'El servidor debe tener los 100 pacientes');
    assert.equal(
      new Set(listado.map((p) => p.cedula)).size,
      usuarios.length * porUsuario,
      'Las cédulas deben ser únicas'
    );
    assert.ok(
      listado.every((p) => String(p.cedula).startsWith(prefijo)),
      'Todas las pacientes deben corresponder a la prueba'
    );

    return {
      ...resumir(ejecucion),
      detalle: `${usuarios.length} usuarios × ${porUsuario} pacientes`,
    };
  } finally {
    await entorno.limpiar();
  }
}

// ---------------------------------------------------------------------------
// Escenario 2 · Agenda concurrente y doble reserva del mismo horario
// ---------------------------------------------------------------------------

async function escenarioAgendaConcurrente() {
  const entorno = await crearEntornoE2E();
  try {
    const admin = await prepararAdministrador(entorno);
    const equipo = await crearEquipo(entorno, admin);
    const medicos = await admin('/api/medicos');
    const medico = medicos[0];
    assert.ok(medico?.id, 'Debe existir un médico activo');

    const pacientes = await crearPacientes(admin, 5, `AG${String(Date.now()).slice(-6)}`, 'AGENDA');

    const usuarios = ['A', 'B', 'C'];
    const tareas = [];
    let numero = 0;
    for (let dia = 0; dia < 5; dia += 1) {
      for (let slot = 0; slot < 24; slot += 1) {
        const letra = usuarios[numero % usuarios.length];
        const hora = 7 + Math.floor(slot / 2);
        const minuto = slot % 2 === 0 ? 0 : 30;
        const paciente = pacientes[numero % pacientes.length];
        numero += 1;
        tareas.push(() =>
          equipo[letra].cliente('/api/appointments', {
            method: 'POST',
            body: {
              patientId: paciente.id,
              medicoId: medico.id,
              fechaHora: isoEnDias(10 + dia, hora, minuto),
              duracionMin: 30,
              motivo: `Agenda concurrencia ${numero}`,
              estado: 'programada',
            },
          })
        );
      }
    }

    const ejecucion = await ejecutar(tareas, 48);
    exigirSinFallos(ejecucion, 'Agenda concurrente');
    assert.equal(
      new Set(ejecucion.resultados.map((r) => r.valor.id)).size,
      120,
      'Las 120 citas deben tener IDs únicos'
    );

    const desde = isoEnDias(10, 0, 0);
    const hasta = isoEnDias(15, 0, 0);
    const listado = await admin(
      `/api/appointments?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(
        hasta
      )}&limit=500`
    );
    const propias = listado.filter((cita) => String(cita.motivo || '').startsWith('Agenda concurrencia'));
    assert.equal(propias.length, 120, 'El servidor debe registrar las 120 citas');

    // Cuatro usuarios intentan reservar exactamente el mismo horario a la vez.
    const horarioDisputado = isoEnDias(25, 11, 0);
    const carrera = await ejecutar(
      ['A', 'B', 'C', 'D'].map((letra) => () =>
        equipo[letra].cliente('/api/appointments', {
          method: 'POST',
          body: {
            patientId: pacientes[0].id,
            medicoId: medico.id,
            fechaHora: horarioDisputado,
            duracionMin: 30,
            motivo: 'Carrera mismo horario',
            estado: 'programada',
          },
        })
      ),
      4
    );

    const ganadores = carrera.resultados.filter((r) => r.ok).length;
    assert.equal(ganadores, 1, 'Solo un usuario puede ganar el horario disputado');
    soloConflictos(carrera, 3, 'Doble reserva');

    const diaDisputado = await admin(
      `/api/appointments?desde=${encodeURIComponent(isoEnDias(25, 0, 0))}&hasta=${encodeURIComponent(
        isoEnDias(26, 0, 0)
      )}&limit=500`
    );
    assert.equal(
      diaDisputado.filter((cita) => cita.motivo === 'Carrera mismo horario').length,
      1,
      'Debe existir una sola cita en el horario disputado'
    );

    return {
      ...resumir(ejecucion),
      detalle: '120 citas + 4 intentos simultáneos sobre el mismo horario (1 ganador, 3 conflictos)',
    };
  } finally {
    await entorno.limpiar();
  }
}

// ---------------------------------------------------------------------------
// Escenario 3 · Emisión concurrente de certificados
// ---------------------------------------------------------------------------

async function escenarioCertificados() {
  const entorno = await crearEntornoE2E();
  const archivosFirma = [];
  try {
    const admin = await prepararAdministrador(entorno);
    const equipo = await crearEquipo(entorno, admin);
    const plantillas = await admin('/api/templates');
    const plantilla = plantillas.find((item) => item.nombre === 'Certificado médico');
    assert.ok(plantilla, 'Debe existir la plantilla “Certificado médico”');

    const pacientes = await crearPacientes(
      equipo.D.cliente,
      30,
      `CE${String(Date.now()).slice(-6)}`,
      'CERTIFICADO'
    );

    const porMedico = 30;
    const tareas = [];
    for (let i = 0; i < porMedico; i += 1) {
      for (const letra of ['E', 'F']) {
        const paciente = pacientes[i % pacientes.length];
        tareas.push(() =>
          equipo[letra].cliente('/api/documents', {
            method: 'POST',
            body: {
              patientId: paciente.id,
              templateId: plantilla.id,
              titulo: `Certificado concurrente ${letra}-${i + 1}`,
            },
          })
        );
      }
    }

    const ejecucion = await ejecutar(tareas, 40);
    exigirSinFallos(ejecucion, 'Emisión concurrente de certificados');

    const ids = ejecucion.resultados.map((r) => r.valor.id);
    assert.equal(new Set(ids).size, porMedico * 2, 'Cada certificado debe tener un ID único');

    const detalles = await ejecutar(
      ids.map((id) => () => admin(`/api/documents/${encodeURIComponent(id)}`)),
      32
    );
    exigirSinFallos(detalles, 'Verificación de certificados');

    const documentos = detalles.resultados.map((r) => r.valor);
    const codigos = documentos.map((doc) => doc.codigo);
    assert.equal(new Set(codigos).size, documentos.length, 'Los códigos de documento deben ser únicos');

    const numeros = codigos
      .map((codigo) => Number(String(codigo).split('-').at(-1)))
      .sort((a, b) => a - b);
    assert.equal(
      numeros.at(-1) - numeros[0] + 1,
      numeros.length,
      'Los códigos concurrentes deben ser consecutivos, sin huecos ni duplicados'
    );

    const porEmisor = new Map([
      [equipo.E.id, 0],
      [equipo.F.id, 0],
    ]);
    for (const doc of documentos) {
      assert.equal(doc.estado, 'firmado', 'El certificado debe quedar firmado');
      assert.equal(doc.firmaModo, 'medico', 'El certificado debe firmarse con la firma del médico');
      assert.equal(doc.requiereFirmaPaciente, false, 'El certificado no requiere firma de la paciente');
      assert.ok(
        String(doc.versiones?.[0]?.contenido_html || '').includes('CERTIFICADO MÉDICO'),
        'El HTML debe contener el título del certificado'
      );
      assert.ok(
        String(doc.versiones?.[0]?.contenido_html || '').includes('SELLO DE RECEPCIÓN'),
        'El HTML debe contener el sello de recepción'
      );
      assert.ok(porEmisor.has(doc.medico_id), 'El certificado debe pertenecer a E o F');
      porEmisor.set(doc.medico_id, porEmisor.get(doc.medico_id) + 1);
      if (doc.medico_firma_path) archivosFirma.push(doc.medico_firma_path);
    }

    assert.equal(porEmisor.get(equipo.E.id), porMedico, 'E debe emitir 30 certificados');
    assert.equal(porEmisor.get(equipo.F.id), porMedico, 'F debe emitir 30 certificados');

    const todos = await admin('/api/documents?limit=500');
    assert.equal(
      new Set(todos.map((doc) => doc.codigo)).size,
      todos.length,
      'No debe existir ningún código duplicado en todo el sistema'
    );

    return {
      ...resumir(ejecucion),
      detalle: '2 médicos × 30 certificados; códigos únicos y consecutivos',
    };
  } finally {
    await entorno.limpiar(archivosFirma);
  }
}

// ---------------------------------------------------------------------------
// Escenario 4 · Edición concurrente de las mismas historias clínicas
// ---------------------------------------------------------------------------

async function escenarioHistoriasConcurrentes() {
  const entorno = await crearEntornoE2E();
  try {
    const admin = await prepararAdministrador(entorno);
    const equipo = await crearEquipo(entorno, admin);
    const medicos = await admin('/api/medicos');
    const medico = medicos[0];

    const pacientes = await crearPacientes(
      admin,
      12,
      `HC${String(Date.now()).slice(-6)}`,
      'HISTORIA'
    );
    const { historias } = await crearCitasYHistorias(admin, pacientes, medico.id, 12, 40);

    const rondas = 3;
    const ejecucionesRonda = [];
    for (let ronda = 1; ronda <= rondas; ronda += 1) {
      const tareas = [];
      for (let i = 0; i < historias.length; i += 1) {
        const historia = historias[i];
        tareas.push(() =>
          equipo.E.cliente(`/api/clinical-records/${encodeURIComponent(historia.id)}`, {
            method: 'PATCH',
            body: { notas: `E ronda ${ronda} historia ${i + 1}` },
          })
        );
        tareas.push(() =>
          equipo.F.cliente(`/api/clinical-records/${encodeURIComponent(historia.id)}`, {
            method: 'PATCH',
            body: { diagnostico: `F ronda ${ronda} historia ${i + 1}` },
          })
        );
        // Lectura simultánea mientras se escribe (WAL).
        tareas.push(() =>
          admin(`/api/clinical-records?patientId=${encodeURIComponent(historia.patient_id)}`)
        );
      }
      // Cada ronda termina antes de la siguiente: así la última edición es
      // determinista aunque E y F escriban en paralelo dentro de la ronda.
      const ejecucionRonda = await ejecutar(tareas, 48);
      exigirSinFallos(ejecucionRonda, `Edición concurrente de historias (ronda ${ronda})`);
      ejecucionesRonda.push(ejecucionRonda);
    }

    // E y F escriben el mismo campo al mismo tiempo: gana uno, sin errores.
    const carrera = [];
    for (let i = 0; i < historias.length; i += 1) {
      const historia = historias[i];
      carrera.push(() =>
        equipo.E.cliente(`/api/clinical-records/${encodeURIComponent(historia.id)}`, {
          method: 'PATCH',
          body: { tratamiento: `Tratamiento E ${i + 1}` },
        })
      );
      carrera.push(() =>
        equipo.F.cliente(`/api/clinical-records/${encodeURIComponent(historia.id)}`, {
          method: 'PATCH',
          body: { tratamiento: `Tratamiento F ${i + 1}` },
        })
      );
    }
    const ejecucionTratamiento = await ejecutar(carrera, 32);
    exigirSinFallos(ejecucionTratamiento, 'Carrera sobre el mismo campo');

    for (let i = 0; i < historias.length; i += 1) {
      const historia = historias[i];
      const registros = await admin(
        `/api/clinical-records?patientId=${encodeURIComponent(historia.patient_id)}`
      );
      assert.equal(registros.length, 1, 'Cada paciente debe conservar una sola historia');
      const registro = registros[0];
      assert.equal(
        registro.notas,
        `E ronda ${rondas} historia ${i + 1}`,
        'E no debe perder su última edición'
      );
      assert.equal(
        registro.diagnostico,
        `F ronda ${rondas} historia ${i + 1}`,
        'F no debe perder su última edición'
      );
      assert.ok(
        [`Tratamiento E ${i + 1}`, `Tratamiento F ${i + 1}`].includes(registro.tratamiento),
        'El campo disputado debe quedar con uno de los dos valores completos'
      );
      assert.ok(
        [equipo.E.id, equipo.F.id].includes(registro.actualizado_por),
        'La última edición debe quedar atribuida a E o F'
      );
    }

    const resultadosRondas = ejecucionesRonda.flatMap((ronda) => ronda.resultados);
    const msRondas = ejecucionesRonda.reduce((total, ronda) => total + ronda.ms, 0);

    return {
      ...resumir({
        resultados: [...resultadosRondas, ...ejecucionTratamiento.resultados],
        ms: msRondas + ejecucionTratamiento.ms,
      }),
      detalle: 'E y F editan las mismas 12 historias, 3 rondas + carrera sobre el mismo campo',
    };
  } finally {
    await entorno.limpiar();
  }
}

// ---------------------------------------------------------------------------
// Escenario 5 · Tormenta mixta con los ocho usuarios a la vez
// ---------------------------------------------------------------------------

async function escenarioTormentaMixta() {
  const entorno = await crearEntornoE2E();
  const archivosFirma = [];
  try {
    const admin = await prepararAdministrador(entorno);
    const equipo = await crearEquipo(entorno, admin);
    const medicos = await admin('/api/medicos');
    const medico = medicos[0];
    const plantillas = await admin('/api/templates');
    const plantilla = plantillas.find((item) => item.nombre === 'Certificado médico');
    assert.ok(plantilla, 'Debe existir la plantilla “Certificado médico”');
    const marca = String(Date.now()).slice(-6);

    const pacientesAgenda = await crearPacientes(admin, 5, `TM${marca}A`, 'TORMENTA AGENDA');
    const pacientesCertificado = await crearPacientes(admin, 40, `TM${marca}C`, 'TORMENTA CERT');
    const baseHistorias = await crearCitasYHistorias(admin, pacientesAgenda, medico.id, 12, 50);

    const grupos = { A: [], B: [], C: [], D: [], E: [], F: [], G: [], H: [], L: [] };

    for (const letra of ['A', 'B', 'C']) {
      for (let i = 0; i < 30; i += 1) {
        const indice = i + (letra.charCodeAt(0) - 65) * 30;
        const slot = indice % 24;
        grupos[letra].push(() =>
          equipo[letra].cliente('/api/appointments', {
            method: 'POST',
            body: {
              patientId: pacientesAgenda[indice % pacientesAgenda.length].id,
              medicoId: medico.id,
              fechaHora: isoEnDias(
                60 + Math.floor(indice / 24),
                7 + Math.floor(slot / 2),
                slot % 2 === 0 ? 0 : 30
              ),
              duracionMin: 30,
              motivo: `Tormenta cita ${letra}-${i + 1}`,
              estado: 'programada',
            },
          })
        );
      }
    }

    for (let i = 0; i < 40; i += 1) {
      grupos.D.push(() =>
        equipo.D.cliente('/api/patients', {
          method: 'POST',
          body: datosPaciente(`TM${marca}D${String(i).padStart(3, '0')}`, i, 'TORMENTA PACIENTE'),
        })
      );
    }

    for (const letra of ['E', 'F']) {
      for (let i = 0; i < 30; i += 1) {
        grupos[letra].push(() =>
          equipo[letra].cliente('/api/documents', {
            method: 'POST',
            body: {
              patientId: pacientesCertificado[i % pacientesCertificado.length].id,
              templateId: plantilla.id,
              titulo: `Certificado tormenta ${letra}-${i + 1}`,
            },
          })
        );
      }
    }

    // G y H son enfermería: su permiso de edición es sobre datos de pacientes,
    // no sobre historias clínicas (matriz de roles de la UI v2).
    for (const letra of ['G', 'H']) {
      for (let i = 0; i < 20; i += 1) {
        const paciente = pacientesAgenda[i % pacientesAgenda.length];
        grupos[letra].push(() =>
          equipo[letra].cliente(`/api/patients/${encodeURIComponent(paciente.id)}`, {
            method: 'PATCH',
            body: { notas: `Tormenta ${letra} ${i + 1}` },
          })
        );
      }
    }

    for (let i = 0; i < 40; i += 1) {
      grupos.L.push(() =>
        admin(i % 2 === 0 ? '/api/patients?limit=100' : '/api/appointments?limit=200')
      );
    }

    const tareas = intercalar(grupos);
    const ejecucion = await ejecutar(tareas, 64);
    exigirSinFallos(ejecucion, 'Tormenta mixta');

    const salud = await fetch(`${entorno.base}/api/health`);
    assert.equal(salud.status, 200, 'El servidor debe seguir saludable después de la tormenta');

    for (const resultado of ejecucion.resultados) {
      if (resultado.ok && resultado.valor?.versionId) {
        const detalle = await admin(
          `/api/documents/${encodeURIComponent(resultado.valor.id)}`
        );
        if (detalle.medico_firma_path) archivosFirma.push(detalle.medico_firma_path);
      }
    }

    return {
      ...resumir(ejecucion),
      detalle: '90 citas + 40 pacientes + 60 certificados + 40 ediciones + 40 lecturas',
    };
  } finally {
    await entorno.limpiar(archivosFirma);
  }
}

// ---------------------------------------------------------------------------
// Escenario 6 · Carreras de unicidad, cancelación y reagenda
// ---------------------------------------------------------------------------

async function escenarioCarrerasCriticas() {
  const entorno = await crearEntornoE2E();
  try {
    const admin = await prepararAdministrador(entorno);
    const equipo = await crearEquipo(entorno, admin);
    const medicos = await admin('/api/medicos');
    const medico = medicos[0];
    const marca = String(Date.now()).slice(-6);
    const pacientes = await crearPacientes(admin, 8, `CR${marca}`, 'CARRERA');

    // 1) Cinco usuarios registran exactamente la misma cédula a la vez.
    const cedulaDisputada = `DUP${marca}`;
    const carreraCedula = await ejecutar(
      ['A', 'B', 'C', 'D'].map((letra) => () =>
          equipo[letra].cliente('/api/patients', {
            method: 'POST',
            body: datosPaciente(cedulaDisputada, 0, 'DUPLICADO'),
          })
        ).concat([
          () =>
            admin('/api/patients', {
              method: 'POST',
              body: datosPaciente(cedulaDisputada, 1, 'DUPLICADO ADMIN'),
            }),
        ]),
      5
    );
    assert.equal(
      carreraCedula.resultados.filter((r) => r.ok).length,
      1,
      'Solo un usuario puede registrar la cédula disputada'
    );
    soloConflictos(carreraCedula, 4, 'Cédula duplicada simultánea');

    // 2) Cancelación y dos reagendas simultáneas sobre las mismas citas.
    const citas = [];
    for (let i = 0; i < 8; i += 1) {
      const cita = await admin('/api/appointments', {
        method: 'POST',
        body: {
          patientId: pacientes[i].id,
          medicoId: medico.id,
          fechaHora: isoEnDias(70, 8 + i, 0),
          duracionMin: 30,
          motivo: `Cita carrera ${i + 1}`,
          estado: 'programada',
        },
      });
      citas.push(cita);
    }

    const fechas = citas.map((_, i) => ({
      primera: isoEnDias(71, 8 + i, 0),
      segunda: isoEnDias(72, 8 + i, 0),
    }));

    const tareas = [];
    const motivos = citas.map((_, i) => ({
      primera: `Reagenda A ${i + 1}`,
      segunda: `Reagenda B ${i + 1}`,
    }));

    for (let i = 0; i < citas.length; i += 1) {
      const id = encodeURIComponent(citas[i].id);
      tareas.push(() => equipo.A.cliente(`/api/appointments/${id}/cancel`, { method: 'POST' }));
      tareas.push(() =>
        equipo.B.cliente(`/api/appointments/${id}`, {
          method: 'PATCH',
          body: {
            fechaHora: fechas[i].primera,
            motivo: motivos[i].primera,
            motivoReagenda: 'Reagenda concurrente A',
          },
        })
      );
      tareas.push(() =>
        equipo.C.cliente(`/api/appointments/${id}`, {
          method: 'PATCH',
          body: {
            fechaHora: fechas[i].segunda,
            motivo: motivos[i].segunda,
            motivoReagenda: 'Reagenda concurrente B',
          },
        })
      );
      tareas.push(() => equipo.D.cliente(`/api/appointments/${id}`));
    }

    const ejecucion = await ejecutar(tareas, 32);
    exigirSinFallos(ejecucion, 'Carrera de cancelación y reagenda');

    let canceladas = 0;
    for (let i = 0; i < citas.length; i += 1) {
      const cita = await admin(`/api/appointments/${encodeURIComponent(citas[i].id)}`);
      assert.equal(cita.estado, 'cancelada', 'La cancelación debe prevalecer sobre la reagenda');
      assert.ok(
        [fechas[i].primera, fechas[i].segunda].includes(new Date(cita.fecha_hora).toISOString()),
        'La fecha final debe ser una de las dos reagendas completas'
      );
      assert.ok(
        [motivos[i].primera, motivos[i].segunda].includes(cita.motivo),
        'El motivo final debe ser uno de los dos motivos completos'
      );
      canceladas += 1;
    }

    // 3) Cinco cancelaciones simultáneas de la misma cita: todas deben ser idempotentes.
    const citaUnica = await admin('/api/appointments', {
      method: 'POST',
      body: {
        patientId: pacientes[0].id,
        medicoId: medico.id,
        fechaHora: isoEnDias(80, 9, 0),
        duracionMin: 30,
        motivo: 'Cancelación múltiple',
        estado: 'programada',
      },
    });
    const idUnico = encodeURIComponent(citaUnica.id);
    const cancelaciones = await ejecutar(
      ['A', 'B', 'C', 'D'].map((letra) => () =>
        equipo[letra].cliente(`/api/appointments/${idUnico}/cancel`, { method: 'POST' })
      ).concat([() => admin(`/api/appointments/${idUnico}/cancel`, { method: 'POST' })]),
      5
    );
    assert.equal(cancelaciones.resultados.filter((r) => r.ok).length, 5, 'Las 5 cancelaciones deben ser idempotentes');
    const final = await admin(`/api/appointments/${idUnico}`);
    assert.equal(final.estado, 'cancelada', 'La cita debe quedar cancelada');

    // Los 409 de la cédula duplicada son el resultado esperado de la carrera,
    // no un fallo del sistema: se contabilizan como operaciones correctas.
    const combinados = [
      ...carreraCedula.resultados,
      ...ejecucion.resultados,
      ...cancelaciones.resultados,
    ].map((resultado) => (resultado.ok ? resultado : { ...resultado, ok: true, esperado: true }));

    return {
      ...resumir({ resultados: combinados, ms: ejecucion.ms }),
      detalle: '5 cédulas iguales (1 gana, 4 conflictos esperados), 8 citas canceladas/reagendadas, 5 cancelaciones idempotentes',
      canceladas,
    };
  } finally {
    await entorno.limpiar();
  }
}

// ---------------------------------------------------------------------------
// Ejecución secuencial de los escenarios
// ---------------------------------------------------------------------------

const escenarios = [
  ['Registro concurrente de pacientes', escenarioRegistroPacientes],
  ['Agenda concurrente y doble reserva', escenarioAgendaConcurrente],
  ['Emisión concurrente de certificados', escenarioCertificados],
  ['Edición concurrente de historias clínicas', escenarioHistoriasConcurrentes],
  ['Tormenta mixta de 8 usuarios', escenarioTormentaMixta],
  ['Carreras de cédula, cancelación y reagenda', escenarioCarrerasCriticas],
];

console.log('');
console.log('ISIM · Pruebas E2E de concurrencia');
console.log('');

for (let i = 0; i < escenarios.length; i += 1) {
  const [nombre, ejecutarEscenario] = escenarios[i];
  const etiqueta = `[${i + 1}/${escenarios.length}] ${nombre}`;
  const inicio = performance.now();
  try {
    const resultado = await ejecutarEscenario();
    const duracion = performance.now() - inicio;
    console.log(
      `${etiqueta} … OK  ${resultado.total} ops · ${resultado.ok}/${resultado.total} · ` +
        `${(duracion / 1000).toFixed(1)} s · ${resultado.rps.toFixed(0)} op/s · p95 ${ms(
          resultado.p95
        )}`
    );
    console.log(`    ${resultado.detalle}`);
    resumenEscenarios.push({ nombre, estado: 'OK', ...resultado, totalMs: duracion });
  } catch (error) {
    const duracion = performance.now() - inicio;
    console.log(`${etiqueta} … FALLÓ en ${(duracion / 1000).toFixed(1)} s`);
    console.log(`    ${error.message}`);
    resumenEscenarios.push({
      nombre,
      estado: 'FALLÓ',
      total: 0,
      ok: 0,
      fallos: 1,
      ms: duracion,
      p50: 0,
      p95: 0,
      max: 0,
      rps: 0,
      detalle: error.message,
      totalMs: duracion,
    });
    process.exitCode = 1;
  }
  console.log('');
}

const totalOps = resumenEscenarios.reduce((suma, item) => suma + item.total, 0);
const totalOk = resumenEscenarios.reduce((suma, item) => suma + item.ok, 0);
const totalFallos = resumenEscenarios.reduce((suma, item) => suma + item.fallos, 0);
const fallidos = resumenEscenarios.filter((item) => item.estado !== 'OK');

console.log('RESUMEN DE CONCURRENCIA');
console.log('-'.repeat(112));
console.log(
  'Escenario'.padEnd(46) +
    'Ops'.padStart(6) +
    'OK'.padStart(7) +
    'Fallos'.padStart(8) +
    'p50'.padStart(10) +
    'p95'.padStart(10) +
    'máx'.padStart(10) +
    'op/s'.padStart(9)
);
for (const item of resumenEscenarios) {
  console.log(
    item.nombre.padEnd(46) +
      String(item.total).padStart(6) +
      String(item.ok).padStart(7) +
      String(item.fallos).padStart(8) +
      `${item.p50.toFixed(0)} ms`.padStart(10) +
      `${item.p95.toFixed(0)} ms`.padStart(10) +
      `${item.max.toFixed(0)} ms`.padStart(10) +
      item.rps.toFixed(0).padStart(9)
  );
}
console.log('-'.repeat(112));
console.log(
  `${'TOTAL'.padEnd(46)}${String(totalOps).padStart(6)}${String(totalOk).padStart(7)}${String(
    totalFallos
  ).padStart(8)}`
);
console.log('');

if (fallidos.length) {
  console.log(`RESULTADO: ${fallidos.length} escenario(s) fallaron.`);
} else {
  console.log('RESULTADO: todos los escenarios de concurrencia pasaron.');
}
console.log('');
