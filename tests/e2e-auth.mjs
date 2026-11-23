import assert from 'node:assert/strict';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * E2E de autenticación con usuario y contraseña.
 *
 * Comprueba creación de usuarios, usuarios duplicados, contraseñas repetidas,
 * cambios de contraseña, restablecimiento por administrador, nombres de usuario
 * sin distinguir mayúsculas y carreras concurrentes de unicidad.
 */

let entorno = null;
let contadorCedulas = 0;

function cedula() {
  contadorCedulas += 1;
  return `AU${String(contadorCedulas).padStart(3, '0')}${marca}`;
}

async function iniciar(cliente, username, password) {
  return cliente('/api/auth/login', { method: 'POST', body: { username, password } });
}

async function crearUsuario(admin, username, password, datos = {}) {
  return admin('/api/users', {
    method: 'POST',
    body: {
      nombre: datos.nombre || `Usuario ${username}`,
      cedula: datos.cedula || cedula(),
      username,
      password,
      rol: datos.rol || 'operador',
      ...(datos.rol === 'medico'
        ? { especialidad: 'Ginecología', senecit: `SEN-${username}` }
        : {}),
    },
  });
}

const marca = String(Date.now()).slice(-6);

try {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente({ crudo: true });
  const loginAdmin = await iniciar(admin, 'admin', '54321');
  assert.equal(loginAdmin.status, 200, 'El administrador debe iniciar sesión');
  assert.equal(loginAdmin.datos.username, 'admin');
  console.log('✓ Administrador autenticado con usuario y contraseña');

  // 1. Creación y acceso con usuario y contraseña.
  const usuarioUno = `auth.uno.${marca}`;
  const claveUno = `Clave${marca}1`;
  const creadoUno = await crearUsuario(admin, usuarioUno, claveUno, {
    nombre: 'Usuario Uno E2E',
  });
  assert.equal(creadoUno.status, 201, 'El usuario debe crearse');
  assert.equal(creadoUno.datos.username, usuarioUno);

  const clienteUno = entorno.crearCliente({ crudo: true });
  const loginUno = await iniciar(clienteUno, usuarioUno.toUpperCase(), claveUno);
  assert.equal(loginUno.status, 200, 'El usuario debe ingresar sin distinguir mayúsculas');
  assert.equal(loginUno.datos.username, usuarioUno);
  console.log('✓ Usuario Creado e ingreso con usuario y contraseña');

  // 2. Usuario duplicado: exacto, con mayúsculas y con espacios.
  const duplicadoExacto = await crearUsuario(admin, usuarioUno, `Otra${marca}2`);
  assert.equal(duplicadoExacto.status, 409, 'El usuario duplicado exacto debe rechazarse');

  const duplicadoMayusculas = await crearUsuario(
    admin,
    usuarioUno.toUpperCase(),
    `Otra${marca}3`
  );
  assert.equal(
    duplicadoMayusculas.status,
    409,
    'El usuario duplicado sin distinguir mayúsculas debe rechazarse'
  );

  const duplicadoEspacios = await crearUsuario(
    admin,
    `  ${usuarioUno}  `,
    `Otra${marca}4`
  );
  assert.equal(
    duplicadoEspacios.status,
    409,
    'El usuario duplicado con espacios externos debe rechazarse'
  );
  console.log('✓ Usuarios duplicados rechazados (exacto, mayúsculas y espacios)');

  // 3. Contraseñas repetidas: dos usuarios distintos pueden usar la misma.
  const claveCompartida = `Compartida${marca}1`;
  const usuarioDos = `auth.dos.${marca}`;
  const usuarioTres = `auth.tres.${marca}`;
  const creadoDos = await crearUsuario(admin, usuarioDos, claveCompartida, {
    nombre: 'Usuario Dos E2E',
  });
  const creadoTres = await crearUsuario(admin, usuarioTres, claveCompartida, {
    nombre: 'Usuario Tres E2E',
  });
  assert.equal(creadoDos.status, 201, 'El segundo usuario debe crearse');
  assert.equal(creadoTres.status, 201, 'El tercer usuario debe crearse con la misma clave');

  const loginDos = await iniciar(entorno.crearCliente({ crudo: true }), usuarioDos, claveCompartida);
  const loginTres = await iniciar(entorno.crearCliente({ crudo: true }), usuarioTres, claveCompartida);
  assert.equal(loginDos.status, 200, 'El segundo usuario debe ingresar con la clave compartida');
  assert.equal(loginTres.status, 200, 'El tercer usuario debe ingresar con la clave compartida');
  console.log('✓ Contraseñas repetidas permitidas y funcionales');

  // 4. Contraseñas débiles y usuarios inválidos.
  const debilCorta = await crearUsuario(admin, `debil.corta.${marca}`, 'Ab1');
  assert.equal(debilCorta.status, 400, 'La contraseña corta debe rechazarse');

  const debilSinLetra = await crearUsuario(admin, `debil.letra.${marca}`, '12345678');
  assert.equal(debilSinLetra.status, 400, 'La contraseña sin letras debe rechazarse');

  const debilSinNumero = await crearUsuario(admin, `debil.numero.${marca}`, 'abcdefgh');
  assert.equal(debilSinNumero.status, 400, 'La contraseña sin números debe rechazarse');

  const usuarioInvalido = await crearUsuario(admin, 'ab', `Clave${marca}1`);
  assert.equal(usuarioInvalido.status, 400, 'El usuario demasiado corto debe rechazarse');

  const usuarioConEspacio = await crearUsuario(admin, 'mal usuario', `Clave${marca}1`);
  assert.equal(usuarioConEspacio.status, 400, 'El usuario con espacios debe rechazarse');
  console.log('✓ Validación de contraseñas y nombres de usuario');

  // 5. Cambio de contraseña por el propio usuario.
  const usuarioCuatro = `auth.cuatro.${marca}`;
  const claveCuatro = `Clave${marca}4`;
  const claveCuatroNueva = `Nueva${marca}44`;
  const creadoCuatro = await crearUsuario(admin, usuarioCuatro, claveCuatro, {
    nombre: 'Usuario Cuatro E2E',
  });
  assert.equal(creadoCuatro.status, 201);

  const clienteCuatro = entorno.crearCliente({ crudo: true });
  assert.equal((await iniciar(clienteCuatro, usuarioCuatro, claveCuatro)).status, 200);

  const cambioIncorrecto = await clienteCuatro('/api/users/me/password', {
    method: 'POST',
    body: { passwordActual: 'Incorrecta123', passwordNuevo: claveCuatroNueva },
  });
  assert.equal(cambioIncorrecto.status, 401, 'La contraseña actual incorrecta debe rechazarse');

  const cambioDebil = await clienteCuatro('/api/users/me/password', {
    method: 'POST',
    body: { passwordActual: claveCuatro, passwordNuevo: 'corta' },
  });
  assert.equal(cambioDebil.status, 400, 'La nueva contraseña débil debe rechazarse');

  const cambioCorrecto = await clienteCuatro('/api/users/me/password', {
    method: 'POST',
    body: { passwordActual: claveCuatro, passwordNuevo: claveCuatroNueva },
  });
  assert.equal(cambioCorrecto.status, 200, 'El cambio de contraseña debe completarse');

  const sesionTrasCambio = await clienteCuatro('/api/auth/me');
  assert.equal(sesionTrasCambio.status, 200, 'La sesión actual debe seguir activa');

  assert.equal(
    (await iniciar(entorno.crearCliente({ crudo: true }), usuarioCuatro, claveCuatro)).status,
    401,
    'La contraseña anterior debe dejar de funcionar'
  );
  assert.equal(
    (await iniciar(entorno.crearCliente({ crudo: true }), usuarioCuatro, claveCuatroNueva)).status,
    200,
    'La contraseña nueva debe funcionar'
  );
  console.log('✓ Cambio de contraseña propio verificado');

  // 6. Restablecimiento por administrador e invalidación de la sesión.
  const usuarioCinco = `auth.cinco.${marca}`;
  const claveCinco = `Clave${marca}5`;
  const claveCincoNueva = `Reset${marca}55`;
  const creadoCinco = await crearUsuario(admin, usuarioCinco, claveCinco, {
    nombre: 'Usuario Cinco E2E',
  });
  assert.equal(creadoCinco.status, 201);

  const clienteCinco = entorno.crearCliente({ crudo: true });
  assert.equal((await iniciar(clienteCinco, usuarioCinco, claveCinco)).status, 200);

  const reset = await admin(
    `/api/users/${encodeURIComponent(creadoCinco.datos.id)}/password`,
    { method: 'POST', body: { password: claveCincoNueva } }
  );
  assert.equal(reset.status, 200, 'El administrador debe restablecer la contraseña');
  assert.equal(
    (await clienteCinco('/api/auth/me')).status,
    401,
    'La sesión abierta del usuario debe cerrarse al restablecer la contraseña'
  );

  assert.equal(
    (await iniciar(entorno.crearCliente({ crudo: true }), usuarioCinco, claveCinco)).status,
    401,
    'La contraseña anterior debe rechazarse tras el restablecimiento'
  );
  assert.equal(
    (await iniciar(
      entorno.crearCliente({ crudo: true }),
      usuarioCinco,
      claveCincoNueva
    )).status,
    200,
    'La contraseña restablecida debe funcionar'
  );
  console.log('✓ Restablecimiento de contraseña y cierre de sesión verificados');

  // 7. Cambio de nombre de usuario y rechazo de duplicados.
  const usuarioSeis = `auth.seis.${marca}`;
  const usuarioSeisNuevo = `auth.seis.nuevo.${marca}`;
  const creadoSeis = await crearUsuario(admin, usuarioSeis, `Clave${marca}6`, {
    nombre: 'Usuario Seis E2E',
  });
  assert.equal(creadoSeis.status, 201);

  const cambioUsuario = await admin(
    `/api/users/${encodeURIComponent(creadoSeis.datos.id)}`,
    { method: 'PATCH', body: { username: usuarioSeisNuevo } }
  );
  assert.equal(cambioUsuario.status, 200, 'El nombre de usuario debe actualizarse');
  assert.equal(
    (await iniciar(entorno.crearCliente({ crudo: true }), usuarioSeis, `Clave${marca}6`)).status,
    401,
    'El nombre de usuario anterior no debe servir'
  );
  assert.equal(
    (await iniciar(
      entorno.crearCliente({ crudo: true }),
      usuarioSeisNuevo,
      `Clave${marca}6`
    )).status,
    200,
    'El nombre de usuario nuevo debe servir'
  );

  const cambioADuplicado = await admin(
    `/api/users/${encodeURIComponent(creadoSeis.datos.id)}`,
    { method: 'PATCH', body: { username: usuarioUno } }
  );
  assert.equal(cambioADuplicado.status, 409, 'No se debe poder usar un usuario ya existente');
  console.log('✓ Actualización de usuario y rechazo de duplicados');

  // 8. Carrera: varios administradores/creaciones con el mismo usuario.
  const usuarioCarrera = `auth.carrera.${marca}`;
  const intentos = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      crearUsuario(admin, usuarioCarrera, `Carrera${marca}${i}`, {
        nombre: `Carrera ${i}`,
        cedula: `CR${i}${marca}`,
      })
    )
  );
  const creadosCarrera = intentos.filter((r) => r.status === 201).length;
  const conflictosCarrera = intentos.filter((r) => r.status === 409).length;
  assert.equal(creadosCarrera, 1, 'Solo una creación concurrente debe ganar');
  assert.equal(conflictosCarrera, 5, 'Las demás deben recibir 409');
  console.log('✓ Carrera de usuarios duplicados: 1 gana, 5 conflictos');

  // 9. Carrera con la misma contraseña: todas deben crearse.
  const claveCarrera = `Repetida${marca}1`;
  const creacionesClave = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      crearUsuario(admin, `auth.repetida.${i}.${marca}`, claveCarrera, {
        nombre: `Clave Repetida ${i}`,
        cedula: `RP${i}${marca}`,
      })
    )
  );
  assert.equal(
    creacionesClave.filter((r) => r.status === 201).length,
    5,
    'Cinco usuarios deben crearse con la misma contraseña'
  );
  for (let i = 0; i < 5; i += 1) {
    const login = await iniciar(
      entorno.crearCliente({ crudo: true }),
      `auth.repetida.${i}.${marca}`,
      claveCarrera
    );
    assert.equal(login.status, 200, 'Cada usuario con clave repetida debe ingresar');
  }
  console.log('✓ Carrera con contraseña repetida: 5/5 usuarios creados y autenticados');

  // 10. Usuario desactivado y ausencia de hashes en las respuestas.
  const usuarioSiete = `auth.siete.${marca}`;
  const claveSiete = `Clave${marca}7`;
  const creadoSiete = await crearUsuario(admin, usuarioSiete, claveSiete, {
    nombre: 'Usuario Siete E2E',
  });
  assert.equal(creadoSiete.status, 201);

  const clienteSiete = entorno.crearCliente({ crudo: true });
  assert.equal((await iniciar(clienteSiete, usuarioSiete, claveSiete)).status, 200);

  const desactivar = await admin(`/api/users/${encodeURIComponent(creadoSiete.datos.id)}`, {
    method: 'PATCH',
    body: { activo: 0 },
  });
  assert.equal(desactivar.status, 200);
  assert.equal(
    (await clienteSiete('/api/auth/me')).status,
    401,
    'Un usuario desactivado pierde el acceso'
  );
  assert.equal(
    (await iniciar(entorno.crearCliente({ crudo: true }), usuarioSiete, claveSiete)).status,
    401,
    'Un usuario desactivado no puede iniciar sesión'
  );

  const listado = await admin('/api/users');
  assert.equal(listado.status, 200);
  const textoUsuarios = JSON.stringify(listado.datos);
  assert.ok(!textoUsuarios.includes('password_hash'), 'La API no debe exponer hashes de contraseña');
  assert.ok(!textoUsuarios.includes('pin_hash'), 'La API no debe exponer hashes de PIN');

  const sesion = await admin('/api/auth/me');
  assert.equal(sesion.status, 200);
  assert.ok(!JSON.stringify(sesion.datos).includes('password_hash'));
  console.log('✓ Usuario desactivado y respuestas sin hashes verificados');

  // 11. Credenciales faltantes o incorrectas.
  assert.equal(
    (await entorno.crearCliente({ crudo: true })('/api/auth/login', {
      method: 'POST',
      body: {},
    })).status,
    400,
    'Sin usuario ni contraseña debe devolver 400'
  );
  assert.equal(
    (await iniciar(entorno.crearCliente({ crudo: true }), usuarioUno, 'ClaveIncorrecta1')).status,
    401,
    'Una contraseña incorrecta debe devolver 401'
  );
  assert.equal(
    (await iniciar(
      entorno.crearCliente({ crudo: true }),
      'usuario.inexistente',
      claveUno
    )).status,
    401,
    'Un usuario inexistente debe devolver 401'
  );
  console.log('✓ Credenciales faltantes e incorrectas rechazadas');

  console.log('');
  console.log('E2E DE USUARIOS Y CONTRASEÑAS COMPLETADO');
  console.log(
    JSON.stringify(
      {
        usuarioBase: usuarioUno,
        usuariosCreados: contadorCedulas,
        contrasenaCompartida: true,
        duplicadosRechazados: 3,
        carreras: { usuarios: '1 gana / 5 conflictos', contrasenas: '5/5 creados' },
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('');
  console.error('E2E DE USUARIOS Y CONTRASEÑAS FALLÓ:', error.message);
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
