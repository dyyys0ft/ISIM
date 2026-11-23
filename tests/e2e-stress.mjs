import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Prueba de estrés máximo del sistema.
 *
 * Fase 1 · Carga sostenida: N usuarios conectados al mismo servidor ejecutan
 *          lecturas y escrituras reales sin pausa durante S segundos.
 * Fase 2 · Sincronización local: se mide cuánto tarda un cambio en ser visible
 *          para 12 clientes simultáneos y se comprueba el cierre de sesión en
 *          tiempo real por SSE (una sola sesión por usuario).
 * Fase 3 · Validación de información: se envían datos inválidos, malformados y
 *          peligrosos en paralelo y se verifica que el servidor los rechace sin
 *          corromper la base ni devolver errores 500.
 *
 * Variables opcionales:
 *   STRESS_USERS=20      usuarios concurrentes (4–48)
 *   STRESS_SECONDS=20    duración de la carga sostenida
 *
 * Comando: npm run test:e2e:stress
 */

const USUARIOS = Math.min(48, Math.max(8, Number(process.env.STRESS_USERS || 20)));
const SEGUNDOS = Math.min(120, Math.max(5, Number(process.env.STRESS_SECONDS || 20)));
const LECTORES_SYNC = 12;
const ARCHIVOS_FIRMA = [];
const RESULTADOS = {};

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoEnDias(dias, hora = 8, minuto = 0) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  fecha.setUTCHours(hora, minuto, 0, 0);
  return fecha.toISOString();
}

async function ejecutar(tareas, limite = 32) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;

  async function trabajador() {
    for (;;) {
      const indice = siguiente;
      siguiente += 1;
      if (indice >= tareas.length) return;
      const t0 = performance.now();
      try {
        resultados[indice] = { ok: true, valor: await tareas[indice](), ms: performance.now() - t0 };
      } catch (error) {
        resultados[indice] = { ok: false, error, ms: performance.now() - t0 };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limite, tareas.length)) }, () => trabajador())
  );
  return resultados;
}

function percentil(ordenados, fraccion) {
  if (!ordenados.length) return 0;
  const posicion = Math.min(
    ordenados.length - 1,
    Math.max(0, Math.ceil(fraccion * ordenados.length) - 1)
  );
  return ordenados[posicion];
}

function latencias(registros) {
  const tiempos = registros.map((r) => r.ms).sort((a, b) => a - b);
  return {
    p50: percentil(tiempos, 0.5),
    p95: percentil(tiempos, 0.95),
    p99: percentil(tiempos, 0.99),
    max: tiempos.at(-1) || 0,
  };
}

function exigirSinFallos(resultados, etiqueta) {
  const fallos = resultados.filter((r) => !r.ok);
  if (!fallos.length) return;
  const detalle = fallos
    .slice(0, 8)
    .map((f) => f.error?.message || String(f.error))
    .join(' | ');
  throw new Error(`${etiqueta}: ${fallos.length}/${resultados.length} fallaron → ${detalle}`);
}

function distribuirRoles(total) {
  const operadores = Math.max(2, Math.round(total * 0.5));
  const medicos = Math.max(1, Math.round(total * 0.25));
  const enfermeros = Math.max(1, Math.round(total * 0.15));
  const lectura = Math.max(1, total - operadores - medicos - enfermeros);
  const roles = [
    ...Array(operadores).fill('operador'),
    ...Array(medicos).fill('medico'),
    ...Array(enfermeros).fill('enfermero'),
    ...Array(lectura).fill('lectura'),
  ];
  // Si el reparto se excede por los mínimos, se recorta desde el final.
  return roles.slice(0, total);
}

async function iniciarSesionCredenciales(cliente, username, password) {
  return cliente('/api/auth/login', { method: 'POST', body: { username, password } });
}

async function contarPacientes(cliente) {
  const respuesta = await cliente('/api/patients/paginated?limit=1');
  const datos = respuesta?.datos ?? respuesta;
  return datos.total;
}

