import assert from 'node:assert/strict';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de permisos de solo lectura.
 *
 * 1. Crea un rol con permisos de lectura de todos los módulos y otro rol que
 *    solo puede ver la agenda.
 * 2. Comprueba que pueden leer lo permitido y que no pueden ver lo no permitido.
 * 3. Lanza decenas de intentos de escritura en paralelo (fuerza bruta) y exige
 *    que todos terminen en 403.
 * 4. Verifica que la estructura de roles, permisos y datos no cambió.
 */

const marca = String(Date.now()).slice(-6);
let entorno = null;
let contador = 0;

function cedula() {
  contador += 1;
  return `RO${String(contador).padStart(3, '0')}${marca}`;
}

async function iniciar(cliente, username, password) {
  return cliente('/api/auth/login', { method: 'POST', body: { username, password } });
}

async function ejecutar(tareas, limite = 25) {
  const resultados = new Array(tareas.length);
  let siguiente = 0;

  async function trabajador() {
    for (;;) {
      const indice = siguiente;
      siguiente += 1;
      if (indice >= tareas.length) return;
      try {
        resultados[indice] = { ok: true, valor: await tareas[indice]() };
      } catch (error) {
        resultados[indice] = { ok: false, error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limite, tareas.length)) }, () => trabajador())
  );
  return resultados;
}

const fechaCita = new Date(Date.now() + 24 * 60 * 60 * 1000);
fechaCita.setUTCHours(15, 0, 0, 0);

