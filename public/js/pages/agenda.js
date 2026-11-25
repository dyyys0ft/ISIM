import { api } from '../api.js';
import { $, $$, escapeHtml, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';
import { alSalir } from '../navegacion.js';
import { abrirCargaEvidencia, abrirSelectorConsentimiento } from '../lopdp.js';

const ESTADOS_CITA = {
  programada: { texto: 'Programada', clase: 'programada' },
  confirmada: { texto: 'Confirmada', clase: 'confirmada' },
  en_progreso: { texto: 'En progreso', clase: 'en_progreso' },
  atendida: { texto: 'Finalizada', clase: 'atendida' },
  cancelada: { texto: 'Cancelada', clase: 'cancelada' },
  reagendada: { texto: 'Reagendada', clase: 'reagendada' },
  no_asistio: { texto: 'No asistió', clase: 'no_asistio' },
};

const MOTIVOS_REAGENDA = [
  'Llegó tarde y no se pudo atender',
  'Tuvo que irse antes',
  'El médico no pudo atender',
  'Emergencia médica',
  'Problema de transporte',
  'Paciente no se presentó',
  'Otro',
];

const MAX_CITAS_DIA = 3;

// Horario por defecto: L–V con mañana y tarde, dos cupos por hora. El sábado
// y el domingo no tienen turnos fijos; se configuran en Ajustes.
const HORARIO_POR_DEFECTO = {
  cupos_por_hora: 2,
  lv: {
    manana: ['09:30', '10:00', '10:30', '11:00', '11:30'],
    tarde: ['15:30', '16:00', '16:30', '17:00', '17:30'],
  },
  sabado: { manana: [], tarde: [] },
  domingo: { manana: [], tarde: [] },
};

let motivosPorNombre = new Map();
let motivosAdmin = [];

const estadoPagina = {
  usuario: null,
  citas: [],
  horario: HORARIO_POR_DEFECTO,
  calendario: null,
  medicos: [],
  pacienteSeleccionado: null,
  pacientesTimer: null,
  pacientesSeq: 0,
  modoProximas: false,
  vista: 'lista',
  mes: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  citaSeleccionada: null,
  avisoLopdp: null,
  pacienteParam: new URLSearchParams(location.search).get('patientId') || '',
};

function hoyLocal() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function aInputLocal(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  const h = String(fecha.getHours()).padStart(2, '0');
  const min = String(fecha.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

function fechaPorDefecto() {
  const fecha = new Date(Date.now() + 60 * 60 * 1000);
  fecha.setMinutes(fecha.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (fecha.getMinutes() === 0) fecha.setHours(fecha.getHours() + 1);
  return aInputLocal(fecha.toISOString());
}

function badgeCita(estado) {
  const datos = ESTADOS_CITA[estado] || { texto: estado, clase: 'programada' };
  return `<span class="badge badge--${escapeHtml(datos.clase)}">${escapeHtml(datos.texto)}</span>`;
}

function badgeCitaVisual(cita) {
  if (
    cita.historia_id &&
    !['en_progreso', 'atendida', 'cancelada', 'reagendada', 'no_asistio'].includes(cita.estado)
  ) {
    return '<span class="badge badge--en_consulta">En consulta</span>';
  }
  return badgeCita(cita.estado);
}

function estadoConsentimiento(cita) {
  if (!cita.es_menor) return null;
  if (cita.consentimiento?.firmado) {
    return { clase: 'firmado', texto: 'Consentimiento firmado', corto: '✓ Firmado' };
  }
  if (cita.consentimiento && cita.consentimiento.estado !== 'sin_generar') {
    return { clase: 'pendiente', texto: 'Consentimiento sin firmar', corto: '⚠ Sin firmar' };
  }
  return { clase: 'pendiente', texto: 'Consentimiento sin generar', corto: '⚠ Sin consentimiento' };
}

/** El pendiente LOPDP se deriva de la evidencia, nunca de la marca de fecha. */
function pacienteSinEvidencia(paciente) {
  if (!paciente?.id) return false;
  if (paciente.consentimientoEstado) {
    return !paciente.consentimientoEstado.evidencia;
  }
  return !paciente.consentimientoEvidencia;
}

function ocultarAvisoLopdp() {
  estadoPagina.avisoLopdp = null;
  const region = $('#aviso-lopdp-agenda');
  if (region) region.hidden = true;
}

function mostrarAvisoLopdp(paciente, citaId = null) {
  const region = $('#aviso-lopdp-agenda');
  if (!region || !paciente?.id || !pacienteSinEvidencia(paciente)) {
    ocultarAvisoLopdp();
    return;
  }

  estadoPagina.avisoLopdp = { paciente, citaId };
  const nombre = `${paciente.nombres || ''} ${paciente.apellidos || ''}`.trim();
  const cedula = paciente.cedula ? ` (C.I. ${paciente.cedula})` : '';
  $('#aviso-lopdp-texto').textContent =
    `${nombre}${cedula} no tiene evidencia firmada cargada. ` +
    'La cita ya quedó registrada; el pendiente se resuelve al subir la evidencia.';
  $('#aviso-lopdp-ficha').href = `/paciente.html?id=${encodeURIComponent(
    paciente.id
  )}&tab=datos`;
  $('#aviso-lopdp-subir').hidden = !puede(estadoPagina.usuario, 'pacientes.editar');
  region.hidden = false;
}

async function previsualizarLopdpAviso() {
  const aviso = estadoPagina.avisoLopdp;
  if (!aviso) return;
  try {
    await abrirSelectorConsentimiento({
      paciente: aviso.paciente,
      citaId: aviso.citaId,
      puedeVerDocumentos: puede(estadoPagina.usuario, 'documentos.ver'),
      puedeCrearDocumentos: puede(estadoPagina.usuario, 'documentos.crear'),
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

function subirEvidenciaAviso() {
  const aviso = estadoPagina.avisoLopdp;
  if (!aviso) return;
  abrirCargaEvidencia({
    paciente: aviso.paciente,
    onSubida: async () => {
      const actualizado = await api
        .get(`/api/patients/${encodeURIComponent(aviso.paciente.id)}`)
        .catch(() => null);
      if (actualizado) {
        estadoPagina.pacienteSeleccionado = actualizado;
        aviso.paciente = actualizado;
        if (!pacienteSinEvidencia(actualizado)) {
          ocultarAvisoLopdp();
          toast('Evidencia cargada: pendiente LOPDP resuelto', 'success');
        } else {
          mostrarAvisoLopdp(actualizado, aviso.citaId);
        }
      }
      await cargarCitas();
    },
  });
}

function claveDia(iso) {
  const fecha = new Date(iso);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function etiquetaDia(iso) {
  const texto = new Date(iso).toLocaleDateString('es-EC', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function horaCita(iso) {
  return new Date(iso).toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function edadEnFecha(fechaNacimiento, referencia = new Date()) {
  if (!fechaNacimiento) return null;
  const nacimiento = new Date(`${String(fechaNacimiento).slice(0, 10)}T00:00:00`);
  const fecha = referencia instanceof Date ? referencia : new Date(referencia);
  if (Number.isNaN(nacimiento.getTime()) || Number.isNaN(fecha.getTime())) return null;
  let edad = fecha.getFullYear() - nacimiento.getFullYear();
  const meses = fecha.getMonth() - nacimiento.getMonth();
  if (meses < 0 || (meses === 0 && fecha.getDate() < nacimiento.getDate())) edad -= 1;
  return edad >= 0 && edad < 130 ? edad : null;
}

function nombreCompleto(cita) {
  return `${cita.apellidos || ''} ${cita.nombres || ''}`.trim();
}

function inicialesPaciente(cita) {
  return `${cita.nombres?.[0] || ''}${cita.apellidos?.[0] || ''}`.toUpperCase();
}

function tipoCitaBadge(cita) {
  if (cita.tipo === 'emergencia') {
    return '<span class="badge badge--cancelada">Emergencia</span>';
  }
  if (cita.tipo === 'extra') {
    return '<span class="badge badge--reagendada">Extra</span>';
  }
  return `<span class="badge badge--cupo">Cupo ${Number(cita.cupo) || 1}</span>`;
}

function esMenorFecha(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;
  const nacimiento = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return false;
  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const meses = hoy.getMonth() - nacimiento.getMonth();
  if (meses < 0 || (meses === 0 && hoy.getDate() < nacimiento.getDate())) edad -= 1;
  return edad >= 0 && edad < 18;
}

/**
 * Agrupa citas cuyos intervalos se solapan, para mostrarlas en columnas
 * paralelas dentro de la misma fila de la agenda.
 */
function agruparSolapadas(citas) {
  const grupos = [];
  let actual = [];
  let fin = 0;

  for (const cita of citas) {
    const inicio = new Date(cita.fecha_hora).getTime();
    const duracion = (Number(cita.duracion_min) || 30) * 60 * 1000;
    const citaFin = inicio + duracion;

    if (!actual.length || inicio < fin) {
      actual.push(cita);
      fin = Math.max(fin, citaFin);
    } else {
      grupos.push(actual);
      actual = [cita];
      fin = citaFin;
    }
  }

  if (actual.length) grupos.push(actual);
  return grupos;
}

async function cargarMedicos() {
  try {
    estadoPagina.medicos = await api.get('/api/medicos');
  } catch {
    estadoPagina.medicos = [];
  }

  const opciones = estadoPagina.medicos
    .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.nombre)}</option>`)
    .join('');

  $('#filtro-medico').innerHTML = `<option value="">Todos los médicos</option>${opciones}`;
  $('#cita-medico').innerHTML = `<option value="">Sin médico asignado</option>${opciones}`;
}

async function cargarMotivos() {
  try {
    const grupos = await api.get('/api/motivos');
    const opciones = grupos.flatMap((grupo) =>
      grupo.motivos.map(
        (item) =>
          `<option value="${escapeHtml(item.motivo)}">${escapeHtml(grupo.grupo)}</option>`
      )
    );
    $('#motivos-cita').innerHTML = opciones.join('');
    motivosPorNombre = new Map(
      grupos.flatMap((grupo) => grupo.motivos.map((item) => [item.motivo, grupo.grupo]))
    );
    actualizarGruposMotivo(grupos);
  } catch {
    motivosPorNombre = new Map();
  }
}

/** Mantiene sincronizados los grupos del catálogo y del texto libre. */
function actualizarGruposMotivo(grupos) {
  const nombres = [...new Set(grupos.map((grupo) => grupo.grupo).filter(Boolean))];
  const lista = nombres.length ? nombres : ['Consultas'];
  const select = $('#motivo-otro-grupo');
  if (select) {
    const actual = select.value;
    select.innerHTML = lista
      .map((grupo) => `<option value="${escapeHtml(grupo)}">${escapeHtml(grupo)}</option>`)
      .join('');
    if (lista.includes(actual)) select.value = actual;
  }
  const datalist = $('#motivos-grupos');
  if (datalist) {
    datalist.innerHTML = lista
      .map((grupo) => `<option value="${escapeHtml(grupo)}"></option>`)
      .join('');
  }
}

async function abrirMotivos() {
  limpiarFormularioMotivo();
  $('#dlg-motivos').showModal();
  await cargarMotivosAdmin();
}

async function cargarMotivosAdmin() {
  const contenedor = $('#motivos-lista');
  contenedor.innerHTML = '<p class="hint">Cargando motivos…</p>';
  try {
    motivosAdmin = await api.get('/api/motivos/admin');
    renderMotivosAdmin();
  } catch (error) {
    contenedor.innerHTML = `<p class="muted small">${escapeHtml(error.message)}</p>`;
    toast(error.message, 'error');
  }
}

function renderMotivosAdmin() {
  const contenedor = $('#motivos-lista');
  if (!motivosAdmin.length) {
    contenedor.innerHTML = '<p class="hint">Todavía no hay motivos registrados.</p>';
    return;
  }

  const grupos = new Map();
  for (const fila of motivosAdmin) {
    const grupo = fila.grupo || 'Consultas';
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo).push(fila);
  }

  contenedor.innerHTML = [...grupos.entries()]
    .map(
      ([grupo, filas]) => `
      <section class="motivo-grupo" aria-label="${escapeHtml(grupo)}">
        <h4 class="motivo-grupo__titulo">${escapeHtml(grupo)}</h4>
        ${filas
          .map((fila) => {
            const activo = Number(fila.activo) === 1;
            return `<article class="motivo-fila ${activo ? '' : 'motivo-fila--inactivo'}" data-id="${escapeHtml(
              fila.id
            )}">
              <div class="motivo-fila__texto">
                <strong>${escapeHtml(fila.motivo)}</strong>
                <span class="motivo-fila__meta">
                  Orden ${Number(fila.orden) || 1}
                  ${
                    activo
                      ? '<span class="badge badge--programada">Activo</span>'
                      : '<span class="badge badge--cancelada">Inactivo</span>'
                  }
                </span>
              </div>
              <div class="motivo-fila__acciones">
                <button class="btn btn--sm" type="button" data-editar-motivo aria-label="Editar ${escapeHtml(
                  fila.motivo
                )}">Editar</button>
                ${
                  activo
                    ? `<button class="btn btn--sm btn--danger" type="button" data-desactivar-motivo aria-label="Desactivar ${escapeHtml(
                        fila.motivo
                      )}">✕</button>`
                    : `<button class="btn btn--sm" type="button" data-reactivar-motivo aria-label="Reactivar ${escapeHtml(
                        fila.motivo
                      )}">Reactivar</button>`
                }
              </div>
            </article>`;
          })
          .join('')}
      </section>`
    )
    .join('');

  for (const boton of $$('#motivos-lista [data-editar-motivo]')) {
    const id = boton.closest('[data-id]')?.dataset.id;
    boton.addEventListener('click', () => editarMotivo(id));
  }
  for (const boton of $$('#motivos-lista [data-desactivar-motivo]')) {
    const id = boton.closest('[data-id]')?.dataset.id;
    boton.addEventListener('click', () => desactivarMotivo(id));
  }
  for (const boton of $$('#motivos-lista [data-reactivar-motivo]')) {
    const id = boton.closest('[data-id]')?.dataset.id;
    boton.addEventListener('click', () => reactivarMotivo(id));
  }
}

function limpiarFormularioMotivo() {
  const formulario = $('#form-motivo');
  formulario.reset();
  $('#motivo-id').value = '';
  $('#motivo-grupo').value = 'Consultas';
  $('#motivo-orden').value = '';
  $('#btn-guardar-motivo').textContent = 'Agregar motivo';
  $('#btn-cancelar-motivo').hidden = true;
  $('#motivos-form-estado').textContent = '';
}

function editarMotivo(id) {
  const fila = motivosAdmin.find((item) => item.id === id);
  if (!fila) return;
  $('#motivo-id').value = fila.id;
  $('#motivo-grupo').value = fila.grupo || 'Consultas';
  $('#motivo-texto').value = fila.motivo;
  $('#motivo-orden').value = String(fila.orden || 1);
  $('#btn-guardar-motivo').textContent = 'Guardar cambios';
  $('#btn-cancelar-motivo').hidden = false;
  $('#motivos-form-estado').textContent = `Editando “${fila.motivo}”.`;
  $('#motivo-texto').focus();
}

async function guardarMotivo(evento) {
  evento.preventDefault();
  const formulario = $('#form-motivo');
  if (!formulario.reportValidity()) return;

  const id = $('#motivo-id').value;
  const datos = {
    grupo: $('#motivo-grupo').value.trim() || 'Consultas',
    motivo: $('#motivo-texto').value.trim(),
  };
  const orden = $('#motivo-orden').value.trim();
  if (orden) datos.orden = Number(orden);

  const boton = $('#btn-guardar-motivo');
  const estado = $('#motivos-form-estado');
  setBusy(boton, true, 'Guardando…');
  try {
    if (id) {
      await api.patch(`/api/motivos/${encodeURIComponent(id)}`, datos);
      toast('Motivo actualizado', 'success');
    } else {
      await api.post('/api/motivos', datos);
      toast('Motivo agregado', 'success');
    }
    setBusy(boton, false);
    await Promise.all([cargarMotivosAdmin(), cargarMotivos()]);
    limpiarFormularioMotivo();
    estado.textContent = id ? 'Motivo actualizado.' : 'Motivo agregado al catálogo.';
  } catch (error) {
    setBusy(boton, false);
    estado.textContent = error.message;
    toast(error.message, 'error');
  }
}

async function desactivarMotivo(id) {
  const fila = motivosAdmin.find((item) => item.id === id);
  if (!fila) return;
  const confirmado = window.confirm(
    `¿Desactivar el motivo “${fila.motivo}”? Dejará de ofrecerse en nuevas citas, pero las citas anteriores conservan su texto.`
  );
  if (!confirmado) return;

  try {
    await api.delete(`/api/motivos/${encodeURIComponent(id)}`);
    toast('Motivo desactivado', 'success');
    await Promise.all([cargarMotivosAdmin(), cargarMotivos()]);
    if ($('#motivo-id').value === id) limpiarFormularioMotivo();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function reactivarMotivo(id) {
  try {
    await api.patch(`/api/motivos/${encodeURIComponent(id)}`, { activo: 1 });
    toast('Motivo reactivado', 'success');
    await Promise.all([cargarMotivosAdmin(), cargarMotivos()]);
  } catch (error) {
    toast(error.message, 'error');
  }
}

function abrirMotivoOtro() {
  const panel = $('#motivo-otro-panel');
  if (!panel.hidden) {
    cerrarMotivoOtro();
    return;
  }
  const puedeCatalogo = puede(estadoPagina.usuario, 'agenda.motivos');
  $('#motivo-otro-guardar-wrap').hidden = !puedeCatalogo;
  const campoGrupo = $('#motivo-otro-grupo').closest('.field');
  if (campoGrupo) campoGrupo.hidden = !puedeCatalogo;
  panel.hidden = false;
  $('#btn-motivo-otro').setAttribute('aria-expanded', 'true');
  $('#motivo-otro-texto').focus();
}

function cerrarMotivoOtro() {
  $('#motivo-otro-panel').hidden = true;
  $('#btn-motivo-otro').setAttribute('aria-expanded', 'false');
  $('#motivo-otro-texto').value = '';
  $('#motivo-otro-guardar').checked = false;
}

async function usarMotivoOtro() {
  const texto = $('#motivo-otro-texto').value.trim();
  if (!texto) {
    toast('Escribe el motivo personalizado', 'error');
    $('#motivo-otro-texto').focus();
    return;
  }

  const puedeCatalogo = puede(estadoPagina.usuario, 'agenda.motivos');
  const guardar = puedeCatalogo && !$('#motivo-otro-guardar-wrap').hidden && $('#motivo-otro-guardar').checked;
  if (guardar) {
    const boton = $('#btn-motivo-otro-usar');
    setBusy(boton, true, 'Guardando…');
    try {
      await api.post('/api/motivos', {
        grupo: $('#motivo-otro-grupo').value || 'Consultas',
        motivo: texto,
      });
      toast('Motivo guardado en el catálogo', 'success');
      await cargarMotivos();
    } catch (error) {
      if (error.status !== 409) {
        setBusy(boton, false);
        toast(error.message, 'error');
        return;
      }
      toast('Ese motivo ya existe en el catálogo; se usará en la cita.', 'info');
    }
    setBusy(boton, false);
  }

  $('#cita-motivo').value = texto;
  cerrarMotivoOtro();
  $('#cita-motivo').focus();
}


async function cargarHorario() {
  try {
    const horario = await api.get('/api/settings/horario');
    if (horario && typeof horario === 'object') {
      estadoPagina.horario = {
        cupos_por_hora: Math.min(Math.max(Number(horario.cupos_por_hora) || 2, 1), 20),
        lv: horario.lv || HORARIO_POR_DEFECTO.lv,
        sabado: horario.sabado || { manana: [], tarde: [] },
        domingo: horario.domingo || { manana: [], tarde: [] },
      };
    }
  } catch {
    estadoPagina.horario = HORARIO_POR_DEFECTO;
  }
}

/** Horario configurado para una fecha: domingo nunca tiene turnos fijos. */
function horarioDelDia(fecha) {
  const dia = new Date(`${fecha}T12:00:00`).getDay();
  const horario = estadoPagina.horario || HORARIO_POR_DEFECTO;
  if (dia === 0) return { manana: [], tarde: [] };
  if (dia === 6) return horario.sabado || { manana: [], tarde: [] };
  return horario.lv || HORARIO_POR_DEFECTO.lv;
}

async function cargarCitas() {
  const params = new URLSearchParams();
  const estado = $('#filtro-estado').value;
  const medicoId = $('#filtro-medico').value;
  const fecha = $('#fecha-agenda').value;
  const filtrosActivos = [estado, medicoId].filter(Boolean).length;
  const botonFiltros = $('#btn-filtros');
  if (botonFiltros) {
    botonFiltros.textContent = filtrosActivos ? `Filtros (${filtrosActivos})` : 'Filtros';
  }

  if (estado) params.set('estado', estado);
  if (medicoId) params.set('medicoId', medicoId);

  if (estadoPagina.vista === 'calendario') {
    const inicio = new Date(
      estadoPagina.mes.getFullYear(),
      estadoPagina.mes.getMonth(),
      1
    );
    const fin = new Date(
      estadoPagina.mes.getFullYear(),
      estadoPagina.mes.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    params.set('desde', inicio.toISOString());
    params.set('hasta', fin.toISOString());
    params.set('porDia', String(MAX_CITAS_DIA));
    params.set('tzOffset', String(new Date().getTimezoneOffset()));

    try {
      estadoPagina.calendario = await api.get(
        `/api/appointments/calendar?${params.toString()}`
      );
      estadoPagina.citas = estadoPagina.calendario.dias.flatMap((dia) => dia.citas);
      render();
    } catch (error) {
      if (error.status === 401) return window.location.replace('/');
      toast(error.message, 'error');
      estadoPagina.calendario = null;
      estadoPagina.citas = [];
      render();
    }
    return;
  }

  estadoPagina.calendario = null;

  if (estadoPagina.vista === 'jornada' && !fecha) {
    $('#fecha-agenda').value = hoyLocal();
    estadoPagina.modoProximas = false;
    params.set('fecha', hoyLocal());
  } else if (fecha && !estadoPagina.modoProximas) {
    params.set('fecha', fecha);
  } else {
    params.set('desde', new Date().toISOString());
    params.set('hasta', new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString());
    estadoPagina.modoProximas = true;
  }

  try {
    estadoPagina.citas = await api.get(`/api/appointments?${params.toString()}`);
    render();
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
    estadoPagina.citas = [];
    render();
  }
}

function render() {
  const lista = $('#lista');
  const vacio = $('#vacio');
  const citas = estadoPagina.citas;
  const enCalendario = estadoPagina.vista === 'calendario';
  const enJornada = estadoPagina.vista === 'jornada';

  let resumenDatos = enCalendario ? estadoPagina.calendario?.resumen : null;

  if (!resumenDatos) {
    resumenDatos = {
      total: citas.length,
      pendientes: citas.filter((c) =>
        ['programada', 'confirmada', 'reagendada'].includes(c.estado)
      ).length,
      enProgreso: citas.filter((c) => c.estado === 'en_progreso').length,
      atendidas: citas.filter((c) => c.estado === 'atendida').length,
      canceladas: citas.filter((c) => ['cancelada', 'no_asistio'].includes(c.estado)).length,
    };
  }

  $('#contador').textContent = `${resumenDatos.total} cita${
    resumenDatos.total === 1 ? '' : 's'
  }`;

  const fechaSeleccionada = $('#fecha-agenda').value;
  const fechaHero = $('#agenda-fecha-hero');
  if (fechaHero) {
    if (estadoPagina.modoProximas) {
      fechaHero.textContent = 'Próximas citas · los siguientes 90 días';
    } else if (fechaSeleccionada) {
      const texto = new Date(`${fechaSeleccionada}T12:00:00`).toLocaleDateString(
        'es-EC',
        {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }
      );
      fechaHero.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
    } else {
      fechaHero.textContent = 'Selecciona una fecha para ver la agenda';
    }
  }

  $('#resumen').innerHTML = `
    <div class="agenda-resumen__item"><strong>${resumenDatos.total}</strong><span>Total</span></div>
    <div class="agenda-resumen__item agenda-resumen__item--pendiente"><strong>${resumenDatos.pendientes}</strong><span>Pendientes</span></div>
    <div class="agenda-resumen__item agenda-resumen__item--progreso"><strong>${resumenDatos.enProgreso}</strong><span>En progreso</span></div>
    <div class="agenda-resumen__item agenda-resumen__item--atendida"><strong>${resumenDatos.atendidas}</strong><span>Finalizadas</span></div>
    <div class="agenda-resumen__item agenda-resumen__item--cancelada"><strong>${resumenDatos.canceladas}</strong><span>Canceladas / no asistió</span></div>
  `;

  $('#vista-calendario').hidden = !enCalendario;
  $('#vista-jornada').hidden = !enJornada;
  $('#controles-fecha').hidden = enCalendario;
  lista.hidden = enCalendario || enJornada;

  if (enCalendario) {
    vacio.hidden = true;
    renderCalendario();
    return;
  }

  if (enJornada) {
    vacio.hidden = true;
    renderJornada(citas);
    return;
  }

  if (!citas.length) {
    lista.replaceChildren();
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;

  const grupos = new Map();
  for (const cita of citas) {
    const clave = claveDia(cita.fecha_hora);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(cita);
  }

  const puedeGestionar = puede(estadoPagina.usuario, 'agenda.gestionar');
  const puedeVerHistoria = puede(estadoPagina.usuario, 'historias.ver');
  const ahora = Date.now();
  const siguiente = citas
    .filter(
      (cita) =>
        ['programada', 'confirmada', 'reagendada'].includes(cita.estado) &&
        new Date(cita.fecha_hora).getTime() >= ahora
    )
    .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))[0];
  const siguienteId = siguiente?.id;

  lista.innerHTML = [...grupos.entries()]
    .map(([clave, grupo]) => {
      const ordenadas = grupo.toSorted(
        (a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora)
      );
      const primera = ordenadas[0];
      const filas = ordenadas
        .map((cita) => {
          const nombre = nombreCompleto(cita);
          const esSiguiente = cita.id === siguienteId;
          const puedeIniciarConsulta =
            puede(estadoPagina.usuario, 'historias.gestionar') &&
            !['cancelada', 'no_asistio'].includes(cita.estado);
          const puedeCrearDocumento = puede(estadoPagina.usuario, 'documentos.crear');
          const consentimiento = estadoConsentimiento(cita);
          const puedeVerDocumento = puede(estadoPagina.usuario, 'documentos.ver');
          const edad = edadEnFecha(cita.fecha_nacimiento, new Date(`${clave}T12:00:00`));
          const iniciales = inicialesPaciente(cita);

          let historia = '';
          if (cita.historia_id) {
            historia = `<a class="btn btn--sm" href="/historia.html?appointmentId=${encodeURIComponent(
              cita.id
            )}${cita.estado === 'atendida' ? '' : '&modo=editar'}">${
              cita.estado === 'atendida' ? 'Ver consulta' : 'Continuar consulta'
            }</a>`;
          } else if (puedeIniciarConsulta) {
            historia = `<button class="btn btn--sm btn--primary" type="button" data-action="iniciar-consulta">Empezar consulta</button>`;
          } else if (puedeVerHistoria) {
            historia = `<a class="btn btn--sm" href="/historia.html?appointmentId=${encodeURIComponent(
              cita.id
            )}">Ver cita</a>`;
          }

          const cancelar =
            cita.estado !== 'cancelada' && cita.estado !== 'no_asistio'
              ? '<button class="btn btn--ghost btn--sm" type="button" data-action="cancelar">Cancelar</button>'
              : '';

          const principales = [
            cita.es_menor && consentimiento.clase !== 'firmado' && puedeCrearDocumento
              ? cita.consentimiento?.id
                ? `<a class="btn btn--sm btn--warning" href="/documento.html?id=${encodeURIComponent(
                    cita.consentimiento.id
                  )}">Firmar consentimiento</a>`
                : '<button class="btn btn--sm btn--warning" type="button" data-action="consentimiento">Generar consentimiento</button>'
              : '',
            cita.es_menor &&
            consentimiento.clase === 'firmado' &&
            cita.consentimiento?.id &&
            puedeVerDocumento
              ? `<a class="btn btn--sm" href="/documento.html?id=${encodeURIComponent(
                  cita.consentimiento.id
                )}">Ver consentimiento</a>`
              : '',
            historia,
          ].filter(Boolean);
          const secundarias = puedeGestionar
            ? [
                '<button class="btn btn--sm" type="button" data-action="estado">Estado</button>',
                '<button class="btn btn--sm" type="button" data-action="editar">Editar</button>',
                cancelar,
              ].filter(Boolean)
            : [];

          return `<tr class="agenda-item ${
            esSiguiente ? 'agenda-item--siguiente' : ''
          } ${cita.es_menor ? 'agenda-item--menor' : ''}" data-id="${escapeHtml(cita.id)}">
            <td class="agenda-tabla__hora">
              <strong>${horaCita(cita.fecha_hora)}</strong>
              <span>${Number(cita.duracion_min) || 30} min</span>
            </td>
            <td class="agenda-tabla__paciente">
              <div class="agenda-paciente">
                <span class="agenda-paciente__avatar" aria-hidden="true">${escapeHtml(
                  iniciales || '··'
                )}</span>
                <div class="agenda-paciente__datos">
                  <strong>${escapeHtml(nombre)}</strong>
                  <span class="agenda-paciente__meta">
                    C.I. ${escapeHtml(cita.paciente_cedula || '—')}${
                      edad != null ? ` · ${edad} años` : ''
                    }
                  </span>
                  <div class="agenda-badges">
                    ${
                      cita.es_menor
                        ? '<span class="badge badge--menor">Menor de edad</span>'
                        : ''
                    }
                    ${
                      consentimiento
                        ? `<span class="agenda-consentimiento agenda-consentimiento--${consentimiento.clase}">${consentimiento.texto}</span>`
                        : ''
                    }
                    ${
                      esSiguiente
                        ? '<span class="badge badge--programada">Siguiente</span>'
                        : ''
                    }
                  </div>
                </div>
              </div>
            </td>
            <td class="agenda-tabla__motivo">
              <strong>${escapeHtml(cita.motivo || 'Sin motivo registrado')}</strong>
              <span>${escapeHtml(cita.medico_nombre || 'Sin médico asignado')}</span>
              ${
                cita.estado === 'reagendada' && cita.motivo_reagenda
                  ? `<small>Reagenda: ${escapeHtml(cita.motivo_reagenda)}</small>`
                  : ''
              }
            </td>
            <td class="agenda-tabla__tipo">${tipoCitaBadge(cita)}</td>
            <td class="agenda-tabla__estado">${badgeCitaVisual(cita)}</td>
            <td class="agenda-tabla__acciones">
              <div class="agenda-acciones">
                ${
                  principales.length
                    ? `<div class="agenda-acciones__linea">${principales.join('')}</div>`
                    : ''
                }
                ${
                  secundarias.length
                    ? `<div class="agenda-acciones__linea agenda-acciones__linea--secundaria">${secundarias.join(
                        ''
                      )}</div>`
                    : ''
                }
                ${
                  !principales.length && !secundarias.length
                    ? '<span class="muted small">—</span>'
                    : ''
                }
              </div>
            </td>
          </tr>`;
        })
        .join('');

      return `<section class="agenda-grupo">
        <div class="agenda-dia-head">
          <div>
            <h2 class="agenda-dia">${escapeHtml(etiquetaDia(primera.fecha_hora))}</h2>
            <p class="hint">
              ${ordenadas.length} cita${ordenadas.length === 1 ? '' : 's'}
              · ${ordenadas.filter((cita) => cita.es_menor).length} menor(es)
            </p>
          </div>
          ${
            puedeGestionar
              ? `<button class="btn btn--sm" type="button" data-nueva-dia="${claveDia(
                  primera.fecha_hora
                )}">+ Nueva cita</button>`
              : ''
          }
        </div>
        <div class="agenda-tabla-wrap">
          <table class="agenda-tabla">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Paciente</th>
                <th>Motivo / médico</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th class="agenda-tabla__th-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join('');

  for (const boton of $$('[data-action]', lista)) {
    const item = boton.closest('[data-id]');
    const cita = citas.find((c) => c.id === item?.dataset.id);
    if (!cita) continue;
    if (boton.dataset.action === 'editar') {
      boton.addEventListener('click', () => abrirEditar(cita));
    }
    if (boton.dataset.action === 'cancelar') {
      boton.addEventListener('click', () => cancelarCita(cita));
    }
    if (boton.dataset.action === 'iniciar-consulta') {
      boton.addEventListener('click', () => iniciarConsulta(cita, boton));
    }
    if (boton.dataset.action === 'consentimiento') {
      boton.addEventListener('click', () => generarConsentimiento(cita, boton));
    }
    if (boton.dataset.action === 'estado') {
      boton.addEventListener('click', () => {
        abrirDetalleCita(cita);
        setTimeout(() => $('#detalle-estado')?.focus(), 180);
      });
    }
  }

  for (const boton of $$('[data-nueva-dia]', lista)) {
    boton.addEventListener('click', () => {
      $('#fecha-agenda').value = boton.dataset.nuevaDia;
      estadoPagina.modoProximas = false;
      abrirNueva(null, '09:00');
    });
  }

  for (const item of $$('.agenda-item', lista)) {
    const cita = citas.find((c) => c.id === item.dataset.cita || c.id === item.dataset.id);
    if (!cita) continue;
    item.addEventListener('click', (evento) => {
      if (evento.target.closest('button, a')) return;
      abrirDetalleCita(cita);
    });
  }
}

async function generarConsentimiento(cita, boton = null) {
  setBusy(boton, true, 'Generando…');

  try {
    const resultado = await api.post(
      `/api/appointments/${encodeURIComponent(cita.id)}/consent`,
      {}
    );
    toast('Consentimiento generado. Revisa y firma antes de la consulta.', 'success');
    window.location.href = `/documento.html?id=${encodeURIComponent(resultado.id)}`;
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function iniciarConsulta(cita, boton = null) {
  setBusy(boton, true, 'Iniciando…');
  try {
    await api.post(`/api/appointments/${encodeURIComponent(cita.id)}/start-consultation`);
    toast('Consulta iniciada', 'success');
    window.location.href = `/historia.html?appointmentId=${encodeURIComponent(
      cita.id
    )}&modo=editar`;
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function renderJornada(citas) {
  const contenedor = $('#vista-jornada');
  const fecha = $('#fecha-agenda').value || hoyLocal();
  const puedeGestionar = puede(estadoPagina.usuario, 'agenda.gestionar');
  const cuposPorHora = 2;
  const referencia = new Date(`${fecha}T12:00:00`);
  const horario = horarioDelDia(fecha);
  const horas = {
    manana: Array.isArray(horario.manana) ? horario.manana.toSorted() : [],
    tarde: Array.isArray(horario.tarde) ? horario.tarde.toSorted() : [],
  };
  const sinTurnosFijos = !horas.manana.length && !horas.tarde.length;
  const esDomingo = new Date(`${fecha}T12:00:00`).getDay() === 0;

  const horaSlot = (cita) => {
    const hora = new Date(cita.fecha_hora);
    return `${String(hora.getHours()).padStart(2, '0')}:${
      hora.getMinutes() < 30 ? '00' : '30'
    }`;
  };

  const esDeJornada = (cita, claveJornada) => {
    if (cita.jornada === 'manana' || cita.jornada === 'tarde') {
      return cita.jornada === claveJornada;
    }
    const hora = new Date(cita.fecha_hora).getHours();
    return claveJornada === 'manana' ? hora < 12 : hora >= 12;
  };

  const normales = new Map();
  for (const cita of citas) {
    if (cita.tipo && cita.tipo !== 'normal') continue;
    const cupo = Math.min(Math.max(Number(cita.cupo) || 1, 1), cuposPorHora);
    const clave = `${horaSlot(cita)}|${cupo}`;
    if (!normales.has(clave)) normales.set(clave, []);
    normales.get(clave).push(cita);
  }

  const tarjetaCita = (
    cita,
    hora,
    cupo,
    clase = 'jornada-slot jornada-slot--ocupado',
    mostrarHora = false
  ) => {
    const consentimiento = estadoConsentimiento(cita);
    const edad = edadEnFecha(cita.fecha_nacimiento, referencia);
    const nombre = nombreCompleto(cita);
    const iniciales = inicialesPaciente(cita);
    const tipo =
      cita.tipo === 'emergencia'
        ? 'Emergencia'
        : cita.tipo === 'extra'
          ? 'Extra'
          : `Cupo ${cupo}`;
    const estadoClase = `e-${String(cita.estado || 'programada').replace(
      /[^a-z_]/g,
      ''
    )}`;

    return `<button class="${clase} ${estadoClase}" type="button" data-cita-jornada="${escapeHtml(
      cita.id
    )}">
      <span class="jornada-slot__paciente">
        <span class="jornada-slot__nombre">
          <span class="jornada-slot__avatar" aria-hidden="true">${escapeHtml(
            iniciales || '··'
          )}</span>
          <strong>${escapeHtml(nombre)}</strong>
        </span>
        <span class="jornada-slot__meta">
          ${mostrarHora ? `<span class="jornada-slot__hora">${hora}</span>` : ''}
          <span>${escapeHtml(cita.paciente_cedula || '—')}</span>
          ${edad != null ? `<span>· ${edad} años</span>` : ''}
          <span class="jornada-slot__tipo">${escapeHtml(tipo)}</span>
        </span>
        <small>${escapeHtml(cita.motivo || 'Sin motivo')}</small>
        ${
          consentimiento
            ? `<span class="jornada-slot__consentimiento jornada-slot__consentimiento--${consentimiento.clase}">${consentimiento.corto}</span>`
            : ''
        }
      </span>
    </button>`;
  };

  const slotLibre = (hora, cupo, clave) => `<button type="button" class="jornada-slot jornada-slot--libre"${
    puedeGestionar
      ? ` data-jornada-hora="${hora}" data-jornada-cupo="${cupo}" data-jornada-clave="${clave}"`
      : ' disabled'
  }>
    <span class="jornada-slot__vacio">${
      puedeGestionar ? `Cupo ${cupo} · Disponible` : 'Sin cita'
    }</span>
    ${puedeGestionar ? '<span class="jornada-slot__add" aria-hidden="true">+</span>' : ''}
  </button>`;

  const columna = (clave, titulo, icono) => {
    const configuradas = horas[clave] || [];
    // Citas guardadas en horas que ya no están en el horario configurado
    // (por ejemplo, agenda antigua): se muestran igual para no ocultarlas.
    const jornadaDeHora = (hora) => (Number(hora.slice(0, 2)) < 12 ? 'manana' : 'tarde');
    const horasConCitas = [...normales.keys()]
      .map((claveSlot) => claveSlot.split('|')[0])
      .filter((hora, indice, lista) => lista.indexOf(hora) === indice)
      .filter((hora) => jornadaDeHora(hora) === clave)
      .filter((hora) => !configuradas.includes(hora))
      .sort();
    const listaHoras = [...configuradas, ...horasConCitas];
    const filas = [];
    for (const hora of listaHoras) {
      const celdas = [];
      for (let cupo = 1; cupo <= cuposPorHora; cupo += 1) {
        const encontradas = normales.get(`${hora}|${cupo}`) || [];
        celdas.push(
          encontradas.length
            ? `<div class="jornada-cupo">${encontradas
                .map((cita) => tarjetaCita(cita, hora, cupo))
                .join('')}</div>`
            : slotLibre(hora, cupo, clave)
        );
      }
      filas.push(`<div class="jornada-row">
        <div class="jornada-row__hora">${hora}</div>
        <div class="jornada-row__cupos">${celdas.join('')}</div>
      </div>`);
    }

    const extras = citas.filter(
      (cita) => esDeJornada(cita, clave) && cita.tipo && cita.tipo !== 'normal'
    );
    const asignadas = citas.filter((cita) => esDeJornada(cita, clave)).length;

    return `<section class="jornada-col">
      <header class="jornada-col__head">
        <div>
          <h3>${titulo}</h3>
          <span>${
            configuradas.length
              ? `${configuradas.length * cuposPorHora} turnos fijos · `
              : ''
          }${asignadas} asignado${asignadas === 1 ? '' : 's'}</span>
        </div>
        <span class="jornada-col__icon" aria-hidden="true">${icono}</span>
      </header>
      ${
        filas.length
          ? `<div class="jornada-filas">${filas.join('')}</div>`
          : `<p class="jornada-sin-turnos">Sin turnos fijos para esta jornada. Usa un turno extra o registra una emergencia.</p>`
      }
      <div class="jornada-extras">
        <div class="jornada-extras__head">
          <h4>Turnos extra y emergencias</h4>
          <span>${extras.length}</span>
        </div>
        <div class="jornada-extras__lista">
          ${
            extras.length
              ? extras
                  .map((cita) =>
                    tarjetaCita(
                      cita,
                      horaSlot(cita),
                      cita.cupo || 1,
                      cita.tipo === 'emergencia'
                        ? 'jornada-slot jornada-slot--emergencia'
                        : 'jornada-slot jornada-slot--extra',
                      true
                    )
                  )
                  .join('')
              : '<p class="hint">Sin turnos extra ni emergencias para esta jornada.</p>'
          }
        </div>
        ${
          puedeGestionar
            ? `<div class="jornada-extras__acciones">
                 <button class="btn btn--sm" type="button" data-jornada-extra="extra" data-jornada-clave="${clave}">+ Turno extra</button>
                 <button class="btn btn--sm btn--danger" type="button" data-jornada-extra="emergencia" data-jornada-clave="${clave}">+ Emergencia</button>
               </div>`
            : ''
        }
      </div>
    </section>`;
  };

  contenedor.innerHTML = `
    ${
      esDomingo
        ? '<div class="jornada-aviso">Domingo: no hay turnos fijos. Solo se registran emergencias o turnos extra.</div>'
        : sinTurnosFijos
          ? '<div class="jornada-aviso">Este día no tiene turnos fijos configurados. Puedes asignar turnos extra o emergencias.</div>'
          : ''
    }
    <div class="jornada-head">
      <div>
        <h2 class="side-title">Turnos del ${new Date(
          `${fecha}T12:00:00`
        ).toLocaleDateString('es-EC', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
        })}</h2>
        <p class="hint">${cuposPorHora} cupo${
          cuposPorHora === 1 ? '' : 's'
        } por hora. Pulsa un espacio disponible para asignar un turno.</p>
      </div>
      <div class="jornada-head__stats">
        <span class="badge">${citas.length} cita${citas.length === 1 ? '' : 's'}</span>
        <span class="badge badge--programada">${
          citas.filter((cita) => cita.es_menor).length
        } menor(es)</span>
      </div>
    </div>
    <div class="jornada-grid">
      ${columna('manana', 'Mañana', '☀')}
      ${columna('tarde', 'Tarde', '☾')}
    </div>`;

  for (const boton of contenedor.querySelectorAll('[data-cita-jornada]')) {
    const cita = citas.find((item) => item.id === boton.dataset.citaJornada);
    if (cita) boton.addEventListener('click', () => abrirDetalleCita(cita));
  }
  for (const slot of contenedor.querySelectorAll('[data-jornada-hora]')) {
    slot.addEventListener('click', () => {
      $('#fecha-agenda').value = fecha;
      estadoPagina.modoProximas = false;
      abrirNueva(null, slot.dataset.jornadaHora, {
        cupo: Number(slot.dataset.jornadaCupo) || 1,
        jornada: slot.dataset.jornadaClave || undefined,
        slot: true,
      });
    });
  }
  for (const boton of contenedor.querySelectorAll('[data-jornada-extra]')) {
    boton.addEventListener('click', () => {
      const tipo = boton.dataset.jornadaExtra;
      const clave = boton.dataset.jornadaClave || 'manana';
      const horasJornada = horas[clave] || [];
      const horaPorDefecto =
        clave === 'manana' ? '11:30' : '17:30';
      const hora =
        horasJornada.length > 0
          ? horasJornada[horasJornada.length - 1]
          : horaPorDefecto;
      $('#fecha-agenda').value = fecha;
      estadoPagina.modoProximas = false;
      abrirNueva(null, hora, { tipo, jornada: clave });
    });
  }
}

function renderCalendario() {
  const mes = estadoPagina.mes;
  const anio = mes.getFullYear();
  const numeroMes = mes.getMonth();
  const primerDia = new Date(anio, numeroMes, 1);
  const diasMes = new Date(anio, numeroMes + 1, 0).getDate();
  const offset = (primerDia.getDay() + 6) % 7; // lunes = 0
  const totalCeldas = Math.ceil((offset + diasMes) / 7) * 7;

  const grupos = new Map(
    (estadoPagina.calendario?.dias || []).map((dia) => [dia.fecha, dia])
  );
  const porDia = estadoPagina.calendario?.porDia || MAX_CITAS_DIA;
  const puedeGestionar = puede(estadoPagina.usuario, 'agenda.gestionar');

  const mesTexto = mes.toLocaleDateString('es-EC', {
    month: 'long',
    year: 'numeric',
  });
  $('#mes-actual').textContent =
    mesTexto.charAt(0).toUpperCase() + mesTexto.slice(1);

  const fechaSeleccionada = $('#fecha-agenda').value;
  const seleccionTexto = $('#calendario-seleccion-texto');
  if (seleccionTexto) {
    if (fechaSeleccionada) {
      const texto = new Date(`${fechaSeleccionada}T12:00:00`).toLocaleDateString(
        'es-EC',
        {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }
      );
      seleccionTexto.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
    } else {
      seleccionTexto.textContent = 'Selecciona un día';
    }
  }

  const mesCorto = mes
    .toLocaleDateString('es-EC', { month: 'short' })
    .replace('.', '')
    .toUpperCase();

  let celdas = '';

  for (let i = 0; i < totalCeldas; i += 1) {
    const diaNum = i - offset + 1;
    const enMes = diaNum >= 1 && diaNum <= diasMes;

    if (!enMes) {
      celdas += '<div class="calendario-dia calendario-dia--fuera" aria-hidden="true"></div>';
      continue;
    }

    const clave = `${anio}-${String(numeroMes + 1).padStart(2, '0')}-${String(diaNum).padStart(
      2,
      '0'
    )}`;
    const dia = grupos.get(clave);
    const citasDia = dia?.citas || [];
    const totalDia = dia?.total ?? citasDia.length;
    const visibles = citasDia.slice(0, porDia);
    const restantes = Math.max(0, totalDia - visibles.length);
    const esSeleccionado = clave === fechaSeleccionada;
    const esHoy = clave === hoyLocal();
    const items = visibles
      .map((cita) => {
        const nombre = `${cita.nombres} ${cita.apellidos}`.trim();
        const enConsulta =
          cita.historia_id && !['atendida', 'cancelada', 'no_asistio'].includes(cita.estado);
        const consentimiento = estadoConsentimiento(cita);
        const clase =
          cita.estado === 'cancelada' || cita.estado === 'no_asistio'
            ? ' calendario-cita--cancelada'
            : enConsulta
              ? ' calendario-cita--en_consulta'
              : cita.estado === 'atendida'
                ? ' calendario-cita--atendida'
                : '';
        const claseConsentimiento =
          consentimiento?.clase === 'pendiente'
            ? ' calendario-cita--consentimiento-pendiente'
            : '';
        return `<button class="calendario-cita${clase}${claseConsentimiento}" type="button" data-cita="${escapeHtml(
          cita.id
        )}" title="${escapeHtml(
          `${horaCita(cita.fecha_hora)} · ${nombre} · ${cita.motivo || 'Sin motivo'}${
            consentimiento ? ` · ${consentimiento.texto}` : ''
          }`
        )}">
          <span class="calendario-cita__hora">${horaCita(cita.fecha_hora)}</span>
          <span class="calendario-cita__texto">
            <strong class="calendario-cita__nombre">${escapeHtml(nombre)}</strong>
            <span class="calendario-cita__motivo">${escapeHtml(
              cita.motivo || 'Sin motivo'
            )}</span>
            ${
              consentimiento
                ? `<span class="calendario-cita__consentimiento calendario-cita__consentimiento--${consentimiento.clase}">${consentimiento.corto}</span>`
                : ''
            }
          </span>
        </button>`;
      })
      .join('');

    celdas += `
      <div class="calendario-dia${esSeleccionado ? ' calendario-dia--seleccionado' : ''}${esHoy ? ' calendario-dia--hoy' : ''}" data-dia-calendario="${clave}" data-total="${totalDia}">
        <button class="calendario-dia__num" type="button" data-dia="${clave}" ${
          esSeleccionado ? 'aria-current="date"' : ''
        }>
          <span class="calendario-dia__mes">${mesCorto}</span>
          <strong class="calendario-dia__numero">${diaNum}</strong>
          ${esHoy ? '<span class="calendario-dia__hoy">Hoy</span>' : ''}
        </button>
        ${
          puedeGestionar
            ? `<button class="calendario-add" type="button" data-nueva-dia="${clave}" title="Agendar cita">+</button>`
            : ''
        }
        <div class="calendario-citas">${items}${
          restantes > 0
            ? `<button class="calendario-ver-mas" type="button" data-ver-dia="${clave}">+${restantes} más</button>`
            : ''
        }</div>
      </div>`;
  }

  $('#calendario-grid').innerHTML = celdas;

  for (const boton of $$('[data-dia]', $('#calendario-grid'))) {
    boton.addEventListener('click', () => {
      $('#fecha-agenda').value = boton.dataset.dia;
      estadoPagina.modoProximas = false;
      renderCalendario();
    });
  }

  for (const boton of $$('[data-ver-dia]', $('#calendario-grid'))) {
    boton.addEventListener('click', () => {
      $('#fecha-agenda').value = boton.dataset.verDia;
      estadoPagina.modoProximas = false;
      cambiarVista('lista');
    });
  }

  for (const boton of $$('[data-cita]', $('#calendario-grid'))) {
    const cita = estadoPagina.citas.find((item) => item.id === boton.dataset.cita);
    if (!cita) continue;
    boton.addEventListener('click', () => abrirDetalleCita(cita));
  }

  for (const boton of $$('[data-nueva-dia]', $('#calendario-grid'))) {
    boton.addEventListener('click', (evento) => {
      evento.stopPropagation();
      $('#fecha-agenda').value = boton.dataset.nuevaDia;
      estadoPagina.modoProximas = false;
      abrirNueva(null, '09:00');
    });
  }
}

function abrirDetalleCita(cita) {
  estadoPagina.citaSeleccionada = cita;

  const nombre = `${cita.nombres} ${cita.apellidos}`.trim();
  const esCancelada = ['cancelada', 'no_asistio'].includes(cita.estado);
  const puedeGestionar = puede(estadoPagina.usuario, 'agenda.gestionar');
  const puedeIniciar =
    !cita.historia_id &&
    puede(estadoPagina.usuario, 'historias.gestionar') &&
    !esCancelada;
  const consentimiento = estadoConsentimiento(cita);

  const opcionesEstado = Object.entries(ESTADOS_CITA)
    .map(
      ([valor, datos]) =>
        `<option value="${valor}" ${cita.estado === valor ? 'selected' : ''}>${datos.texto}</option>`
    )
    .join('');
  const opcionesMotivo = MOTIVOS_REAGENDA.map(
    (motivo) => `<option value="${escapeHtml(motivo)}">${escapeHtml(motivo)}</option>`
  ).join('');

  $('#detalle-cita-contenido').innerHTML = `
    <div class="detalle-cita">
      <div class="detalle-cita__paciente">
        <div>
          <h3>${escapeHtml(nombre)}</h3>
          <p class="muted small">C.I. ${escapeHtml(cita.paciente_cedula)}</p>
        </div>
        ${badgeCitaVisual(cita)}
      </div>

      <div class="detalle-cita__grid">
        <div><span>Fecha</span><strong>${escapeHtml(etiquetaDia(cita.fecha_hora))}</strong></div>
        <div><span>Hora</span><strong>${horaCita(cita.fecha_hora)}</strong></div>
        <div><span>Duración</span><strong>${cita.duracion_min} minutos</strong></div>
        <div><span>Profesional</span><strong>${escapeHtml(cita.medico_nombre || 'Sin médico asignado')}</strong></div>
      </div>

      ${
        consentimiento
          ? `<div class="detalle-cita__consentimiento detalle-cita__consentimiento--${consentimiento.clase}">
               <span>Consentimiento del menor</span>
               <strong>${consentimiento.texto}</strong>
               ${
                 consentimiento.firmado
                   ? ''
                   : '<p class="hint">Genera y firma el consentimiento antes de iniciar la consulta.</p>'
               }
             </div>`
          : ''
      }

      <div class="detalle-cita__bloque">
        <span>Motivo</span>
        <p>${escapeHtml(cita.motivo || 'Sin motivo registrado')}</p>
      </div>
      ${
        cita.notas
          ? `<div class="detalle-cita__bloque"><span>Notas de agenda</span><p>${escapeHtml(
              cita.notas
            )}</p></div>`
          : ''
      }
      ${
        cita.motivo_reagenda
          ? `<div class="detalle-cita__bloque"><span>Motivo de reagenda</span><p>${escapeHtml(
              cita.motivo_reagenda
            )}</p></div>`
          : ''
      }

      ${
        puedeGestionar
          ? `<div class="detalle-cita__estado">
              <span>Actualizar estado</span>
              <div class="row">
                <select class="select" id="detalle-estado">${opcionesEstado}</select>
                <button class="btn btn--primary btn--sm" id="btn-actualizar-estado" type="button">
                  Actualizar estado
                </button>
              </div>
              <div class="detalle-cita__motivo-reagenda" id="detalle-motivo-reagenda" hidden>
                <label for="detalle-motivo-select">Motivo de la reagenda *</label>
                <select class="select" id="detalle-motivo-select">
                  <option value="">Selecciona un motivo…</option>
                  ${opcionesMotivo}
                </select>
                <input
                  class="input"
                  id="detalle-motivo-otro"
                  maxlength="500"
                  placeholder="Describe el motivo…"
                  hidden
                />
              </div>
            </div>`
          : ''
      }

      ${
        puedeGestionar
          ? `<div class="detalle-cita__notificacion">
              <span>Confirmación por WhatsApp</span>
              ${
                estadoPagina.usuario.whatsappConfigurado
                  ? `<div class="row">
                      <button class="btn btn--sm btn--primary" id="btn-notificar-whatsapp" type="button" ${
                        esCancelada ? 'disabled' : ''
                      }>Enviar confirmación</button>
                    </div>`
                  : '<p class="hint">Configura WhatsApp Business API en Ajustes del sistema.</p>'
              }
              ${
                cita.ultima_notificacion_estado
                  ? `<p class="hint">Última notificación: ${
                      cita.ultima_notificacion_estado === 'enviado' ? 'enviada' : 'con error'
                    }${
                      cita.ultima_notificacion_en
                        ? ` · ${new Date(cita.ultima_notificacion_en).toLocaleString('es-EC', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}`
                        : ''
                    }</p>`
                  : '<p class="hint">Sin confirmaciones enviadas.</p>'
              }
            </div>`
          : ''
      }
    </div>
  `;

  const botonIniciar = $('#btn-empezar-consulta');
  botonIniciar.hidden = !puedeIniciar;
  botonIniciar.classList.toggle(
    'btn--warning',
    Boolean(consentimiento && !consentimiento.firmado)
  );
  botonIniciar.textContent =
    consentimiento && !consentimiento.firmado
      ? 'Empezar consulta sin consentimiento'
      : 'Empezar consulta';
  $('#btn-abrir-consulta').hidden = !cita.historia_id;
  if (cita.historia_id) {
    $('#btn-abrir-consulta').href = `/historia.html?appointmentId=${encodeURIComponent(
      cita.id
    )}${cita.estado === 'atendida' ? '' : '&modo=editar'}`;
    $('#btn-abrir-consulta').textContent =
      cita.estado === 'atendida' ? 'Ver consulta' : 'Continuar consulta';
  }
  $('#btn-editar-cita').hidden = !puedeGestionar;
  $('#btn-cancelar-cita').hidden = !puedeGestionar || esCancelada;

  $('#btn-actualizar-estado')?.addEventListener('click', actualizarEstadoCita);
  $('#btn-notificar-whatsapp')?.addEventListener('click', () => notificarWhatsApp(cita));

  if (puedeGestionar) {
    const motivo = cita.motivo_reagenda || '';
    if (motivo && MOTIVOS_REAGENDA.slice(0, -1).includes(motivo)) {
      $('#detalle-motivo-select').value = motivo;
    } else if (motivo) {
      $('#detalle-motivo-select').value = 'Otro';
      $('#detalle-motivo-otro').value = motivo;
    }
    actualizarMotivoReagenda();
    $('#detalle-estado').addEventListener('change', actualizarMotivoReagenda);
    $('#detalle-motivo-select').addEventListener('change', actualizarMotivoReagenda);
  }

  $('#dlg-cita-detalle').showModal();
}

function actualizarMotivoReagenda() {
  const esReagenda = $('#detalle-estado').value === 'reagendada';
  $('#detalle-motivo-reagenda').hidden = !esReagenda;
  $('#detalle-motivo-otro').hidden =
    !esReagenda || $('#detalle-motivo-select').value !== 'Otro';
}

async function notificarWhatsApp(cita) {
  const boton = $('#btn-notificar-whatsapp');
  setBusy(boton, true, 'Enviando…');

  try {
    await api.post(`/api/appointments/${encodeURIComponent(cita.id)}/notify-whatsapp`);
    toast('Confirmación enviada por WhatsApp', 'success');
    $('#dlg-cita-detalle').close();
    await cargarCitas();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function actualizarEstadoCita() {
  const cita = estadoPagina.citaSeleccionada;
  if (!cita) return;

  const nuevoEstado = $('#detalle-estado').value;
  if (nuevoEstado === cita.estado) {
    return toast('La cita ya tiene ese estado');
  }

  const cambios = { estado: nuevoEstado };
  if (nuevoEstado === 'reagendada') {
    const seleccion = $('#detalle-motivo-select').value;
    const motivo =
      seleccion === 'Otro' ? $('#detalle-motivo-otro').value.trim() : seleccion;
    if (!motivo) {
      return toast('Selecciona el motivo de la reagenda', 'error');
    }
    cambios.motivoReagenda = motivo;
  }

  const boton = $('#btn-actualizar-estado');
  setBusy(boton, true, 'Actualizando…');

  try {
    await api.patch(`/api/appointments/${encodeURIComponent(cita.id)}`, cambios);
    toast('Estado de la cita actualizado', 'success');
    $('#dlg-cita-detalle').close();
    await cargarCitas();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function cambiarVista(vista) {
  estadoPagina.vista = vista;
  $('#btn-vista-lista').classList.toggle('is-active', vista === 'lista');
  $('#btn-vista-calendario').classList.toggle('is-active', vista === 'calendario');
  $('#btn-vista-jornada').classList.toggle('is-active', vista === 'jornada');

  if (vista === 'calendario') {
    let fecha = $('#fecha-agenda').value;
    if (!fecha) {
      fecha = hoyLocal();
      $('#fecha-agenda').value = fecha;
      estadoPagina.modoProximas = false;
    }
    const [anio, mes] = fecha.split('-').map(Number);
    estadoPagina.mes = new Date(anio, mes - 1, 1);
  }

  if (vista === 'jornada' && !$('#fecha-agenda').value) {
    $('#fecha-agenda').value = hoyLocal();
    estadoPagina.modoProximas = false;
  }

  cargarCitas();
}

function limpiarPaciente() {
  estadoPagina.pacienteSeleccionado = null;
  $('#cita-paciente').value = '';
  $('#cita-paciente-busqueda').value = '';
  $('#cita-paciente-seleccionado').textContent = 'Escribe al menos 2 letras para buscar.';
  $('#resultados-pacientes-cita').hidden = true;
  $('#resultados-pacientes-cita').replaceChildren();
}

function seleccionarPaciente(paciente) {
  estadoPagina.pacienteSeleccionado = paciente;
  $('#cita-paciente').value = paciente.id;
  $('#cita-paciente-busqueda').value = `${paciente.apellidos} ${paciente.nombres} — ${paciente.cedula}`;
  $('#cita-paciente-seleccionado').textContent = `Seleccionada: ${paciente.nombres} ${paciente.apellidos}${
    paciente.alergias ? ` · Alergias: ${paciente.alergias}` : ''
  }`;
  $('#resultados-pacientes-cita').hidden = true;
  $('#resultados-pacientes-cita').replaceChildren();
  $('#cita-nueva-paciente').hidden = true;
  $('#cita-menor-aviso').hidden = !(
    paciente.es_menor || esMenorFecha(paciente.fecha_nacimiento)
  );
}

function renderResultadosPacientes(pacientes) {
  const contenedor = $('#resultados-pacientes-cita');
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
        <span>C.I. ${escapeHtml(paciente.cedula)}${paciente.es_menor ? ' · Menor de edad' : ''}</span>
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
    $('#resultados-pacientes-cita').hidden = true;
    return;
  }

  const secuencia = ++estadoPagina.pacientesSeq;
  try {
    const pacientes = await api.get(`/api/patients?q=${encodeURIComponent(q)}&limit=20`);
    if (secuencia !== estadoPagina.pacientesSeq) return;
    renderResultadosPacientes(pacientes);
  } catch (error) {
    if (secuencia !== estadoPagina.pacientesSeq) return;
    toast(error.message, 'error');
  }
}

function abrirNueva(paciente = null, hora = '09:00', opciones = {}) {
  const formulario = $('#form-cita');
  formulario.reset();
  cerrarMotivoOtro();
  const tipo = ['normal', 'extra', 'emergencia'].includes(opciones.tipo)
    ? opciones.tipo
    : 'normal';
  const cupo = Math.min(Math.max(Number(opciones.cupo) || 1, 1), 10);
  $('#cita-id').value = '';
  const esSlot = Boolean(opciones.slot);
  $('#titulo-cita').textContent = esSlot
    ? `Asignar turno — ${hora} (cupo ${cupo})`
    : tipo === 'emergencia'
      ? 'Registrar emergencia'
      : tipo === 'extra'
        ? 'Turno extra'
        : 'Nueva cita';
  $('#btn-guardar-cita').textContent = esSlot
    ? 'Asignar turno'
    : tipo === 'emergencia'
      ? 'Registrar emergencia'
      : tipo === 'extra'
        ? 'Guardar turno extra'
        : 'Guardar cita';
  $('#cita-paso-sub').textContent = esSlot
    ? 'Busca a la paciente o regístrala como primera vez'
    : 'Paso 1 · Busca a la paciente o regístrala';
  $('#cita-nueva-paciente').hidden = true;
  $('#cita-menor-aviso').hidden = true;
  $('#cita-representantes').hidden = true;
  $('#cita-tipo').value = tipo;
  $('#cita-cupo').value = String(cupo);
  limpiarPaciente();

  const fechaSeleccionada = $('#fecha-agenda').value;
  if (fechaSeleccionada) {
    $('#cita-fecha').value = `${fechaSeleccionada}T${hora || '09:00'}`;
  } else {
    $('#cita-fecha').value = fechaPorDefecto();
  }

  $('#cita-duracion').value = '30';
  $('#cita-estado').value = 'programada';
  $('#campo-estado-cita').hidden = false;
  $('#cita-medico').value =
    estadoPagina.usuario?.rol === 'medico' ? estadoPagina.usuario.id : '';
  $('#cita-fecha-resumen').textContent = '';

  if (paciente) seleccionarPaciente(paciente);

  $('#dlg-cita').showModal();
  $('#cita-paciente-busqueda').focus();
}

function abrirEditar(cita) {
  $('#titulo-cita').textContent = 'Editar cita';
  $('#btn-guardar-cita').textContent = 'Guardar cambios';
  $('#cita-paso-sub').textContent = 'Edita los datos de la cita';
  $('#cita-id').value = cita.id;
  $('#cita-nueva-paciente').hidden = true;
  $('#cita-representantes').hidden = true;
  $('#cita-tipo').value = cita.tipo || 'normal';
  $('#cita-cupo').value = cita.cupo || 1;

  const paciente = cita.paciente || {
    id: cita.patient_id,
    nombres: cita.nombres,
    apellidos: cita.apellidos,
    cedula: cita.paciente_cedula,
  };
  seleccionarPaciente(paciente);

  $('#cita-fecha').value = aInputLocal(cita.fecha_hora);
  $('#cita-duracion').value = String(cita.duracion_min || 30);
  $('#cita-estado').value = cita.estado || 'programada';
  $('#campo-estado-cita').hidden = true;
  $('#cita-medico').value = cita.medico_id || '';
  $('#cita-motivo').value = cita.motivo || '';
  $('#cita-notas').value = cita.notas || '';

  $('#dlg-cita').showModal();
}

async function guardarCita(evento) {
  evento.preventDefault();
  const boton = $('#btn-guardar-cita');
  const id = $('#cita-id').value;
  const fechaHora = $('#cita-fecha').value;
  const nuevaVisible = !$('#cita-nueva-paciente').hidden;
  let patientId = $('#cita-paciente').value;

  if (!fechaHora) return toast('Selecciona la fecha y hora', 'error');

  const motivo = $('#cita-motivo').value.trim();
  const tipo = $('#cita-tipo').value;
  const cupo = Math.min(Math.max(Number($('#cita-cupo').value || 1), 1), 10);
  let pacienteNuevo = null;
  let citaCreada = null;

  setBusy(boton, true, 'Guardando…');
  try {
    if (!patientId && nuevaVisible) {
      const cedula = $('#np-cedula').value.trim();
      const nombres = $('#np-nombres').value.trim();
      const apellidos = $('#np-apellidos').value.trim();
      const nacimiento = $('#np-nacimiento').value;

      if (!cedula || !nombres || !apellidos || !nacimiento) {
        throw new Error('Completa cédula, nombres, apellidos y fecha de nacimiento');
      }
      if (!$('#np-lopdp').checked) {
        throw new Error('La paciente debe autorizar el tratamiento de sus datos (LOPDP)');
      }

      const menor = esMenorFecha(nacimiento);
      const repNombre = $('#np-rep1-nombre').value.trim();
      const repCedula = $('#np-rep1-cedula').value.trim();
      if (menor && (!repNombre || !repCedula)) {
        throw new Error('Registra el representante legal del paciente menor');
      }

      const consentimientoFecha = new Date().toISOString();
      const creada = await api.post('/api/patients', {
        cedula,
        nombres,
        apellidos,
        fecha_nacimiento: nacimiento,
        sexo: $('#np-sexo').value,
        telefono: $('#np-telefono').value.trim(),
        email: $('#np-email').value.trim(),
        direccion: $('#np-direccion').value.trim(),
        alergias: $('#np-alergias').value.trim(),
        consentimiento_datos: consentimientoFecha,
        representante1_nombre: menor ? repNombre : '',
        representante1_cedula: menor ? repCedula : '',
        representante1_parentesco: menor
          ? $('#np-rep1-parentesco').value.trim()
          : '',
      });
      patientId = creada.id;
      pacienteNuevo = await api.get(`/api/patients/${encodeURIComponent(patientId)}`).catch(() => ({
        id: patientId,
        cedula,
        nombres,
        apellidos,
        consentimiento_datos: consentimientoFecha,
      }));
      $('#cita-paciente').value = patientId;
    }

    if (!patientId) throw new Error('Selecciona una paciente o regístrala como nueva');

    const datos = {
      patientId,
      medicoId: $('#cita-medico').value || null,
      fechaHora,
      duracionMin: Number($('#cita-duracion').value),
      motivo,
      notas: $('#cita-notas').value.trim(),
      tipo,
      cupo,
      motivoGrupo: motivosPorNombre.get(motivo) || null,
    };
    if (!id) datos.estado = $('#cita-estado').value;

    if (id) {
      await api.patch(`/api/appointments/${encodeURIComponent(id)}`, datos);
      toast('Cita actualizada', 'success');
    } else {
      citaCreada = await api.post('/api/appointments', datos);
      toast('Cita registrada', 'success');
    }
    setBusy(boton, false);
    $('#dlg-cita').close();
    await cargarCitas();

    // Sin interrupción modal: el pendiente LOPDP se muestra como aviso no modal
    // y se resuelve con la evidencia firmada, no con la marca de consentimiento.
    if (!id) {
      let pacienteParaAviso = pacienteNuevo || estadoPagina.pacienteSeleccionado;
      if (!pacienteParaAviso && patientId) {
        pacienteParaAviso = await api
          .get(`/api/patients/${encodeURIComponent(patientId)}`)
          .catch(() => null);
        if (pacienteParaAviso) estadoPagina.pacienteSeleccionado = pacienteParaAviso;
      }
      if (pacienteParaAviso) {
        mostrarAvisoLopdp(pacienteParaAviso, citaCreada?.id || null);
      }
    }
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function cancelarCita(cita) {
  const nombre = `${cita.nombres} ${cita.apellidos}`.trim();
  const confirmado = window.confirm(
    `¿Cancelar la cita de ${nombre} del ${etiquetaDia(cita.fecha_hora)} a las ${horaCita(cita.fecha_hora)}?`
  );
  if (!confirmado) return;

  try {
    await api.post(`/api/appointments/${encodeURIComponent(cita.id)}/cancel`);
    toast('Cita cancelada', 'success');
    await cargarCitas();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function conectarEventos() {
  $('#btn-nueva-cita').addEventListener('click', () => abrirNueva());
  $('#btn-motivos')?.addEventListener('click', () => abrirMotivos());

  $('#form-motivo')?.addEventListener('submit', guardarMotivo);
  $('#btn-cancelar-motivo')?.addEventListener('click', () => limpiarFormularioMotivo());
  $('#btn-motivo-otro')?.addEventListener('click', () => abrirMotivoOtro());
  $('#btn-motivo-otro-usar')?.addEventListener('click', () => usarMotivoOtro());
  $('#dlg-motivos')?.addEventListener('close', () => limpiarFormularioMotivo());

  $('#aviso-lopdp-previsualizar')?.addEventListener('click', () => previsualizarLopdpAviso());
  $('#aviso-lopdp-subir')?.addEventListener('click', () => subirEvidenciaAviso());
  $('#aviso-lopdp-cerrar')?.addEventListener('click', () => ocultarAvisoLopdp());

  $('#btn-paciente-nueva').addEventListener('click', () => {
    $('#cita-paciente').value = '';
    $('#cita-paciente-busqueda').value = '';
    $('#resultados-pacientes-cita').hidden = true;
    $('#cita-paciente-seleccionado').textContent =
      'Paciente nueva: completa los datos de admisión.';
    $('#cita-nueva-paciente').hidden = false;
    $('#cita-menor-aviso').hidden = true;
    $('#cita-representantes').hidden = true;
    $('#np-cedula').focus();
  });

  $('#np-nacimiento').addEventListener('change', () => {
    const menor = esMenorFecha($('#np-nacimiento').value);
    $('#cita-menor-aviso').hidden = !menor;
    $('#cita-representantes').hidden = !menor;
  });

  $('#cita-fecha').addEventListener('change', () => {
    const valor = $('#cita-fecha').value;
    $('#cita-fecha-resumen').textContent = valor
      ? new Date(valor).toLocaleString('es-EC', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
  });

  $('#btn-filtros').addEventListener('click', () => {
    const panel = $('#filtros-agenda');
    panel.hidden = !panel.hidden;
    $('#btn-filtros').classList.toggle('is-active', !panel.hidden);
    $('#btn-filtros').setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) $('#filtro-estado').focus();
  });

  $('#btn-limpiar-filtros').addEventListener('click', () => {
    $('#filtro-estado').value = '';
    $('#filtro-medico').value = '';
    cargarCitas();
  });

  $('#filtro-estado').addEventListener('change', cargarCitas);
  $('#filtro-medico').addEventListener('change', cargarCitas);

  const activarVista = (vista) => {
    if (estadoPagina.vista === vista) return;
    cambiarVista(vista);
  };

  $('#btn-vista-lista').addEventListener('click', () => activarVista('lista'));
  $('#btn-vista-calendario').addEventListener('click', () => activarVista('calendario'));
  $('#btn-vista-jornada').addEventListener('click', () => activarVista('jornada'));

  const moverMes = (delta) => {
    estadoPagina.mes = new Date(
      estadoPagina.mes.getFullYear(),
      estadoPagina.mes.getMonth() + delta,
      1
    );
    cargarCitas();
  };

  $('#btn-mes-anterior').addEventListener('click', () => moverMes(-1));
  $('#btn-mes-siguiente').addEventListener('click', () => moverMes(1));
  $('#btn-mes-hoy').addEventListener('click', () => {
    estadoPagina.mes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    cargarCitas();
  });

  $('#btn-ver-dia').addEventListener('click', () => {
    estadoPagina.modoProximas = false;
    cambiarVista('lista');
  });

  $('#fecha-agenda').addEventListener('change', () => {
    estadoPagina.modoProximas = false;
    cargarCitas();
  });

  const moverDia = (delta) => {
    const base = $('#fecha-agenda').value || hoyLocal();
    const fecha = new Date(`${base}T12:00:00`);
    fecha.setDate(fecha.getDate() + delta);
    $('#fecha-agenda').value = `${fecha.getFullYear()}-${String(
      fecha.getMonth() + 1
    ).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
    estadoPagina.modoProximas = false;
    cargarCitas();
  };

  $('#btn-dia-anterior').addEventListener('click', () => moverDia(-1));
  $('#btn-dia-siguiente').addEventListener('click', () => moverDia(1));

  $('#btn-hoy').addEventListener('click', () => {
    estadoPagina.modoProximas = false;
    $('#fecha-agenda').value = hoyLocal();
    cargarCitas();
  });

  $('#btn-proximas').addEventListener('click', () => {
    estadoPagina.modoProximas = true;
    $('#fecha-agenda').value = '';
    cargarCitas();
  });

  $('#form-cita').addEventListener('submit', guardarCita);

  $('#btn-empezar-consulta').addEventListener('click', () => {
    const cita = estadoPagina.citaSeleccionada;
    if (!cita) return;
    $('#dlg-cita-detalle').close();
    iniciarConsulta(cita, null);
  });

  $('#btn-editar-cita').addEventListener('click', () => {
    const cita = estadoPagina.citaSeleccionada;
    if (!cita) return;
    $('#dlg-cita-detalle').close();
    abrirEditar(cita);
  });

  $('#btn-cancelar-cita').addEventListener('click', () => {
    const cita = estadoPagina.citaSeleccionada;
    if (!cita) return;
    $('#dlg-cita-detalle').close();
    cancelarCita(cita);
  });

  $('#cita-paciente-busqueda').addEventListener('input', () => {
    estadoPagina.pacienteSeleccionado = null;
    $('#cita-paciente').value = '';
    $('#cita-paciente-seleccionado').textContent = 'Escribe al menos 2 letras para buscar.';
    const q = $('#cita-paciente-busqueda').value.trim();
    clearTimeout(estadoPagina.pacientesTimer);
    estadoPagina.pacientesTimer = setTimeout(() => buscarPacientes(q), 260);
  });

  document.addEventListener('click', cerrarResultadosCita);

  $$('[data-cerrar]').forEach((boton) =>
    boton.addEventListener('click', () => boton.closest('dialog').close())
  );

  $('#dlg-cita').addEventListener('close', () => {
    limpiarPaciente();
    estadoPagina.pacienteSeleccionado = null;
  });

  alSalir(() => {
    clearTimeout(estadoPagina.pacientesTimer);
    document.removeEventListener('click', cerrarResultadosCita);
  });
}

function cerrarResultadosCita(evento) {
  if (!evento.target.closest('#cita-paciente-busqueda, #resultados-pacientes-cita')) {
    $('#resultados-pacientes-cita').hidden = true;
  }
}

async function vistaInicialAgenda() {
  try {
    const datos = await api.get('/api/settings/agenda-vista');
    return ['lista', 'jornada', 'calendario'].includes(datos?.vista)
      ? datos.vista
      : 'jornada';
  } catch {
    return 'jornada';
  }
}

async function init() {
  estadoPagina.usuario = await initChrome({ active: 'agenda' });
  if (!estadoPagina.usuario) return;

  if (!puede(estadoPagina.usuario, 'agenda.ver')) {
    window.location.replace('/documentos.html');
    return;
  }

  if (estadoPagina.usuario.rol === 'medico') {
    $('#filtro-medico').hidden = true;
    const subtitulo = document.querySelector('.page-sub');
    if (subtitulo) subtitulo.textContent = 'Mis citas del día, pasadas y futuras';
  }

  const fechaParam = new URLSearchParams(location.search).get('fecha') || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaParam)) {
    $('#fecha-agenda').value = fechaParam;
    estadoPagina.modoProximas = false;
  } else {
    $('#fecha-agenda').value = hoyLocal();
  }

  conectarEventos();
  await Promise.all([cargarMedicos(), cargarMotivos(), cargarHorario()]);
  const vista = await vistaInicialAgenda();
  cambiarVista(vista);

  if (estadoPagina.pacienteParam && puede(estadoPagina.usuario, 'agenda.gestionar')) {
    try {
      const paciente = await api.get(
        `/api/patients/${encodeURIComponent(estadoPagina.pacienteParam)}`
      );
      abrirNueva(paciente);
    } catch {
      // El paciente del enlace ya no está disponible.
    }
  } else if (
    new URLSearchParams(location.search).get('nueva') === '1' &&
    puede(estadoPagina.usuario, 'agenda.gestionar')
  ) {
    abrirNueva();
  }
}

init();
