import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';
import { alSalir } from '../navegacion.js';

const TIPOS = { tarea: 'Tarea', queja: 'Queja', sugerencia: 'Sugerencia' };
const PRIORIDADES = { baja: 'Baja', media: 'Media', alta: 'Alta', urgente: 'Urgente' };
const ESTADOS_TAREA = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
  cancelada: 'Cancelada',
};

const ORDEN_ESTADO = { pendiente: 0, en_proceso: 1, resuelta: 2, cancelada: 3 };
const ORDEN_PRIORIDAD = { urgente: 0, alta: 1, media: 2, baja: 3 };

const COLUMNAS_PRIORIDAD = ['urgente', 'alta', 'media', 'baja'];
const COLUMNAS_ESTADO = ['pendiente', 'en_proceso', 'resuelta', 'cancelada'];

const estado = {
  usuario: null,
  pestana: 'pacientes',
  contactos: [],
  seleccionado: null,
  detalle: null,
  tareas: [],
  agrupacion: 'prioridad',
  tipoKanban: '',
  edicion: null,
  arrastrando: false,
  temporizador: null,
  temporizadorSolicitudes: null,
  temporizadorPaciente: null,
  refresco: null,
};

function sinTildes(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tareaPorId(id) {
  return estado.tareas.find((tarea) => tarea.id === id) || null;
}

function fechaCorta(fecha) {
  if (!fecha) return '';
  const [anio, mes, dia] = String(fecha).split('-');
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}

function fechaHora(iso) {
  if (!iso) return '';
  return fmtFecha(iso, { time: true, weekday: false });
}

function badgeTipo(tipo) {
  return `<span class="crm-badge crm-badge--tipo-${escapeHtml(tipo)}">${escapeHtml(
    TIPOS[tipo] || tipo
  )}</span>`;
}

function badgePrioridad(prioridad) {
  return `<span class="crm-badge crm-badge--prio-${escapeHtml(prioridad)}">${escapeHtml(
    PRIORIDADES[prioridad] || prioridad
  )}</span>`;
}

function badgeEstadoTarea(valor) {
  return `<span class="crm-badge crm-badge--estado-${escapeHtml(valor)}">${escapeHtml(
    ESTADOS_TAREA[valor] || valor
  )}</span>`;
}

function opciones(mapa, actual) {
  return Object.entries(mapa)
    .map(
      ([valor, texto]) =>
        `<option value="${valor}" ${actual === valor ? 'selected' : ''}>${texto}</option>`
    )
    .join('');
}

function ordenarTareas(lista) {
  return lista.toSorted((a, b) => {
    const porEstado = (ORDEN_ESTADO[a.estado] ?? 9) - (ORDEN_ESTADO[b.estado] ?? 9);
    if (porEstado) return porEstado;
    const porPrioridad =
      (ORDEN_PRIORIDAD[a.prioridad] ?? 9) - (ORDEN_PRIORIDAD[b.prioridad] ?? 9);
    if (porPrioridad) return porPrioridad;
    return String(a.fecha_limite || '9999-99-99').localeCompare(
      String(b.fecha_limite || '9999-99-99')
    );
  });
}

function nombreTarea(tarea) {
  return `${tarea.nombres || ''} ${tarea.apellidos || ''}`.trim() || 'Paciente';
}

/* --------------------------------------------------------------------------
   Pestañas
   -------------------------------------------------------------------------- */

function cambiarPestana(nombre, { silencioso = false } = {}) {
  const valida = ['pacientes', 'solicitudes', 'kanban'].includes(nombre) ? nombre : 'pacientes';
  estado.pestana = valida;

  for (const tab of document.querySelectorAll('[data-crm-tab]')) {
    const activo = tab.dataset.crmTab === valida;
    tab.classList.toggle('is-active', activo);
    tab.setAttribute('aria-selected', String(activo));
  }
  for (const vista of document.querySelectorAll('[data-crm-vista]')) {
    vista.classList.toggle('is-active', vista.dataset.crmVista === valida);
  }

  if (!silencioso) {
    history.replaceState(null, '', `#${valida}`);
  }

  if (valida === 'solicitudes') renderSolicitudes();
  if (valida === 'kanban') renderKanban();
}

/* --------------------------------------------------------------------------
   Contactos y chat
   -------------------------------------------------------------------------- */

function renderContactos() {
  const contenedor = $('#crm-contactos');
  $('#crm-contador').textContent = `${estado.contactos.length} contacto${
    estado.contactos.length === 1 ? '' : 's'
  }`;

  if (!estado.contactos.length) {
    contenedor.innerHTML =
      '<p class="crm-vacio">No hay contactos. Busca una paciente por nombre o cédula.</p>';
    return;
  }

  contenedor.innerHTML = estado.contactos
    .map(
      (contacto) => `
      <button class="crm-contacto ${
        contacto.id === estado.seleccionado ? 'is-active' : ''
      }" type="button" data-patient="${escapeHtml(contacto.id)}">
        <span class="crm-contacto__avatar">${escapeHtml(
          (contacto.nombres?.[0] || '') + (contacto.apellidos?.[0] || '')
        )}</span>
        <span class="crm-contacto__info">
          <strong>${escapeHtml(contacto.nombre)}</strong>
          <span>${escapeHtml(contacto.ultimo_mensaje || 'Sin mensajes todavía')}</span>
        </span>
        <span class="crm-contacto__meta">
          ${
            contacto.no_leidos
              ? `<b class="crm-contacto__unread">${contacto.no_leidos}</b>`
              : ''
          }
          <small>${contacto.ultimo_mensaje_en ? fechaHora(contacto.ultimo_mensaje_en) : ''}</small>
        </span>
      </button>`
    )
    .join('');

  for (const boton of contenedor.querySelectorAll('[data-patient]')) {
    boton.addEventListener('click', () => seleccionarContacto(boton.dataset.patient));
  }
}

async function cargarContactos(q = '') {
  try {
    estado.contactos = await api.get(`/api/crm/contacts?q=${encodeURIComponent(q)}`);
    renderContactos();
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
  }
}

async function seleccionarContacto(patientId, silencioso = false) {
  const borrador = silencioso ? $('#crm-mensaje')?.value || '' : '';
  try {
    estado.detalle = await api.get(`/api/crm/contacts/${encodeURIComponent(patientId)}`);
    estado.seleccionado = patientId;
    renderContactos();
    renderChat();
    renderPanel();
    if (borrador) {
      const campo = $('#crm-mensaje');
      if (campo) campo.value = borrador;
    }
    if (!silencioso) {
      // Desplaza el chat al último mensaje.
      requestAnimationFrame(() => {
        const chat = $('#crm-mensajes');
        if (chat) chat.scrollTop = chat.scrollHeight;
      });
    }
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
  }
}

function renderChat() {
  const detalle = estado.detalle;
  if (!detalle) return;
  const contenedor = $('#crm-chat');
  const mensajes = detalle.mensajes || [];

  contenedor.innerHTML = `
    <div class="crm-chat__head">
      <div>
        <h2>${escapeHtml(detalle.nombre)}</h2>
        <p class="muted small">${escapeHtml(detalle.telefono || 'Sin teléfono')} · ${
          mensajes.length
        } mensaje${mensajes.length === 1 ? '' : 's'}</p>
      </div>
      <a class="btn btn--sm" href="/historia.html?patientId=${encodeURIComponent(
        detalle.id
      )}" target="_blank" rel="noopener">Ver historia</a>
    </div>
    <div class="crm-mensajes" id="crm-mensajes">
      ${
        mensajes.length
          ? mensajes
              .map(
                (mensaje) => `
                <div class="crm-burbuja crm-burbuja--${
                  mensaje.direccion === 'entrante' ? 'entrante' : 'saliente'
                }">
                  <p>${escapeHtml(mensaje.contenido || '')}</p>
                  <small>
                    ${escapeHtml(fechaHora(mensaje.creado_en))}
                    ${
                      mensaje.estado === 'error'
                        ? ' · Error de envío'
                        : mensaje.estado === 'manual'
                          ? ' · Abierto en WhatsApp'
                          : ''
                    }
                  </small>
                </div>`
              )
              .join('')
          : '<p class="crm-vacio">Todavía no hay mensajes en esta conversación.</p>'
      }
    </div>
    <form class="crm-enviar" id="form-crm-mensaje">
      <textarea class="textarea" id="crm-mensaje" rows="2" maxlength="4000" placeholder="Escribe un mensaje…"></textarea>
      <button class="btn btn--primary" type="submit" id="btn-enviar-crm">Enviar</button>
    </form>
    <p class="hint">
      Si WhatsApp Business no está configurado, el mensaje se abrirá en WhatsApp Web.
    </p>
  `;

  const chat = $('#crm-mensajes');
  if (chat) chat.scrollTop = chat.scrollHeight;

  $('#form-crm-mensaje').addEventListener('submit', enviarMensaje);
  $('#crm-mensaje').addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      if (evento.isComposing || evento.keyCode === 229) return;
      enviarMensaje(evento);
    }
  });
}