try {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');

  // Datos base para las lecturas.
  const paciente = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: cedula(),
      nombres: 'Paciente solo lectura',
      apellidos: 'PRUEBA PERMISOS',
      fecha_nacimiento: '1990-06-15',
      sexo: 'F',
      telefono: '0999999999',
    },
  });

  const cita = await admin('/api/appointments', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      fechaHora: fechaCita.toISOString(),
      duracionMin: 30,
      motivo: 'Cita para prueba de solo lectura',
      estado: 'programada',
    },
  });

  const historia = await admin('/api/clinical-records', {
    method: 'POST',
    body: {
      appointmentId: cita.id,
      motivoConsulta: 'Consulta de prueba',
      notas: 'Notas originales',
      diagnostico: 'Diagnóstico original',
    },
  });

  const plantillas = await admin('/api/templates');
  const plantilla = plantillas.find((item) => item.nombre === 'Certificado médico') || plantillas[0];
  const documento = await admin('/api/documents', {
    method: 'POST',
    body: {
      patientId: paciente.id,
      templateId: plantilla.id,
      titulo: 'Documento solo lectura',
    },
  });

  console.log('✓ Datos base creados');

  // Rol con lectura de todos los módulos, sin ningún permiso de edición.
  const rolTotal = await admin('/api/roles', {
    method: 'POST',
    body: {
      nombre: `Lectura total ${marca}`,
      descripcion: 'Solo lectura en todos los módulos',
      permisos: [
        'pacientes.ver',
        'agenda.ver',
        'historias.ver',
        'documentos.ver',
        'registro.ver',
        'configuracion.ver',
        'crm.ver',
        'dashboard.ver',
        'reportes.ver',
      ],
    },
  });

  // Rol que solo puede ver citas.
  const rolAgenda = await admin('/api/roles', {
    method: 'POST',
    body: {
      nombre: `Solo agenda ${marca}`,
      descripcion: 'Solo puede consultar citas',
      permisos: ['agenda.ver'],
    },
  });

  assert.equal(rolTotal.permisos.length, 9);
  assert.equal(rolAgenda.permisos.length, 1);
  console.log('✓ Roles de solo lectura creados');

  const clave = `Clave${marca}1`;
  const usuarioTotal = await admin('/api/users', {
    method: 'POST',
    body: {
      nombre: 'Lector total',
      cedula: cedula(),
      username: `lector.total.${marca}`,
      password: clave,
      rol: rolTotal.slug,
    },
  });
  const usuarioAgenda = await admin('/api/users', {
    method: 'POST',
    body: {
      nombre: 'Lector agenda',
      cedula: cedula(),
      username: `lector.agenda.${marca}`,
      password: clave,
      rol: rolAgenda.slug,
    },
  });

  const lectorTotal = entorno.crearCliente({ crudo: true });
  assert.equal((await iniciar(lectorTotal, `lector.total.${marca}`, clave)).status, 200);
  const lectorAgenda = entorno.crearCliente({ crudo: true });
  assert.equal((await iniciar(lectorAgenda, `lector.agenda.${marca}`, clave)).status, 200);
  console.log('✓ Usuarios de solo lectura autenticados');

  // Lecturas permitidas para el rol total.
  const lecturasPermitidas = [
    '/api/patients',
    `/api/patients/${encodeURIComponent(paciente.id)}`,
    '/api/appointments',
    `/api/appointments/${encodeURIComponent(cita.id)}`,
    `/api/appointments/calendar?desde=${encodeURIComponent(
      new Date(Date.now() - 86400000).toISOString()
    )}&hasta=${encodeURIComponent(new Date(Date.now() + 7 * 86400000).toISOString())}`,
    `/api/clinical-records?patientId=${encodeURIComponent(paciente.id)}`,
    `/api/clinical-history/patients?limit=20`,
    '/api/documents?limit=20',
    '/api/templates',
    '/api/settings',
    '/api/roles/nombres',
  ];

  for (const ruta of lecturasPermitidas) {
    const respuesta = await lectorTotal(ruta);
    assert.equal(respuesta.status, 200, `El rol total debe leer ${ruta}`);
  }
  console.log('✓ Rol total puede leer todos los módulos permitidos');

  // Lecturas permitidas para el rol que solo ve la agenda.
  assert.equal((await lectorAgenda('/api/appointments')).status, 200);
  assert.equal(
    (await lectorAgenda(`/api/appointments/${encodeURIComponent(cita.id)}`)).status,
    200
  );
  assert.equal((await lectorAgenda('/api/appointments/calendar?' + new URLSearchParams({
    desde: new Date(Date.now() - 86400000).toISOString(),
    hasta: new Date(Date.now() + 7 * 86400000).toISOString(),
  }))).status, 200);

  for (const ruta of [
    '/api/patients',
    `/api/clinical-records?patientId=${encodeURIComponent(paciente.id)}`,
    '/api/documents',
    '/api/settings',
    '/api/templates',
  ]) {
    assert.equal(
      (await lectorAgenda(ruta)).status,
      403,
      `El rol de solo agenda no debe leer ${ruta}`
    );
  }
  console.log('✓ Rol de solo agenda ve citas y no otros módulos');

  // Instantánea de la estructura antes de la fuerza bruta.
  const rolesAntes = JSON.stringify(await admin('/api/roles'));
  const citaAntes = await admin(`/api/appointments/${encodeURIComponent(cita.id)}`);
  const historiaAntes = await admin(
    `/api/clinical-records?patientId=${encodeURIComponent(paciente.id)}`
  );
  const pacientesAntes = await admin('/api/patients/paginated?limit=1');

  const intentos = [
    { ruta: '/api/patients', method: 'POST', body: { cedula: cedula(), nombres: 'X', apellidos: 'Y' } },
    { ruta: `/api/patients/${encodeURIComponent(paciente.id)}`, method: 'PATCH', body: { telefono: '0991111111' } },
    { ruta: `/api/patients/${encodeURIComponent(paciente.id)}`, method: 'DELETE' },
    {
      ruta: '/api/appointments',
      method: 'POST',
      body: { patientId: paciente.id, fechaHora: fechaCita.toISOString(), motivo: 'Intento' },
    },
    { ruta: `/api/appointments/${encodeURIComponent(cita.id)}`, method: 'PATCH', body: { motivo: 'Intento' } },
    { ruta: `/api/appointments/${encodeURIComponent(cita.id)}/cancel`, method: 'POST' },
    { ruta: `/api/appointments/${encodeURIComponent(cita.id)}/notify-whatsapp`, method: 'POST' },
    { ruta: `/api/appointments/${encodeURIComponent(cita.id)}/start-consultation`, method: 'POST' },
    { ruta: `/api/appointments/${encodeURIComponent(cita.id)}/finish-consultation`, method: 'POST' },
    { ruta: '/api/clinical-records', method: 'POST', body: { appointmentId: cita.id } },
    { ruta: `/api/clinical-records/${encodeURIComponent(historia.id)}`, method: 'PATCH', body: { notas: 'Intento' } },
    { ruta: `/api/clinical-records/${encodeURIComponent(historia.id)}/exams`, method: 'POST', body: { nombre: 'Intento' } },
    { ruta: `/api/clinical-records/${encodeURIComponent(historia.id)}/attachments`, method: 'POST', body: {} },
    { ruta: '/api/documents', method: 'POST', body: { patientId: paciente.id } },
    { ruta: `/api/documents/${encodeURIComponent(documento.id)}/annul`, method: 'POST' },
    { ruta: `/api/documents/${encodeURIComponent(documento.id)}/versions`, method: 'POST', body: {} },
    { ruta: '/api/settings/centro', method: 'POST', body: { nombre: 'Intento' } },
    { ruta: '/api/settings/alertas', method: 'POST', body: { examenesPendientes: false } },
    { ruta: '/api/settings/agenda', method: 'POST', body: { permitirCitasSimultaneas: true } },
    { ruta: '/api/settings/actualizaciones', method: 'POST', body: { automaticas: true } },
    {
      ruta: '/api/users',
      method: 'POST',
      body: {
        nombre: 'Intento',
        cedula: cedula(),
        username: `intento.${marca}`,
        password: `Clave${marca}9`,
        rol: 'operador',
      },
    },
    { ruta: `/api/users/${encodeURIComponent(usuarioTotal.id)}`, method: 'PATCH', body: { nombre: 'Intento' } },
    {
      ruta: `/api/users/${encodeURIComponent(usuarioTotal.id)}/password`,
      method: 'POST',
      body: { password: `Otra${marca}9` },
    },
    { ruta: '/api/roles', method: 'POST', body: { nombre: `Intento ${marca}`, permisos: ['usuarios.gestionar'] } },
    { ruta: `/api/roles/${encodeURIComponent(rolTotal.slug)}`, method: 'PATCH', body: { permisos: ['usuarios.gestionar'] } },
    { ruta: `/api/roles/${encodeURIComponent(rolTotal.slug)}`, method: 'DELETE' },
    { ruta: '/api/templates', method: 'POST', body: { nombre: 'Intento', cuerpoHtml: '<p>Intento</p>' } },
    { ruta: '/api/crm/tasks', method: 'POST', body: { patientId: paciente.id, motivo: 'Intento' } },
  ];

  const repeticiones = 5;
  const tareas = [];
  for (let r = 0; r < repeticiones; r += 1) {
    for (const intento of intentos) {
      tareas.push(() =>
        lectorTotal(intento.ruta, {
          method: intento.method,
          body: intento.body,
        })
      );
    }
  }

  const resultados = await ejecutar(tareas, 25);
  const exitos = resultados.filter((item) => item.ok && item.valor.status !== 403);
  const erroresRed = resultados.filter((item) => !item.ok);

  assert.equal(erroresRed.length, 0, `Fallos de red: ${erroresRed.length}`);
  assert.equal(
    exitos.length,
    0,
    `Todos los intentos de escritura deben ser 403. Inesperados: ${exitos
      .slice(0, 8)
      .map((item) => `${item.valor.status}`)
      .join(', ')}`
  );
  console.log(
    `✓ Fuerza bruta: ${tareas.length} intentos de escritura, todos 403`
  );

  // La estructura y los datos deben seguir exactamente igual.
  const rolesDespues = JSON.stringify(await admin('/api/roles'));
  assert.equal(rolesDespues, rolesAntes, 'La estructura de roles y permisos no debe cambiar');

  const citaDespues = await admin(`/api/appointments/${encodeURIComponent(cita.id)}`);
  assert.equal(citaDespues.estado, citaAntes.estado);
  assert.equal(citaDespues.fecha_hora, citaAntes.fecha_hora);
  assert.equal(citaDespues.motivo, citaAntes.motivo);

  const historiaDespues = await admin(
    `/api/clinical-records?patientId=${encodeURIComponent(paciente.id)}`
  );
  assert.equal(historiaDespues[0].notas, historiaAntes[0].notas);
  assert.equal(historiaDespues[0].diagnostico, historiaAntes[0].diagnostico);

  const pacientesDespues = await admin('/api/patients/paginated?limit=1');
  assert.equal(pacientesDespues.total, pacientesAntes.total, 'No debe crearse ningún paciente');

  const sesion = await lectorTotal('/api/auth/me');
  assert.equal(sesion.status, 200);
  assert.equal(sesion.datos.rol, rolTotal.slug, 'El rol del lector no debe cambiar');
  assert.equal(sesion.datos.permisos.length, 9, 'Los permisos no deben cambiar');

  const usuarios = await admin('/api/users');
  assert.ok(
    usuarios.some((usuario) => usuario.id === usuarioTotal.id && usuario.rol === rolTotal.slug),
    'El usuario de solo lectura debe conservar su rol'
  );
  assert.ok(
    !usuarios.some((usuario) => usuario.username === `intento.${marca}`),
    'El intento de crear un usuario no debe persistir'
  );

  const roles = (await admin('/api/roles')).roles;
  assert.ok(
    !roles.some((rol) => rol.nombre === `Intento ${marca}`),
    'El intento de crear un rol no debe persistir'
  );
  assert.equal(
    roles.find((rol) => rol.slug === rolTotal.slug).permisos.length,
    9,
    'Los permisos del rol de lectura no deben cambiar'
  );

  console.log('✓ Estructura de roles, permisos y datos intacta');
  console.log('✓ El rol de solo agenda no puede editar citas ni ver otros módulos');

  console.log('');
  console.log('E2E DE PERMISOS DE SOLO LECTURA COMPLETADO');
  console.log(
    JSON.stringify(
      {
        rolTotal: rolTotal.slug,
        rolSoloAgenda: rolAgenda.slug,
        usuarios: [usuarioTotal.id, usuarioAgenda.id],
        intentosEscritura: tareas.length,
        todos403: true,
        estructuraIntacta: true,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('');
  console.error('E2E DE PERMISOS DE SOLO LECTURA FALLÓ:', error.message);
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
