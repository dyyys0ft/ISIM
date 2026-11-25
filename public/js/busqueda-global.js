import { api } from './api.js';
import { puede } from './permisos.js';
import { escapeHtml, initials, toast } from './ui.js';

const RUTAS_SIN_BARRA = new Set([
  '/paciente.html',
  '/documento.html',
  '/consulta-imprimir.html',
  '/firma.html',
  '/certificado.html',
  '/receta.html',
]);

let usuarioActual = null;
let dialogo = null;
let entrada = null;
let resultados = null;
let estado = null;
let temporizador = null;
let secuencia = 0;
let barra = null;
let eventosListos = false;

function edad(fecha) {
  if (!fecha) return null;
  const nacimiento = new Date(`${String(fecha).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  let anios = hoy.getFullYear() - nacimiento.getFullYear();
  const meses = hoy.getMonth() - nacimiento.getMonth();
  if (meses < 0 || (meses === 0 && hoy.getDate() < nacimiento.getDate())) anios -= 1;
  return anios >= 0 && anios < 130 ? anios : null;
}

function crearDialogo() {
  if (dialogo?.isConnected) return;

  dialogo = document.createElement('dialog');
  dialogo.className = 'cmd';
  dialogo.id = 'cmd-busqueda';
  dialogo.setAttribute('aria-labelledby', 'cmd-titulo');
  dialogo.innerHTML = `
    <div class="cmd__cabecera">
      <svg class="cmd__lupa" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7"></circle>
        <path d="m20 20-3.5-3.5"></path>
      </svg>
      <h2 class="sr-only" id="cmd-titulo">Buscar paciente o acción</h2>
      <input
        class="cmd__input"
        id="cmd-entrada"
        type="search"
        placeholder="Busca una paciente, cédula o acción…"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        aria-label="Buscar paciente o acción"
        aria-controls="cmd-resultados"
        autofocus
      />
      <button class="cmd__cerrar" type="button" data-cerrar-cmd aria-label="Cerrar búsqueda">✕</button>
    </div>
    <div class="cmd__resultados" id="cmd-resultados"></div>
    <p class="sr-only" id="cmd-estado" aria-live="polite"></p>
    <div class="cmd__pie" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
      <span><kbd>Enter</kbd> abrir</span>
      <span><kbd>Esc</kbd> cerrar</span>
    </div>
  `;
  document.body.append(dialogo);

  entrada = dialogo.querySelector('#cmd-entrada');
  resultados = dialogo.querySelector('#cmd-resultados');
  estado = dialogo.querySelector('#cmd-estado');

  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo || evento.target.closest('[data-cerrar-cmd]')) {
      evento.preventDefault();
      dialogo.close();
    }
  });

  entrada.addEventListener('input', () => {
    clearTimeout(temporizador);
    const consulta = entrada.value.trim();
    temporizador = setTimeout(() => buscar(consulta), 240);
  });

  entrada.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      enfocarPrimero();
    } else if (evento.key === 'Enter') {
      const primero = resultados.querySelector('[data-cmd-url]');
      if (primero) {
        evento.preventDefault();
        navegar(primero.dataset.cmdUrl);
      }
    }
  });

  resultados.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-cmd-url]');
    if (!boton) return;
    navegar(boton.dataset.cmdUrl);
  });

  dialogo.addEventListener('keydown', (evento) => {
    if (evento.key !== 'ArrowDown' && evento.key !== 'ArrowUp') return;
    const items = [...resultados.querySelectorAll('[data-cmd-url]')];
    if (!items.length) return;
    evento.preventDefault();
    const actual = document.activeElement;
    const indice = items.indexOf(actual);
    const siguiente =
      evento.key === 'ArrowDown'
        ? items[(indice + 1 + items.length) % items.length]
        : items[(indice - 1 + items.length) % items.length];
    siguiente.focus();
  });
}

function enfocarPrimero() {
  resultados.querySelector('[data-cmd-url]')?.focus();
}

function navegar(url) {
  if (!url) return;
  dialogo?.close();
  window.location.href = url;
}

function accion(id, etiqueta, descripcion, url) {
  return `<button class="cmd__item" type="button" data-cmd-url="${escapeHtml(url)}" data-cmd-id="${id}">
    <span class="cmd__item-icono" aria-hidden="true">${id === 'cita' ? '+' : id === 'paciente' ? '👤' : id === 'documento' ? '📄' : '→'}</span>
    <span class="cmd__item-texto">
      <strong>${escapeHtml(etiqueta)}</strong>
      <small>${escapeHtml(descripcion)}</small>
    </span>
    <span class="cmd__item-flecha" aria-hidden="true">↵</span>
  </button>`;
}

function accionesBase(consulta) {
  const acciones = [];
  if (puede(usuarioActual, 'agenda.gestionar')) {
    acciones.push(
      accion('cita', 'Nueva cita', 'Agendar una paciente en la agenda', '/agenda.html?nueva=1')
    );
  }
  if (puede(usuarioActual, 'pacientes.crear')) {
    acciones.push(
      accion('paciente', 'Nuevo paciente', 'Registro rápido con los datos mínimos', '/pacientes.html?nuevo=1')
    );
  }
  if (puede(usuarioActual, 'documentos.crear')) {
    acciones.push(
      accion(
        'documento',
        'Nuevo consentimiento',
        'Crear un documento desde una plantilla',
        '/documentos.html?nuevo=1'
      )
    );
  }
  if (puede(usuarioActual, 'agenda.ver')) {
    acciones.push(accion('agenda', 'Ir a la agenda', 'Ver las citas del día', '/agenda.html'));
  }
  if (puede(usuarioActual, 'pacientes.ver')) {
    acciones.push(accion('pacientes', 'Ir a pacientes', 'Buscar en el registro de pacientes', '/pacientes.html'));
  }

  if (!consulta) return acciones.join('');
  const normalizada = consulta.toLocaleLowerCase('es');
  return acciones
    .filter((html) => html.toLocaleLowerCase('es').includes(normalizada))
    .join('');
}

function renderPacientes(pacientes, consulta) {
  if (!pacientes.length) {
    return `<div class="cmd__vacio">
      <strong>Sin coincidencias</strong>
      <p>No encontramos una paciente con “${escapeHtml(consulta)}”.</p>
    </div>`;
  }

  return `<div class="cmd__grupo-titulo">Pacientes</div>
    <div class="cmd__pacientes">
      ${pacientes
        .map((paciente) => {
          const nombre = `${paciente.apellidos || ''} ${paciente.nombres || ''}`.trim();
          const anios = edad(paciente.fecha_nacimiento);
          const detalle = [
            paciente.cedula ? `C.I. ${paciente.cedula}` : null,
            anios != null ? `${anios} años` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const ficha = `/paciente.html?id=${encodeURIComponent(paciente.id)}`;
          const cita = `/agenda.html?patientId=${encodeURIComponent(paciente.id)}`;
          const documento = `/documentos.html?patientId=${encodeURIComponent(paciente.id)}&nuevo=1`;
          return `<article class="cmd__paciente">
            <button class="cmd__paciente-principal" type="button" data-cmd-url="${escapeHtml(ficha)}">
              <span class="avatar cmd__avatar" aria-hidden="true">${escapeHtml(initials(nombre))}</span>
              <span class="cmd__paciente-texto">
                <strong>${escapeHtml(nombre || 'Paciente')}</strong>
                <small>${escapeHtml(detalle || 'Sin datos de identificación')}</small>
              </span>
              <span class="cmd__item-flecha" aria-hidden="true">↵</span>
            </button>
            <span class="cmd__paciente-acciones">
              ${
                puede(usuarioActual, 'agenda.gestionar')
                  ? `<button class="cmd__chip" type="button" data-cmd-url="${escapeHtml(cita)}" aria-label="Nueva cita para ${escapeHtml(nombre)}">Cita</button>`
                  : ''
              }
              ${
                puede(usuarioActual, 'documentos.crear')
                  ? `<button class="cmd__chip" type="button" data-cmd-url="${escapeHtml(documento)}" aria-label="Nuevo consentimiento para ${escapeHtml(nombre)}">Consentimiento</button>`
                  : ''
              }
            </span>
          </article>`;
        })
        .join('')}
    </div>`;
}

async function buscar(consulta) {
  if (!dialogo?.open) return;
  const q = consulta.trim();
  const base = accionesBase(q);
  const buscarEnPacientes = q && puede(usuarioActual, 'pacientes.ver')
    ? `<button class="cmd__item cmd__item--secundario" type="button" data-cmd-url="${escapeHtml(
        `/pacientes.html?q=${encodeURIComponent(q)}`
      )}">
        <span class="cmd__item-icono" aria-hidden="true">⌕</span>
        <span class="cmd__item-texto">
          <strong>Buscar “${escapeHtml(q)}” en Pacientes</strong>
          <small>Abrir el listado con este filtro</small>
        </span>
        <span class="cmd__item-flecha" aria-hidden="true">↵</span>
      </button>`
    : '';

  if (q.length < 2 || !puede(usuarioActual, 'pacientes.ver')) {
    resultados.innerHTML = `${base || (buscarEnPacientes ? '' : '<div class="cmd__vacio"><strong>Escribe al menos 2 letras</strong><p>Busca por nombre, apellido o cédula.</p></div>')}${buscarEnPacientes}`;
    estado.textContent = base ? 'Acciones disponibles' : 'Escribe al menos dos letras para buscar pacientes';
    return;
  }

  const actual = ++secuencia;
  resultados.innerHTML = `${base}${buscarEnPacientes}<div class="cmd__cargando">Buscando pacientes…</div>`;
  try {
    const pacientes = await api.get(
      `/api/patients/search?q=${encodeURIComponent(q)}&limit=8`
    );
    if (actual !== secuencia || !dialogo?.open) return;
    resultados.innerHTML = `${base}${renderPacientes(pacientes, q)}${buscarEnPacientes}`;
    estado.textContent = `${pacientes.length} paciente${pacientes.length === 1 ? '' : 's'} encontrada${pacientes.length === 1 ? '' : 's'}`;
  } catch (error) {
    if (actual !== secuencia) return;
    resultados.innerHTML = `${base}${buscarEnPacientes}<div class="cmd__vacio"><strong>No se pudo buscar</strong><p>${escapeHtml(error.message)}</p></div>`;
    estado.textContent = 'Error al buscar pacientes';
  }
}

export function abrirBusquedaGlobal() {
  crearDialogo();
  entrada.value = '';
  if (!dialogo.open) dialogo.showModal();
  buscar('');
  requestAnimationFrame(() => entrada.focus());
}

function construirBarra() {
  if (barra) barra.remove();
  const acciones = [];
  if (puede(usuarioActual, 'agenda.ver')) {
    acciones.push(
      '<a class="quickbar__item" href="/agenda.html"><span aria-hidden="true">▦</span><span>Agenda</span></a>'
    );
  }
  if (puede(usuarioActual, 'agenda.gestionar')) {
    acciones.push(
      '<a class="quickbar__item quickbar__item--principal" href="/agenda.html?nueva=1"><span aria-hidden="true">＋</span><span>Cita</span></a>'
    );
  }
  if (puede(usuarioActual, 'pacientes.crear')) {
    acciones.push(
      '<a class="quickbar__item" href="/pacientes.html?nuevo=1"><span aria-hidden="true">＋</span><span>Paciente</span></a>'
    );
  }
  if (puede(usuarioActual, 'pacientes.ver') || acciones.length) {
    acciones.push(
      '<button class="quickbar__item" type="button" data-abrir-busqueda><span aria-hidden="true">⌕</span><span>Buscar</span></button>'
    );
  }

  if (!acciones.length) {
    document.body.classList.remove('quickbar-visible', 'sin-quickbar');
    return;
  }

  barra = document.createElement('nav');
  barra.className = 'quickbar no-print';
  barra.setAttribute('aria-label', 'Acciones rápidas');
  barra.innerHTML = acciones.join('');
  document.body.append(barra);

  const sinBarra = RUTAS_SIN_BARRA.has(location.pathname);
  document.body.classList.toggle('sin-quickbar', sinBarra);
  document.body.classList.toggle('quickbar-visible', !sinBarra);
}

function conectarEventosGlobales() {
  if (eventosListos) return;
  eventosListos = true;

  document.addEventListener('click', (evento) => {
    if (evento.target.closest('[data-abrir-busqueda]')) {
      evento.preventDefault();
      abrirBusquedaGlobal();
    }
  });

  document.addEventListener('keydown', (evento) => {
    const esAtajo = (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k';
    if (!esAtajo) return;
    evento.preventDefault();
    abrirBusquedaGlobal();
  });
}

export function initBusquedaGlobal(usuario) {
  usuarioActual = usuario;
  conectarEventosGlobales();
  construirBarra();
}