function datosPaciente(cedula, nombres, apellidos, extra = {}) {
  return {
    cedula,
    nombres,
    apellidos,
    fecha_nacimiento: '1990-05-20',
    sexo: 'F',
    telefono: '0999999999',
    email: `${String(cedula).toLowerCase()}@estres.isim.local`,
    direccion: 'Dirección de prueba de estrés',
    ocupacion: 'Prueba de carga',
    estado_civil: 'Soltera/o',
    ciudad: 'Riobamba',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Fase 1 · Carga sostenida
// ---------------------------------------------------------------------------

function resumirCarga(registros, msTotal) {
  const ok = registros.filter((r) => r.ok).length;
  const escrituras = registros.filter((r) => r.ok && r.tipo === 'escritura');
  const lecturas = registros.filter((r) => r.ok && r.tipo === 'lectura');
  const tiempos = latencias(registros.filter((r) => r.ok));
  const segundos = Math.max(1, Math.ceil(msTotal / 1000));
  const porSegundo = Array(segundos).fill(0);
  for (const registro of registros) {
    const indice = Math.min(segundos - 1, Math.floor(registro.fin / 1000));
    porSegundo[indice] += 1;
  }
  return {
    total: registros.length,
    ok,
    fallos: registros.length - ok,
    escrituras: escrituras.length,
    lecturas: lecturas.length,
    ms: msTotal,
    rps: registros.length / (msTotal / 1000),
    rpsEscritura: escrituras.length / (msTotal / 1000),
    rpsLectura: lecturas.length / (msTotal / 1000),
    ...tiempos,
    porSegundo,
  };
}

async function crearUsuariosDeCarga(entorno, admin, marca) {
  const roles = distribuirRoles(USUARIOS);
  const usuarios = [];
  const inicio = performance.now();

  for (let i = 0; i < roles.length; i += 1) {
    const rol = roles[i];
    const etiqueta = `U${String(i + 1).padStart(2, '0')}`;
    const username = `carga${String(i + 1).padStart(2, '0')}.${marca}`;
    const password = `Carga${marca}${i + 1}`;
    const creado = await admin('/api/users', {
      method: 'POST',
      body: {
        nombre: `Estrés ${etiqueta} · ${rol}`,
        cedula: `ST${marca}${String(i).padStart(2, '0')}`,
        username,
        password,
        rol,
        ...(rol === 'medico'
          ? { especialidad: 'Ginecología y obstetricia de estrés', senecit: `SEN-${marca}-${i}` }
          : {}),
      },
    });

    const cliente = entorno.crearCliente();
    const login = await iniciarSesionCredenciales(cliente, username, password);
    assert.equal(login.id, creado.id, `El usuario ${etiqueta} debe iniciar sesión`);

    usuarios.push({
      id: creado.id,
      username,
      password,
      rol,
      etiqueta,
      indice: i,
      cliente,
      contadores: { citas: 0, pacientes: 0, certificados: 0, ediciones: 0 },
    });

    if ((i + 1) % 5 === 0 || i === roles.length - 1) {
      console.log(`    usuarios listos: ${i + 1}/${roles.length}`);
    }
  }

  return { usuarios, ms: performance.now() - inicio };
}

async function prepararBase(admin, usuarios, marca) {
  const medicos = usuarios.filter((u) => u.rol === 'medico');
  const catalogo = await admin('/api/medicos');
  const medicosIds = [
    ...new Set([...medicos.map((u) => u.id), ...catalogo.map((m) => m.id)]),
  ];
  assert.ok(medicosIds.length, 'Debe existir al menos un médico');

  const pacientes = [];
  const creaciones = await ejecutar(
    Array.from({ length: 12 }, (_, i) => () =>
      admin('/api/patients', {
        method: 'POST',
        body: datosPaciente(`BASE${marca}${String(i).padStart(2, '0')}`, `Base ${i + 1}`, 'Paciente Estrés'),
      })
    ),
    6
  );
  exigirSinFallos(creaciones, 'Pacientes base');
  for (let i = 0; i < creaciones.length; i += 1) {
    pacientes.push({ id: creaciones[i].valor.id, cedula: `BASE${marca}${String(i).padStart(2, '0')}` });
  }

  const medicoBase = medicosIds[0];
  const historias = [];
  for (let i = 0; i < 24; i += 1) {
    const slot = i % 24;
    const cita = await admin('/api/appointments', {
      method: 'POST',
      body: {
        patientId: pacientes[i % pacientes.length].id,
        medicoId: medicoBase,
        fechaHora: isoEnDias(90 + Math.floor(i / 24), 7 + Math.floor(slot / 2), slot % 2 ? 30 : 0),
        duracionMin: 30,
        motivo: `Historia base de estrés ${i + 1}`,
        estado: 'programada',
      },
    });
    const historia = await admin('/api/clinical-records', {
      method: 'POST',
      body: {
        appointmentId: cita.id,
        motivoConsulta: `Motivo base ${i + 1}`,
        notas: `Notas base ${i + 1}`,
        diagnostico: `Diagnóstico base ${i + 1}`,
      },
    });
    historias.push({ id: historia.id, patient_id: pacientes[i % pacientes.length].id });
  }

  const plantillas = await admin('/api/templates');
  const plantilla = plantillas.find((item) => item.nombre === 'Certificado médico');
  assert.ok(plantilla, 'Debe existir la plantilla “Certificado médico”');

  return { pacientes, historias, medicos: medicosIds, templateId: plantilla.id, medicoBase };
}

async function lecturaCarga(u, seq, ctx) {
  const rutas = [
    '/api/patients?limit=100',
    '/api/appointments?limit=200',
    '/api/patients/paginated?limit=25',
  ];
  // Secretario/a no tiene acceso a documentos ni historias.
  if (['admin', 'medico', 'enfermero', 'lectura'].includes(u.rol)) {
    rutas.push('/api/documents?limit=100');
  }
  // Solo los roles con historias.ver pueden leer historias clínicas.
  if (['admin', 'medico', 'lectura'].includes(u.rol)) {
    rutas.push('/api/clinical-history/patients?limit=50');
    rutas.push(
      `/api/clinical-records?patientId=${encodeURIComponent(
        ctx.pacientes[seq % ctx.pacientes.length].id
      )}`
    );
  }
  await u.cliente(rutas[(seq + u.indice) % rutas.length]);
  return { tipo: 'lectura' };
}

async function crearCitaCarga(u, seq, ctx, baseDia) {
  const n = u.contadores.citas;
  u.contadores.citas += 1;
  const slot = n % 24;
  const cita = await u.cliente('/api/appointments', {
    method: 'POST',
    body: {
      patientId: ctx.pacientes[(seq + u.indice) % ctx.pacientes.length].id,
      medicoId: ctx.medicos[u.indice % ctx.medicos.length],
      fechaHora: isoEnDias(baseDia + u.indice * 5 + Math.floor(n / 24), 7 + Math.floor(slot / 2), slot % 2 ? 30 : 0),
      duracionMin: 30,
      motivo: `Carga ${u.etiqueta} cita ${n + 1}`,
      estado: 'programada',
    },
  });
  ctx.creados.citas.push(cita.id);
  return { tipo: 'escritura' };
}

async function crearPacienteCarga(u, seq, ctx) {
  const n = u.contadores.pacientes;
  u.contadores.pacientes += 1;
  const cedula = `ES${String(u.indice).padStart(2, '0')}${String(n).padStart(3, '0')}`;
  const paciente = await u.cliente('/api/patients', {
    method: 'POST',
    body: datosPaciente(cedula, `Carga ${u.etiqueta} ${n + 1}`, 'Paciente de carga'),
  });
  const registro = { id: paciente.id, cedula };
  ctx.creados.pacientes.push(registro);
  ctx.pacientes.push(registro);
  return { tipo: 'escritura' };
}

async function editarPacienteCarga(u, seq, ctx) {
  const paciente = ctx.pacientes[(seq + u.indice) % ctx.pacientes.length];
  await u.cliente(`/api/patients/${encodeURIComponent(paciente.id)}`, {
    method: 'PATCH',
    body: { telefono: `0988${String((seq + u.indice) % 100000).padStart(5, '0')}` },
  });
  return { tipo: 'escritura' };
}

async function crearCertificadoCarga(u, seq, ctx) {
  const n = u.contadores.certificados;
  u.contadores.certificados += 1;
  const paciente = ctx.pacientes[(seq + u.indice) % ctx.pacientes.length];
  const documento = await u.cliente('/api/documents', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      templateId: ctx.templateId,
      titulo: `Certificado de carga ${u.etiqueta}-${n + 1}`,
    },
  });
  ctx.creados.certificados.push(documento.id);
  return { tipo: 'escritura' };
}

