import { api } from '../api.js';
import { $, escapeHtml, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { decorarHoja } from '../components/hoja.js';
import { puede } from '../permisos.js';

let plantillas = [];
let editando = null;

const MODOS_FIRMA = {
  ambas: 'Ambas firmas',
  paciente: 'Solo paciente',
  medico: 'Solo profesional',
};

function opcionesFirma(actual) {
  return Object.entries(MODOS_FIRMA)
    .map(
      ([valor, texto]) =>
        `<option value="${valor}" ${actual === valor ? 'selected' : ''}>${texto}</option>`
    )
    .join('');
}

async function cargar() {
  plantillas = await api.get('/api/templates/admin');
  render();
}

function render() {
  const lista = $('#lista-plantillas');

  if (!plantillas.length) {
    lista.innerHTML = '<div class="empty"><p>No hay plantillas registradas.</p></div>';
    return;
  }

  lista.innerHTML = plantillas
    .map(
      (plantilla) => `
      <article class="template-row" data-id="${escapeHtml(plantilla.id)}">
        <div class="template-row__main">
          <div class="row">
            <h3>${escapeHtml(plantilla.nombre)}</h3>
            <span class="badge badge--${plantilla.activo ? 'activo' : 'inactivo'}">
              ${plantilla.activo ? 'Activa' : 'Inactiva'}
            </span>
          </div>
          <p class="cell-sub">Tipo: ${escapeHtml(plantilla.tipo || 'general')} · ${escapeHtml(
            plantilla.creado_en ? new Date(plantilla.creado_en).toLocaleDateString('es-EC') : ''
          )}</p>
        </div>
        <div class="template-row__actions">
          <select
            class="select select--sm"
            data-action="firma-modo"
            aria-label="Firmas de la plantilla ${escapeHtml(plantilla.nombre)}"
            title="Firmas que se incluyen en los documentos de esta plantilla"
          >
            ${opcionesFirma(plantilla.firma_modo || 'ambas')}
          </select>
          <button class="btn btn--sm" type="button" data-action="previsualizar">Previsualizar</button>
          <button class="btn btn--sm" type="button" data-action="editar">Editar</button>
          ${
            plantilla.activo
              ? '<button class="btn btn--ghost btn--sm" type="button" data-action="desactivar">Desactivar</button>'
              : ''
          }
        </div>
      </article>`
    )
    .join('');

  for (const boton of lista.querySelectorAll('[data-action]')) {
    const fila = boton.closest('[data-id]');
    const plantilla = plantillas.find((p) => p.id === fila.dataset.id);

    if (boton.dataset.action === 'previsualizar') {
      boton.addEventListener('click', () => previsualizar(plantilla, boton));
    } else if (boton.dataset.action === 'editar') {
      boton.addEventListener('click', () => abrirFormulario(plantilla));
    } else if (boton.dataset.action === 'firma-modo') {
      boton.addEventListener('change', () => cambiarModoFirma(plantilla, boton));
    } else if (boton.dataset.action === 'desactivar') {
      boton.addEventListener('click', () => desactivar(plantilla));
    }
  }
}

async function previsualizar(plantilla, boton) {
  setBusy(boton, true, 'Cargando…');

  try {
    const datos = await api.get(
      `/api/templates/${encodeURIComponent(plantilla.id)}/preview`
    );

    $('#titulo-preview-plantilla').textContent = `Vista previa · ${datos.nombre}`;
    const hoja = $('#preview-plantilla-hoja');
    hoja.innerHTML = datos.html;

    decorarHoja(hoja, {
      logoUrl: datos.logoUrl,
      centro: datos.centro,
      pieTexto: datos.pieTexto,
      titulo: datos.nombre,
      paciente: datos.paciente,
      medico: datos.medico,
      firmaModo: datos.firmaModo,
    });

    setBusy(boton, false);
    $('#dlg-preview-plantilla').showModal();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function abrirFormulario(plantilla = null) {
  editando = plantilla;
  $('#form-plantilla').reset();
  $('#titulo-plantilla').textContent = plantilla ? 'Editar plantilla' : 'Nueva plantilla';
  $('#p-activo').checked = true;
  $('#p-firma-modo').value = 'ambas';

  if (plantilla) {
    $('#p-nombre').value = plantilla.nombre;
    $('#p-tipo').value = plantilla.tipo || '';
    $('#p-cuerpo').value = plantilla.cuerpo_html;
    $('#p-activo').checked = Boolean(plantilla.activo);
    $('#p-firma-modo').value = plantilla.firma_modo || 'ambas';
  }

  $('#dlg-plantilla').showModal();
  $('#p-nombre').focus();
}

async function guardar(evento) {
  evento.preventDefault();
  const boton = $('#btn-guardar-plantilla');

  const datos = {
    nombre: $('#p-nombre').value.trim(),
    tipo: $('#p-tipo').value.trim() || 'general',
    cuerpo_html: $('#p-cuerpo').value,
    firmaModo: $('#p-firma-modo').value,
    activo: $('#p-activo').checked,
  };

  if (!datos.nombre) return toast('Escribe un nombre para la plantilla', 'error');

  setBusy(boton, true, 'Guardando…');
  try {
    if (editando) {
      await api.patch(`/api/templates/${encodeURIComponent(editando.id)}`, datos);
      toast('Plantilla actualizada', 'success');
    } else {
      await api.post('/api/templates', datos);
      toast('Plantilla creada', 'success');
    }
    setBusy(boton, false);
    $('#dlg-plantilla').close();
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function cambiarModoFirma(plantilla, select) {
  const anterior = plantilla.firma_modo || 'ambas';
  select.disabled = true;

  try {
    await api.patch(`/api/templates/${encodeURIComponent(plantilla.id)}`, {
      firmaModo: select.value,
    });
    plantilla.firma_modo = select.value;
    toast(`Firmas de "${plantilla.nombre}": ${MODOS_FIRMA[select.value]}`, 'success');
  } catch (error) {
    select.value = anterior;
    toast(error.message, 'error');
  } finally {
    select.disabled = false;
  }
}

async function desactivar(plantilla) {
  if (!window.confirm(`¿Desactivar la plantilla "${plantilla.nombre}"? Los documentos ya creados no se alteran.`)) {
    return;
  }

  try {
    await api.delete(`/api/templates/${encodeURIComponent(plantilla.id)}`);
    toast('Plantilla desactivada', 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function conectarEventos() {
  $('#btn-nueva-plantilla').addEventListener('click', () => abrirFormulario(null));
  $('#form-plantilla').addEventListener('submit', guardar);

  for (const boton of document.querySelectorAll('[data-cerrar]')) {
    boton.addEventListener('click', () => boton.closest('dialog').close());
  }

  $('#dlg-plantilla').addEventListener('close', () => {
    editando = null;
  });
}

async function init() {
  const usuario = await initChrome({ active: 'plantillas' });
  if (!usuario) return;

  if (!puede(usuario, 'plantillas.gestionar')) {
    window.location.replace('/documentos.html');
    return;
  }

  conectarEventos();
  await cargar();
}

init();
