import { api } from '../api.js';
import { $, etiquetaRol, initials, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';
import { SignaturePad } from '../components/signature-pad.js';

let padMedico = null;
let firmaSubida = null;
let usuarioActual = null;

function leerArchivo(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error('No se pudo leer la imagen'));
    lector.readAsDataURL(archivo);
  });
}

function actualizarFoto(url) {
  const preview = $('#foto-preview');
  if (url) {
    preview.innerHTML = `<img src="${url}" alt="Foto de perfil">`;
  } else {
    preview.textContent = initials(usuarioActual?.nombre || '');
  }

  for (const elemento of document.querySelectorAll('[data-user-avatar]')) {
    if (url) {
      elemento.innerHTML = `<img src="${url}" alt="">`;
      elemento.classList.add('avatar--foto');
    } else {
      elemento.textContent = initials(usuarioActual?.nombre || '');
      elemento.classList.remove('avatar--foto');
    }
  }

  $('#quitar-foto').hidden = !url;
}

async function guardarPerfil(evento) {
  evento.preventDefault();
  const boton = $('#btn-perfil');
  const nombre = $('#c-nombre').value.trim();
  const cedula = $('#c-cedula').value.trim();
  const esMedico = usuarioActual?.rol === 'medico';
  const senecit = esMedico ? $('#c-senecit')?.value.trim() || '' : '';
  const especialidad = esMedico ? $('#c-especialidad')?.value.trim() || '' : '';

  if (!nombre || !cedula) {
    return toast('Nombre y cédula son obligatorios', 'error');
  }

  setBusy(boton, true, 'Guardando…');
  try {
    const usuario = await api.patch('/api/users/me', { nombre, cedula, senecit, especialidad });
    setBusy(boton, false);
    usuarioActual.nombre = usuario.nombre;
    usuarioActual.senecit = usuario.senecit || '';
    usuarioActual.especialidad = usuario.especialidad || '';
    if (!usuarioActual.fotoUrl) actualizarFoto(null);

    for (const elemento of document.querySelectorAll('[data-user-name]')) {
      elemento.textContent = usuario.nombre;
    }
    for (const elemento of document.querySelectorAll('[data-user-avatar]')) {
      elemento.textContent = initials(usuario.nombre);
    }

    toast('Datos actualizados', 'success');
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function cambiarPassword(evento) {
  evento.preventDefault();
  const boton = $('#btn-password');
  const passwordActual = $('#c-password-actual').value;
  const passwordNuevo = $('#c-password-nuevo').value;
  const confirmar = $('#c-password-confirmar').value;

  if (passwordNuevo.length < 8 || passwordNuevo.length > 128) {
    return toast('La nueva contraseña debe tener entre 8 y 128 caracteres', 'error');
  }
  if (!/[a-záéíóúüñ]/i.test(passwordNuevo) || !/\d/.test(passwordNuevo)) {
    return toast('La contraseña debe incluir al menos una letra y un número', 'error');
  }
  if (passwordNuevo !== confirmar) {
    return toast('Las contraseñas nuevas no coinciden', 'error');
  }
  if (passwordNuevo === passwordActual) {
    return toast('La nueva contraseña debe ser diferente de la actual', 'error');
  }

  setBusy(boton, true, 'Cambiando…');
  try {
    await api.post('/api/users/me/password', { passwordActual, passwordNuevo });
    setBusy(boton, false);
    $('#form-password').reset();
    toast('Contraseña actualizada', 'success');
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function actualizarPreviewFirma(url) {
  const contenedor = $('#firma-preview');

  if (url) {
    contenedor.innerHTML = `<img src="${url}" alt="Firma del médico">`;
  } else {
    contenedor.innerHTML = '<p class="muted small">Sin firma registrada.</p>';
  }

  $('#quitar-firma').hidden = !url;
}

async function seleccionarFirma() {
  const archivo = $('#archivo-firma').files?.[0];
  if (!archivo) return;

  if (archivo.type !== 'image/png') {
    return toast('La firma debe ser una imagen PNG', 'error');
  }
  if (archivo.size > 2 * 1024 * 1024) {
    return toast('El PNG supera los 2 MB', 'error');
  }

  try {
    firmaSubida = await leerArchivo(archivo);
    actualizarPreviewFirma(firmaSubida);
    toast('Vista previa de la firma. Pulsa “Guardar firma”.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function guardarFirma() {
  const imagen = firmaSubida || padMedico?.toDataURL();
  if (!imagen) {
    return toast('Firma en el recuadro o sube una imagen PNG', 'error');
  }

  const boton = $('#guardar-firma');
  setBusy(boton, true, 'Guardando…');

  try {
    const resultado = await api.post('/api/users/me/firma', { image: imagen });
    setBusy(boton, false);

    firmaSubida = null;
    $('#archivo-firma').value = '';
    padMedico?.clear();
    actualizarPreviewFirma(resultado.firmaUrl);
    toast('Firma del médico guardada', 'success');
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function quitarFirma() {
  if (
    !window.confirm(
      '¿Quitar la firma del médico? Los documentos ya creados conservan la firma con la que se generaron.'
    )
  ) {
    return;
  }

  try {
    await api.delete('/api/users/me/firma');
    firmaSubida = null;
    $('#archivo-firma').value = '';
    padMedico?.clear();
    actualizarPreviewFirma(null);
    toast('Firma eliminada', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function iniciarFirmaMedico(usuario) {
  actualizarPreviewFirma(usuario.firmaUrl);

  padMedico = new SignaturePad($('#firma-medico'), {
    onChange: () => {
      firmaSubida = null;
      $('#pad-medico').classList.toggle('has-ink', !padMedico.isEmpty());
    },
  });

  $('#deshacer-firma').addEventListener('click', () => padMedico?.undo());
  $('#limpiar-firma').addEventListener('click', () => padMedico?.clear());
  $('#archivo-firma').addEventListener('change', seleccionarFirma);
  $('#guardar-firma').addEventListener('click', guardarFirma);
  $('#quitar-firma').addEventListener('click', quitarFirma);
}

async function seleccionarFoto() {
  const archivo = $('#archivo-foto').files?.[0];
  if (!archivo) return;

  if (archivo.type !== 'image/png') {
    return toast('La foto debe ser una imagen PNG', 'error');
  }
  if (archivo.size > 2 * 1024 * 1024) {
    return toast('La foto supera los 2 MB', 'error');
  }

  try {
    const imagen = await leerArchivo(archivo);
    const resultado = await api.post('/api/users/me/foto', { image: imagen });
    usuarioActual.fotoUrl = resultado.fotoUrl;
    actualizarFoto(resultado.fotoUrl);
    toast('Foto de perfil actualizada', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function quitarFoto() {
  if (!window.confirm('¿Quitar tu foto de perfil?')) return;

  try {
    await api.delete('/api/users/me/foto');
    usuarioActual.fotoUrl = null;
    $('#archivo-foto').value = '';
    actualizarFoto(null);
    toast('Foto eliminada', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function init() {
  const usuario = await initChrome({ active: 'cuenta' });
  if (!usuario) return;

  usuarioActual = usuario;

  $('#c-nombre').value = usuario.nombre;
  $('#c-cedula').value = usuario.cedula || '';
  $('#c-usuario').value = usuario.username || '';
  $('#c-senecit').value = usuario.senecit || '';
  $('#c-especialidad').value = usuario.especialidad || '';
  $('#c-rol').value = etiquetaRol(usuario.rol);
  actualizarFoto(usuario.fotoUrl);

  const esMedico = usuario.rol === 'medico';
  $('#campo-senecit-perfil').hidden = !esMedico;
  $('#campo-especialidad-perfil').hidden = !esMedico;
  document.querySelector('[data-permiso="firma.medico"]').hidden = !esMedico;

  $('#form-perfil').addEventListener('submit', guardarPerfil);
  $('#form-password').addEventListener('submit', cambiarPassword);
  $('#archivo-foto').addEventListener('change', seleccionarFoto);
  $('#quitar-foto').addEventListener('click', quitarFoto);

  if (esMedico) {
    iniciarFirmaMedico(usuario);
  }
}

init();