async function editarHistoriaCarga(u, seq, ctx) {
  const historia = ctx.historias[(seq + u.indice) % ctx.historias.length];
  const campos = ['notas', 'diagnostico', 'tratamiento', 'recomendaciones'];
  const campo = campos[(seq + u.indice) % campos.length];
  await u.cliente(`/api/clinical-records/${encodeURIComponent(historia.id)}`, {
    method: 'PATCH',
    body: { [campo]: `Carga ${u.etiqueta} ${campo} ${seq + 1}` },
  });
  ctx.creados.ediciones.push({ id: historia.id, campo, usuario: u.id });
  return { tipo: 'escritura' };
}

async function ejecutarOperacion(u, seq, ctx) {
  const s = seq % 20;

  if (u.rol === 'operador') {
    if (s < 6 && u.contadores.citas < 60) return crearCitaCarga(u, seq, ctx, 120);
    if (s < 9 && u.contadores.pacientes < 25) return crearPacienteCarga(u, seq, ctx);
    if (s < 11) return editarPacienteCarga(u, seq, ctx);
    return lecturaCarga(u, seq, ctx);
  }

  if (u.rol === 'medico') {
    if (s < 7 && u.contadores.certificados < 30) return crearCertificadoCarga(u, seq, ctx);
    if (s < 15) return editarHistoriaCarga(u, seq, ctx);
    return lecturaCarga(u, seq, ctx);
  }

  if (u.rol === 'enfermero') {
    if (s < 4 && u.contadores.citas < 30) return crearCitaCarga(u, seq, ctx, 220);
    // Enfermería edita datos de pacientes; no tiene historias.gestionar.
    if (s < 13) return editarPacienteCarga(u, seq, ctx);
    return lecturaCarga(u, seq, ctx);
  }

  return lecturaCarga(u, seq, ctx);
}

async function faseCarga(entorno, admin, usuarios, ctx) {
  const inicio = performance.now();
  const fin = inicio + SEGUNDOS * 1000;
  const registros = [];

  async function bucle(usuario) {
    let seq = 0;
    while (performance.now() < fin) {
      const t0 = performance.now();
      let tipo = 'lectura';
      try {
        const resultado = await ejecutarOperacion(usuario, seq, ctx);
        tipo = resultado.tipo;
        registros.push({
          ok: true,
          tipo,
          rol: usuario.rol,
          ms: performance.now() - t0,
          fin: performance.now() - inicio,
        });
      } catch (error) {
        registros.push({
          ok: false,
          tipo,
          rol: usuario.rol,
          ms: performance.now() - t0,
          fin: performance.now() - inicio,
          error: error.message,
        });
      }
      seq += 1;
    }
  }

  await Promise.all(usuarios.map((usuario) => bucle(usuario)));
  const ms = performance.now() - inicio;
  const resumen = resumirCarga(registros, ms);

  const fallos = registros.filter((r) => !r.ok);
  if (fallos.length) {
    const muestra = fallos.slice(0, 6).map((f) => `${f.rol}: ${f.error}`).join(' | ');
    throw new Error(`${fallos.length} operaciones fallaron bajo carga → ${muestra}`);
  }

  const salud = await fetch(`${entorno.base}/api/health`);
  assert.equal(salud.status, 200, 'El servidor debe seguir saludable tras la carga');

  assert.equal(
    new Set(ctx.creados.pacientes.map((p) => p.id)).size,
    ctx.creados.pacientes.length,
    'Los IDs de pacientes creados deben ser únicos'
  );
  assert.equal(
    new Set(ctx.creados.citas).size,
    ctx.creados.citas.length,
    'Los IDs de citas creados deben ser únicos'
  );
  assert.equal(
    new Set(ctx.creados.certificados).size,
    ctx.creados.certificados.length,
    'Los IDs de certificados creados deben ser únicos'
  );

  // Muestras de integridad de lo escrito durante la carga.
  const muestraPacientes = await ejecutar(
    ctx.creados.pacientes.slice(0, 5).map((p) => () =>
      admin(`/api/patients/${encodeURIComponent(p.id)}`)
    ),
    5
  );
  exigirSinFallos(muestraPacientes, 'Muestras de pacientes');
  for (let i = 0; i < muestraPacientes.length; i += 1) {
    assert.equal(muestraPacientes[i].valor.cedula, ctx.creados.pacientes[i].cedula);
    assert.ok(muestraPacientes[i].valor.nombres.startsWith('Carga '));
  }

  const muestraCitas = await ejecutar(
    ctx.creados.citas.slice(0, 5).map((id) => () => admin(`/api/appointments/${encodeURIComponent(id)}`)),
    5
  );
  exigirSinFallos(muestraCitas, 'Muestras de citas');
  for (const resultado of muestraCitas) {
    assert.ok(resultado.valor.id);
    assert.ok(Number.isFinite(new Date(resultado.valor.fecha_hora).getTime()));
    assert.match(String(resultado.valor.motivo), /^Carga /);
  }

  let codigos = [];
  if (ctx.creados.certificados.length) {
    const detalles = await ejecutar(
      ctx.creados.certificados.map((id) => () => admin(`/api/documents/${encodeURIComponent(id)}`)),
      16
    );
    exigirSinFallos(detalles, 'Certificados bajo carga');
    codigos = detalles.map((r) => r.valor.codigo);
    assert.equal(new Set(codigos).size, codigos.length, 'Los códigos de certificado deben ser únicos');
    const numeros = codigos
      .map((codigo) => Number(String(codigo).split('-').at(-1)))
      .sort((a, b) => a - b);
    assert.equal(
      numeros.at(-1) - numeros[0] + 1,
      numeros.length,
      'Los códigos generados bajo carga deben ser consecutivos'
    );
    for (const detalle of detalles) {
      assert.equal(detalle.valor.estado, 'firmado', 'El certificado debe quedar firmado');
      assert.equal(detalle.valor.firmaModo, 'medico');
      if (detalle.valor.medico_firma_path) ARCHIVOS_FIRMA.push(detalle.valor.medico_firma_path);
    }
  }

  if (ctx.creados.ediciones.length) {
    const muestraEdicion = ctx.creados.ediciones.at(-1);
    const registrosHistoria = await admin(
      `/api/clinical-records?patientId=${encodeURIComponent(
        ctx.historias.find((h) => h.id === muestraEdicion.id)?.patient_id || ctx.pacientes[0].id
      )}`
    );
    assert.ok(Array.isArray(registrosHistoria));
  }

  return {
    resumen,
    generado: {
      pacientes: ctx.creados.pacientes.length,
      citas: ctx.creados.citas.length,
      certificados: ctx.creados.certificados.length,
      ediciones: ctx.creados.ediciones.length,
    },
    dbBytes: statSync(entorno.dbFile).size,
    codigos: codigos.length,
  };
}

