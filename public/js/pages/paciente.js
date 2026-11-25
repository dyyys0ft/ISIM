import { api } from '../api.js';
import { $, $$, escapeHtml, fmtFecha, initials, toast, modal, confirmar } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';
import { htmlContactoPrivado, activarContactoPrivado } from '../privacidad.js';

/** Pestañas de la ficha, en el orden del proyecto final. */
const TABS = [
  {
    id: 'datos',
    titulo: 'Datos de la paciente',
    corto: 'Datos',
    permiso: 'pacientes.ver',
    editar: 'pacientes.editar',
  },
  {
    id: 'signos',
    titulo: 'Signos vitales',
    corto: 'Signos',
    permiso: ['historias.resumen', 'historias.ver'],
    editar: 'historias.gestionar',
  },
  {
    id: 'historia',
    titulo: 'Historia clínica',
    corto: 'Historia',
    permiso: ['historias.resumen', 'historias.ver'],
    editar: 'historias.gestionar',
  },
  {
    id: 'consulta',
    titulo: 'Consulta del día',
    corto: 'Consulta',
    permiso: 'historias.ver',
    editar: 'historias.gestionar',
  },
  {
    id: 'receta',
    titulo: 'Receta',
    corto: 'Receta',
    permiso: 'historias.ver',
    editar: 'historias.gestionar',
  },
  {
    id: 'examenes',
    titulo: 'Exámenes',
    corto: 'Exámenes',
    permiso: ['historias.resumen', 'historias.ver'],
    editar: 'examenes.gestionar',
  },
  {
    id: 'pedidos',
    titulo: 'Pedidos',
    corto: 'Pedidos',
    permiso: 'historias.ver',
    editar: 'historias.gestionar',
  },
  {
    id: 'consentimientos',
    titulo: 'Consentimientos',
    corto: 'Consent.',
    permiso: 'documentos.ver',
    editar: ['documentos.crear', 'documentos.firmar'],
  },
  {
    id: 'certificados',
    titulo: 'Certificados',
    corto: 'Certif.',
    permiso: 'historias.ver',
    editar: 'historias.gestionar',
  },
];

const parametros = new URLSearchParams(location.search);
const pacienteId = parametros.get('id');
const citaId = parametros.get('cita');

let usuario = null;
let paciente = null;
let cita = null;
let tabActual = parametros.get('tab') || '';
let tabsResizeConectado = false;

function actualizarTabsDesborde() {
  const tabs = $('#tabs-ficha');
  const wrap = $('#tabs-ficha-wrap');
  if (!tabs) return;
  const alInicio = tabs.scrollLeft <= 2;
  const alFin = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 2;
  for (const nodo of [tabs, wrap]) {
    nodo?.classList.toggle('tabs--inicio', alInicio);
    nodo?.classList.toggle('tabs--fin', alFin);
  }
}

function autorizado(permiso) {
  if (!permiso) return true;
  if (Array.isArray(permiso)) return permiso.some((p) => puede(usuario, p));
  return puede(usuario, permiso);
}

function urlDeTab(id) {
  const params = new URLSearchParams({ id: pacienteId, tab: id });
  if (citaId) params.set('cita', citaId);
  return `/paciente.html?${params.toString()}`;
}

function actualizarUrl() {
  const url = new URL(location.href);
  if (tabActual) url.searchParams.set('tab', tabActual);
  history.replaceState(null, '', url);
}

function nombreCompleto() {
  return `${paciente?.apellidos || ''} ${paciente?.nombres || ''}`.trim();
}

function notaImportante() {
  return String(paciente?.nota_importante || '').trim();
}

function puedeEditarNota() {
  return puede(usuario, 'pacientes.editar') || puede(usuario, 'historias.gestionar');
}

function pintarEmbarazo() {
  if (Number(paciente?.embarazada) !== 1) return '';
  const fum = paciente.fum
    ? fmtFecha(`${String(paciente.fum).slice(0, 10)}T12:00:00`)
    : 'No registrada';
  const nota = String(paciente.embarazo_nota || '').trim();
  return `<div class="nota-imp nota-imp--embarazo">
      <span class="ic" aria-hidden="true">♡</span>
      <div class="grow">
        <b>EMBARAZO</b>
        <div class="tx">
          <span><strong>FUM:</strong> ${escapeHtml(fum)}</span>
          ${nota ? `<div>${escapeHtml(nota)}</div>` : ''}
        </div>
      </div>
      ${
        puedeEditarNota()
          ? '<button class="btn btn--sm" type="button" id="editar-embarazo">Editar</button>'
          : ''
      }
    </div>`;
}

