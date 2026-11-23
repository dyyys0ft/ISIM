import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de carga con exámenes y archivos.
 *
 * Crea 60 citas, cada una con 5 exámenes y 2 adjuntos por examén (600 archivos),
 * emulando imágenes PDF/PNG reales. Verifica rutas, bytes, hashes, límites,
 * descargas y limpieza.
 */

const CITAS = 60;
const EXAMENES_POR_CITA = 5;
const ARCHIVOS_POR_EXAMEN = 2;
const SELLO = String(Date.now()).slice(-8);
const DATA_DIR_ANTERIOR = process.env.DATA_DIR;
const DATA_DIR = resolve(process.cwd(), 'data', `e2e-archivos-${SELLO}`);
process.env.DATA_DIR = DATA_DIR;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  'utf8'
);

let entorno = null;

function urlDe(mime, buffer) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function ejecutar(tareas, limite = 20) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;

  async function trabajador() {
    for (;;) {
      const indice = siguiente;
      siguiente += 1;
      if (indice >= tareas.length) return;
      const t0 = performance.now();
      try {
        resultados[indice] = {
          ok: true,
          valor: await tareas[indice](),
          ms: performance.now() - t0,
        };
      } catch (error) {
        resultados[indice] = { ok: false, error, ms: performance.now() - t0 };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limite, tareas.length)) }, () => trabajador())
  );

  const fallos = resultados.filter((resultado) => !resultado.ok);
  if (fallos.length) {
    throw new Error(
      `${fallos.length}/${resultados.length} operaciones fallaron: ${fallos
        .slice(0, 6)
        .map((f) => f.error.message)
        .join(' | ')}`
    );
  }
  return resultados;
}

function fechaCita(indice) {
  const dia = 10 + Math.floor(indice / 24);
  const slot = indice % 24;
  const hora = 7 + Math.floor(slot / 2);
  const minuto = slot % 2 === 0 ? 0 : 30;
  return new Date(Date.UTC(2026, 10, dia, hora, minuto, 0)).toISOString();
}