// ---------------------------------------------------------------------------
// Fase 2 · Sincronización local multi-cliente
// ---------------------------------------------------------------------------

async function escucharSSE(base, cookie) {
  const controlador = new AbortController();
  const respuesta = await fetch(`${base}/api/auth/session-events`, {
    headers: { cookie },
    signal: controlador.signal,
  });
  assert.equal(respuesta.status, 200, 'SSE debe conectar');

  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  let conectadoListo = false;
  let resolverConectado;
  let resolverCierre;
  const conectado = new Promise((resolve) => {
    resolverConectado = resolve;
  });
  const cierre = new Promise((resolve) => {
    resolverCierre = resolve;
  });

  (async () => {
    try {
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        buffer += decodificador.decode(value, { stream: true });

        if (!conectadoListo && buffer.includes('event: conectado')) {
          conectadoListo = true;
          resolverConectado();
        }
        if (buffer.includes('event: sesion-cerrada')) {
          resolverCierre(buffer);
          return;
        }
      }
    } catch {
      // conexión abortada al terminar la prueba
    }
  })();

  return {
    conectado,
    cierre,
    cerrar: () => controlador.abort(),
  };
}

async function medirPropagacion(nombre, escritura, lectura, verificar, lectores) {
  const valor = await escritura();
  const esperas = await Promise.all(
    lectores.map(async (u) => {
      const inicio = performance.now();
      for (let intento = 0; intento < 300; intento += 1) {
        try {
          if (verificar(await lectura(u, valor), valor)) {
            return { ok: true, ms: performance.now() - inicio };
          }
        } catch {
          // reintenta hasta que el cambio sea visible
        }
        await dormir(4);
      }
      return { ok: false, ms: performance.now() - inicio };
    })
  );

  const ok = esperas.filter((e) => e.ok).length;
  const tiempos = esperas.filter((e) => e.ok).map((e) => e.ms).sort((a, b) => a - b);
  return {
    nombre,
    ok,
    total: esperas.length,
    p95: percentil(tiempos, 0.95),
    max: tiempos.at(-1) || 0,
  };
}

async function faseSincronizacion(entorno, admin, usuarios, ctx) {
  const lectores = usuarios.slice(0, LECTORES_SYNC);
  const marca = String(Date.now()).slice(-7);
  const propagaciones = [];

  propagaciones.push(
    await medirPropagacion(
      'Paciente creado',
      async () => {
        const paciente = await admin('/api/patients', {
          method: 'POST',
          body: datosPaciente(`SYNC${marca}P`, 'Sincronía Paciente', 'Visibilidad Inmediata'),
        });
        return { id: paciente.id, cedula: `SYNC${marca}P` };
      },
      (u, valor) => u.cliente(`/api/patients?cedula=${encodeURIComponent(valor.cedula)}&limit=50`),
      (datos, valor) => Array.isArray(datos) && datos.some((p) => p.id === valor.id),
      lectores
    )
  );

  propagaciones.push(
    await medirPropagacion(
      'Cita creada',
      async () => {
        const cita = await admin('/api/appointments', {
          method: 'POST',
          body: {
            patientId: ctx.pacientes[0].id,
            medicoId: ctx.medicoBase,
            fechaHora: isoEnDias(320, 10, 0),
            duracionMin: 30,
            motivo: `Sincronía cita ${marca}`,
            estado: 'programada',
          },
        });
        return { id: cita.id };
      },
      (u, valor) => u.cliente(`/api/appointments/${encodeURIComponent(valor.id)}`),
      (datos, valor) => datos?.id === valor.id,
      lectores
    )
  );

  const historiaSync = ctx.historias[0];
  const valorHistoria = `Sincronía clínica ${marca}`;
  propagaciones.push(
    await medirPropagacion(
      'Historia editada',
      async () => {
        await admin(`/api/clinical-records/${encodeURIComponent(historiaSync.id)}`, {
          method: 'PATCH',
          body: { diagnostico: valorHistoria },
        });
        return { id: historiaSync.id, patientId: historiaSync.patient_id, valor: valorHistoria };
      },
      (u, valor) => u.cliente(`/api/clinical-records?patientId=${encodeURIComponent(valor.patientId)}`),
      (datos, valor) =>
        Array.isArray(datos) &&
        datos.some((registro) => registro.id === valor.id && registro.diagnostico === valor.valor),
      lectores
    )
  );

  propagaciones.push(
    await medirPropagacion(
      'Certificado emitido',
      async () => {
        const documento = await admin('/api/documents', {
          method: 'POST',
          body: {
            patientId: ctx.pacientes[1].id,
            templateId: ctx.templateId,
            medicoId: ctx.medicoBase,
            titulo: `Sincronía certificado ${marca}`,
          },
        });
        return { id: documento.id };
      },
      (u, valor) => u.cliente(`/api/documents/${encodeURIComponent(valor.id)}`),
      (datos, valor) => datos?.id === valor.id && datos.estado === 'firmado',
      lectores
    )
  );

  // Todos los clientes deben ver el mismo total de pacientes (vista consistente).
  const totales = await ejecutar(
    lectores.map((u) => () => u.cliente('/api/patients/paginated?limit=1')),
    12
  );
  exigirSinFallos(totales, 'Lectura consistente multi-cliente');
  const valores = totales.map((r) => r.valor.total);
  assert.equal(new Set(valores).size, 1, 'Todos los clientes deben ver el mismo total de pacientes');

  // Una sola sesión por usuario + cierre en tiempo real por SSE.
  const usuarioSync = usuarios.at(-1);
  const clienteA = entorno.crearCliente({ crudo: true });
  const loginA = await iniciarSesionCredenciales(
    clienteA,
    usuarioSync.username,
    usuarioSync.password
  );
  assert.equal(loginA.status, 200, 'La primera sesión debe iniciar');

  const sse = await escucharSSE(entorno.base, clienteA.cookieActual());
  await Promise.race([sse.conectado, dormir(4000)]);

  const inicioCierre = performance.now();
  const clienteB = entorno.crearCliente({ crudo: true });
  const loginB = await iniciarSesionCredenciales(
    clienteB,
    usuarioSync.username,
    usuarioSync.password
  );
  assert.equal(loginB.status, 200, 'La segunda sesión debe iniciar');

  const evento = await Promise.race([sse.cierre, dormir(5000).then(() => null)]);
  const msCierre = performance.now() - inicioCierre;
  sse.cerrar();

  assert.ok(evento, 'La sesión anterior debe recibir el evento de cierre');
  assert.match(String(evento), /event: sesion-cerrada/);
  assert.match(String(evento), /otra_sesion/);

  const sesionVieja = await clienteA('/api/auth/me');
  assert.equal(sesionVieja.status, 401, 'La sesión anterior debe quedar invalidada');
  const sesionNueva = await clienteB('/api/auth/me');
  assert.equal(sesionNueva.status, 200, 'La sesión nueva debe seguir activa');

  return {
    propagaciones,
    totalConsistente: valores[0],
    sesionUnica: { ms: msCierre, evento: 'otra_sesion', anterior: 401, nueva: 200 },
  };
}

