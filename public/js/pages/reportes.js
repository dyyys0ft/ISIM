import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, initials, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';

const ACCIONES = {
  login: 'Inicio de sesión',
  logout: 'Cierre de sesión',
  login_fallido: 'Intento de acceso fallido',
  login_ambiguo: 'Acceso ambiguo',
  sesiones_revocadas: 'Sesiones cerradas por administrador',
  paciente_creado: 'Paciente creado',
  paciente_editado: 'Paciente editado',
  paciente_desactivado: 'Paciente desactivado',
  contacto_paciente_revelado: 'Datos de contacto consultados',
  cita_creada: 'Cita creada',
  cita_editada: 'Cita editada',
  cita_cancelada: 'Cita cancelada',
  cita_notificada_whatsapp: 'Confirmación de cita por WhatsApp',
  consulta_finalizada: 'Consulta finalizada',
  historia_creada: 'Consulta creada',
  historia_editada: 'Consulta editada',
  examen_solicitado: 'Examen agregado',
  examen_actualizado: 'Examen actualizado',
  examen_eliminado: 'Examen eliminado',
  adjunto_subido: 'Archivo de examen subido',
  adjunto_eliminado: 'Archivo de examen eliminado',
  documento_creado: 'Documento creado',
  documento_version: 'Documento editado',
  documento_anulado: 'Documento anulado',
  consentimiento_negado: 'Consentimiento rechazado (negativa)',
  consentimiento_revocado: 'Consentimiento revocado',
  firma_solicitada: 'Firma solicitada',
  firma_cancelada: 'Firma cancelada',
  copia_entregada: 'Copia impresa entregada',
  receta_guardada: 'Receta guardada',
  receta_anulada: 'Receta anulada',
  receta_enviada_whatsapp: 'Receta enviada por WhatsApp',
  receta_compartida: 'Receta compartida',
  crm_mensaje_enviado: 'Mensaje de CRM enviado',
  crm_conversacion_leida: 'Conversación de CRM marcada como leída',
  crm_tarea_creada: 'Solicitud creada',
  crm_tarea_actualizada: 'Solicitud actualizada',
  crm_cita_confirmada_whatsapp: 'Cita confirmada desde CRM',
  plantilla_creada: 'Plantilla creada',
  plantilla_editada: 'Plantilla editada',
  plantilla_desactivada: 'Plantilla desactivada',
  documentos_paciente_compartidos: 'Documentos compartidos',
  documentos_paciente_enlace_revocado: 'Enlace de documentos revocado',
  documentos_paciente_enviados_whatsapp: 'Documentos enviados por WhatsApp',
  perfil_actualizado: 'Perfil actualizado',
  password_cambiada: 'Contraseña cambiada',
  password_restablecida: 'Contraseña restablecida',
  firma_medico_guardada: 'Firma del médico guardada',
  firma_medico_eliminada: 'Firma del médico eliminada',
  foto_actualizada: 'Foto actualizada',
  foto_eliminada: 'Foto eliminada',
  centro_actualizado: 'Datos del centro actualizados',
  textos_consentimiento_actualizados: 'Textos de consentimiento actualizados',
  logo_actualizado: 'Logo actualizado',
  logo_eliminado: 'Logo eliminado',
  pie_actualizado: 'Pie de página actualizado',
  pie_eliminado: 'Pie de página eliminado',
  alertas_actualizadas: 'Alertas actualizadas',
  agenda_actualizada: 'Configuración de agenda actualizada',
  whatsapp_configurado: 'WhatsApp configurado',
  whatsapp_token_eliminado: 'Token de WhatsApp eliminado',
  migracion_analizada: 'Migración analizada',
  migracion_completada: 'Migración completada',
  duplicados_depurados: 'Duplicados depurados',
  consentimiento_generado_cita: 'Consentimiento generado desde la cita',
  red_puerto_actualizado: 'Puerto de acceso actualizado',
  red_restriccion_actualizada: 'Restricción de IPs actualizada',
  red_ip_agregada: 'IP autorizada agregada',
  red_ip_eliminada: 'IP autorizada retirada',
};