function tareaEnPanel(tarea) {
  return `
    <div class="crm-tarea">
      <div class="crm-tarea__head">
        ${badgeTipo(tarea.tipo)}
        ${badgePrioridad(tarea.prioridad)}
      </div>
      <strong>${escapeHtml(tarea.motivo)}</strong>
      ${tarea.descripcion ? `<p class="small">${escapeHtml(tarea.descripcion)}</p>` : ''}
      <div class="crm-tarea__pie">
        <span>${
          tarea.fecha_limite ? `Límite: ${escapeHtml(fechaCorta(tarea.fecha_limite))}` : 'Sin fecha límite'
        }</span>
        <select class="select select--sm" data-tarea-estado="${escapeHtml(tarea.id)}">
          ${opciones(ESTADOS_TAREA, tarea.estado)}
        </select>
      </div>
    </div>`;
}

function renderPanel() {
  const detalle = estado.detalle;
  if (!detalle) return;
  const panel = $('#crm-panel');
  const citas = detalle.citas || [];
  const tareas = detalle.tareas || [];

  panel.innerHTML = `
    <div class="crm-panel__paciente">
      <h2 class="side-title">${escapeHtml(detalle.nombre)}</h2>
      <p class="muted small">C.I. ${escapeHtml(detalle.cedula || '—')}</p>
      <p class="muted small">${escapeHtml(detalle.telefono || 'Sin teléfono')}</p>
      ${
        detalle.datos_incompletos
          ? `<span class="badge badge--reagendada">Datos por actualizar</span>
             <p class="hint">${escapeHtml(detalle.datos_incompletos_detalle || '')}</p>`
          : ''
      }
    </div>

    <section class="crm-panel__seccion">
      <div class="crm-panel__titulo">
        <h3 class="side-title">Próximas citas</h3>
      </div>
      ${
        citas.length
          ? citas
              .map(
                (cita) => `
                <div class="crm-cita">
                  <div>
                    <strong>${escapeHtml(fechaHora(cita.fecha_hora))}</strong>
                    <span class="muted small">${escapeHtml(
                      cita.motivo || 'Sin motivo'
                    )} · ${escapeHtml(cita.medico_nombre || 'Sin médico')}</span>
                  </div>
                  <button class="btn btn--sm" type="button" data-confirmar-cita="${escapeHtml(
                    cita.id
                  )}">Confirmar WhatsApp</button>
                </div>`
              )
              .join('')
          : '<p class="hint">Sin citas próximas.</p>'
      }
    </section>

    <section class="crm-panel__seccion">
      <div class="crm-panel__titulo">
        <h3 class="side-title">Solicitudes</h3>
        <button class="btn btn--sm btn--primary" id="btn-nueva-tarea" type="button">+ Nueva</button>
      </div>
      ${
        tareas.length
          ? tareas.map(tareaEnPanel).join('')
          : '<p class="hint">Sin tareas registradas.</p>'
      }
    </section>
  `;

  $('#btn-nueva-tarea').addEventListener('click', () =>
    abrirTarea({
      paciente: { id: detalle.id, nombre: detalle.nombre, cedula: detalle.cedula },
    })
  );
  for (const boton of panel.querySelectorAll('[data-confirmar-cita]')) {
    boton.addEventListener('click', () => confirmarCita(boton.dataset.confirmarCita, boton));
  }
  for (const select of panel.querySelectorAll('[data-tarea-estado]')) {
    select.addEventListener('change', () =>
      moverTarea(select.dataset.tareaEstado, 'estado', select.value)
    );
  }
}

