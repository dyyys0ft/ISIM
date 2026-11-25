import { api } from '../api.js';
import { $, $$, badge, escapeHtml, fmtFecha, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';
import { alSalir } from '../navegacion.js';

const parametros = new URLSearchParams(location.search);
const patientId = parametros.get('patientId') || '';

let temporizador = null;
let datosCargados = false;
let pacienteFiltro = null;
let usuarioActual = null;
let medicos = [];
let pacienteSeleccionado = null;
let pacientesTimer = null;
let pacientesSeq = 0;
let plantillasPorId = new Map();
let plantillaPreferidaId = '';
let tituloAutomatico = true;

async function cargarDocumentos() {
  const q = $('#buscar').value.trim();
  const estado = $('#filtro-estado').value;
  const lista = $('#lista');

  try {
    const documentos = await api.get(
      `/api/documents?q=${encodeURIComponent(q)}&estado=${encodeURIComponent(estado)}&patientId=${encodeURIComponent(patientId)}`
    );
    render(documentos);
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
    lista.replaceChildren();
  }
}

function render(documentos) {
  const lista = $('#lista');
  const vacio = $('#vacio');
  $('#contador').textContent = `${documentos.length} documento${documentos.length === 1 ? '' : 's'}`;

  if (!documentos.length) {
    lista.replaceChildren();
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  lista.innerHTML = documentos
    .map(
      (doc) => `
      <div class="doc-item-wrap">
      <a class="doc-item" data-nav="documentos" href="/documento.html?id=${encodeURIComponent(doc.id)}">
        <div class="doc-item__main">
          <div class="doc-item__title-row">
            <h3 class="doc-item__title">${escapeHtml(doc.titulo)}</h3>
            ${badge(doc.estado)}
          </div>
          <p class="doc-item__meta">
            ${escapeHtml(doc.nombres)} ${escapeHtml(doc.apellidos)} · ${escapeHtml(doc.paciente_cedula)}
            ${doc.codigo ? ` · Código: ${escapeHtml(doc.codigo)}` : ''}
          </p>
        </div>
        <div class="doc-item__side">
          <span class="doc-item__version">V${doc.version_actual}</span>
          <span>${escapeHtml(fmtFecha(doc.actualizado_en, { time: true }))}</span>
          <span>${doc.firmas} firma${doc.firmas === 1 ? '' : 's'}</span>
        </div>
      </a>
      ${
        puede(usuarioActual, 'documentos.firmar') &&
        ['borrador', 'pendiente_firma'].includes(doc.estado)
          ? `<button class="btn btn--sm doc-item__firmar" type="button" data-firmar-doc="${encodeURIComponent(
              doc.id
            )}">Firmar</button>`
          : ''
      }
      </div>`
    )
    .join('');
}

function seleccionarPaciente(paciente) {
  pacienteSeleccionado = paciente;
  $('#nuevo-paciente').value = paciente.id;
  $('#nuevo-paciente-busqueda').value = `${paciente.apellidos} ${paciente.nombres} — ${paciente.cedula}`;

  if (paciente.es_menor) {
    const representante = paciente.representantes?.[0];
    $('#paciente-seleccionado').textContent = representante
      ? `Menor de edad. Firmará su representante legal: ${representante.nombre} · C.I. ${representante.cedula}`
      : 'Menor de edad. Registra al representante legal en Pacientes antes de crear el consentimiento.';
  } else {
    $('#paciente-seleccionado').textContent = `Seleccionada: ${paciente.nombres} ${paciente.apellidos}`;
  }

  $('#resultados-pacientes').hidden = true;
  $('#resultados-pacientes').replaceChildren();
}

function limpiarPaciente() {
  pacienteSeleccionado = null;
  $('#nuevo-paciente').value = '';
  $('#paciente-seleccionado').textContent = 'Selecciona una paciente de los resultados.';
  $('#resultados-pacientes').hidden = true;
  $('#resultados-pacientes').replaceChildren();
}

function renderResultadosPacientes(pacientes) {
  const contenedor = $('#resultados-pacientes');
  if (!pacientes.length) {
    contenedor.innerHTML = '<p class="search-results__empty">Sin coincidencias</p>';
    contenedor.hidden = false;
    return;
  }

  contenedor.innerHTML = pacientes
    .map(
      (paciente) => `
      <button type="button" class="search-result" data-id="${escapeHtml(paciente.id)}">
        <strong>${escapeHtml(paciente.apellidos)} ${escapeHtml(paciente.nombres)}</strong>
        <span>C.I. ${escapeHtml(paciente.cedula)}</span>
      </button>`
    )
    .join('');
  contenedor.hidden = false;

  for (const boton of contenedor.querySelectorAll('.search-result')) {
    const paciente = pacientes.find((p) => p.id === boton.dataset.id);
    boton.addEventListener('click', () => seleccionarPaciente(paciente));
  }
}

async function buscarPacientes(q) {
  if (q.length < 2) {
    $('#resultados-pacientes').hidden = true;
    return;
  }

  const secuencia = ++pacientesSeq;
  try {
    const pacientes = await api.get(
      `/api/patients?q=${encodeURIComponent(q)}&limit=20`
    );
    if (secuencia !== pacientesSeq) return;
    renderResultadosPacientes(pacientes);
  } catch (error) {
    if (secuencia !== pacientesSeq) return;
    toast(error.message, 'error');
  }
}

async function abrirNuevo() {
  const dialogo = $('#dlg-nuevo');
  dialogo.showModal();

  if (datosCargados) {
    if (patientId && !pacienteSeleccionado) {
      try {
        const paciente = pacienteFiltro || (await api.get(`/api/patients/${encodeURIComponent(patientId)}`));
        seleccionarPaciente(paciente);
      } catch {
        // sin paciente preseleccionado
      }
    }
    let plantilla = plantillasPorId.get(String($('#nuevo-tipo').value));
    if (!plantilla && plantillaPreferidaId) {
      $('#nuevo-tipo').value = plantillaPreferidaId;
      plantilla = plantillasPorId.get(plantillaPreferidaId);
    }
    const titulo = $('#nuevo-titulo');
    if (plantilla && titulo && !titulo.value.trim()) {
      titulo.value = plantilla.nombre || '';
      tituloAutomatico = true;
    }
    preseleccionarMedico();
    return;
  }

  const selectPlantilla = $('#nuevo-tipo');
  const selectMedico = $('#nuevo-medico');

  try {
    const [plantillas, listaMedicos] = await Promise.all([
      api.get('/api/templates'),
      api.get('/api/medicos'),
    ]);

    medicos = listaMedicos;

    selectPlantilla.innerHTML =
      '<option value="">Documento en blanco (plantilla básica)</option>' +
      plantillas
        .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.nombre)}</option>`)
        .join('');

    selectMedico.innerHTML =
      '<option value="">Sin médico responsable</option>' +
      medicos
        .map(
          (m) =>
            `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nombre)}${
              m.tiene_firma ? '' : ' (sin firma registrada)'
            }</option>`
        )
        .join('');

    plantillasPorId = new Map(plantillas.map((t) => [String(t.id), t]));
    const plantillaInicial =
      plantillas.find((t) => /consentimiento/i.test(`${t.tipo || ''} ${t.nombre || ''}`)) ||
      plantillas[0];
    if (plantillaInicial) {
      plantillaPreferidaId = String(plantillaInicial.id);
      selectPlantilla.value = plantillaPreferidaId;
      const titulo = $('#nuevo-titulo');
      if (titulo && !titulo.value.trim()) {
        titulo.value = plantillaInicial.nombre || '';
        tituloAutomatico = true;
      }
    }

    if (patientId) {
      const paciente = pacienteFiltro || (await api.get(`/api/patients/${encodeURIComponent(patientId)}`));
      seleccionarPaciente(paciente);
    }

    preseleccionarMedico();
    datosCargados = true;
  } catch (error) {
    toast(`No se pudieron cargar los datos: ${error.message}`, 'error');
  }
}