// ---------------------------------------------------------------------------
// Fase 3 · Validación de información
// ---------------------------------------------------------------------------

async function faseValidacion(entorno, admin, usuarios, ctx) {
  const marca = String(Date.now()).slice(-7);
  const adminCrudo = entorno.crearCliente({ crudo: true });
  const operador = usuarios.find((u) => u.rol === 'operador');
  const lectura = usuarios.find((u) => u.rol === 'lectura');
  const medico = usuarios.find((u) => u.rol === 'medico');
  const operadorCrudo = entorno.crearCliente({ crudo: true });
  const lecturaCrudo = entorno.crearCliente({ crudo: true });
  const medicoCrudo = entorno.crearCliente({ crudo: true });

  assert.equal(
    (await iniciarSesionCredenciales(adminCrudo, admin.username, admin.password ?? '54321')).status,
    200
  );
  assert.equal(
    (await iniciarSesionCredenciales(operadorCrudo, operador.username, operador.password)).status,
    200
  );
  assert.equal(
    (await iniciarSesionCredenciales(lecturaCrudo, lectura.username, lectura.password)).status,
    200
  );
  assert.equal(
    (await iniciarSesionCredenciales(medicoCrudo, medico.username, medico.password)).status,
    200
  );

  const pacienteExistente = ctx.pacientes[0];
  const cedulaExistente = pacienteExistente.cedula;
  const historiaExistente = ctx.historias[0];
  const menorCedula = `MEN${marca}`;
  const fechaInvalidaCedula = `BAD${marca}`;
  const duplicadaCedula = `DUP${marca}`;

  const antes = await contarPacientes(adminCrudo);
  const casos = [];
  const caso = (nombre, fn, esperados, verificar = null) => {
    casos.push({ nombre, fn, esperados, verificar });
  };

  // Autenticación y permisos
  caso('Sin sesión no puede listar pacientes', () => entorno.crearCliente({ crudo: true })('/api/patients'), [401]);
  caso('Sin sesión no puede crear pacientes', () =>
    entorno.crearCliente({ crudo: true })('/api/patients', {
      method: 'POST',
      body: datosPaciente(`ANON${marca}`, 'Anónimo', 'Sin Sesión'),
    }), [401]);
  caso('Contraseña incorrecta es rechazada', () =>
    iniciarSesionCredenciales(
      entorno.crearCliente({ crudo: true }),
      admin.username,
      'Incorrecta123'
    ), [401]);
  caso('Usuario inexistente es rechazado', () =>
    entorno.crearCliente({ crudo: true })('/api/auth/login', {
      method: 'POST',
      body: { username: 'no.existe', password: 'Clave1234' },
    }), [401]);
  caso('Nombre de usuario duplicado es rechazado', async () => {
    const username = `duplicado.${marca}`;
    const primero = await adminCrudo('/api/users', {
      method: 'POST',
      body: {
        nombre: 'Duplicado Uno',
        cedula: `UD1${marca}`,
        username,
        password: `Clave${marca}1`,
        rol: 'operador',
      },
    });
    assert.equal(primero.status, 201);
    return adminCrudo('/api/users', {
      method: 'POST',
      body: {
        nombre: 'Duplicado Dos',
        cedula: `UD2${marca}`,
        username,
        password: `OtraClave${marca}2`,
        rol: 'operador',
      },
    });
  }, [409]);
  caso('Dos usuarios pueden compartir la misma contraseña', async () => {
    const password = `Compartida${marca}1`;
    const uno = await adminCrudo('/api/users', {
      method: 'POST',
      body: {
        nombre: 'Clave Compartida Uno',
        cedula: `UC1${marca}`,
        username: `compartida.uno.${marca}`,
        password,
        rol: 'operador',
      },
    });
    const dos = await adminCrudo('/api/users', {
      method: 'POST',
      body: {
        nombre: 'Clave Compartida Dos',
        cedula: `UC2${marca}`,
        username: `compartida.dos.${marca}`,
        password,
        rol: 'operador',
      },
    });
    assert.equal(uno.status, 201);
    assert.equal(dos.status, 201);
    return { status: 201, datos: { uno: uno.datos, dos: dos.datos } };
  }, [201]);
  caso('Contraseña débil es rechazada', () =>
    adminCrudo('/api/users', {
      method: 'POST',
      body: {
        nombre: 'Clave Débil',
        cedula: `UW${marca}`,
        username: `debil.${marca}`,
        password: 'corta',
        rol: 'operador',
      },
    }), [400]);
  caso('Nombre de usuario inválido es rechazado', () =>
    adminCrudo('/api/users', {
      method: 'POST',
      body: {
        nombre: 'Usuario Inválido',
        cedula: `UI${marca}`,
        username: 'ab',
        password: `Clave${marca}1`,
        rol: 'operador',
      },
    }), [400]);
  caso('Lectura no puede crear pacientes', () =>
    lecturaCrudo('/api/patients', {
      method: 'POST',
      body: datosPaciente(`LEC${marca}`, 'Lectora', 'Sin Permiso'),
    }), [403]);
  caso('Operador no puede editar usuarios', () =>
    operadorCrudo(`/api/users/${encodeURIComponent(admin.id)}`, {
      method: 'PATCH',
      body: { nombre: 'Intento no autorizado' },
    }), [403]);

  // Pacientes
  caso('Paciente sin cédula', () =>
    adminCrudo('/api/patients', { method: 'POST', body: { nombres: 'Sin', apellidos: 'Cédula' } }), [400]);
  caso('Paciente sin nombres', () =>
    adminCrudo('/api/patients', {
      method: 'POST',
      body: { cedula: `SN${marca}`, apellidos: 'Sin Nombre' },
    }), [400]);
  caso('Paciente sin apellidos', () =>
    adminCrudo('/api/patients', {
      method: 'POST',
      body: { cedula: `SA${marca}`, nombres: 'Sin Apellido' },
    }), [400]);
  caso('Fecha de nacimiento inválida', () =>
    adminCrudo('/api/patients', {
      method: 'POST',
      body: datosPaciente(fechaInvalidaCedula, 'Fecha', 'Inválida', { fecha_nacimiento: '31-12-1990' }),
    }), [400]);
  caso('Cédula duplicada', () =>
    adminCrudo('/api/patients', {
      method: 'POST',
      body: datosPaciente(cedulaExistente, 'Duplicada', 'Existente'),
    }), [409]);
  caso('Menor de edad sin representante', () =>
    adminCrudo('/api/patients', {
      method: 'POST',
      body: datosPaciente(menorCedula, 'Menor', 'Sin Representante', { fecha_nacimiento: '2018-01-01' }),
    }), [400]);
  caso('Tildes, eñes y texto peligroso se conservan como texto', () =>
    adminCrudo('/api/patients', {
      method: 'POST',
      body: datosPaciente(`TIL${marca}`, 'María José <script>alert("x")</script>', 'Peña Ñandú', { sexo: 'Z' }),
    }), [201], async (respuesta) => {
      const id = respuesta.datos.id;
      const detalle = await adminCrudo(`/api/patients/${encodeURIComponent(id)}`);
      assert.equal(detalle.status, 200);
      assert.equal(detalle.datos.nombres, 'María José <script>alert("x")</script>');
      assert.equal(detalle.datos.apellidos, 'Peña Ñandú');
      assert.equal(detalle.datos.sexo, '', 'Un sexo inválido debe normalizarse, no guardarse');
    });
  caso('Nombres excesivamente largos se recortan', () =>
    adminCrudo('/api/patients', {
      method: 'POST',
      body: datosPaciente(`LAR${marca}`, 'A'.repeat(500), 'Recorte de Campo'),
    }), [201], async (respuesta) => {
      const detalle = await adminCrudo(`/api/patients/${encodeURIComponent(respuesta.datos.id)}`);
      assert.equal(detalle.status, 200);
      assert.equal(detalle.datos.nombres.length, 200, 'El nombre debe recortarse a 200 caracteres');
    });

  // Citas
  caso('Cita sin paciente', () =>
    adminCrudo('/api/appointments', {
      method: 'POST',
      body: { fechaHora: isoEnDias(330, 9, 0), motivo: 'Sin paciente' },
    }), [400]);
  caso('Cita con paciente inexistente', () =>
    adminCrudo('/api/appointments', {
      method: 'POST',
      body: { patientId: 'no-existe', fechaHora: isoEnDias(330, 9, 0), motivo: 'Paciente falso' },
    }), [400]);
  caso('Cita con fecha inválida', () =>
    adminCrudo('/api/appointments', {
      method: 'POST',
      body: { patientId: pacienteExistente.id, fechaHora: 'no-es-fecha', motivo: 'Fecha mala' },
    }), [400]);
  caso('Cita con duración menor al mínimo', () =>
    adminCrudo('/api/appointments', {
      method: 'POST',
      body: { patientId: pacienteExistente.id, fechaHora: isoEnDias(330, 9, 0), duracionMin: 1 },
    }), [400]);
  caso('Cita con duración excesiva', () =>
    adminCrudo('/api/appointments', {
      method: 'POST',
      body: { patientId: pacienteExistente.id, fechaHora: isoEnDias(330, 9, 0), duracionMin: 999 },
    }), [400]);
  caso('Cita con estado inventado', () =>
    adminCrudo('/api/appointments', {
      method: 'POST',
      body: { patientId: pacienteExistente.id, fechaHora: isoEnDias(330, 9, 0), estado: 'inventado' },
    }), [400]);
  caso('Cita con médico inexistente', () =>
    adminCrudo('/api/appointments', {
      method: 'POST',
      body: { patientId: pacienteExistente.id, medicoId: 'no-existe', fechaHora: isoEnDias(330, 9, 0) },
    }), [400]);

  // Historias clínicas
  caso('Historia sin cita', () => adminCrudo('/api/clinical-records', { method: 'POST', body: {} }), [404]);
  caso('Historia de cita inexistente', () =>
    adminCrudo('/api/clinical-records', { method: 'POST', body: { appointmentId: 'no-existe' } }), [404]);
  caso('Editar historia inexistente', () =>
    adminCrudo('/api/clinical-records/no-existe', { method: 'PATCH', body: { notas: 'x' } }), [404]);
  caso('Editar historia sin cambios', () =>
    adminCrudo(`/api/clinical-records/${encodeURIComponent(historiaExistente.id)}`, {
      method: 'PATCH',
      body: {},
    }), [400]);
  caso('Editar historia con fecha inválida', () =>
    adminCrudo(`/api/clinical-records/${encodeURIComponent(historiaExistente.id)}`, {
      method: 'PATCH',
      body: { fecha: 'no-es-fecha' },
    }), [400]);

  // Documentos
  caso('Documento sin paciente', () =>
    adminCrudo('/api/documents', { method: 'POST', body: { templateId: ctx.templateId } }), [400]);
  caso('Documento con plantilla inexistente', () =>
    adminCrudo('/api/documents', {
      method: 'POST',
      body: { patientId: pacienteExistente.id, templateId: 'no-existe' },
    }), [400]);
  caso('Documento con contenido vacío', () =>
    adminCrudo('/api/documents', {
      method: 'POST',
      body: { patientId: pacienteExistente.id, contenidoHtml: '<p> </p>' },
    }), [400]);
  caso('Documento inexistente', () => adminCrudo('/api/documents/no-existe'), [404]);
  caso('Paciente inexistente', () => adminCrudo('/api/patients/no-existe'), [404]);

  // Protocolo HTTP y seguridad
  caso('JSON malformado', () =>
    entorno.crearCliente({ crudo: true })('/api/auth/login', {
      method: 'POST',
      rawBody: '{"username":',
    }), [400]);
  caso('Content-Type incorrecto', () =>
    entorno.crearCliente({ crudo: true })('/api/auth/login', {
      method: 'POST',
      rawBody: JSON.stringify({ username: 'admin', password: '1234' }),
      contentType: 'text/plain',
    }), [415]);
  caso('Cuerpo mayor al límite permitido', () =>
    entorno.crearCliente({ crudo: true })('/api/auth/login', {
      method: 'POST',
      rawBody: 'x'.repeat(16 * 1024 * 1024 + 1024),
    }), [413]);
  caso('Búsqueda con intento de inyección SQL', () =>
    adminCrudo(`/api/patients?q=${encodeURIComponent("' OR 1=1 --")}`), [200], async (respuesta) => {
      assert.ok(Array.isArray(respuesta.datos), 'La búsqueda debe devolver una lista');
    });
  caso('Ruta estática fuera del directorio público', () =>
    entorno.crearCliente({ crudo: true })('/%2e%2e%2f%2e%2e%2fdata%2fsgcpm.db'), [404]);
  caso('Health público', () => entorno.crearCliente({ crudo: true })('/api/health'), [200]);

  // Concurrencia de validación: seis usuarios intentan la misma cédula.
  caso('Cédula duplicada concurrente (1 gana, 5 conflictos)', async () => {
    const intentos = await ejecutar(
      Array.from({ length: 6 }, () => () =>
        adminCrudo('/api/patients', {
          method: 'POST',
          body: datosPaciente(duplicadaCedula, 'Carrera', 'Duplicada'),
        })
      ),
      6
    );
    const creados = intentos.filter((r) => r.ok && r.valor.status === 201).length;
    const conflictos = intentos.filter((r) => r.ok && r.valor.status === 409).length;
    assert.equal(creados, 1, 'Solo una petición debe crear la cédula disputada');
    assert.equal(conflictos, 5, 'Las otras cinco deben recibir 409');
    return { status: 201, datos: { creados, conflictos } };
  }, [201]);

  const ejecucion = await ejecutar(
    casos.map((item) => async () => {
      const respuesta = await item.fn();
      assert.ok(
        item.esperados.includes(respuesta.status),
        `${item.nombre}: se esperaba ${item.esperados.join('/')} y llegó ${respuesta.status} ` +
          `${JSON.stringify(respuesta.datos)?.slice(0, 200)}`
      );
      if (item.verificar) await item.verificar(respuesta);
      return { nombre: item.nombre, status: respuesta.status };
    }),
    8
  );
  exigirSinFallos(ejecucion, 'Validación de información');

  const aceptados = ejecucion.filter(
    (r) => r.ok && r.valor.status >= 200 && r.valor.status < 300
  ).length;
  const rechazados = ejecucion.filter((r) => r.ok && r.valor.status >= 400).length;
  assert.equal(aceptados + rechazados, casos.length);
  assert.equal(ejecucion.filter((r) => r.ok && r.valor.status === 500).length, 0);

  const despues = await contarPacientes(adminCrudo);
  assert.equal(
    despues - antes,
    3,
    'Solo deben persistirse los 3 registros válidos (tildes, recorte y ganador de la carrera)'
  );

  const duplicadas = await adminCrudo(
    `/api/patients?cedula=${encodeURIComponent(duplicadaCedula)}&limit=50`
  );
  assert.equal(duplicadas.datos.length, 1, 'La cédula disputada debe existir una sola vez');

  const menor = await adminCrudo(`/api/patients?cedula=${encodeURIComponent(menorCedula)}&limit=50`);
  assert.equal(menor.datos.length, 0, 'El menor sin representante no debe persistirse');

  const fechaMala = await adminCrudo(
    `/api/patients?cedula=${encodeURIComponent(fechaInvalidaCedula)}&limit=50`
  );
  assert.equal(fechaMala.datos.length, 0, 'La fecha inválida no debe persistirse');

  const duplicadaExistente = await adminCrudo(
    `/api/patients?cedula=${encodeURIComponent(cedulaExistente)}&limit=50`
  );
  assert.equal(duplicadaExistente.datos.length, 1, 'La cédula existente no debe duplicarse');

  const salud = await fetch(`${entorno.base}/api/health`);
  assert.equal(salud.status, 200, 'El servidor debe seguir saludable tras las validaciones');

  return {
    casos: casos.length,
    aceptados,
    rechazados,
    pacientesAntes: antes,
    pacientesDespues: despues,
    delta: despues - antes,
  };
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

function imprimirResumen() {
  console.log('');
  console.log('RESULTADO DEL ESTRÉS');
  console.log('='.repeat(100));

  const carga = RESULTADOS.carga;
  if (carga) {
    const r = carga.resumen;
    console.log('FASE 1 · CARGA MÁXIMA SOSTENIDA');
    console.log(`  Usuarios conectados : ${USUARIOS}`);
    console.log(`  Duración            : ${(r.ms / 1000).toFixed(1)} s`);
    console.log(`  Operaciones         : ${r.total.toLocaleString('es-EC')}  (OK ${r.ok.toLocaleString('es-EC')} · errores ${r.fallos})`);
    console.log(`  Lecturas            : ${r.lecturas.toLocaleString('es-EC')}  (${r.rpsLectura.toFixed(0)} op/s)`);
    console.log(`  Escrituras          : ${r.escrituras.toLocaleString('es-EC')}  (${r.rpsEscritura.toFixed(0)} op/s)`);
    console.log(`  Rendimiento         : ${r.rps.toFixed(0)} op/s`);
    console.log(`  Latencia            : p50 ${r.p50.toFixed(0)} ms · p95 ${r.p95.toFixed(0)} ms · p99 ${r.p99.toFixed(0)} ms · máx ${r.max.toFixed(0)} ms`);
    console.log(`  Ops por segundo     : ${r.porSegundo.join(' ')}`);
    console.log(
      `  Datos generados     : ${carga.generado.pacientes} pacientes · ${carga.generado.citas} citas · ` +
        `${carga.generado.certificados} certificados · ${carga.generado.ediciones} ediciones`
    );
    console.log(`  Códigos únicos      : ${carga.codigos}`);
    console.log(`  Base de datos       : ${(carga.dbBytes / 1024 / 1024).toFixed(2)} MB`);
    console.log('  Integridad          : IDs únicos, muestras verificadas, salud 200');
    console.log('');
  }

  const sync = RESULTADOS.sync;
  if (sync) {
    console.log('FASE 2 · SINCRONIZACIÓN LOCAL MULTI-CLIENTE');
    for (const propagacion of sync.propagaciones) {
      console.log(
        `  ${propagacion.nombre.padEnd(20)} visible para ${propagacion.ok}/${propagacion.total} clientes · p95 ${propagacion.p95.toFixed(0)} ms · máx ${propagacion.max.toFixed(0)} ms`
      );
    }
    console.log(`  Total consistente    : ${sync.totalConsistente} pacientes (mismo valor en 12 clientes)`);
    console.log(
      `  Sesión única (SSE)   : cierre por “${sync.sesionUnica.evento}” en ${sync.sesionUnica.ms.toFixed(0)} ms · ` +
        `anterior ${sync.sesionUnica.anterior} · nueva ${sync.sesionUnica.nueva}`
    );
    console.log('');
  }

  const validacion = RESULTADOS.validacion;
  if (validacion) {
    console.log('FASE 3 · VALIDACIÓN DE INFORMACIÓN');
    console.log(`  Casos ejecutados    : ${validacion.casos}`);
    console.log(`  Respuestas 2xx      : ${validacion.aceptados}`);
    console.log(`  Rechazos 4xx        : ${validacion.rechazados}`);
    console.log(`  Error 500           : 0`);
    console.log(
      `  Pacientes           : ${validacion.pacientesAntes} → ${validacion.pacientesDespues} (delta ${validacion.delta}, esperado 3)`
    );
    console.log('  Integridad          : duplicados 1 · menores inválidos 0 · fechas inválidas 0 · salud 200');
    console.log('');
  }

  const fallos = RESULTADOS.fallos || [];
  console.log('='.repeat(100));
  if (!fallos.length) {
    console.log('VEREDICTO: el sistema superó las tres fases de estrés sin pérdida de datos.');
  } else {
    console.log('VEREDICTO: se encontraron problemas:');
    for (const fallo of fallos) console.log(`  · ${fallo}`);
  }
  console.log('');
}

async function main() {
  let entorno = null;

  try {
    entorno = await crearEntornoE2E();
    console.log('');
    console.log('ISIM · Prueba de estrés máximo');
    console.log(`Servidor aislado: ${entorno.base}`);
    console.log(`Configuración: ${USUARIOS} usuarios · ${SEGUNDOS} s de carga · ${LECTORES_SYNC} lectores de sincronización`);
    console.log('');

    const admin = entorno.crearCliente();
    await entorno.iniciarSesion(admin, 'admin', '54321');
    const adminSesion = await admin('/api/auth/me');
    const marca = String(Date.now()).slice(-6);

    console.log('Preparando usuarios y datos base…');
    const creados = await crearUsuariosDeCarga(entorno, admin, marca);
    const base = await prepararBase(admin, creados.usuarios, marca);
    const ctx = {
      ...base,
      creados: { pacientes: [], citas: [], certificados: [], ediciones: [] },
    };
    console.log(`Datos base listos en ${(creados.ms / 1000).toFixed(1)} s.`);
    console.log('');

    try {
      RESULTADOS.carga = await faseCarga(entorno, admin, creados.usuarios, ctx);
    } catch (error) {
      RESULTADOS.fallos = RESULTADOS.fallos || [];
      RESULTADOS.fallos.push(`Fase 1 (carga): ${error.message}`);
    }

    try {
      RESULTADOS.sync = await faseSincronizacion(entorno, admin, creados.usuarios, ctx);
    } catch (error) {
      RESULTADOS.fallos = RESULTADOS.fallos || [];
      RESULTADOS.fallos.push(`Fase 2 (sincronización): ${error.message}`);
    }

    try {
      RESULTADOS.validacion = await faseValidacion(entorno, adminSesion, creados.usuarios, ctx);
    } catch (error) {
      RESULTADOS.fallos = RESULTADOS.fallos || [];
      RESULTADOS.fallos.push(`Fase 3 (validación): ${error.message}`);
    }

    imprimirResumen();
  } catch (error) {
    RESULTADOS.fallos = RESULTADOS.fallos || [];
    RESULTADOS.fallos.push(error.message);
    console.error('');
    console.error('ESTRÉS FALLÓ:', error.message);
    if (entorno) {
      const log = entorno.obtenerLog();
      if (log) {
        console.error('');
        console.error('--- últimas líneas del servidor ---');
        console.error(log.split(/\r?\n/).slice(-40).join('\n'));
      }
    }
    imprimirResumen();
  } finally {
    if (RESULTADOS.fallos?.length) process.exitCode = 1;
    await entorno?.limpiar(ARCHIVOS_FIRMA);
  }
}

await main();
