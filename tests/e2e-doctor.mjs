import assert from 'node:assert/strict';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

let entorno = null;

try {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  const doctor = entorno.crearCliente();
  const stamp = Date.now();
  const sufijo = String(stamp).slice(-8);
  const usernameDoctor = `doctor.${sufijo}`;
  const passwordDoctor = `Doctor${sufijo}1`;

  await entorno.iniciarSesion(admin, 'admin', '54321');
  console.log('✓ Administrador autenticado');

  const nuevoDoctor = await admin('/api/users', {
    method: 'POST',
    body: {
      nombre: `Dra. E2E ${sufijo}`,
      cedula: `DOCE2E${sufijo}`,
      username: usernameDoctor,
      password: passwordDoctor,
      rol: 'medico',
      especialidad: 'Ginecología y obstetricia E2E',
      senecit: `E2E-${sufijo}`,
    },
  });
  assert.ok(nuevoDoctor.id, 'El médico debe crearse con id');
  console.log(`✓ Médico creado: ${nuevoDoctor.id}`);

  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `PACE2E${sufijo}`,
      nombres: 'PACIENTE',
      apellidos: 'CERTIFICADO E2E',
      fecha_nacimiento: '1991-06-20',
      sexo: 'F',
      telefono: '0988888888',
      email: `paciente-doctor-${stamp}@isim.local`,
      direccion: 'Dirección E2E médico',
      ocupacion: 'Prueba',
      estado_civil: 'Soltera/o',
      ciudad: 'Riobamba',
    },
  });
  assert.ok(paciente.id);
  console.log(`✓ Paciente creada: ${paciente.id}`);

  const fechaCita = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
  fechaCita.setUTCHours(16, 0, 0, 0);

  const cita = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      medicoId: nuevoDoctor.id,
      fechaHora: fechaCita.toISOString(),
      duracionMin: 30,
      motivo: 'Consulta para certificado E2E',
      estado: 'programada',
    },
  });
  assert.ok(cita.id);
  console.log(`✓ Cita asignada al nuevo médico: ${cita.id}`);

  await entorno.iniciarSesion(doctor, usernameDoctor, passwordDoctor);
  const sesionDoctor = await doctor('/api/auth/me');
  assert.equal(sesionDoctor.id, nuevoDoctor.id);
  assert.equal(sesionDoctor.rol, 'medico');
  assert.equal(sesionDoctor.username, usernameDoctor);
  console.log('✓ Médico autenticado con su propio usuario y contraseña');

  const inicio = await doctor(
    `/api/appointments/${encodeURIComponent(cita.id)}/start-consultation`,
    { method: 'POST' }
  );
  assert.ok(inicio.recordId);
  console.log(`✓ Consulta iniciada por el médico: ${inicio.recordId}`);

  const diagnostico = `Diagnóstico certificado E2E ${stamp}`;
  await doctor(`/api/clinical-records/${encodeURIComponent(inicio.recordId)}`, {
    method: 'PATCH',
    body: {
      motivoConsulta: 'Valoración para certificado',
      notas: 'Evolución satisfactoria.',
      diagnostico,
      tratamiento: 'Tratamiento E2E',
      indicaciones: 'Indicaciones E2E',
      recomendaciones: 'Recomendaciones E2E',
    },
  });

  await doctor(
    `/api/appointments/${encodeURIComponent(cita.id)}/finish-consultation`,
    { method: 'POST' }
  );
  console.log('✓ Consulta finalizada por el médico');

  const plantillas = await doctor('/api/templates');
  const plantilla = plantillas.find((item) => item.nombre === 'Certificado médico');
  assert.ok(plantilla, 'Debe existir la plantilla Certificado médico');

  const documento = await doctor('/api/documents', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      templateId: plantilla.id,
      titulo: `Certificado médico E2E — ${sufijo}`,
    },
  });
  assert.ok(documento.id);
  console.log(`✓ Certificado emitido por el médico: ${documento.id}`);

  const detalle = await doctor(`/api/documents/${encodeURIComponent(documento.id)}`);
  assert.equal(detalle.estado, 'firmado');
  assert.equal(detalle.firmaModo, 'medico');
  assert.equal(detalle.requiereFirmaPaciente, false);
  assert.equal(detalle.medico?.id, nuevoDoctor.id);
  assert.ok(detalle.versiones?.[0]?.contenido_html?.includes('CERTIFICADO MÉDICO'));
  assert.ok(detalle.versiones?.[0]?.contenido_html?.includes('SELLO DE RECEPCIÓN'));

  const registros = await doctor(
    `/api/clinical-records?patientId=${encodeURIComponent(paciente.id)}`
  );
  assert.equal(registros.length, 1);
  assert.equal(registros[0].diagnostico, diagnostico);

  const detalleCita = await doctor(`/api/appointments/${encodeURIComponent(cita.id)}`);
  assert.equal(detalleCita.estado, 'atendida');
  assert.equal(detalleCita.medico_id, nuevoDoctor.id);

  const documentos = await doctor(
    `/api/patients/${encodeURIComponent(paciente.id)}/documents`
  );
  assert.ok(documentos.some((item) => item.id === documento.id));

  console.log('✓ Certificado asociado al nuevo médico y a la paciente');
  console.log('');
  console.log('E2E CON MÉDICO NUEVO COMPLETADO');
  console.log(
    JSON.stringify(
      {
        medico: nuevoDoctor.id,
        paciente: paciente.id,
        cita: cita.id,
        consulta: inicio.recordId,
        documento: documento.id,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('');
  console.error('E2E CON MÉDICO NUEVO FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('');
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-40).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await entorno?.limpiar();
}
