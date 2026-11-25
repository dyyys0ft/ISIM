import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, setBusy, toast } from '../ui.js';
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
  usuario_creado: 'Usuario creado',
  usuario_editado: 'Usuario editado',
  usuario_desactivado: 'Usuario desactivado',
  pedido_creado: 'Pedido creado',
  pedido_actualizado: 'Pedido actualizado',
  certificado_creado: 'Certificado creado',
  consentimiento_evidencia_subida: 'Evidencia del consentimiento subida',
  consentimiento_evidencia_eliminada: 'Evidencia del consentimiento eliminada',
  clave_respaldos_descargada: 'Clave de respaldos descargada',
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

const TIPOS_ACCION = {
  ver: 'Ver',
  leer: 'Leer',
  modificar: 'Modificar',
  eliminar: 'Eliminar',
};

function etiquetaTipoAccion(valor) {
  return TIPOS_ACCION[valor] || String(valor || '—');
}

const estado = {
  usuario: null,
  fecha: '',
  usuarios: [],
  resumen: null,
  filtroUsuario: '',
  filtroModulo: '',
  filtroAccion: '',
  opcionesModulos: [],
  opcionesAcciones: [],
  eventos: [],
  eventosVisibles: [],
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

function actualizarEncabezadoImpresion(usuario) {
  const filtros = [];
  if (estado.filtroModulo) filtros.push(`Módulo: ${estado.filtroModulo}`);
  if (estado.filtroAccion) filtros.push(`Acción: ${etiquetaTipoAccion(estado.filtroAccion)}`);
  if (usuario) filtros.push(`Usuario: ${usuario.nombre}`);
  if (estado.busqueda) filtros.push(`Búsqueda: ${estado.busqueda}`);

  $('#reporte-print-fecha').textContent = `Fecha: ${fmtFecha(
    `${estado.fecha}T12:00:00`,
    { weekday: true }
  )}`;
  $('#reporte-print-filtros').textContent = `Filtros: ${
    filtros.length ? filtros.join(' · ') : 'ninguno'
  }`;
  $('#reporte-print-generado').textContent = `Generado: ${new Date().toLocaleString(
    'es-EC',
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  )}`;
}

function renderFiltroOpciones() {
  const modulo = $('#actividad-modulo');
  const accion = $('#actividad-accion');
  modulo.innerHTML = [
    '<option value="">Todos los módulos</option>',
    ...estado.opcionesModulos.map(
      (valor) => `<option value="${escapeHtml(valor)}">${escapeHtml(valor)}</option>`
    ),
  ].join('');
  accion.innerHTML = [
    '<option value="">Todas las acciones</option>',
    ...estado.opcionesAcciones.map(
      (valor) =>
        `<option value="${escapeHtml(valor)}">${escapeHtml(etiquetaTipoAccion(valor))}</option>`
    ),
  ].join('');
  modulo.value = estado.filtroModulo;
  accion.value = estado.filtroAccion;
}

function renderActividad() {
  const contenedor = $('#actividad-lista');
  const usuario = estado.filtroUsuario
    ? estado.usuarios.find((item) => item.id === estado.filtroUsuario)
    : null;
  const busqueda = sinTildes(estado.busqueda);

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
  estado.eventosVisibles = eventos;

  const filtrosActivos = [];
  if (estado.filtroModulo) filtrosActivos.push(estado.filtroModulo);
  if (estado.filtroAccion) filtrosActivos.push(etiquetaTipoAccion(estado.filtroAccion));
  if (usuario) filtrosActivos.push(usuario.nombre);

  $('#actividad-titulo').textContent = usuario
    ? `Actividad de ${usuario.nombre}`
    : 'Actividad de todos los usuarios';
  $('#actividad-sub').textContent = `${eventos.length} evento${
    eventos.length === 1 ? '' : 's'
  } el ${fmtFecha(`${estado.fecha}T12:00:00`)}.${
    filtrosActivos.length ? ` Filtros: ${filtrosActivos.join(' · ')}.` : ''
  }`;
  actualizarEncabezadoImpresion(usuario);

  if (!eventos.length) {
    contenedor.innerHTML = `<p class="muted small">${
      estado.busqueda || filtrosActivos.length
        ? 'No hay eventos que coincidan con los filtros.'
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
              const detalle = [
                etiquetaAccion(evento.accion),
                evento.referencia,
                evento.detalle_legible,
              ]
                .filter(Boolean)
                .join(' · ');
              return `<tr>
                <td class="reporte-tabla__accion">${escapeHtml(
                  etiquetaTipoAccion(evento.accion_tipo)
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
  $('#actividad-lista').innerHTML = '<p class="muted small">Cargando actividad…</p>';

  try {
    const params = new URLSearchParams({
      fecha: estado.fecha,
      limit: '5000',
    });
    if (estado.filtroUsuario) params.set('usuario', estado.filtroUsuario);
    if (estado.filtroModulo) params.set('modulo', estado.filtroModulo);
    if (estado.filtroAccion) params.set('accion', estado.filtroAccion);

    const datos = await api.get(`/api/reports/activity?${params.toString()}`);
    estado.eventos = datos.eventos || [];
    estado.opcionesModulos = [...(datos.filtros?.modulos || [])];
    estado.opcionesAcciones = [...(datos.filtros?.acciones || [])];
    if (estado.filtroModulo && !estado.opcionesModulos.includes(estado.filtroModulo)) {
      estado.opcionesModulos.push(estado.filtroModulo);
    }
    if (estado.filtroAccion && !estado.opcionesAcciones.includes(estado.filtroAccion)) {
      estado.opcionesAcciones.push(estado.filtroAccion);
    }
    renderFiltroOpciones();
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
    renderFiltroUsuarios();

    if (
      estado.filtroUsuario &&
      !estado.usuarios.some((usuario) => usuario.id === estado.filtroUsuario)
    ) {
      estado.filtroUsuario = '';
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
  const eventos = estado.eventosVisibles || [];
  if (!eventos.length) return;

  const filas = [
    [
      'Tipo de acción',
      'Evento',
      'Fecha y hora',
      'Módulo',
      'Paciente',
      'Usuario',
      'Referencia',
      'Detalle',
    ],
    ...eventos.map((evento) => [
      etiquetaTipoAccion(evento.accion_tipo),
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

  $('#actividad-modulo').addEventListener('change', () => {
    estado.filtroModulo = $('#actividad-modulo').value;
    cargarActividad();
  });

  $('#actividad-accion').addEventListener('change', () => {
    estado.filtroAccion = $('#actividad-accion').value;
    cargarActividad();
  });

  $('#btn-limpiar-filtros-reporte').addEventListener('click', () => {
    estado.filtroUsuario = '';
    estado.filtroModulo = '';
    estado.filtroAccion = '';
    estado.busqueda = '';
    $('#actividad-usuario').value = '';
    $('#actividad-modulo').value = '';
    $('#actividad-accion').value = '';
    $('#actividad-buscar').value = '';
    cargarActividad();
  });

  $('#btn-actualizar-reporte').addEventListener('click', cargarReporte);
  $('#btn-exportar-reporte').addEventListener('click', exportarCsv);
  $('#btn-imprimir-reporte').addEventListener('click', () => window.print());
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