function actualizarAvisoMedico() {
  const aviso = $('#nuevo-medico-aviso');
  const select = $('#nuevo-medico');
  if (!aviso || !select) return;
  const medico = medicos.find((m) => String(m.id) === String(select.value));
  if (!medico) {
    aviso.textContent = 'Sin médico responsable: el documento se creará sin firma profesional.';
  } else if (medico.tiene_firma) {
    aviso.textContent = 'Su firma se precargará en el documento.';
  } else {
    aviso.textContent = 'Este médico no tiene firma registrada; el documento se creará sin firma profesional.';
  }
}

function preseleccionarMedico() {
  const select = $('#nuevo-medico');
  if (!select) return;

  const propio = medicos.find((m) => String(m.id) === String(usuarioActual?.id));
  if (usuarioActual?.rol === 'medico' && propio?.tiene_firma) {
    select.value = propio.id;
    actualizarAvisoMedico();
    return;
  }

  const medico = medicos.find((m) => m.tiene_firma) || medicos[0];
  select.value = medico?.id || '';
  actualizarAvisoMedico();
}

async function firmarDocumentoDesdeLista(id) {
  const ventana = window.open(
    '',
    'firma_consentimiento',
    'popup=yes,width=1080,height=860'
  );
  try {
    const sesion = await api.post(
      `/api/documents/${encodeURIComponent(id)}/sign-session`
    );
    const url = new URL(sesion.url, location.origin).href;
    if (ventana && !ventana.closed) {
      ventana.location.href = url;
      toast('Sesión de firma iniciada');
      await cargarDocumentos();
    } else {
      window.location.href = `/documento.html?id=${encodeURIComponent(id)}`;
    }
  } catch (error) {
    ventana?.close();
    toast(error.message, 'error');
  }
}

