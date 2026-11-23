import { api } from '../api.js';
import { $, etiquetaRol, setBusy, toast } from '../ui.js';
import { iniciarVersion } from '../version.js';

const state = {
  busy: false,
  instalacion: false,
};

function tiempoDesde(iso) {
  const transcurrido = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(transcurrido) || transcurrido < 0) return 'hace un momento';

  const minutos = Math.floor(transcurrido / 60000);
  if (minutos < 1) return 'hace menos de un minuto';
  if (minutos < 60) return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} hora${horas === 1 ? '' : 's'}`;

  const dias = Math.floor(horas / 24);
  return `hace ${dias} día${dias === 1 ? '' : 's'}`;
}

function renderUltimo(usuario) {
  const contenedor = $('#ultimo-acceso');
  if (!contenedor || !usuario) return;
  contenedor.hidden = false;
  contenedor.innerHTML = `Último acceso: <b>${usuario.nombre}</b> · ${etiquetaRol(
    usuario.rol
  )} · ${tiempoDesde(usuario.ultimo_acceso_en)}`;
}

async function cargarLogo() {
  const imagen = $('#acceso-logo');
  if (!imagen) return;
  imagen.addEventListener(
    'error',
    () => {
      imagen.src = '/img/isim-logo.png';
    },
    { once: true }
  );
  imagen.src = '/api/settings/logo';
}

function mostrarAcceso() {
  state.instalacion = false;
  $('#form-login').hidden = false;
  $('#form-instalar').hidden = true;
  $('#acceso-titulo').textContent = 'Sistema de Consentimientos';
  $('#acceso-sub').textContent = 'ISIM · Instituto de la Salud Integral de la Mujer';
  $('#login-usuario')?.focus();
}

function mostrarInstalacion() {
  state.instalacion = true;
  $('#form-login').hidden = true;
  $('#form-instalar').hidden = false;
  $('#acceso-titulo').textContent = 'Instalación inicial';
  $('#acceso-sub').textContent = 'Crea la primera cuenta de administrador';
  $('#inst-usuario')?.focus();
}

async function ingresar(evento) {
  evento.preventDefault();
  if (state.busy) return;

  const username = $('#login-usuario').value.trim();
  const password = $('#login-password').value;

  if (!username || !password) {
    toast('Ingresa tu usuario y contraseña', 'error');
    return;
  }

  state.busy = true;
  const boton = $('#btn-ingresar');
  setBusy(boton, true, 'Verificando…');

  try {
    await api.post('/api/auth/login', { username, password });
    window.location.replace('/agenda.html');
  } catch (error) {
    state.busy = false;
    setBusy(boton, false);
    $('#login-password').value = '';
    $('#login-password').focus();
    toast(error.message, 'error');
  }
}

async function instalar(evento) {
  evento.preventDefault();
  if (state.busy) return;

  const datos = {
    usuario: $('#inst-usuario').value.trim(),
    nombre: $('#inst-nombre').value.trim(),
    password: $('#inst-password').value,
    especialidad: $('#inst-especialidad').value.trim(),
    registro: $('#inst-registro').value.trim(),
  };

  if (!datos.usuario || !datos.nombre || !datos.password) {
    toast('Completa usuario, nombre y contraseña', 'error');
    return;
  }

  state.busy = true;
  const boton = $('#btn-instalar');
  setBusy(boton, true, 'Creando…');

  try {
    await api.post('/api/setup/instalar', datos);
    toast('Administrador creado. Bienvenido.', 'success');
    window.location.replace('/agenda.html');
  } catch (error) {
    state.busy = false;
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function alternarPassword() {
  const input = $('#login-password');
  const boton = $('#btn-ver-password');
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  boton.textContent = mostrar ? 'Ocultar' : 'Ver';
  boton.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
}

async function consultarInstalacion() {
  try {
    const estado = await api.get('/api/setup/estado');
    return Boolean(estado?.requiereInstalacion);
  } catch (error) {
    // Mientras el backend no exponga el endpoint, se asume instalado.
    if (error.status === 404) return false;
    return false;
  }
}

async function init() {
  cargarLogo();
  iniciarVersion().catch(() => {});

  $('#form-login').addEventListener('submit', ingresar);
  $('#form-instalar').addEventListener('submit', instalar);
  $('#btn-ver-password').addEventListener('click', alternarPassword);

  const parametros = new URLSearchParams(location.search);
  if (parametros.get('sesion') === 'otra') {
    toast(
      'Tu sesión se cerró. Puede haberse iniciado en otro dispositivo o haber expirado.',
      'error',
      7000
    );
    history.replaceState(null, '', '/');
  }

  try {
    await api.get('/api/auth/me');
    window.location.replace('/agenda.html');
    return;
  } catch {
    // Sin sesión: se muestra el acceso.
  }

  if (await consultarInstalacion()) {
    mostrarInstalacion();
    return;
  }

  mostrarAcceso();

  try {
    renderUltimo(await api.get('/api/auth/ultimo'));
  } catch {
    // Sin último acceso.
  }
}

init();
