import { api } from '../api.js';
import { $, $$, badge, escapeHtml, fmtFecha, initials, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';
import { htmlContactoPrivado, activarContactoPrivado } from '../privacidad.js';

let pacientes = [];
let temporizador = null;
let usuarioActual = null;
let paginaActual = 1;
let totalPaginas = 1;
let totalPacientes = 0;
let totalIncompletos = 0;
let totalSinConsentimiento = 0;
let filtroSinConsentimiento = false;
let ordenActual = 'nombre_asc';
const LIMITE_PAGINA = 24;
const COLUMNAS_KEY = 'pacientes-columnas';
let columnasPacientes = Number(localStorage.getItem(COLUMNAS_KEY)) || 4;
if (![3, 4, 5, 6, 7].includes(columnasPacientes)) columnasPacientes = 4;

const CAMPOS_REPRESENTANTES = {
  representante1_nombre: '#p-rep1-nombre',
  representante1_cedula: '#p-rep1-cedula',
  representante1_parentesco: '#p-rep1-parentesco',
  representante1_telefono: '#p-rep1-telefono',
  representante2_nombre: '#p-rep2-nombre',
  representante2_cedula: '#p-rep2-cedula',
  representante2_parentesco: '#p-rep2-parentesco',
  representante2_telefono: '#p-rep2-telefono',
};

function calcularEdad(fecha) {
  if (!fecha) return null;
  const nacimiento = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return null;

  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const meses = hoy.getMonth() - nacimiento.getMonth();
  if (meses < 0 || (meses === 0 && hoy.getDate() < nacimiento.getDate())) edad -= 1;

  return edad >= 0 && edad < 130 ? edad : null;
}

function etiquetaSexo(sexo) {
  return { F: 'Femenino', M: 'Masculino', X: 'Otro' }[sexo] || '';
}

function esMenorDeEdad(fecha) {
  const edad = calcularEdad(fecha);
  return edad !== null && edad < 18;
}

function actualizarBloqueRepresentantes() {
  const menor = esMenorDeEdad($('#p-nacimiento').value);
  $('#bloque-representantes').hidden = !menor;
  $('#p-rep1-nombre').required = menor;
  $('#p-rep1-cedula').required = menor;
}

async function cargar(pagina = paginaActual) {
  const params = new URLSearchParams({
    page: String(pagina),
    limit: String(LIMITE_PAGINA),
    orden: ordenActual,
  });
  const q = $('#buscar-paciente').value.trim();
  const nombre = $('#buscar-nombre').value.trim();
  const apellido = $('#buscar-apellido').value.trim();
  const cedula = $('#buscar-cedula').value.trim();
  if (q) params.set('q', q);
  if (nombre) params.set('nombre', nombre);
  if (apellido) params.set('apellido', apellido);
  if (cedula) params.set('cedula', cedula);
  if (filtroSinConsentimiento) params.set('sinConsentimiento', '1');

  try {
    const resultado = await api.get(`/api/patients/paginated?${params.toString()}`);
    pacientes = resultado.items;
    paginaActual = resultado.page;
    totalPaginas = resultado.pages;
    totalPacientes = resultado.total;
    totalIncompletos = resultado.incompletos;
    totalSinConsentimiento = resultado.sinConsentimiento || 0;
    render();
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
  }
}

function renderPaginacion() {  const contenedor = $('#paginacion');
  if (totalPaginas <= 1) {
    contenedor.hidden = true;
    contenedor.replaceChildren();
    return;
  }

  contenedor.hidden = false;
  contenedor.innerHTML = `
    <button class="btn btn--sm" id="pag-anterior" type="button" ${
      paginaActual <= 1 ? 'disabled' : ''
    }>‹ Anterior</button>
    <span class="paginacion__pagina">Página ${paginaActual} de ${totalPaginas}</span>
    <button class="btn btn--sm" id="pag-siguiente" type="button" ${
      paginaActual >= totalPaginas ? 'disabled' : ''
    }>Siguiente ›</button>
    <span class="paginacion__info">${totalPacientes} registros</span>
  `;

  $('#pag-anterior')?.addEventListener('click', () => cargar(paginaActual - 1));
  $('#pag-siguiente')?.addEventListener('click', () => cargar(paginaActual + 1));
}

function aplicarColumnas() {
  const lista = $('#lista');
  if (!lista) return;
  lista.style.setProperty('--paciente-columnas', String(columnasPacientes));
  for (const boton of $$('[data-columnas]')) {
    const activo = Number(boton.dataset.columnas) === columnasPacientes;
    boton.classList.toggle('is-active', activo);
    boton.setAttribute('aria-pressed', String(activo));
  }
}

function pintarOrden() {
  for (const boton of $$('[data-orden]')) {
    const activo = boton.dataset.orden === ordenActual;
    boton.setAttribute('aria-pressed', String(activo));
    boton.classList.toggle('is-active', activo);
  }
}

function renderAlertaConsentimiento() {
  const alerta = $('#alerta-sin-consentimiento');
  if (!alerta) return;

  if (!totalSinConsentimiento && !filtroSinConsentimiento) {
    alerta.hidden = true;
    return;
  }

  alerta.hidden = false;
  const cantidad = filtroSinConsentimiento ? totalPacientes : totalSinConsentimiento;
  const numero = Number(cantidad).toLocaleString('es-EC');
  const texto =
    cantidad === 1 ? 'paciente' : 'pacientes';
  $('#alerta-sin-consentimiento-texto').textContent = filtroSinConsentimiento
    ? `Mostrando ${numero} ${texto} sin consentimiento LOPDP registrado.`
    : `${numero} ${texto} ${cantidad === 1 ? 'no tiene' : 'no tienen'} registrado el consentimiento LOPDP.`;

  const boton = $('#btn-filtrar-sin-consentimiento');
  boton.textContent = filtroSinConsentimiento ? 'Ver todos' : 'Ver pacientes';
  boton.setAttribute('aria-pressed', String(filtroSinConsentimiento));
}

function render() {
  renderAlertaConsentimiento();
  const lista = $('#lista');
  const vacio = $('#vacio');
  const resumen = `${totalPacientes} paciente${totalPacientes === 1 ? '' : 's'}${
    totalIncompletos ? ` · ${totalIncompletos} por actualizar` : ''
  }`;
  $('#contador-resultados').textContent = resumen;
  renderPaginacion();

  if (!pacientes.length) {
    lista.replaceChildren();
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;

  const puedeDesactivar = puede(usuarioActual, 'pacientes.desactivar');
  const puedeDocumentos = puede(usuarioActual, 'documentos.ver');

  lista.innerHTML = pacientes
    .map((paciente) => {
      const edad = calcularEdad(paciente.fecha_nacimiento);
      const sexo = etiquetaSexo(paciente.sexo);
      const menor = edad != null && edad < 18;
      const nombreCompleto = `${paciente.nombres} ${paciente.apellidos}`.trim();
      const detalle = [edad != null ? `${edad} años` : null, sexo || null]
        .filter(Boolean)
        .join(' · ');

      return `
        <article class="patient-card" data-id="${escapeHtml(paciente.id)}">
          <div class="patient-card__head">
            <span class="avatar patient-card__avatar" aria-hidden="true">${escapeHtml(
              initials(nombreCompleto)
            )}</span>
            <div class="patient-card__identity">
              <h3 class="patient-card__name" title="${escapeHtml(nombreCompleto)}">${escapeHtml(
                paciente.nombres
              )} ${escapeHtml(paciente.apellidos)}</h3>
              <p class="patient-card__cedula">C.I. ${escapeHtml(paciente.cedula)}</p>
            </div>
          </div>

          <div class="patient-card__badges">
            ${menor ? '<span class="badge badge--programada">Menor</span>' : ''}
            ${
              !String(paciente.consentimiento_datos || '').trim()
                ? '<span class="badge badge--reagendada">Sin consentimiento LOPDP</span>'
                : ''
            }
            ${
              paciente.datos_incompletos
                ? '<span class="badge badge--reagendada">Datos por actualizar</span>'
                : ''
            }
          </div>

          <div class="patient-card__chips">
            ${detalle ? `<span class="patient-chip">${escapeHtml(detalle)}</span>` : ''}
            ${
              paciente.ciudad
                ? `<span class="patient-chip" title="Ciudad">📍 ${escapeHtml(
                    paciente.ciudad
                  )}</span>`
                : ''
            }
          </div>
          ${htmlContactoPrivado(paciente, { compacto: true })}

          ${
            paciente.datos_incompletos && paciente.datos_incompletos_detalle
              ? `<p class="patient-card__pendiente" title="${escapeHtml(
                  paciente.datos_incompletos_detalle
                )}"><strong>Pendiente:</strong> ${escapeHtml(
                  paciente.datos_incompletos_detalle
                )}</p>`
              : ''
          }

          <div class="patient-card__actions">
            <a class="btn btn--sm btn--ficha" href="/paciente.html?id=${encodeURIComponent(
              paciente.id
            )}">Ficha</a>
            ${
              puede(usuarioActual, 'historias.ver')
                ? `<a class="btn btn--sm btn--historia" href="/paciente.html?id=${encodeURIComponent(
                    paciente.id
                  )}&tab=historia">Historia</a>`
                : ''
            }
            ${
              puedeDocumentos
                ? '<button class="btn btn--sm btn--documentos" type="button" data-action="documentos">Documentos</button>'
                : ''
            }
            ${
              puede(usuarioActual, 'agenda.gestionar')
                ? `<a class="btn btn--sm btn--agendar" href="/agenda.html?patientId=${encodeURIComponent(
                    paciente.id
                  )}">Agendar</a>`
                : ''
            }
            ${puedeDesactivar ? '<button class="btn btn--sm btn--desactivar" type="button" data-action="desactivar">Desactivar</button>' : ''}
          </div>
        </article>`;
    })
    .join('');

  for (const boton of $$('[data-action]', lista)) {
    const tarjeta = boton.closest('[data-id]');
    const paciente = pacientes.find((p) => p.id === tarjeta.dataset.id);

    if (boton.dataset.action === 'desactivar') {
      boton.addEventListener('click', () => desactivar(paciente));
    }

    if (boton.dataset.action === 'documentos') {
      boton.addEventListener('click', () => abrirDocumentosPaciente(paciente));
    }
  }

  activarContactoPrivado(lista);
}

async function abrirDocumentosPaciente(paciente) {
  const dialogo = $('#dlg-documentos-paciente');
  const lista = $('#documentos-paciente-lista');
  const resumen = $('#documentos-paciente-resumen');
  const nombre = `${paciente.nombres} ${paciente.apellidos}`.trim();

  $('#documentos-paciente-titulo').textContent = `Documentos de ${nombre}`;
  resumen.textContent = 'Cargando historial…';
  lista.innerHTML = '<p class="muted small">Cargando documentos…</p>';
  dialogo.showModal();

  try {
    const documentos = await api.get(
      `/api/patients/${encodeURIComponent(paciente.id)}/documents`
    );
    const firmados = documentos.filter((doc) => doc.estado === 'firmado').length;
    resumen.textContent = `${documentos.length} documento${
      documentos.length === 1 ? '' : 's'
    } · ${firmados} firmado${firmados === 1 ? '' : 's'}`;

    if (!documentos.length) {
      lista.innerHTML =
        '<p class="muted small">Esta paciente todavía no tiene documentos registrados.</p>';
      return;
    }

    lista.innerHTML = documentos
      .map(
        (doc) => `
        <a class="doc-item" data-nav="documentos" href="/documento.html?id=${encodeURIComponent(doc.id)}">
          <div class="doc-item__main">
            <div class="doc-item__title-row">
              <h3 class="doc-item__title">${escapeHtml(doc.titulo)}</h3>
              ${badge(doc.estado)}
            </div>
            <p class="doc-item__meta">
              ${doc.codigo ? `Código: ${escapeHtml(doc.codigo)} · ` : ''}
              ${doc.firmas} firma${doc.firmas === 1 ? '' : 's'}
            </p>
          </div>
          <div class="doc-item__side">
            <span class="doc-item__version">V${doc.version_actual}</span>
            <span>${escapeHtml(fmtFecha(doc.actualizado_en, { time: true }))}</span>
          </div>
        </a>`
      )
      .join('');
  } catch (error) {
    resumen.textContent = '';
    lista.innerHTML = `<p class="muted small">${escapeHtml(error.message)}</p>`;
    toast(error.message, 'error');
  }
}

function abrirFormulario() {
  const formulario = $('#form-paciente');
  formulario.reset();
  const masDatos = $('#p-mas-datos');
  if (masDatos) masDatos.open = false;

  $('#titulo-paciente').textContent = 'Nuevo paciente';
  $('#btn-guardar-paciente').textContent = 'Registrar paciente';

  const avisoPendiente = $('#p-datos-pendientes');
  if (avisoPendiente) {
    avisoPendiente.hidden = true;
    avisoPendiente.textContent = '';
  }

  actualizarBloqueRepresentantes();
  $('#dlg-paciente').showModal();
  $('#p-nombres').focus();
}

async function guardar(evento) {
  evento.preventDefault();
  const boton = $('#btn-guardar-paciente');

  const datos = {
    cedula: $('#p-cedula').value.trim(),
    nombres: $('#p-nombres').value.trim(),
    apellidos: $('#p-apellidos').value.trim(),
    fecha_nacimiento: $('#p-nacimiento').value,
    sexo: $('#p-sexo').value,
    telefono: $('#p-telefono').value.trim(),
    email: $('#p-email').value.trim(),
    direccion: $('#p-direccion').value.trim(),
    ocupacion: $('#p-ocupacion').value.trim(),
    estado_civil: $('#p-estado-civil').value,
    ciudad: $('#p-ciudad').value.trim(),
    alergias: $('#p-alergias').value.trim(),
    notas: $('#p-notas').value.trim(),
  };

  for (const [campo, selector] of Object.entries(CAMPOS_REPRESENTANTES)) {
    datos[campo] = $(selector).value.trim();
  }

  if (!datos.cedula || !datos.nombres || !datos.apellidos) {
    return toast('Cédula, nombres y apellidos son obligatorios', 'error');
  }

  if (esMenorDeEdad(datos.fecha_nacimiento) && (!datos.representante1_nombre || !datos.representante1_cedula)) {
    return toast('El paciente es menor de edad: registra el representante legal 1', 'error');
  }

  setBusy(boton, true, 'Guardando…');
  try {
    await api.post('/api/patients', datos);
    toast('Paciente registrado', 'success');
    setBusy(boton, false);
    $('#dlg-paciente').close();
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
    if (error.status === 409) $('#p-cedula').focus();
  }
}

async function desactivar(paciente) {
  const nombre = `${paciente.nombres} ${paciente.apellidos}`;
  const confirmado = window.confirm(
    `¿Desactivar a ${nombre}? Sus documentos y firmas se conservan, pero no aparecerá para nuevos trámites.`
  );
  if (!confirmado) return;

  try {
    await api.delete(`/api/patients/${encodeURIComponent(paciente.id)}`);
    toast('Paciente desactivado', 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function conectarEventos() {
  $('#btn-nuevo').addEventListener('click', () => abrirFormulario(null));
  $('#form-paciente').addEventListener('submit', guardar);
  $('#p-nacimiento').addEventListener('change', actualizarBloqueRepresentantes);
  $('#p-nacimiento').addEventListener('input', actualizarBloqueRepresentantes);

  $$('[data-cerrar]').forEach((boton) =>
    boton.addEventListener('click', () => boton.closest('dialog').close())
  );

  $('#form-filtros-pacientes').addEventListener('submit', (evento) => {
    evento.preventDefault();
    cargar(1);
  });

  for (const selector of [
    '#buscar-paciente',
    '#buscar-nombre',
    '#buscar-apellido',
    '#buscar-cedula',
  ]) {
    $(selector).addEventListener('input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => cargar(1), 260);
    });
  }

  $('#btn-limpiar-busqueda').addEventListener('click', () => {
    $('#buscar-paciente').value = '';
    $('#buscar-nombre').value = '';
    $('#buscar-apellido').value = '';
    $('#buscar-cedula').value = '';
    ordenActual = 'nombre_asc';
    filtroSinConsentimiento = false;
    pintarOrden();
    cargar(1);
  });

  $('#btn-filtrar-sin-consentimiento').addEventListener('click', () => {
    filtroSinConsentimiento = !filtroSinConsentimiento;
    cargar(1);
  });

  for (const boton of $$('[data-orden]')) {
    boton.addEventListener('click', () => {
      if (ordenActual === boton.dataset.orden) return;
      ordenActual = boton.dataset.orden;
      pintarOrden();
      cargar(1);
    });
  }

  for (const boton of $$('[data-columnas]')) {
    boton.addEventListener('click', () => {
      columnasPacientes = Number(boton.dataset.columnas);
      if (![3, 4, 5, 6, 7].includes(columnasPacientes)) return;
      localStorage.setItem(COLUMNAS_KEY, String(columnasPacientes));
      aplicarColumnas();
    });
  }

  $('#dlg-paciente').addEventListener('close', () => {
    $('#bloque-representantes').hidden = true;
    const masDatos = $('#p-mas-datos');
    if (masDatos) masDatos.open = false;
  });
}

async function init() {
  usuarioActual = await initChrome({ active: 'pacientes' });
  if (!usuarioActual) return;

  conectarEventos();
  aplicarColumnas();
  pintarOrden();

  const parametros = new URLSearchParams(location.search);
  const qInicial = parametros.get('q');
  if (qInicial) $('#buscar-paciente').value = qInicial;

  await cargar();

  if (parametros.get('nuevo') === '1' && puede(usuarioActual, 'pacientes.crear')) {
    abrirFormulario(null);
  }
}

init();