async function enviarMensaje(evento) {
  evento.preventDefault();
  if (!estado.detalle?.conversacion) return;
  const campo = $('#crm-mensaje');
  const texto = campo.value.trim();
  if (!texto) return;

  const boton = $('#btn-enviar-crm');
  setBusy(boton, true, 'Enviando…');
  try {
    const resultado = await api.post(
      `/api/crm/conversations/${encodeURIComponent(estado.detalle.conversacion.id)}/messages`,
      { texto }
    );
    campo.value = '';
    if (resultado.manual && resultado.manualUrl) {
      window.open(resultado.manualUrl, '_blank');
      toast('Se abrió WhatsApp para enviar el mensaje', 'success');
    } else {
      toast('Mensaje enviado', 'success');
    }
    await seleccionarContacto(estado.seleccionado, true);
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
    await seleccionarContacto(estado.seleccionado, true);
  }
}

async function confirmarCita(citaId, boton) {
  setBusy(boton, true, 'Enviando…');
  try {
    await api.post(`/api/crm/appointments/${encodeURIComponent(citaId)}/whatsapp`);
    toast('Confirmación enviada por WhatsApp', 'success');
    await seleccionarContacto(estado.seleccionado, true);
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

/* --------------------------------------------------------------------------
   Tareas: carga, contador, solicitudes y kanban
   -------------------------------------------------------------------------- */

async function cargarTareas() {
  try {
    estado.tareas = await api.get('/api/crm/tasks?limit=500');
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
    estado.tareas = [];
  }
  actualizarContador();
  renderSolicitudes();
  renderKanban();
}

function actualizarContador() {
  const abiertas = estado.tareas.filter(
    (tarea) => tarea.estado === 'pendiente' || tarea.estado === 'en_proceso'
  ).length;
  const contador = $('#crm-tab-count');
  contador.textContent = String(abiertas);
  contador.hidden = abiertas === 0;
  contador.title = `${abiertas} solicitud${abiertas === 1 ? '' : 'es'} abierta${
    abiertas === 1 ? '' : 's'
  }`;
}

function tareasFiltradasSolicitudes() {
  const q = sinTildes($('#sol-buscar').value.trim());
  const tipo = $('#sol-tipo').value;
  const estadoFiltro = $('#sol-estado').value;
  const prioridad = $('#sol-prioridad').value;

  return ordenarTareas(
    estado.tareas.filter((tarea) => {
      if (tipo && tarea.tipo !== tipo) return false;
      if (estadoFiltro && tarea.estado !== estadoFiltro) return false;
      if (prioridad && tarea.prioridad !== prioridad) return false;
      if (!q) return true;
      const texto = sinTildes(
        `${tarea.motivo || ''} ${tarea.descripcion || ''} ${nombreTarea(tarea)} ${tarea.cedula || ''}`
      );
      return texto.includes(q);
    })
  );
}

function renderSolicitudes() {
  const cuerpo = $('#sol-tabla');
  if (!cuerpo) return;
  const visibles = tareasFiltradasSolicitudes();

  if (!visibles.length) {
    cuerpo.innerHTML = `
      <tr>
        <td colspan="7" class="crm-tabla__vacio">
          ${
            estado.tareas.length
              ? 'No hay solicitudes que coincidan con los filtros.'
              : 'Todavía no hay solicitudes. Crea la primera con “+ Nueva solicitud”.'
          }
        </td>
      </tr>`;
  } else {
    cuerpo.innerHTML = visibles
      .map(
        (tarea) => `
        <tr>
          <td data-label="Paciente">
            <button class="crm-enlace" type="button" data-abrir-paciente="${escapeHtml(
              tarea.patient_id
            )}">
              <span class="cell-strong">${escapeHtml(nombreTarea(tarea))}</span>
              <span class="cell-sub">C.I. ${escapeHtml(tarea.cedula || '—')}</span>
            </button>
          </td>
          <td data-label="Tipo">${badgeTipo(tarea.tipo)}</td>
          <td data-label="Motivo" class="crm-tabla__motivo">
            <span class="cell-strong">${escapeHtml(tarea.motivo)}</span>
            ${
              tarea.descripcion
                ? `<span class="cell-sub">${escapeHtml(tarea.descripcion)}</span>`
                : ''
            }
          </td>
          <td data-label="Prioridad">
            <select class="select select--sm" data-prioridad-solicitud="${escapeHtml(tarea.id)}">
              ${opciones(PRIORIDADES, tarea.prioridad)}
            </select>
          </td>
          <td data-label="Estado">
            <select class="select select--sm" data-estado-solicitud="${escapeHtml(tarea.id)}">
              ${opciones(ESTADOS_TAREA, tarea.estado)}
            </select>
          </td>
          <td data-label="Límite">${
            tarea.fecha_limite
              ? `<span class="cell-strong">${escapeHtml(fechaCorta(tarea.fecha_limite))}</span>`
              : '<span class="muted">Sin límite</span>'
          }</td>
          <td data-label="Acciones">
            <button class="btn btn--sm" type="button" data-editar-solicitud="${escapeHtml(
              tarea.id
            )}">Editar</button>
          </td>
        </tr>`
      )
      .join('');
  }

  $('#sol-resumen').textContent = `${visibles.length} de ${estado.tareas.length} solicitud${
    estado.tareas.length === 1 ? '' : 'es'
  }`;
}

function renderKanban() {
  const tablero = $('#crm-kanban');
  if (!tablero) return;

  const agrupacion = estado.agrupacion;
  const columnas = agrupacion === 'prioridad' ? COLUMNAS_PRIORIDAD : COLUMNAS_ESTADO;
  const etiquetas = agrupacion === 'prioridad' ? PRIORIDADES : ESTADOS_TAREA;
  const campo = agrupacion === 'prioridad' ? 'prioridad' : 'estado';

  $('#kan-ayuda-campo').textContent = agrupacion === 'prioridad' ? 'prioridad' : 'estado';

  const visibles = estado.tareas.filter(
    (tarea) => !estado.tipoKanban || tarea.tipo === estado.tipoKanban
  );

  tablero.innerHTML = columnas
    .map((valor) => {
      const tareas = ordenarTareas(visibles.filter((tarea) => tarea[campo] === valor));
      return `
        <section class="crm-kanban__col crm-kanban__col--${valor}">
          <header class="crm-kanban__col-head">
            <span class="crm-kanban__punto"></span>
            <h3>${escapeHtml(etiquetas[valor])}</h3>
            <b>${tareas.length}</b>
          </header>
          <div class="crm-kanban__zona" data-drop="${valor}">
            ${
              tareas.length
                ? tareas
                    .map(
                      (tarea) => `
                      <article
                        class="crm-kanban__card"
                        draggable="true"
                        tabindex="0"
                        data-tarea-id="${escapeHtml(tarea.id)}"
                        aria-label="Editar ${escapeHtml(tarea.motivo)}"
                      >
                        <div class="crm-kanban__card-top">
                          ${badgeTipo(tarea.tipo)}
                          ${
                            agrupacion === 'prioridad'
                              ? badgeEstadoTarea(tarea.estado)
                              : badgePrioridad(tarea.prioridad)
                          }
                        </div>
                        <strong>${escapeHtml(tarea.motivo)}</strong>
                        ${
                          tarea.descripcion
                            ? `<p>${escapeHtml(tarea.descripcion)}</p>`
                            : ''
                        }
                        <div class="crm-kanban__card-pie">
                          <span>${escapeHtml(nombreTarea(tarea))}</span>
                          <span>${
                            tarea.fecha_limite
                              ? `📅 ${escapeHtml(fechaCorta(tarea.fecha_limite))}`
                              : 'Sin límite'
                          }</span>
                        </div>
                      </article>`
                    )
                    .join('')
                : '<p class="crm-kanban__vacio">Suelta aquí una tarjeta</p>'
            }
          </div>
        </section>`;
    })
    .join('');

  $('#kan-resumen').textContent = `${visibles.length} solicitud${
    visibles.length === 1 ? '' : 'es'
  }`;
}

async function moverTarea(id, campo, valor) {
  const tarea = tareaPorId(id);
  if (!tarea || tarea[campo] === valor) return false;

  const anterior = tarea[campo];
  tarea[campo] = valor;
  actualizarContador();
  renderSolicitudes();
  renderKanban();

  try {
    await api.patch(`/api/crm/tasks/${encodeURIComponent(id)}`, { [campo]: valor });
    toast(campo === 'estado' ? 'Estado actualizado' : 'Prioridad actualizada', 'success');
    if (estado.seleccionado) await seleccionarContacto(estado.seleccionado, true);
    return true;
  } catch (error) {
    tarea[campo] = anterior;
    actualizarContador();
    renderSolicitudes();
    renderKanban();
    if (estado.seleccionado) await seleccionarContacto(estado.seleccionado, true);
    toast(error.message, 'error');
    return false;
  }
}

/* --------------------------------------------------------------------------
   Formulario de solicitudes
   -------------------------------------------------------------------------- */

function fijarPaciente(paciente, fijo = false) {
  const campo = $('#tarea-paciente-buscar');
  const id = paciente?.id || '';
  $('#tarea-patient-id').value = id;
  campo.value = paciente
    ? `${paciente.nombre || ''}${paciente.cedula ? ` · ${paciente.cedula}` : ''}`
    : '';
  campo.readOnly = Boolean(id && fijo);
  $('#tarea-paciente-estado').textContent = paciente
    ? fijo
      ? 'Paciente de la solicitud.'
      : 'Paciente seleccionada. Escribe para cambiarla.'
    : '';
  const resultados = $('#tarea-paciente-resultados');
  resultados.hidden = true;
  resultados.replaceChildren();
}

function abrirTarea({ tarea = null, paciente = null } = {}) {
  estado.edicion = tarea;
  $('#form-crm-tarea').reset();
  $('#tarea-id').value = tarea?.id || '';
  $('#tarea-titulo').textContent = tarea ? 'Editar solicitud' : 'Nueva solicitud';
  $('#btn-guardar-tarea').textContent = tarea ? 'Guardar cambios' : 'Guardar';

  const pacienteInicial = tarea
    ? {
        id: tarea.patient_id,
        nombre: nombreTarea(tarea),
        cedula: tarea.cedula || '',
      }
    : paciente;

  fijarPaciente(pacienteInicial, Boolean(tarea));

  if (tarea) {
    $('#tarea-tipo').value = tarea.tipo;
    $('#tarea-prioridad').value = tarea.prioridad;
    $('#tarea-estado').value = tarea.estado;
    $('#tarea-fecha-limite').value = tarea.fecha_limite || '';
    $('#tarea-motivo').value = tarea.motivo || '';
    $('#tarea-descripcion').value = tarea.descripcion || '';
  } else {
    $('#tarea-tipo').value = 'tarea';
    $('#tarea-prioridad').value = 'media';
    $('#tarea-estado').value = 'pendiente';
    $('#tarea-fecha-limite').value = '';
  }

  $('#dlg-crm-tarea').showModal();
  if (!tarea && !paciente) $('#tarea-paciente-buscar').focus();
  else $('#tarea-motivo').focus();
}

async function buscarPacientesTarea(q) {
  const resultados = $('#tarea-paciente-resultados');
  try {
    const pacientes = await api.get(
      `/api/patients?q=${encodeURIComponent(q)}&limit=8`
    );
    if (!pacientes.length) {
      resultados.innerHTML = '<p class="crm-paciente-resultados__vacio">Sin coincidencias.</p>';
    } else {
      resultados.innerHTML = pacientes
        .map(
          (paciente) => `
          <button
            type="button"
            class="crm-paciente-resultado"
            data-paciente-id="${escapeHtml(paciente.id)}"
            data-paciente-nombre="${escapeHtml(
              `${paciente.nombres || ''} ${paciente.apellidos || ''}`.trim()
            )}"
            data-paciente-cedula="${escapeHtml(paciente.cedula || '')}"
          >
            <strong>${escapeHtml(
              `${paciente.nombres || ''} ${paciente.apellidos || ''}`.trim()
            )}</strong>
            <small>C.I. ${escapeHtml(paciente.cedula || '—')}</small>
          </button>`
        )
        .join('');
    }
    resultados.hidden = false;
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    resultados.innerHTML = `<p class="crm-paciente-resultados__vacio">${escapeHtml(
      error.message
    )}</p>`;
    resultados.hidden = false;
  }
}

async function guardarTarea(evento) {
  evento.preventDefault();
  const boton = $('#btn-guardar-tarea');
  const patientId = $('#tarea-patient-id').value.trim();
  if (!patientId) return toast('Selecciona una paciente', 'error');

  const datos = {
    tipo: $('#tarea-tipo').value,
    motivo: $('#tarea-motivo').value.trim(),
    descripcion: $('#tarea-descripcion').value.trim(),
    prioridad: $('#tarea-prioridad').value,
    estado: $('#tarea-estado').value,
    fechaLimite: $('#tarea-fecha-limite').value,
  };
  if (!datos.motivo) return toast('Escribe el motivo', 'error');

  setBusy(boton, true, 'Guardando…');
  try {
    if (estado.edicion) {
      await api.patch(
        `/api/crm/tasks/${encodeURIComponent(estado.edicion.id)}`,
        datos
      );
      toast('Solicitud actualizada', 'success');
    } else {
      await api.post('/api/crm/tasks', { ...datos, patientId });
      toast('Solicitud creada', 'success');
    }
    setBusy(boton, false);
    $('#dlg-crm-tarea').close();
    await cargarTareas();
    if (estado.seleccionado) await seleccionarContacto(estado.seleccionado, true);
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

/* --------------------------------------------------------------------------
   Eventos
   -------------------------------------------------------------------------- */

function conectarEventos() {
  for (const boton of document.querySelectorAll('[data-cerrar]')) {
    boton.addEventListener('click', () => boton.closest('dialog').close());
  }

  for (const tab of document.querySelectorAll('[data-crm-tab]')) {
    tab.addEventListener('click', () => cambiarPestana(tab.dataset.crmTab));
  }

  $('#form-crm-tarea').addEventListener('submit', guardarTarea);

  $('#crm-buscar').addEventListener('input', () => {
    clearTimeout(estado.temporizador);
    estado.temporizador = setTimeout(
      () => cargarContactos($('#crm-buscar').value.trim()),
      260
    );
  });

  // Filtros de solicitudes.
  $('#sol-buscar').addEventListener('input', () => {
    clearTimeout(estado.temporizadorSolicitudes);
    estado.temporizadorSolicitudes = setTimeout(renderSolicitudes, 180);
  });
  for (const id of ['#sol-tipo', '#sol-estado', '#sol-prioridad']) {
    $(id).addEventListener('change', renderSolicitudes);
  }

  $('#btn-nueva-solicitud').addEventListener('click', () => abrirTarea());
  $('#btn-nueva-kanban').addEventListener('click', () => abrirTarea());

  // Tabla de solicitudes: cambios y acciones.
  $('#sol-tabla').addEventListener('change', (evento) => {
    const prioridad = evento.target.closest('[data-prioridad-solicitud]');
    if (prioridad) {
      moverTarea(prioridad.dataset.prioridadSolicitud, 'prioridad', prioridad.value);
      return;
    }
    const estadoSelect = evento.target.closest('[data-estado-solicitud]');
    if (estadoSelect) {
      moverTarea(estadoSelect.dataset.estadoSolicitud, 'estado', estadoSelect.value);
    }
  });
  $('#sol-tabla').addEventListener('click', (evento) => {
    const abrir = evento.target.closest('[data-abrir-paciente]');
    if (abrir) {
      cambiarPestana('pacientes');
      seleccionarContacto(abrir.dataset.abrirPaciente);
      return;
    }
    const editar = evento.target.closest('[data-editar-solicitud]');
    if (editar) {
      const tarea = tareaPorId(editar.dataset.editarSolicitud);
      if (tarea) abrirTarea({ tarea });
    }
  });

  // Kanban: agrupación, filtro y arrastrar/soltar.
  for (const boton of document.querySelectorAll('[data-agrupar]')) {
    boton.addEventListener('click', () => {
      estado.agrupacion = boton.dataset.agrupar;
      for (const otro of document.querySelectorAll('[data-agrupar]')) {
        otro.classList.toggle('is-active', otro === boton);
      }
      renderKanban();
    });
  }
  $('#kan-tipo').addEventListener('change', () => {
    estado.tipoKanban = $('#kan-tipo').value;
    renderKanban();
  });

  const tablero = $('#crm-kanban');

  tablero.addEventListener('dragstart', (evento) => {
    const tarjeta = evento.target.closest('[data-tarea-id]');
    if (!tarjeta) return;
    estado.arrastrando = true;
    evento.dataTransfer.effectAllowed = 'move';
    evento.dataTransfer.setData('text/plain', tarjeta.dataset.tareaId);
    tarjeta.classList.add('is-dragging');
  });

  tablero.addEventListener('dragend', (evento) => {
    evento.target.closest('[data-tarea-id]')?.classList.remove('is-dragging');
    for (const zona of tablero.querySelectorAll('.is-over')) zona.classList.remove('is-over');
    setTimeout(() => {
      estado.arrastrando = false;
    }, 60);
  });

  tablero.addEventListener('dragover', (evento) => {
    const zona = evento.target.closest('[data-drop]');
    if (!zona) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'move';
    zona.classList.add('is-over');
  });

  tablero.addEventListener('dragleave', (evento) => {
    const zona = evento.target.closest('[data-drop]');
    if (!zona) return;
    if (!zona.contains(evento.relatedTarget)) zona.classList.remove('is-over');
  });

  tablero.addEventListener('drop', (evento) => {
    const zona = evento.target.closest('[data-drop]');
    if (!zona) return;
    evento.preventDefault();
    for (const otra of tablero.querySelectorAll('.is-over')) otra.classList.remove('is-over');
    const id = evento.dataTransfer.getData('text/plain');
    const campo = estado.agrupacion === 'prioridad' ? 'prioridad' : 'estado';
    if (id) moverTarea(id, campo, zona.dataset.drop);
  });

  tablero.addEventListener('click', (evento) => {
    if (estado.arrastrando) return;
    const tarjeta = evento.target.closest('[data-tarea-id]');
    if (!tarjeta) return;
    const tarea = tareaPorId(tarjeta.dataset.tareaId);
    if (tarea) abrirTarea({ tarea });
  });

  tablero.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    const tarjeta = evento.target.closest('[data-tarea-id]');
    if (!tarjeta) return;
    evento.preventDefault();
    const tarea = tareaPorId(tarjeta.dataset.tareaId);
    if (tarea) abrirTarea({ tarea });
  });

  // Selector de paciente dentro del formulario.
  const buscador = $('#tarea-paciente-buscar');
  buscador.addEventListener('input', () => {
    if (buscador.readOnly) return;
    $('#tarea-patient-id').value = '';
    $('#tarea-paciente-estado').textContent = '';
    const q = buscador.value.trim();
    clearTimeout(estado.temporizadorPaciente);
    if (q.length < 2) {
      $('#tarea-paciente-resultados').hidden = true;
      return;
    }
    estado.temporizadorPaciente = setTimeout(() => buscarPacientesTarea(q), 250);
  });

  $('#tarea-paciente-resultados').addEventListener('click', (evento) => {
    const opcion = evento.target.closest('[data-paciente-id]');
    if (!opcion) return;
    fijarPaciente({
      id: opcion.dataset.pacienteId,
      nombre: opcion.dataset.pacienteNombre,
      cedula: opcion.dataset.pacienteCedula,
    });
    $('#tarea-motivo').focus();
  });

  document.addEventListener('click', cerrarResultadosPaciente);

  $('#dlg-crm-tarea').addEventListener('close', () => {
    estado.edicion = null;
    $('#tarea-paciente-buscar').readOnly = false;
  });

  alSalir(() => {
    clearInterval(estado.refresco);
    clearTimeout(estado.temporizador);
    clearTimeout(estado.temporizadorSolicitudes);
    clearTimeout(estado.temporizadorPaciente);
    document.removeEventListener('click', cerrarResultadosPaciente);
  });
}

function cerrarResultadosPaciente(evento) {
  if (evento.target.closest('.crm-paciente-picker')) return;
  const resultados = $('#tarea-paciente-resultados');
  if (resultados) resultados.hidden = true;
}

/* --------------------------------------------------------------------------
   Inicio
   -------------------------------------------------------------------------- */

async function init() {
  estado.usuario = await initChrome({ active: 'crm' });
  if (!estado.usuario) return;
  if (!puede(estado.usuario, 'crm.ver')) {
    window.location.replace('/pacientes.html');
    return;
  }

  conectarEventos();

  const inicial = location.hash.replace('#', '');
  cambiarPestana(inicial || 'pacientes', { silencioso: true });

  await Promise.all([cargarContactos(), cargarTareas()]);

  estado.refresco = setInterval(() => {
    if (estado.pestana !== 'pacientes') return;
    if (estado.seleccionado) seleccionarContacto(estado.seleccionado, true);
    else if (document.activeElement !== $('#crm-buscar')) {
      cargarContactos($('#crm-buscar').value.trim());
    }
  }, 12000);
}

init();
