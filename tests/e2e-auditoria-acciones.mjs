import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';
import { crearBitacoraAcciones } from './lib/auditoria-e2e.mjs';

/**
 * E2E de auditoría:
 * cada paso declara sus acciones esperadas y, al final, se verifica el reporte
 * de actividad de cada usuario y la tabla visible del reporte.
 */
const sello = String(Date.now()).slice(-6);
const capturas = 'C:\\Users\\dyane\\AppData\\Local\\Temp\\opencode\\ui-v2\\capturas';
const entorno = await crearEntornoE2E();

try {
  const admin = entorno.crearCliente();
  const usuarioAdmin = await entorno.iniciarSesion(admin, 'admin', '54321');
  const medicos = await admin('/api/medicos');
  const bitacora = crearBitacoraAcciones();

  // 1. Acceso del administrador.
  bitacora.paso(1, 'Acceso administrador', usuarioAdmin, [
    ['login', 'Acceso', 'ver'],
  ]);

  // 2. Alta de paciente.
  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `AUD${sello}`,
      nombres: 'Auditoría',
      apellidos: `Paciente ${sello}`,
      fecha_nacimiento: '1990-01-15',
      sexo: 'F',
      telefono: '0991234567',
      email: `auditoria-${sello}@isim.local`,
    },
  });
  bitacora.paso(2, 'Paciente creado', usuarioAdmin, [
    ['paciente_creado', 'Pacientes', 'modificar'],
  ]);

  // 3. Edición de paciente.
  await admin(`/api/patients/${encodeURIComponent(paciente.id)}`, {
    method: 'PATCH',
    body: { telefono: '0997654321' },
  });
  bitacora.paso(3, 'Paciente editado', usuarioAdmin, [
    ['paciente_editado', 'Pacientes', 'modificar'],
  ]);

  // 4. Revelado de contacto.
  await admin(`/api/patients/${encodeURIComponent(paciente.id)}/contacto-visto`, {
    method: 'POST',
    body: {},
  });
  bitacora.paso(4, 'Contacto revelado', usuarioAdmin, [
    ['contacto_paciente_revelado', 'Pacientes', 'leer'],
  ]);

  // 5. Cita.
  const cita = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      medicoId: medicos[0].id,
      fechaHora: '2027-03-10T15:00:00.000Z',
      duracionMin: 30,
      motivo: 'Control de auditoría',
      estado: 'programada',
    },
  });
  bitacora.paso(5, 'Cita creada', usuarioAdmin, [
    ['cita_creada', 'Agenda', 'modificar'],
  ]);

  // 6. Historia clínica.
  const historia = await admin('/api/clinical-records', {
    method: 'POST',
    body: {
      appointmentId: cita.id,
      motivoConsulta: 'Consulta de auditoría',
      notas: 'Registro para probar la bitácora.',
    },
  });
  bitacora.paso(6, 'Historia creada', usuarioAdmin, [
    ['historia_creada', 'Historia clínica', 'modificar'],
  ]);

  // 7. Examen solicitado.
  const examen = await admin(
    `/api/clinical-records/${encodeURIComponent(historia.id)}/exams`,
    {
      method: 'POST',
      body: {
        nombre: 'Hemograma de auditoría',
        tipo: 'laboratorio',
        descripcion: 'Control de auditoría',
        observaciones: 'Sin ayuno.',
      },
    }
  );
  bitacora.paso(7, 'Examen solicitado', usuarioAdmin, [
    ['examen_solicitado', 'Exámenes', 'modificar'],
  ]);

  // 8. Resultado de examen.
  await admin(
    `/api/clinical-records/${encodeURIComponent(historia.id)}/attachments`,
    {
      method: 'POST',
      body: {
        examId: examen.id,
        nombre: `resultado-${sello}.png`,
        data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      },
    }
  );
  bitacora.paso(8, 'Resultado subido', usuarioAdmin, [
    ['adjunto_subido', 'Exámenes', 'modificar'],
  ]);

  // 9. Documento.
  await admin('/api/documents', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      medicoId: medicos[0].id,
      titulo: `Consentimiento de auditoría ${sello}`,
    },
  });
  bitacora.paso(9, 'Documento creado', usuarioAdmin, [
    ['documento_creado', 'Documentos', 'modificar'],
  ]);

  // 10. Usuario creado.
  const usuarioCreado = await admin('/api/users', {
    method: 'POST',
    body: {
      nombre: 'Usuario Auditoría',
      cedula: `UA${sello}`,
      username: `audit${sello}`,
      password: 'Audit1234',
      rol: 'lectura',
    },
  });
  assert.ok(usuarioCreado.id);
  bitacora.paso(10, 'Usuario creado', usuarioAdmin, [
    ['usuario_creado', 'Usuarios', 'modificar'],
  ]);

  // 11-14. Acciones de otro usuario.
  const recepcion = entorno.crearCliente();
  const usuarioRecepcion = await entorno.iniciarSesion(recepcion, 'recepcion', '1236');
  bitacora.paso(11, 'Acceso recepción', usuarioRecepcion, [
    ['login', 'Acceso', 'ver'],
  ]);

  const pacienteRecepcion = await recepcion('/api/patients', {
    method: 'POST',
    body: {
      cedula: `AUR${sello}`,
      nombres: 'Recepción',
      apellidos: `Auditoría ${sello}`,
      fecha_nacimiento: '1992-02-20',
      sexo: 'F',
    },
  });
  bitacora.paso(12, 'Paciente creado por recepción', usuarioRecepcion, [
    ['paciente_creado', 'Pacientes', 'modificar'],
  ]);

  await recepcion('/api/appointments', {
    method: 'POST',
    body: {
      patientId: pacienteRecepcion.id,
      medicoId: medicos[0].id,
      fechaHora: '2027-03-11T15:00:00.000Z',
      duracionMin: 30,
      motivo: 'Cita de recepción',
      estado: 'programada',
    },
  });
  bitacora.paso(13, 'Cita creada por recepción', usuarioRecepcion, [
    ['cita_creada', 'Agenda', 'modificar'],
  ]);

  await recepcion('/api/auth/logout', { method: 'POST', body: {} });
  bitacora.paso(14, 'Cierre de sesión recepción', usuarioRecepcion, [
    ['logout', 'Acceso', 'ver'],
  ]);

  // Verificación del reporte por usuario antes de abrir el navegador.
  const fecha = new Date().toLocaleDateString('en-CA');
  await bitacora.verificar(async (usuario) => {
    const reporte = await admin(
      `/api/reports/activity?fecha=${encodeURIComponent(fecha)}&usuario=${encodeURIComponent(
        usuario.id
      )}&limit=5000`
    );
    return reporte.eventos;
  });

  // Verificación visual del reporte de cada usuario.
  const navegador = await puppeteer.launch({
    executablePath: [
      process.env.CHROME_PATH,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]
      .filter(Boolean)
      .find((ruta) => existsSync(ruta)),
    headless: 'new',
    args: ['--no-sandbox'],
  });

  try {
    const p = await navegador.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await p.setCacheEnabled(false);
    p.setDefaultTimeout(30000);
    await p.goto(`${entorno.base}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#btn-ingresar');
    await p.type('#login-usuario', 'admin');
    await p.type('#login-password', '54321');
    await p.click('#btn-ingresar');
    await p.waitForFunction(() => location.pathname === '/agenda.html');

    await p.goto(`${entorno.base}/reportes.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#actividad-usuario');
    await p.waitForFunction(
      () => document.querySelectorAll('#actividad-lista .reporte-tabla tbody tr').length > 0,
      { timeout: 25000 }
    );

    await p.select('#actividad-usuario', usuarioAdmin.id);
    await p.waitForFunction(
      (nombre) => document.querySelector('#actividad-titulo')?.innerText.includes(nombre),
      { timeout: 25000 },
      usuarioAdmin.nombre
    );
    const textoAdmin = await p.$eval('#actividad-lista', (nodo) => nodo.innerText);
    for (const accion of [
      'Paciente creado',
      'Paciente editado',
      'Datos de contacto consultados',
      'Cita creada',
      'Consulta creada',
      'Examen agregado',
      'Archivo de examen subido',
      'Documento creado',
      'Usuario creado',
    ]) {
      assert.ok(textoAdmin.includes(accion), `El reporte de ADMIN no muestra ${accion}`);
    }
    await p.screenshot({ path: `${capturas}\\57-auditoria-admin.png` });

    await p.select('#actividad-usuario', usuarioRecepcion.id);
    await p.waitForFunction(
      (id) =>
        document.querySelector('#actividad-usuario')?.value === id &&
        /Paciente creado/.test(document.querySelector('#actividad-lista')?.innerText || ''),
      { timeout: 25000 },
      usuarioRecepcion.id
    );
    const textoRecepcion = await p.$eval('#actividad-lista', (nodo) => nodo.innerText);
    for (const accion of ['Inicio de sesión', 'Paciente creado', 'Cita creada', 'Cierre de sesión']) {
      assert.ok(
        textoRecepcion.includes(accion),
        `El reporte de recepción no muestra ${accion}`
      );
    }
    await p.screenshot({ path: `${capturas}\\58-auditoria-recepcion.png` });

    console.log('✓ Reporte visible de ADMIN con todas las acciones esperadas');
    console.log('✓ Reporte visible de recepción con sus acciones');
    console.log('');
    console.log('AUDITORÍA E2E: ACCIONES ESPERADAS Y REPORTES OK');
  } finally {
    await navegador.close();
  }
} finally {
  await entorno.limpiar();
}