function pintarNota() {
  const nota = notaImportante();
  const embarazo = pintarEmbarazo();
  if (!nota && !puedeEditarNota()) return embarazo;
  return `${embarazo}${
    nota
      ? `<div class="nota-imp">
        <span class="ic" aria-hidden="true">⚠</span>
        <div class="grow">
          <b>NOTA IMPORTANTE</b>
          <div class="tx">${escapeHtml(nota)}</div>
        </div>
        ${puedeEditarNota() ? '<button class="btn btn--sm" type="button" id="editar-nota">Editar</button>' : ''}
      </div>`
      : `<div class="nota-imp nota-imp--compacta">
        <span class="ic" aria-hidden="true">＋</span>
        <span class="grow">Sin nota importante</span>
        <button class="btn btn--sm" type="button" id="editar-nota">Agregar</button>
      </div>`
  }`;
}

function pintarCabecera() {
  const visibles = TABS.filter((tab) => autorizado(tab.permiso));
  if (!visibles.length) {
    $('#ficha').innerHTML =
      '<div class="empty">Tu usuario no tiene permiso para ver la ficha de esta paciente.</div>';
    return false;
  }
  if (!visibles.some((tab) => tab.id === tabActual)) tabActual = visibles[0].id;

  const anios = paciente.edad;
  const turno = cita
    ? `<div class="phead__turno">
        <b>Turno ${escapeHtml((cita.fecha_hora || '').slice(0, 10).split('-').reverse().join('/'))}
        ${escapeHtml((cita.fecha_hora || '').slice(11, 16))}</b><br />
        <span class="muted">${escapeHtml(cita.motivo || cita.medico?.nombre || '')}</span>
      </div>`
    : '';

  $('#ficha').innerHTML = `
    <div class="ficha-bar no-print">
      <button class="btn btn--ghost btn--sm" type="button" id="volver-ficha">‹ Volver</button>
      <span class="ficha-bar__titulo">Ficha de paciente</span>
    </div>
    ${pintarNota()}
    <section class="phead">
      <span class="avatar" aria-hidden="true">${escapeHtml(initials(nombreCompleto()))}</span>
      <div class="grow">
        <div class="nm">${escapeHtml(nombreCompleto())}</div>
        <div class="meta">
          <span>CI ${escapeHtml(paciente.cedula || '—')}</span>
          <span>${anios != null ? `${anios} años` : 'Edad no registrada'}</span>
          <span>HC N.º ${escapeHtml(paciente.hc_numero || paciente.cedula || '—')}</span>
        </div>
        ${htmlContactoPrivado(paciente)}
        ${paciente.es_menor ? '<div class="phead__menor small">Menor de edad · requiere representante legal para firmar consentimientos</div>' : ''}
      </div>
      ${autorizado(['historias.resumen', 'historias.ver'])
        ? `<span class="alerg"${paciente.alergias ? '' : ' style="background:#eef0f3;color:var(--muted)"'}>Alergias: ${escapeHtml(paciente.alergias || 'no registradas')}</span>`
        : ''}
      ${turno}
    </section>
    <div class="tabs-ficha-wrap" id="tabs-ficha-wrap">
      <nav class="tabs" id="tabs-ficha" aria-label="Pestañas de la ficha">
        ${visibles
          .map(
            (tab) =>
              `<button type="button" class="${tab.id === tabActual ? 'on' : ''}" data-tab="${tab.id}" aria-current="${tab.id === tabActual}" aria-label="${escapeHtml(tab.titulo)}"><span class="tab-etiqueta tab-etiqueta--larga" aria-hidden="true">${escapeHtml(tab.titulo)}</span><span class="tab-etiqueta tab-etiqueta--corta" aria-hidden="true">${escapeHtml(tab.corto || tab.titulo)}</span></button>`
          )
          .join('')}
      </nav>
    </div>
    <section class="ficha-panel" id="panel-tab"><div class="empty">Cargando…</div></section>`;

  $('#volver-ficha')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = '/pacientes.html';
  });

  for (const boton of $$('#tabs-ficha [data-tab]')) {
    boton.addEventListener('click', () => irA(boton.dataset.tab));
  }

  const tabs = $('#tabs-ficha');
  tabs?.addEventListener('scroll', actualizarTabsDesborde, { passive: true });
  if (!tabsResizeConectado) {
    tabsResizeConectado = true;
    window.addEventListener('resize', actualizarTabsDesborde, { passive: true });
  }

  const tabActivo = $('#tabs-ficha [data-tab].on');
  if (tabActivo) {
    requestAnimationFrame(() => {
      tabActivo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      actualizarTabsDesborde();
    });
  }

  $('#editar-nota')?.addEventListener('click', editarNota);
  $('#editar-embarazo')?.addEventListener('click', () => irA('datos'));
  activarContactoPrivado($('#ficha'));
  return true;
}

