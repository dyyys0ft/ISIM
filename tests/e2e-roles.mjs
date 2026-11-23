import assert from 'node:assert/strict';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de roles y permisos dinámicos.
 * Verifica el catálogo de lectura/edición, creación y edición de roles,
 * asignación a usuarios y protección de los roles del sistema.
 */

const marca = String(Date.now()).slice(-6);
let entorno = null;
let contador = 0;

function cedula() {
  contador += 1;
  return `RL${String(contador).padStart(3, '0')}${marca}`;
}

async function iniciar(cliente, username, password) {
  return cliente('/api/auth/login', { method: 'POST', body: { username, password } });
}

async function crearUsuario(admin, username, password, rol) {
  return admin('/api/users', {
    method: 'POST',
    body: {
      nombre: `Usuario rol ${username}`,
      cedula: cedula(),
      username,
      password,
      rol,
    },
  });
}

function datosPaciente(cedulaPaciente, indice) {
  return {
    cedula: cedulaPaciente,
    nombres: `Paciente rol ${indice + 1}`,
    apellidos: 'PRUEBA PERMISOS',
    fecha_nacimiento: '1990-01-15',
    sexo: 'F',
    telefono: `0999${String(indice).padStart(6, '0')}`.slice(0, 10),
  };
}

try {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente({ crudo: true });
  const loginAdmin = await iniciar(admin, 'admin', '54321');
  assert.equal(loginAdmin.status, 200, 'El administrador debe iniciar sesión');

  // 1. Catálogo completo con permisos de lectura y edición.
  const catalogoResp = await admin('/api/roles');
  assert.equal(catalogoResp.status, 200, 'El administrador debe ver los roles');
  const { roles, catalogo } = catalogoResp.datos;

  const porSlug = new Map(roles.map((rol) => [rol.slug, rol]));
  for (const slug of ['admin', 'medico', 'operador', 'enfermero', 'lectura']) {
    assert.ok(porSlug.has(slug), `Debe existir el rol del sistema ${slug}`);
    assert.equal(porSlug.get(slug).protegido, 1, `${slug} debe estar protegido`);
  }

  const grupoPacientes = catalogo.find((grupo) => grupo.id === 'pacientes');
  assert.ok(grupoPacientes, 'Debe existir el grupo de permisos Pacientes');
  assert.ok(
    grupoPacientes.permisos.some((item) => item.tipo === 'lectura'),
    'El catálogo debe incluir permisos de lectura'
  );
  assert.ok(
    grupoPacientes.permisos.some((item) => item.tipo === 'edicion'),
    'El catálogo debe incluir permisos de edición'
  );
  console.log('✓ Catálogo con permisos de lectura y edición');

  // 2. Crear rol de solo lectura.
  const nombreRol = `Consulta pacientes ${marca}`;
  const creacionRol = await admin('/api/roles', {
    method: 'POST',
    body: {
      nombre: nombreRol,
      descripcion: 'Rol de prueba de solo lectura',
      permisos: ['pacientes.ver', 'historias.ver', 'agenda.ver'],
    },
  });
  assert.equal(creacionRol.status, 201, 'El rol debe crearse');
  const slugRol = creacionRol.datos.slug;
  assert.equal(slugRol, `consulta.pacientes.${marca}`, 'El código debe generarse del nombre');
  assert.equal(creacionRol.datos.protegido, 0);
  assert.equal(creacionRol.datos.permisos.length, 3);
  console.log(`✓ Rol de solo lectura creado: ${slugRol}`);

  const duplicado = await admin('/api/roles', {
    method: 'POST',
    body: { nombre: nombreRol, permisos: [] },
  });
  assert.equal(duplicado.status, 409, 'El rol duplicado debe rechazarse');

  const permisoInvalido = await admin('/api/roles', {
    method: 'POST',
    body: {
      nombre: `Rol inválido ${marca}`,
      permisos: ['pacientes.borrar_todo'],
    },
  });
  assert.equal(permisoInvalido.status, 400, 'Un permiso desconocido debe rechazarse');
  console.log('✓ Duplicados y permisos inválidos rechazados');

  // 3. Usuario con el rol de solo lectura: puede leer, no editar.
  const usernameLector = `rol.lector.${marca}`;
  const passwordLector = `Clave${marca}9`;
  const usuarioLector = await crearUsuario(admin, usernameLector, passwordLector, slugRol);
  assert.equal(usuarioLector.status, 201, 'El usuario con rol personalizado debe crearse');
  const idLector = usuarioLector.datos.id;

  const lector = entorno.crearCliente({ crudo: true });
  assert.equal((await iniciar(lector, usernameLector, passwordLector)).status, 200);

  assert.equal((await lector('/api/patients')).status, 200, 'El rol puede ver pacientes');
  assert.equal((await lector('/api/appointments')).status, 200, 'El rol puede ver agenda');
  assert.equal(
    (await lector('/api/patients', { method: 'POST', body: datosPaciente(`LP${marca}`, 0) })).status,
    403,
    'El rol no puede crear pacientes sin permiso de edición'
  );
  assert.equal(
    (await lector('/api/settings')).status,
    403,
    'El rol no puede ver configuración sin permiso'
  );
  assert.equal(
    (await lector('/api/users')).status,
    403,
    'El rol no puede gestionar usuarios sin permiso'
  );
  assert.equal(
    (await lector('/api/roles')).status,
    403,
    'El rol no puede ver la administración de roles sin permiso'
  );
  console.log('✓ Rol de lectura aplicado correctamente');

  assert.equal(
    (await lector('/api/roles/nombres')).status,
    200,
    'Las etiquetas de roles deben estar disponibles para la interfaz'
  );

  // 4. Editar el rol y comprobar que el permiso se aplica sin volver a entrar.
  const edicionRol = await admin(`/api/roles/${encodeURIComponent(slugRol)}`, {
    method: 'PATCH',
    body: {
      permisos: ['pacientes.ver', 'pacientes.crear', 'historias.ver', 'agenda.ver'],
    },
  });
  assert.equal(edicionRol.status, 200, 'El rol debe actualizarse');
  assert.ok(edicionRol.datos.permisos.includes('pacientes.crear'));

  const creacionPaciente = await lector('/api/patients', {
    method: 'POST',
    body: datosPaciente(`LP${marca}N`, 1),
  });
  assert.equal(
    creacionPaciente.status,
    201,
    'El permiso de edición debe aplicarse en la misma sesión'
  );
  console.log('✓ Permiso de edición aplicado sin reiniciar sesión');

  // 5. Quitar un permiso de lectura.
  const sinAgenda = await admin(`/api/roles/${encodeURIComponent(slugRol)}`, {
    method: 'PATCH',
    body: {
      permisos: ['pacientes.ver', 'pacientes.crear', 'historias.ver'],
    },
  });
  assert.equal(sinAgenda.status, 200);
  assert.equal(
    (await lector('/api/appointments')).status,
    403,
    'Al quitar agenda.ver debe bloquearse la agenda'
  );
  assert.equal((await lector('/api/patients')).status, 200, 'Los demás permisos siguen activos');
  console.log('✓ Permiso de lectura retirado correctamente');

  // 6. Protecciones de los roles del sistema y de los roles en uso.
  const adminRol = porSlug.get('admin');
  const sinUsuarios = await admin('/api/roles/admin', {
    method: 'PATCH',
    body: {
      permisos: adminRol.permisos.filter((permiso) => permiso !== 'usuarios.gestionar'),
    },
  });
  assert.equal(
    sinUsuarios.status,
    400,
    'El rol Administrador no puede quedarse sin usuarios.gestionar'
  );

  const sinConfiguracion = await admin('/api/roles/admin', {
    method: 'PATCH',
    body: {
      permisos: adminRol.permisos.filter(
        (permiso) => permiso !== 'configuracion.gestionar'
      ),
    },
  });
  assert.equal(
    sinConfiguracion.status,
    400,
    'El rol Administrador no puede quedarse sin configuracion.gestionar'
  );

  assert.equal(
    (await admin('/api/roles/admin', { method: 'DELETE' })).status,
    409,
    'Un rol del sistema no se puede eliminar'
  );

  assert.equal(
    (await admin(`/api/roles/${encodeURIComponent(slugRol)}`, { method: 'DELETE' })).status,
    409,
    'Un rol con usuarios asignados no se puede eliminar'
  );
  console.log('✓ Protecciones de roles del sistema y roles en uso');

  // 7. Renombrar el rol y validar que el usuario no puede administrar roles.
  const renombrado = await admin(`/api/roles/${encodeURIComponent(slugRol)}`, {
    method: 'PATCH',
    body: { nombre: `Consulta médica ${marca}`, descripcion: 'Nombre editado' },
  });
  assert.equal(renombrado.status, 200);
  assert.equal(renombrado.datos.nombre, `Consulta médica ${marca}`);
  assert.equal(renombrado.datos.slug, slugRol, 'El código no debe cambiar');

  const intentoRol = await lector('/api/roles', {
    method: 'POST',
    body: { nombre: `Rol no autorizado ${marca}`, permisos: [] },
  });
  assert.equal(intentoRol.status, 403, 'Un rol sin permiso no puede crear roles');
  console.log('✓ Renombrado de rol y bloqueo de escalada de privilegios');

  // 8. Rol sin usuarios: se puede eliminar.
  const rolTemporal = await admin('/api/roles', {
    method: 'POST',
    body: {
      nombre: `Temporal ${marca}`,
      permisos: ['pacientes.ver'],
    },
  });
  assert.equal(rolTemporal.status, 201);
  const borradoTemporal = await admin(
    `/api/roles/${encodeURIComponent(rolTemporal.datos.slug)}`,
    { method: 'DELETE' }
  );
  assert.equal(borradoTemporal.status, 200, 'Un rol sin usuarios debe poder eliminarse');
  console.log('✓ Rol temporal sin usuarios eliminado');

  // 9. Reasignar al usuario y eliminar el rol personalizado.
  const reasignado = await admin(`/api/users/${encodeURIComponent(idLector)}`, {
    method: 'PATCH',
    body: { rol: 'lectura' },
  });
  assert.equal(reasignado.status, 200, 'El usuario debe poder cambiar de rol');
  assert.equal(
    (await admin(`/api/roles/${encodeURIComponent(slugRol)}`, { method: 'DELETE' })).status,
    200,
    'Al quedar sin usuarios, el rol personalizado debe poder eliminarse'
  );

  const rolInexistente = await admin('/api/users', {
    method: 'POST',
    body: {
      nombre: 'Usuario rol inexistente',
      cedula: cedula(),
      username: `rol.inexistente.${marca}`,
      password: `Clave${marca}8`,
      rol: 'rol.que.no.existe',
    },
  });
  assert.equal(rolInexistente.status, 400, 'No se puede asignar un rol inexistente');
  console.log('✓ Reasignación y validación de rol inexistente');

  console.log('');
  console.log('E2E DE ROLES Y PERMISOS COMPLETADO');
  console.log(
    JSON.stringify(
      {
        rolesDelSistema: 5,
        rolCreado: slugRol,
        permisosDeLecturaYEdicion: true,
        usuarioRolPersonalizado: usernameLector,
        protecciones: ['admin sin usuarios/config', 'rol del sistema', 'rol en uso'],
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('');
  console.error('E2E DE ROLES Y PERMISOS FALLÓ:', error.message);
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