async function crear(evento) {
  evento.preventDefault();
  const pacienteId = $('#nuevo-paciente').value;
  const titulo = $('#nuevo-titulo').value.trim();
  const plantillaId = $('#nuevo-tipo').value;
  const accionFirmar = evento.submitter?.dataset.accion === 'firmar';

  if (!pacienteId) return toast('Selecciona una paciente', 'error');
  if (!titulo) return toast('Escribe un título para el documento', 'error');

  // La ventana se abre antes del await para que el navegador no la bloquee.
  const ventana = accionFirmar
    ? window.open('', 'firma_consentimiento', 'popup=yes,width=1080,height=860')
    : null;
  const boton = accionFirmar ? $('#btn-crear-firmar') : $('#btn-crear');
  setBusy(boton, true, 'Creando…');

  try {
    const doc = await api.post('/api/documents', {
      patientId: pacienteId,
      titulo,
      templateId: plantillaId || null,
      medicoId: $('#nuevo-medico').value || null,
    });

    if (!accionFirmar) {
      setBusy(boton, false);
      $('#dlg-nuevo').close();
      window.location.href = `/documento.html?id=${encodeURIComponent(doc.id)}`;
      return;
    }

    try {
      const sesion = await api.post(
        `/api/documents/${encodeURIComponent(doc.id)}/sign-session`
      );
      const url = new URL(sesion.url, location.origin).href;
      setBusy(boton, false);
      $('#dlg-nuevo').close();
      if (ventana && !ventana.closed) {
        ventana.location.href = url;
        toast('Documento creado. Continúa la firma.');
        await cargarDocumentos();
      } else {
        window.location.href = `/documento.html?id=${encodeURIComponent(doc.id)}`;
      }
    } catch (falloFirma) {
      ventana?.close();
      setBusy(boton, false);
      $('#dlg-nuevo').close();
      toast(
        `Documento creado, pero no se pudo iniciar la firma: ${falloFirma.message}`,
        'error'
      );
      window.location.href = `/documento.html?id=${encodeURIComponent(doc.id)}`;
    }
  } catch (error) {
    ventana?.close();
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function cargarPacienteFiltro() {
  if (!patientId) return;

  try {
    pacienteFiltro = await api.get(`/api/patients/${encodeURIComponent(patientId)}`);
    $('#filtro-paciente-texto').textContent =
      `${pacienteFiltro.nombres} ${pacienteFiltro.apellidos}`;
    $('#filtro-paciente').hidden = false;
  } catch {
    toast('El paciente del filtro no está disponible', 'error');
  }
}

function conectarEventos() {
  $('#btn-nuevo').addEventListener('click', abrirNuevo);
  $('#form-nuevo').addEventListener('submit', crear);

  $('#nuevo-tipo').addEventListener('change', () => {
    const plantilla = plantillasPorId.get(String($('#nuevo-tipo').value));
    const titulo = $('#nuevo-titulo');
    if (plantilla && titulo && (tituloAutomatico || !titulo.value.trim())) {
      titulo.value = plantilla.nombre || '';
      tituloAutomatico = true;
    }
  });
  $('#nuevo-titulo').addEventListener('input', () => {
    tituloAutomatico = false;
  });
  $('#nuevo-medico').addEventListener('change', actualizarAvisoMedico);

  $('#lista').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-firmar-doc]');
    if (!boton) return;
    evento.preventDefault();
    evento.stopPropagation();
    firmarDocumentoDesdeLista(boton.dataset.firmarDoc);
  });

  $('#quitar-paciente').addEventListener('click', () => {
    window.location.href = '/documentos.html';
  });

  $$('[data-cerrar]').forEach((boton) =>
    boton.addEventListener('click', () => boton.closest('dialog').close())
  );

  $('#buscar').addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(cargarDocumentos, 260);
  });

  $('#nuevo-paciente-busqueda').addEventListener('input', () => {
    limpiarPaciente();
    $('#paciente-seleccionado').textContent = 'Escribe al menos 2 letras para buscar.';
    const q = $('#nuevo-paciente-busqueda').value.trim();
    clearTimeout(pacientesTimer);
    pacientesTimer = setTimeout(() => buscarPacientes(q), 260);
  });

  document.addEventListener('click', cerrarResultadosPaciente);

  alSalir(() => {
    clearTimeout(temporizador);
    clearTimeout(pacientesTimer);
    document.removeEventListener('click', cerrarResultadosPaciente);
  });

  $('#filtro-estado').addEventListener('change', cargarDocumentos);

  $('#dlg-nuevo').addEventListener('close', () => {
    $('#form-nuevo').reset();
    tituloAutomatico = true;
    limpiarPaciente();
    $('#nuevo-paciente-busqueda').value = '';
    $('#paciente-seleccionado').textContent = 'Escribe al menos 2 letras para buscar.';
  });
}

function cerrarResultadosPaciente(evento) {
  if (!evento.target.closest('#nuevo-paciente-busqueda, #resultados-pacientes')) {
    $('#resultados-pacientes').hidden = true;
  }
}

async function init() {
  usuarioActual = await initChrome({ active: 'documentos' });
  if (!usuarioActual) return;

  conectarEventos();
  await cargarPacienteFiltro();
  await cargarDocumentos();

  if (
    new URLSearchParams(location.search).get('nuevo') === '1' &&
    puede(usuarioActual, 'documentos.crear')
  ) {
    await abrirNuevo();
  }
}

init();
