import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stamp = Date.now();
const port = 3200 + Math.floor(Math.random() * 700);
const httpsPort = port + 1;
const dbFile = resolve(root, 'data', `e2e-${stamp}.db`);
const base = `http://127.0.0.1:${port}`;

let cookie = '';
let child = null;
let log = '';
let documentoId = null;
let medicoFirmaPath = null;

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function esperarServidor() {
  for (let intento = 0; intento < 80; intento += 1) {
    if (child.exitCode !== null) {
      throw new Error(`El servidor de prueba terminó antes de iniciar.\n${log.slice(-3000)}`);
    }
    try {
      const respuesta = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(800),
      });
      if (respuesta.ok) return;
    } catch {
      // todavía no responde
    }
    await dormir(200);
  }
  throw new Error(`El servidor de prueba no respondió en el puerto ${port}.\n${log.slice(-3000)}`);
}

async function req(ruta, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;

  const respuesta = await fetch(`${base}${ruta}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const cookies = respuesta.headers.getSetCookie?.() || [];
  if (cookies.length) {
    cookie = cookies.map((valor) => valor.split(';')[0]).join('; ');
  }

  const texto = await respuesta.text();
  let datos = texto;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    // respuesta no JSON
  }

  if (!respuesta.ok) {
    const mensaje =
      datos && typeof datos === 'object' && datos.error ? datos.error : texto;
    throw new Error(`${method} ${ruta} → ${respuesta.status}: ${mensaje}`);
  }
  return datos;
}

async function detenerServidor() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  for (let intento = 0; intento < 20; intento += 1) {
    if (child.exitCode !== null) return;
    await dormir(100);
  }
  child.kill('SIGKILL');
}

async function limpiar() {
  await detenerServidor();

  if (medicoFirmaPath) {
    const archivo = resolve(root, 'data', medicoFirmaPath);
    if (existsSync(archivo)) rmSync(archivo, { force: true });
  }

  for (const archivo of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    if (existsSync(archivo)) rmSync(archivo, { force: true });
  }
}

async function main() {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      DB_FILE: dbFile,
      HOST: '127.0.0.1',
      PORT: String(port),
      HTTPS_PORT: String(httpsPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (bloque) => {
    log += bloque.toString();
  });
  child.stderr.on('data', (bloque) => {
    log += bloque.toString();
  });

  await esperarServidor();
  console.log(`Servidor de prueba: ${base}`);

  const versionPublica = await req('/api/version');
  assert.ok(versionPublica.version, 'Debe existir una versión pública');
  assert.ok(versionPublica.buildId, 'Debe existir un identificador de compilación');
  assert.equal(typeof versionPublica.actualizacionesAutomaticas, 'boolean');

  const health = await req('/api/health');
  assert.equal(health.version, versionPublica.version, 'Health debe informar la versión');
  assert.ok(health.ok);
  console.log(`✓ Versión pública: v${versionPublica.version} (${versionPublica.buildId})`);

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: '54321' },
  });
  assert.ok(login.nombre, 'El login debe devolver el usuario');
  console.log(`✓ Autenticación como ${login.nombre}`);

  const ajustes = await req('/api/settings');
  assert.equal(ajustes.version, versionPublica.version);
  assert.equal(ajustes.buildId, versionPublica.buildId);
  await req('/api/settings/actualizaciones', {
    method: 'POST',
    body: { automaticas: true },
  });
  assert.equal((await req('/api/version')).actualizacionesAutomaticas, true);
  await req('/api/settings/actualizaciones', {
    method: 'POST',
    body: { automaticas: false },
  });
  assert.equal((await req('/api/version')).actualizacionesAutomaticas, false);
  console.log('✓ Preferencia de actualizaciones verificada');

  const sufijo = String(stamp).slice(-9);
  const paciente = await req('/api/patients', {
    method: 'POST',
    body: {
      cedula: `E2E${sufijo}`,
      nombres: 'PRUEBA',
      apellidos: 'AUTOMATICA E2E',
      fecha_nacimiento: '1990-05-15',
      sexo: 'F',
      telefono: '0999999999',
      email: `e2e-${stamp}@isim.local`,
      direccion: 'Dirección de prueba E2E',
      ocupacion: 'Prueba automatizada',
      estado_civil: 'Soltera/o',
      ciudad: 'Riobamba',
    },
  });
  assert.ok(paciente.id, 'La paciente debe crearse con id');
  console.log(`✓ Paciente creada: ${paciente.id}`);

  const fechaCita = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  fechaCita.setUTCHours(15, 0, 0, 0);

  const cita = await req('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      fechaHora: fechaCita.toISOString(),
      duracionMin: 30,
      motivo: 'Consulta E2E',
      estado: 'programada',
    },
  });
  assert.ok(cita.id, 'La cita debe crearse con id');
  console.log(`✓ Cita agendada: ${cita.id}`);

  const inicio = await req(`/api/appointments/${encodeURIComponent(cita.id)}/start-consultation`, {
    method: 'POST',
  });
  assert.ok(inicio.recordId, 'La consulta debe devolver recordId');
  console.log(`✓ Consulta iniciada: ${inicio.recordId}`);

  const diagnostico = `Diagnóstico E2E ${stamp}`;
  await req(`/api/clinical-records/${encodeURIComponent(inicio.recordId)}`, {
    method: 'PATCH',
    body: {
      motivoConsulta: 'Motivo de consulta E2E',
      notas: 'Notas de evolución E2E',
      diagnostico,
      tratamiento: 'Tratamiento E2E',
      receta: 'Receta E2E',
      indicaciones: 'Indicaciones E2E',
      recomendaciones: 'Recomendaciones E2E',
    },
  });
  console.log('✓ Campos de la consulta actualizados');

  await req(`/api/appointments/${encodeURIComponent(cita.id)}/finish-consultation`, {
    method: 'POST',
  });
  console.log('✓ Consulta finalizada');

  const plantillas = await req('/api/templates');
  const plantilla = plantillas.find((item) => item.nombre === 'Certificado médico');
  assert.ok(plantilla, 'Debe existir la plantilla “Certificado médico”');

  const documento = await req('/api/documents', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      templateId: plantilla.id,
      titulo: 'Certificado médico E2E',
    },
  });
  documentoId = documento.id;
  assert.ok(documento.id, 'El certificado debe crearse con id');

  const detalleDocumento = await req(`/api/documents/${encodeURIComponent(documento.id)}`);
  assert.equal(detalleDocumento.estado, 'firmado');
  assert.equal(detalleDocumento.firmaModo, 'medico');
  assert.equal(detalleDocumento.requiereFirmaPaciente, false);

  const html = detalleDocumento.versiones?.[0]?.contenido_html || '';
  assert.ok(html.includes('CERTIFICADO MÉDICO'), 'El certificado debe tener su título');
  assert.ok(html.includes('SELLO DE RECEPCIÓN'), 'El certificado debe incluir el sello');
  assert.ok(html.includes('PRUEBA AUTOMATICA E2E'), 'El certificado debe incluir a la paciente');
  assert.match(html, /a las \d{2}:\d{2}/, 'El certificado debe incluir la hora de emisión');
  medicoFirmaPath = detalleDocumento.medico_firma_path || null;
  console.log(`✓ Certificado emitido y firmado: ${documento.id}`);

  const registros = await req(`/api/clinical-records?patientId=${encodeURIComponent(paciente.id)}`);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].id, inicio.recordId);
  assert.equal(registros[0].diagnostico, diagnostico);
  assert.equal(registros[0].cita_estado, 'atendida');

  const carpetas = await req(
    `/api/clinical-history/patients?q=${encodeURIComponent(`E2E${sufijo}`)}`
  );
  const carpeta = carpetas.find((item) => item.id === paciente.id);
  assert.ok(carpeta, 'La paciente debe aparecer en historias clínicas');
  assert.ok(carpeta.total_historias >= 1);
  assert.ok(carpeta.total_citas >= 1);

  const detalleCita = await req(`/api/appointments/${encodeURIComponent(cita.id)}`);
  assert.equal(detalleCita.estado, 'atendida');
  assert.equal(detalleCita.historia?.id, inicio.recordId);

  const documentosPaciente = await req(
    `/api/patients/${encodeURIComponent(paciente.id)}/documents`
  );
  assert.ok(
    documentosPaciente.some((item) => item.id === documento.id),
    'El certificado debe aparecer en los documentos de la paciente'
  );

  console.log('✓ Historia clínica consultada correctamente');
  console.log('✓ Documentos de la paciente verificados');
  console.log('');
  console.log('E2E COMPLETADO');
  console.log(
    JSON.stringify(
      {
        paciente: paciente.id,
        cita: cita.id,
        consulta: inicio.recordId,
        documento: documento.id,
        estadoCita: detalleCita.estado,
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
  console.error('E2E FALLÓ:', error.message);
  if (log) {
    console.error('');
    console.error('--- últimas líneas del servidor ---');
    console.error(log.split(/\r?\n/).slice(-40).join('\n'));
  }
  process.exitCode = 1;
} finally {
  await limpiar();
}
