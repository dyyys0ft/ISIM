import { api } from '../api.js';
import { $, $$, escapeHtml, etiquetaRol, initials, registrarRoles, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';

let usuarioActual = null;
let usuarios = [];
let rolesDisponibles = [];
let editando = null;
let reseteando = null;
let fotoUsuario = null;

async function cargarRoles() {
  const datos = await api.get('/api/roles');
  rolesDisponibles = datos.roles || [];
  registrarRoles(rolesDisponibles);

  const select = $('#u-rol');
  const seleccionado = select.value;
  select.innerHTML = rolesDisponibles.length
    ? rolesDisponibles
        .map(
          (rol) =>
            `<option value="${escapeHtml(rol.slug)}">${escapeHtml(rol.nombre)}${
              rol.protegido ? '' : ' (personalizado)'
            }</option>`
        )
        .join('')
    : '<option value="">Sin roles disponibles</option>';

  if (seleccionado && rolesDisponibles.some((rol) => rol.slug === seleccionado)) {
    select.value = seleccionado;
  }
}

async function cargar() {
  try {
    usuarios = await api.get('/api/users');
    render();
  } catch (error) {
    if (error.status === 403) {
      window.location.replace('/documentos.html');
      return;
    }
    toast(error.message, 'error');
  }
}

function render() {
  const lista = $('#lista-usuarios');

  lista.innerHTML = usuarios
    .map((usuario) => {
      const avatar = usuario.tiene_foto
        ? `<span class="avatar avatar--foto" aria-hidden="true"><img src="/api/users/${encodeURIComponent(
            usuario.id
          )}/foto?v=${encodeURIComponent(usuario.foto_actualizada_en || '')}" alt=""></span>`
        : `<span class="avatar" aria-hidden="true">${escapeHtml(initials(usuario.nombre))}</span>`;

      return `
      <div class="user-row" data-id="${escapeHtml(usuario.id)}">
        ${avatar}
        <div class="user-row__info">
          <p class="cell-strong">${escapeHtml(usuario.nombre)}${usuario.id === usuarioActual.id ? ' (tú)' : ''}</p>
          <p class="cell-sub">@${escapeHtml(usuario.username || '—')} · C.I. ${escapeHtml(usuario.cedula || '—')} · ${escapeHtml(etiquetaRol(usuario.rol))}${usuario.senecit ? ` · SENECYT ${escapeHtml(usuario.senecit)}` : ''} · ${usuario.firmas} firma${usuario.firmas === 1 ? '' : 's'}</p>
        </div>
        <span class="badge badge--${usuario.activo ? 'activo' : 'inactivo'}">${usuario.activo ? 'Activo' : 'Inactivo'}</span>
        <div class="user-row__actions">
          <button class="btn btn--sm" type="button" data-action="editar">Editar</button>
          <button class="btn btn--sm" type="button" data-action="foto">Foto</button>
          <button class="btn btn--sm" type="button" data-action="password">Cambiar contraseña</button>
          <button class="btn btn--ghost btn--sm" type="button" data-action="estado">${usuario.activo ? 'Desactivar' : 'Activar'}</button>
        </div>
      </div>`;
    })
    .join('');

  for (const boton of $$('[data-action]', lista)) {
    const fila = boton.closest('[data-id]');
    const usuario = usuarios.find((u) => u.id === fila.dataset.id);

    if (boton.dataset.action === 'editar') {
      boton.addEventListener('click', () => abrirFormulario(usuario));
    } else if (boton.dataset.action === 'password') {
      boton.addEventListener('click', () => abrirPassword(usuario));
    } else if (boton.dataset.action === 'estado') {
      boton.addEventListener('click', () => cambiarEstado(usuario));
    } else if (boton.dataset.action === 'foto') {
      boton.addEventListener('click', () => abrirSelectorFoto(usuario));
    }
  }
}

function abrirFormulario(usuario = null) {
  editando = usuario;
  $('#form-usuario').reset();
  $('#titulo-usuario').textContent = usuario ? 'Editar usuario' : 'Nuevo usuario';
  $('#campo-password').hidden = Boolean(usuario);
  $('#campo-password-confirmar').hidden = Boolean(usuario);
  $('#u-password').required = !usuario;
  $('#u-password-confirmar').required = !usuario;

  if (usuario) {
    $('#u-nombre').value = usuario.nombre;
    $('#u-cedula').value = usuario.cedula || '';
    $('#u-username').value = usuario.username || '';
    $('#u-rol').value = usuario.rol;
    $('#u-senecit').value = usuario.senecit || '';
    $('#u-especialidad').value = usuario.especialidad || '';
  } else {
    const porDefecto =
      rolesDisponibles.find((rol) => rol.slug === 'operador') ||
      rolesDisponibles.find((rol) => rol.activo) ||
      rolesDisponibles[0];
    if (porDefecto) $('#u-rol').value = porDefecto.slug;
  }

  actualizarCamposMedico();
  $('#dlg-usuario').showModal();
  $('#u-nombre').focus();
}

function actualizarCamposMedico() {
  const esMedico = $('#u-rol').value === 'medico';
  $('#campo-senecit').hidden = !esMedico;
  $('#campo-especialidad').hidden = !esMedico;

  if (!esMedico) {
    $('#u-senecit').value = '';
    $('#u-especialidad').value = '';
  }
}

async function guardar(evento) {
  evento.preventDefault();
  const boton = $('#btn-guardar-usuario');

  const datos = {
    nombre: $('#u-nombre').value.trim(),
    cedula: $('#u-cedula').value.trim(),
    username: $('#u-username').value.trim().toLowerCase(),
    rol: $('#u-rol').value,
    senecit: $('#u-rol').value === 'medico' ? $('#u-senecit').value.trim() : '',
    especialidad: $('#u-rol').value === 'medico' ? $('#u-especialidad').value.trim() : '',
  };

  if (!datos.nombre || !datos.cedula || !datos.username) {
    return toast('Nombre, cédula y usuario son obligatorios', 'error');
  }

  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(datos.username)) {
    return toast(
      'El usuario debe tener entre 3 y 32 caracteres: minúsculas, números, punto, guion o guion bajo',
      'error'
    );
  }

  if (!editando) {
    const password = $('#u-password').value;
    const confirmar = $('#u-password-confirmar').value;
    if (password.length < 8 || password.length > 128) {
      return toast('La contraseña debe tener entre 8 y 128 caracteres', 'error');
    }
    if (!/[a-záéíóúüñ]/i.test(password) || !/\d/.test(password)) {
      return toast('La contraseña debe incluir al menos una letra y un número', 'error');
    }
    if (password !== confirmar) {
      return toast('Las contraseñas no coinciden', 'error');
    }
    datos.password = password;
  }

  setBusy(boton, true, 'Guardando…');
  try {
    if (editando) {
      await api.patch(`/api/users/${encodeURIComponent(editando.id)}`, datos);
      toast('Usuario actualizado', 'success');
    } else {
      await api.post('/api/users', datos);
      toast('Usuario creado', 'success');
    }
    setBusy(boton, false);
    $('#dlg-usuario').close();
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function abrirPassword(usuario) {
  reseteando = usuario;
  $('#form-password-usuario').reset();
  $('#password-usuario').textContent = `Se asignará una nueva contraseña a ${usuario.nombre} (@${usuario.username}).`;
  $('#dlg-password').showModal();
  $('#u-nuevo-password').focus();
}

async function guardarPassword(evento) {
  evento.preventDefault();
  if (!reseteando) return;

  const password = $('#u-nuevo-password').value;
  const confirmar = $('#u-nuevo-password-confirmar').value;
  if (password.length < 8 || password.length > 128) {
    return toast('La contraseña debe tener entre 8 y 128 caracteres', 'error');
  }
  if (!/[a-záéíóúüñ]/i.test(password) || !/\d/.test(password)) {
    return toast('La contraseña debe incluir al menos una letra y un número', 'error');
  }
  if (password !== confirmar) {
    return toast('Las contraseñas no coinciden', 'error');
  }

  const boton = $('#btn-guardar-password');
  setBusy(boton, true, 'Guardando…');
  try {
    await api.post(`/api/users/${encodeURIComponent(reseteando.id)}/password`, { password });
    setBusy(boton, false);
    $('#dlg-password').close();
    toast('Contraseña actualizada. Las sesiones abiertas de ese usuario se cerraron.', 'success');
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function cambiarEstado(usuario) {
  const accion = usuario.activo ? 'desactivar' : 'activar';
  if (
    !window.confirm(
      `¿${accion === 'desactivar' ? 'Desactivar' : 'Activar'} a ${usuario.nombre}? ${
        accion === 'desactivar' ? 'No podrá iniciar sesión hasta que se reactive.' : ''
      }`
    )
  ) {
    return;
  }

  try {
    await api.patch(`/api/users/${encodeURIComponent(usuario.id)}`, {
      activo: usuario.activo ? 0 : 1,
    });
    toast(`Usuario ${accion === 'desactivar' ? 'desactivado' : 'activado'}`, 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function leerArchivo(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error('No se pudo leer la imagen'));
    lector.readAsDataURL(archivo);
  });
}

function abrirSelectorFoto(usuario) {
  fotoUsuario = usuario;
  const input = $('#archivo-foto-usuario');
  input.value = '';
  input.click();
}

async function subirFoto() {
  const archivo = $('#archivo-foto-usuario').files?.[0];
  if (!archivo || !fotoUsuario) return;

  if (archivo.type !== 'image/png') {
    toast('La foto debe ser una imagen PNG', 'error');
    return;
  }
  if (archivo.size > 2 * 1024 * 1024) {
    toast('La foto supera los 2 MB', 'error');
    return;
  }

  try {
    const imagen = await leerArchivo(archivo);
    await api.post(`/api/users/${encodeURIComponent(fotoUsuario.id)}/foto`, { image: imagen });
    toast('Foto actualizada', 'success');
    fotoUsuario = null;
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function conectarEventos() {
  $('#btn-nuevo-usuario').addEventListener('click', () => abrirFormulario(null));
  $('#form-usuario').addEventListener('submit', guardar);
  $('#form-password-usuario').addEventListener('submit', guardarPassword);
  $('#archivo-foto-usuario').addEventListener('change', subirFoto);
  $('#u-rol').addEventListener('change', actualizarCamposMedico);
  $('#u-username').addEventListener('input', () => {
    const input = $('#u-username');
    input.value = input.value.toLowerCase().replace(/\s+/g, '');
  });

  $$('[data-cerrar]').forEach((boton) =>
    boton.addEventListener('click', () => boton.closest('dialog').close())
  );

  $('#dlg-usuario').addEventListener('close', () => {
    editando = null;
  });

  $('#dlg-password').addEventListener('close', () => {
    reseteando = null;
  });
}

async function init() {
  usuarioActual = await initChrome({ active: 'usuarios' });
  if (!usuarioActual) return;

  if (!puede(usuarioActual, 'usuarios.gestionar')) {
    window.location.replace('/documentos.html');
    return;
  }

  await cargarRoles();
  conectarEventos();
  await cargar();
}

init();