function editarNota() {
  const nota = notaImportante();
  const dialogo = modal(
    'Nota importante de la paciente',
    `<div class="info small" style="margin-bottom:10px">Se muestra arriba en todas las pestañas de la ficha y en la agenda. Registra solo lo que el médico debe tener presente siempre.</div>
     <label class="f"><span>Nota</span><textarea id="nota-texto" rows="4" maxlength="2000" placeholder="Ej.: Hipertensa en tratamiento con losartán. Alérgica a penicilina.">${escapeHtml(nota)}</textarea></label>`,
    `${nota ? '<button class="btn danger" type="button" id="nota-quitar" style="margin-right:auto">Quitar nota</button>' : ''}
     <button class="btn" type="button" data-cerrar-modal>Cancelar</button>
     <button class="btn pri" type="button" id="nota-guardar">Guardar</button>`
  );

  const guardar = async (valor) => {
    try {
      await api.patch(`/api/patients/${encodeURIComponent(paciente.id)}`, {
        nota_importante: valor,
      });
      toast('Nota guardada');
      dialogo.close();
      dialogo.remove();
      await recargar();
    } catch (error) {
      toast(error.message, 'error');
    }
  };

  dialogo.querySelector('#nota-guardar')?.addEventListener('click', () =>
    guardar(dialogo.querySelector('#nota-texto').value.trim())
  );
  dialogo.querySelector('#nota-quitar')?.addEventListener('click', async () => {
    if (!(await confirmar('¿Quitar la nota importante de esta paciente?', { peligro: true }))) return;
    await guardar('');
  });
  dialogo.querySelector('#nota-texto')?.focus();
}

async function pintarPestana() {
  const panel = $('#panel-tab');
  if (!panel) return;
  panel.innerHTML = '<div class="empty">Cargando…</div>';
  const definicion = TABS.find((tab) => tab.id === tabActual);
  if (!definicion || !autorizado(definicion.permiso)) {
    panel.innerHTML = '<div class="empty">No tienes permiso para ver esta pestaña.</div>';
    return;
  }

  const ctx = {
    pacienteId: paciente.id,
    paciente,
    citaId: cita?.id || null,
    cita,
    usuario,
    puede: autorizado,
    irA,
    recargar,
    toast,
    modal,
    confirmar,
  };

  try {
    const modulo = await import(`./paciente/${tabActual}.js`);
    await modulo.tab.render(panel, ctx);
  } catch (error) {
    console.error(error);
    panel.innerHTML = `<div class="info">No se pudo cargar esta pestaña: ${escapeHtml(error.message)}</div>`;
    toast(error.message, 'error');
  }
}

async function irA(destino) {
  const definicion = TABS.find((tab) => tab.id === destino);
  if (!definicion || !autorizado(definicion.permiso)) return;
  tabActual = destino;
  actualizarUrl();
  for (const boton of $$('#tabs-ficha [data-tab]')) {
    const activo = boton.dataset.tab === destino;
    boton.classList.toggle('on', activo);
    boton.setAttribute('aria-current', String(activo));
    if (activo) {
      boton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  await pintarPestana();
}

async function recargar() {
  const anterior = tabActual;
  await cargarFicha(anterior);
}

async function cargarFicha(tabSolicitada = tabActual) {
  const contenedor = $('#ficha');
  contenedor.innerHTML = '<div class="empty">Cargando ficha…</div>';

  if (!pacienteId) {
    contenedor.innerHTML = '<div class="empty">No se indicó la paciente.</div>';
    return;
  }

  try {
    paciente = await api.get(`/api/patients/${encodeURIComponent(pacienteId)}`);
  } catch (error) {
    if (error.status === 401) return location.replace('/');
    contenedor.innerHTML = `<div class="info">${escapeHtml(error.message)}</div>`;
    toast(error.message, 'error');
    return;
  }

  cita = null;
  if (citaId) {
    try {
      const detalle = await api.get(`/api/appointments/${encodeURIComponent(citaId)}`);
      if (detalle?.patient_id === paciente.id) cita = detalle;
    } catch {
      cita = null;
    }
  }

  tabActual = tabSolicitada || '';
  if (!pintarCabecera()) return;
  await pintarPestana();
}

async function iniciar() {
  usuario = await initChrome({ active: 'pacientes' });
  if (!usuario) return;
  await cargarFicha();
}

iniciar();