const ENTIDADES = {
  users: 'Usuario',
  patients: 'Paciente',
  appointments: 'Cita',
  clinical_records: 'Consulta',
  clinical_exams: 'Examen',
  clinical_attachments: 'Archivo de examen',
  documents: 'Documento',
  document_versions: 'Versión de documento',
  signatures: 'Firma',
  prescriptions: 'Receta',
  crm_messages: 'Mensaje CRM',
  crm_tasks: 'Solicitud CRM',
  templates: 'Plantilla',
  settings: 'Configuración',
  migration_runs: 'Migración',
  patient_share_links: 'Enlace de documentos',
};

const estado = {
  usuario: null,
  fecha: '',
  usuarios: [],
  resumen: null,
  seleccionado: null,
  filtroUsuario: '',
  eventos: [],
  busqueda: '',
};

function etiquetaAccion(valor) {
  if (ACCIONES[valor]) return ACCIONES[valor];
  return String(valor || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letra) => letra.toUpperCase());
}

function etiquetaEntidad(valor) {
  return ENTIDADES[valor] || valor || '—';
}

function hora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sinTildes(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function renderResumen() {
  const resumen = estado.resumen || {};
  const ultimo = resumen.ultimo ? fmtFecha(resumen.ultimo, { time: true }) : 'Sin actividad';

  $('#reporte-resumen').innerHTML = `
    <div class="reporte-card">
      <span>Eventos del día</span>
      <strong>${resumen.eventos || 0}</strong>
    </div>
    <div class="reporte-card">
      <span>Usuarios con actividad</span>
      <strong>${resumen.usuariosActivos || 0}</strong>
    </div>
    <div class="reporte-card">
      <span>Inicios de sesión</span>
      <strong>${resumen.inicios || 0}</strong>
    </div>
    <div class="reporte-card reporte-card--ancho">
      <span>Última actividad</span>
      <strong>${escapeHtml(ultimo)}</strong>
    </div>
  `;
}

function renderUsuarios() {
  const contenedor = $('#reporte-lista');
  if (!estado.usuarios.length) {
    contenedor.innerHTML = '<p class="muted small">No hay usuarios para mostrar.</p>';
    return;
  }

  contenedor.innerHTML = estado.usuarios
    .map(
      (usuario) => `
      <button
        class="reporte-usuario ${usuario.id === estado.seleccionado ? 'is-active' : ''}"
        type="button"
        data-usuario="${escapeHtml(usuario.id)}"
      >
        <span class="reporte-usuario__avatar" aria-hidden="true">${escapeHtml(
          initials(usuario.nombre)
        )}</span>
        <span class="reporte-usuario__info">
          <strong>${escapeHtml(usuario.nombre)}</strong>
          <span>${escapeHtml(usuario.rol || '')}${
            usuario.activo ? '' : ' · inactivo'
          }${usuario.sesion_activa ? ' · sesión activa' : ''}</span>
        </span>
        <span class="reporte-usuario__meta">
          <b>${usuario.eventos}</b>
          <small>${usuario.ultimo ? hora(usuario.ultimo) : 'sin actividad'}</small>
        </span>
      </button>`
    )
    .join('');

  for (const boton of contenedor.querySelectorAll('[data-usuario]')) {
    boton.addEventListener('click', () => seleccionarUsuario(boton.dataset.usuario));
  }
}

function renderActividad() {
  const contenedor = $('#actividad-lista');
  const usuario = estado.filtroUsuario
    ? estado.usuarios.find((item) => item.id === estado.filtroUsuario)
    : null;
  const busqueda = sinTildes(estado.busqueda);

  $('#actividad-titulo').textContent = usuario
    ? `Actividad de ${usuario.nombre}`
    : 'Actividad de todos los usuarios';
  $('#actividad-sub').textContent = `${estado.eventos.length} evento${
    estado.eventos.length === 1 ? '' : 's'
  } el ${estado.fecha}${
    usuario ? '' : ' · elige un usuario en el filtro para ver solo su actividad'
  }`;

  const botonCerrar = $('#btn-cerrar-sesion-usuario');
  botonCerrar.hidden = !(
    usuario &&
    usuario.sesion_activa &&
    usuario.id !== estado.usuario.id
  );
  if (usuario) botonCerrar.dataset.usuario = usuario.id;

  const eventos = estado.eventos.filter((evento) => {
    if (!busqueda) return true;
    return sinTildes(
      `${etiquetaAccion(evento.accion)} ${etiquetaEntidad(evento.entidad)} ${
        evento.modulo || ''
      } ${evento.paciente || ''} ${evento.referencia || ''} ${
        evento.detalle_legible || ''
      } ${evento.usuario_nombre || ''}`
    ).includes(busqueda);
  });

  if (!eventos.length) {
    contenedor.innerHTML = `<p class="muted small">${
      estado.eventos.length
        ? 'No hay eventos que coincidan con la búsqueda.'
        : usuario
          ? 'Este usuario no tuvo actividad en la fecha seleccionada.'
          : 'No hubo actividad en la fecha seleccionada.'
    }</p>`;
    return;
  }

  contenedor.innerHTML = `
    <div class="reporte-tabla-wrap" role="region" aria-labelledby="reporte-tabla-caption" tabindex="0">
      <table class="reporte-tabla">
        <caption id="reporte-tabla-caption" class="visually-hidden">Actividad por acción, fecha y hora, módulo y paciente</caption>
        <thead>
          <tr>
            <th scope="col">Acción</th>
            <th scope="col">Fecha y hora</th>
            <th scope="col">Módulo</th>
            <th scope="col">Paciente</th>
            <th scope="col">Usuario</th>
            <th scope="col">Detalle</th>
          </tr>
        </thead>
        <tbody>
          ${eventos
            .map((evento) => {
              const detalle = [evento.referencia, evento.detalle_legible]
                .filter(Boolean)
                .join(' · ');
              return `<tr>
                <td class="reporte-tabla__accion">${escapeHtml(
                  etiquetaAccion(evento.accion)
                )}</td>
                <td>${escapeHtml(fmtFecha(evento.creado_en, { time: true }) || '—')}</td>
                <td><span class="reporte-tabla__modulo">${escapeHtml(
                  evento.modulo || '—'
                )}</span></td>
                <td>${escapeHtml(evento.paciente || '—')}</td>
                <td>${escapeHtml(evento.usuario_nombre || usuario?.nombre || '—')}</td>
                <td class="reporte-tabla__detalle">${escapeHtml(detalle || '—')}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function renderFiltroUsuarios() {
  const selector = $('#actividad-usuario');
  selector.innerHTML = [
    '<option value="">Todos los usuarios</option>',
    ...estado.usuarios.map(
      (usuario) =>
        `<option value="${escapeHtml(usuario.id)}">${escapeHtml(usuario.nombre)}${
          usuario.rol ? ` · ${escapeHtml(usuario.rol)}` : ''
        }</option>`
    ),
  ].join('');
  selector.value = estado.filtroUsuario;
}

async function cargarActividad() {
  estado.busqueda = '';
  $('#actividad-buscar').value = '';
  renderUsuarios();
  $('#actividad-lista').innerHTML = '<p class="muted small">Cargando actividad…</p>';

  try {
    const filtro = estado.filtroUsuario
      ? `&usuario=${encodeURIComponent(estado.filtroUsuario)}`
      : '';
    const datos = await api.get(
      `/api/reports/activity?fecha=${encodeURIComponent(estado.fecha)}${filtro}&limit=1000`
    );
    estado.eventos = datos.eventos || [];
    renderActividad();
    $('#btn-exportar-reporte').disabled = estado.eventos.length === 0;
  } catch (error) {
    toast(error.message, 'error');
    estado.eventos = [];
    renderActividad();
  }
}

async function seleccionarUsuario(userId) {
  estado.filtroUsuario = userId || '';
  estado.seleccionado = estado.filtroUsuario || null;
  $('#actividad-usuario').value = estado.filtroUsuario;
  await cargarActividad();
}

async function cargarReporte() {
  const boton = $('#btn-actualizar-reporte');
  setBusy(boton, true, 'Cargando…');

  try {
    const datos = await api.get(
      `/api/reports/users?fecha=${encodeURIComponent(estado.fecha)}`
    );
    estado.usuarios = datos.usuarios || [];
    estado.resumen = datos;
    renderResumen();
    renderUsuarios();
    renderFiltroUsuarios();

    if (
      estado.filtroUsuario &&
      !estado.usuarios.some((usuario) => usuario.id === estado.filtroUsuario)
    ) {
      estado.filtroUsuario = '';
      estado.seleccionado = null;
      $('#actividad-usuario').value = '';
    }

    await cargarActividad();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
  }
}

async function cerrarSesionUsuario() {
  const usuario = estado.usuarios.find(
    (item) => item.id === $('#btn-cerrar-sesion-usuario').dataset.usuario
  );
  if (!usuario || !usuario.sesion_activa) return;
  if (
    !window.confirm(
      `¿Cerrar todas las sesiones activas de "${usuario.nombre}"? Deberá iniciar sesión de nuevo.`
    )
  ) {
    return;
  }

  const boton = $('#btn-cerrar-sesion-usuario');
  setBusy(boton, true, 'Cerrando…');
  try {
    const resultado = await api.post(
      `/api/reports/users/${encodeURIComponent(usuario.id)}/close-sessions`,
      {}
    );
    toast(
      resultado.cerradas
        ? `Se cerraron ${resultado.cerradas} sesión(es) de ${usuario.nombre}`
        : 'El usuario no tenía sesiones activas',
      'success'
    );
    setBusy(boton, false);
    await cargarReporte();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function exportarCsv() {
  const usuario = estado.filtroUsuario
    ? estado.usuarios.find((item) => item.id === estado.filtroUsuario)
    : null;
  if (!estado.eventos.length) return;

  const filas = [
    ['Acción', 'Fecha y hora', 'Módulo', 'Paciente', 'Usuario', 'Referencia', 'Detalle'],
    ...estado.eventos.map((evento) => [
      etiquetaAccion(evento.accion),
      fmtFecha(evento.creado_en, { time: true }) || estado.fecha,
      evento.modulo || '',
      evento.paciente || '',
      evento.usuario_nombre || usuario?.nombre || '—',
      evento.referencia || '',
      evento.detalle_legible || '',
    ]),
  ];

  const csv = filas
    .map((fila) =>
      fila.map((campo) => `"${String(campo ?? '').replaceAll('"', '""')}"`).join(';')
    )
    .join('\r\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  const nombreArchivo = usuario
    ? usuario.nombre.replace(/\s+/g, '-').toLowerCase()
    : 'todos-los-usuarios';
  enlace.download = `actividad-${nombreArchivo}-${estado.fecha}.csv`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
  toast('Reporte exportado', 'success');
}

function conectarEventos() {
  $('#reporte-fecha').addEventListener('change', () => {
    estado.fecha = $('#reporte-fecha').value;
    cargarReporte();
  });

  $('#actividad-usuario').addEventListener('change', () => {
    seleccionarUsuario($('#actividad-usuario').value);
  });

  $('#btn-actualizar-reporte').addEventListener('click', cargarReporte);
  $('#btn-exportar-reporte').addEventListener('click', exportarCsv);
  $('#btn-cerrar-sesion-usuario').addEventListener('click', cerrarSesionUsuario);

  $('#actividad-buscar').addEventListener('input', () => {
    estado.busqueda = $('#actividad-buscar').value.trim();
    renderActividad();
  });
}

async function init() {
  estado.usuario = await initChrome({ active: 'reportes' });
  if (!estado.usuario) return;

  if (!puede(estado.usuario, 'reportes.ver')) {
    window.location.replace('/agenda.html');
    return;
  }

  estado.fecha = new Date().toLocaleDateString('en-CA');
  $('#reporte-fecha').value = estado.fecha;
  conectarEventos();
  await cargarReporte();
}

init();