async function main() {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);
  console.log(`Directorio de archivos: ${DATA_DIR}`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  // 1. Pacientes y citas.
  const pacientes = (
    await ejecutar(
      Array.from({ length: CITAS }, (_, i) => () =>
        admin('/api/patients', {
          method: 'POST',
          body: {
            cedula: `EX${String(i).padStart(3, '0')}${SELLO}`,
            nombres: `Paciente examen ${i + 1}`,
            apellidos: 'PRUEBA CARGA',
            fecha_nacimiento: '1990-04-12',
            sexo: 'F',
            telefono: `0998${String(i).padStart(6, '0')}`.slice(0, 10),
            email: `examen-${i}-${SELLO}@isim.local`,
          },
        })
      ),
      10
    )
  ).map((resultado) => resultado.valor);

  const citas = (
    await ejecutar(
      pacientes.map((paciente, i) => () =>
        admin('/api/appointments', {
          method: 'POST',
          body: {
            patientId: paciente.id,
            fechaHora: fechaCita(i),
            duracionMin: 30,
            motivo: `Cita exámenes ${i + 1}`,
            estado: 'programada',
          },
        })
      ),
      10
    )
  ).map((resultado) => resultado.valor);

  const historias = (
    await ejecutar(
      citas.map((cita, i) => () =>
        admin('/api/clinical-records', {
          method: 'POST',
          body: {
            appointmentId: cita.id,
            motivoConsulta: `Estudio de carga ${i + 1}`,
            notas: 'Cita con múltiples exámenes y archivos',
          },
        })
      ),
      10
    )
  ).map((resultado) => resultado.valor);

  console.log(
    `✓ ${pacientes.length} pacientes · ${citas.length} citas · ${historias.length} historias`
  );

  // 2. Exámenes: 5 por cita.
  const tipos = ['clinico', 'laboratorio', 'imagen', 'otro', 'clinico'];
  const tareasExamenes = [];
  for (let h = 0; h < historias.length; h += 1) {
    for (let e = 0; e < EXAMENES_POR_CITA; e += 1) {
      tareasExamenes.push(() =>
        admin(`/api/clinical-records/${encodeURIComponent(historias[h].id)}/exams`, {
          method: 'POST',
          body: {
            nombre: `Examen ${h + 1}-${e + 1}`,
            tipo: tipos[e],
            descripcion: `Examen de prueba ${h + 1}-${e + 1}`,
            observaciones: `Observación ${h + 1}-${e + 1}`,
            estado: 'solicitado',
          },
        })
      );
    }
  }

  const examenes = (
    await ejecutar(tareasExamenes, 20)
  ).map((resultado) => resultado.valor);
  assert.equal(examenes.length, CITAS * EXAMENES_POR_CITA);
  console.log(`✓ ${examenes.length} exámenes creados`);

  // 3. Adjuntos: 2 por examén (PNG + PDF) = 600 archivos.
  const tareasArchivos = [];
  const esperados = new Map();
  const examenesPorHistoria = new Map();

  for (let e = 0; e < examenes.length; e += 1) {
    const examen = examenes[e];
    const historiaIndice = Math.floor(e / EXAMENES_POR_CITA);
    if (!examenesPorHistoria.has(historiaIndice)) {
      examenesPorHistoria.set(historiaIndice, []);
    }
    examenesPorHistoria.get(historiaIndice).push(examen.id);

    for (let a = 0; a < ARCHIVOS_POR_EXAMEN; a += 1) {
      const esPng = a === 0;
      const mime = esPng ? 'image/png' : 'application/pdf';
      const buffer = esPng ? PNG_1X1 : PDF_MINIMO;
      const nombre = `archivo-${e + 1}-${a + 1}.${esPng ? 'png' : 'pdf'}`;
      const historiaId = historias[historiaIndice].id;

      tareasArchivos.push(() =>
        admin(`/api/clinical-records/${encodeURIComponent(historiaId)}/attachments`, {
          method: 'POST',
          body: {
            examId: examen.id,
            nombre,
            data: urlDe(mime, buffer),
          },
        })
      );
    }
  }

  const inicioAdjuntos = performance.now();
  const resultadosArchivos = await ejecutar(tareasArchivos, 25);
  const duracionAdjuntos = performance.now() - inicioAdjuntos;

  for (const resultado of resultadosArchivos) {
    const datos = resultado.valor;
    const esPng = datos.mime === 'image/png';
    esperados.set(datos.id, {
      ...datos,
      buffer: esPng ? PNG_1X1 : PDF_MINIMO,
      hash: sha256(esPng ? PNG_1X1 : PDF_MINIMO),
    });
  }

  assert.equal(esperados.size, CITAS * EXAMENES_POR_CITA * ARCHIVOS_POR_EXAMEN);
  console.log(
    `✓ ${esperados.size} archivos subidos en ${(duracionAdjuntos / 1000).toFixed(1)} s ` +
      `(${(esperados.size / (duracionAdjuntos / 1000)).toFixed(0)} archivos/s)`
  );

  // 4. Verificación en base y en disco.
  const db = new DatabaseSync(entorno.dbFile, { readOnly: true });
  const conteos = {
    pacientes: db.prepare('SELECT COUNT(*) AS n FROM patients').get().n,
    citas: db.prepare('SELECT COUNT(*) AS n FROM appointments').get().n,
    historias: db.prepare('SELECT COUNT(*) AS n FROM clinical_records').get().n,
    examenes: db.prepare('SELECT COUNT(*) AS n FROM clinical_exams').get().n,
    adjuntos: db.prepare('SELECT COUNT(*) AS n FROM clinical_attachments').get().n,
  };

  assert.equal(conteos.citas, CITAS);
  assert.equal(conteos.historias, CITAS);
  assert.equal(conteos.examenes, CITAS * EXAMENES_POR_CITA);
  assert.equal(conteos.adjuntos, esperados.size);

  const filasAdjuntos = db.prepare('SELECT * FROM clinical_attachments').all();
  for (const fila of filasAdjuntos) {
    const esperado = esperados.get(fila.id);
    assert.ok(esperado, `Adjunto ${fila.id} no esperado`);
    assert.equal(fila.nombre, esperado.nombre);
    assert.equal(fila.mime, esperado.mime);
    assert.equal(fila.tamano, esperado.buffer.length);
    assert.equal(fila.hash, esperado.hash);
    assert.match(fila.ruta, /^historias\/[a-zA-Z0-9_-]{2}\//);

    const absoluta = resolve(DATA_DIR, fila.ruta);
    assert.ok(existsSync(absoluta), `No existe el archivo ${fila.ruta}`);
    assert.deepEqual(readFileSync(absoluta), esperado.buffer);
  }

  const porPaciente = new Map();
  for (const fila of filasAdjuntos) {
    porPaciente.set(fila.patient_id, (porPaciente.get(fila.patient_id) || 0) + 1);
  }
  assert.equal(porPaciente.size, CITAS);
  for (const total of porPaciente.values()) {
    assert.equal(total, EXAMENES_POR_CITA * ARCHIVOS_POR_EXAMEN);
  }

  const examenesRecibidos = db
    .prepare("SELECT COUNT(*) AS n FROM clinical_exams WHERE estado = 'recibido'")
    .get().n;
  assert.equal(examenesRecibidos, examenes.length);
  db.close();

  console.log('✓ Base y disco coinciden: 300 exámenes, 600 archivos con hash y bytes correctos');

  // 5. Una cita orquesta todos sus archivos y se descargan por API.
  const historiaPrincipal = historias[0];
  const detalle = await admin(
    `/api/clinical-records?patientId=${encodeURIComponent(pacientes[0].id)}`
  );
  assert.equal(detalle.length, 1);
  assert.equal(detalle[0].examenes.length, EXAMENES_POR_CITA);
  assert.equal(detalle[0].examenes[0].observaciones, 'Observación 1-1');
  assert.ok(detalle[0].appointment_id, 'La consulta debe conservar su cita');
  assert.ok(detalle[0].cita_fecha, 'La consulta debe devolver la fecha de la cita');
  assert.ok(
    detalle[0].examenes.every((examen) => examen.record_id === historiaPrincipal.id),
    'Cada examen debe pertenecer a la consulta de la cita'
  );
  assert.equal(
    detalle[0].examenes.reduce((total, examen) => total + examen.adjuntos.length, 0),
    EXAMENES_POR_CITA * ARCHIVOS_POR_EXAMEN
  );

  const idsPrincipales = [...esperados.keys()].filter((id) =>
    filasAdjuntos.some(
      (fila) => fila.id === id && fila.patient_id === pacientes[0].id
    )
  );
  assert.equal(idsPrincipales.length, EXAMENES_POR_CITA * ARCHIVOS_POR_EXAMEN);

  for (const id of idsPrincipales) {
    const respuesta = await fetch(
      `${entorno.base}/api/clinical-attachments/${encodeURIComponent(id)}/file`,
      { headers: { cookie: admin.cookieActual() } }
    );
    assert.equal(respuesta.status, 200);
    const descargado = Buffer.from(await respuesta.arrayBuffer());
    assert.deepEqual(descargado, esperados.get(id).buffer);
    assert.equal(
      respuesta.headers.get('content-type'),
      esperados.get(id).mime
    );
  }
  console.log('✓ Cita principal: 5 exámenes y 10 archivos descargados y verificados');

  // 6. Límite de documentos por paciente (11º archivo rechazado).
  const raw = entorno.crearCliente({ crudo: true });
  const loginRaw = await raw('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: '54321' },
  });
  assert.equal(loginRaw.status, 200, 'El administrador debe iniciar sesión');
  const examenPrincipal = examenesPorHistoria.get(0)[0];
  const exceso = await raw(
    `/api/clinical-records/${encodeURIComponent(historiaPrincipal.id)}/attachments`,
    {
      method: 'POST',
      body: {
        examId: examenPrincipal,
        nombre: 'archivo-excedente.png',
        data: urlDe('image/png', PNG_1X1),
      },
    }
  );
  assert.equal(exceso.status, 409);
  assert.match(String(exceso.datos.error), /10 documentos/);

  // 7. Validación de archivos inválidos en una paciente sin documentos.
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const pacienteInvalido = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `INV${SELLO}`,
      nombres: 'Paciente inválidos',
      apellidos: 'PRUEBA ARCHIVOS',
      fecha_nacimiento: '1992-02-10',
      sexo: 'F',
    },
  });
  const citaInvalida = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: pacienteInvalido.id,
      fechaHora: fechaCita(CITAS + 1),
      duracionMin: 30,
      motivo: 'Cita pruebas de archivos inválidos',
      estado: 'programada',
    },
  });
  const historiaInvalida = await admin('/api/clinical-records', {
    method: 'POST',
    body: { appointmentId: citaInvalida.id, motivoConsulta: 'Validación de adjuntos' },
  });
  const examenInvalido = await admin(
    `/api/clinical-records/${encodeURIComponent(historiaInvalida.id)}/exams`,
    {
      method: 'POST',
      body: { nombre: 'Examen para archivos inválidos', tipo: 'clinico' },
    }
  );
  const baseSegundo = `/api/clinical-records/${encodeURIComponent(
    historiaInvalida.id
  )}/attachments`;
  const examenSegundo = examenInvalido.id;
  const casosInvalidos = [
    ['base64 inválido', { examId: examenSegundo, nombre: 'mal.png', data: 'no-es-base64' }],
    ['mime no permitido', { examId: examenSegundo, nombre: 'mal.txt', data: urlDe('text/plain', PDF_MINIMO) }],
    [
      'PNG corrupto',
      {
        examId: examenSegundo,
        nombre: 'corrupto.png',
        data: urlDe('image/png', Buffer.from('no es un png')),
      },
    ],
    ['sin examen', { nombre: 'sin-examen.png', data: urlDe('image/png', PNG_1X1) }],
  ];

  for (const [etiqueta, cuerpo] of casosInvalidos) {
    let error = null;
    try {
      await admin(baseSegundo, { method: 'POST', body: cuerpo });
    } catch (fallo) {
      error = fallo;
    }
    assert.ok(error, `${etiqueta} debía fallar`);
    assert.match(error.message, /→ 400:/, `${etiqueta}: ${error.message}`);
  }

  // 8. Eliminación de un archivo y liberación del cupo.
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const idAEliminar = idsPrincipales[0];
  const filaEliminada = filasAdjuntos.find((fila) => fila.id === idAEliminar);
  const eliminado = await admin(
    `/api/clinical-attachments/${encodeURIComponent(idAEliminar)}`,
    { method: 'DELETE' }
  );
  assert.equal(eliminado.ok !== false, true);
  assert.equal(existsSync(resolve(DATA_DIR, filaEliminada.ruta)), false);

  const db2 = new DatabaseSync(entorno.dbFile, { readOnly: true });
  assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM clinical_attachments').get().n, esperados.size - 1);
  db2.close();

  const salud = await fetch(`${entorno.base}/api/health`);
  assert.equal(salud.status, 200);

  console.log('');
  console.log('E2E DE EXÁMENES Y ARCHIVOS COMPLETADO');
  console.log(
    JSON.stringify(
      {
        citas: CITAS,
        examenesPorCita: EXAMENES_POR_CITA,
        archivosPorExamen: ARCHIVOS_POR_EXAMEN,
        examenes: examenes.length,
        archivos: esperados.size,
        archivosPorSegundo: Math.round(esperados.size / (duracionAdjuntos / 1000)),
        descargasVerificadas: idsPrincipales.length,
        limitePorPaciente: '10 (11º rechazado)',
        archivosInvalidosRechazados: casosInvalidos.length,
        eliminacionVerificada: true,
      },
      null,
      2
    )
  );
}

try {
  await main();
} catch (error) {
  console.error('');
  console.error('E2E DE EXÁMENES Y ARCHIVOS FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-50).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await entorno?.limpiar();
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  if (DATA_DIR_ANTERIOR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = DATA_DIR_ANTERIOR;
}
