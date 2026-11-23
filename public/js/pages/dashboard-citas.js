import { api } from '../api.js';
import { $, $$, escapeHtml, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';

const estado = {
  usuario: null,
  periodo: 'dia',
  datos: null,
};

const ESTADOS_DASHBOARD = {
  programada: { texto: 'Programadas', color: '#003f93' },
  confirmada: { texto: 'Confirmadas', color: '#008d31' },
  en_progreso: { texto: 'En progreso', color: '#b54708' },
  atendida: { texto: 'Finalizadas', color: '#0a6b2a' },
  reagendada: { texto: 'Reagendadas', color: '#b7791f' },
  cancelada: { texto: 'Canceladas', color: '#b42318' },
  no_asistio: { texto: 'No asistió', color: '#64748b' },
};

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

async function cargar(periodo = estado.periodo) {
  estado.periodo = periodo;

  for (const boton of $$('#dashboard-periodo [data-periodo]')) {
    boton.classList.toggle('is-active', boton.dataset.periodo === periodo);
  }

  try {
    estado.datos = await api.get(
      `/api/appointments/dashboard?periodo=${encodeURIComponent(periodo)}`
    );
    render();
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
  }
}

function render() {
  const dashboard = estado.datos;
  if (!dashboard) return;

  const resumen = dashboard.resumen || {};
  $('#dashboard-stats').innerHTML = `
    <div class="dashboard-stat">
      <span>Citas hoy</span>
      <strong>${resumen.citasHoy ?? 0}</strong>
      <small>${resumen.pacientesHoy ?? 0} pacientes</small>
    </div>
    <div class="dashboard-stat">
      <span>Próximos 7 días</span>
      <strong>${resumen.citasSemana ?? 0}</strong>
      <small>${resumen.pacientesSemana ?? 0} pacientes</small>
    </div>
    <div class="dashboard-stat">
      <span>Próximos 30 días</span>
      <strong>${resumen.citasMes ?? 0}</strong>
      <small>${resumen.pacientesMes ?? 0} pacientes</small>
    </div>
    <div class="dashboard-stat dashboard-stat--green">
      <span>Embarazos atendidos</span>
      <strong>${resumen.embarazosAtendidos ?? 0}</strong>
      <small>últimos 12 meses</small>
    </div>
  `;

  const nombres = { dia: 'día', semana: 'semana', mes: 'mes' };
  $('#dashboard-serie-titulo').textContent = `Pacientes y citas por ${
    nombres[dashboard.periodo] || 'día'
  }`;
  $('#dashboard-pista').hidden = dashboard.periodo !== 'dia';

  const serie = dashboard.serie || [];
  const maximo = Math.max(1, ...serie.flatMap((punto) => [punto.citas, punto.pacientes]));

  $('#dashboard-serie').innerHTML = serie
    .map((punto) => {
      const alturaCitas = Math.round((punto.citas / maximo) * 100);
      const alturaPacientes = Math.round((punto.pacientes / maximo) * 100);
      return `
        <div
          class="dashboard-bucket ${dashboard.periodo === 'dia' ? 'is-clickable' : ''}"
          data-clave="${escapeHtml(punto.clave)}"
          tabindex="0"
          role="img"
          aria-label="${escapeHtml(punto.etiqueta)}: ${punto.citas} citas, ${punto.pacientes} pacientes"
        >
          <span class="dashboard-bucket__tooltip">${punto.citas} citas · ${punto.pacientes} pacientes</span>
          <div class="dashboard-bucket__bars">
            <span class="dashboard-barra dashboard-barra--cita" style="height: ${alturaCitas}%"></span>
            <span class="dashboard-barra dashboard-barra--paciente" style="height: ${alturaPacientes}%"></span>
          </div>
          <span class="dashboard-bucket__label">${escapeHtml(punto.etiqueta)}</span>
        </div>`;
    })
    .join('');

  for (const bucket of $$('.dashboard-bucket', $('#dashboard-serie'))) {
    if (dashboard.periodo !== 'dia') continue;
    const irAlDia = () => {
      window.location.href = `/agenda.html?fecha=${encodeURIComponent(bucket.dataset.clave)}`;
    };
    bucket.addEventListener('click', irAlDia);
    bucket.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      evento.preventDefault();
      irAlDia();
    });
  }

  renderEstados(dashboard.estados || []);
  renderDiasSemana(dashboard.porDiaSemana || []);
  renderHoras(dashboard.porHora || []);
  renderMedicos(dashboard.medicos || []);
  renderMotivos(dashboard.motivos || []);
}

function renderEstados(estados) {
  const contenedor = $('#dashboard-estados');
  const mapa = new Map(estados.map((item) => [item.estado, item.total]));
  const items = Object.entries(ESTADOS_DASHBOARD).map(([clave, datos]) => ({
    clave,
    ...datos,
    total: mapa.get(clave) || 0,
  }));
  const total = items.reduce((suma, item) => suma + item.total, 0);

  if (!total) {
    contenedor.innerHTML = '<p class="hint">No hay citas registradas en este periodo.</p>';
    return;
  }

  const radio = 52;
  const circunferencia = 2 * Math.PI * radio;
  let desplazamiento = 0;
  const segmentos = items
    .filter((item) => item.total > 0)
    .map((item) => {
      const largo = (item.total / total) * circunferencia;
      const segmento = `<circle
        class="dashboard-donut__seg"
        cx="70"
        cy="70"
        r="${radio}"
        fill="none"
        stroke="${item.color}"
        stroke-width="18"
        stroke-dasharray="${largo} ${circunferencia - largo}"
        stroke-dashoffset="${-desplazamiento}"
        transform="rotate(-90 70 70)"
        data-estado="${item.clave}"
      ><title>${escapeHtml(item.texto)}: ${item.total}</title></circle>`;
      desplazamiento += largo;
      return segmento;
    })
    .join('');

  contenedor.innerHTML = `
    <div class="dashboard-donut__grafico">
      <svg viewBox="0 0 140 140" class="dashboard-donut__svg" role="img" aria-label="Citas por estado">
        <circle cx="70" cy="70" r="${radio}" fill="none" stroke="var(--surface-3)" stroke-width="18"></circle>
        ${segmentos}
      </svg>
      <div class="dashboard-donut__centro">
        <strong>${total}</strong>
        <span>citas</span>
      </div>
    </div>
    <div class="dashboard-donut__leyenda">
      ${items
        .map(
          (item) => `
        <div class="dashboard-donut__leyenda-item" data-estado="${item.clave}">
          <span class="dashboard-donut__punto" style="background: ${item.color}"></span>
          <span class="dashboard-donut__nombre">${item.texto}</span>
          <strong>${item.total}</strong>
          <small>${Math.round((item.total / total) * 100)}%</small>
        </div>`
        )
        .join('')}
    </div>
  `;

  for (const fila of $$('.dashboard-donut__leyenda-item', contenedor)) {
    const segmento = contenedor.querySelector(
      `.dashboard-donut__seg[data-estado="${fila.dataset.estado}"]`
    );
    fila.addEventListener('mouseenter', () => segmento?.classList.add('is-destacado'));
    fila.addEventListener('mouseleave', () => segmento?.classList.remove('is-destacado'));
  }
}

function renderBarrasVerticales(selector, items, unidad = 'citas') {
  const contenedor = $(selector);
  if (!items.length) {
    contenedor.innerHTML = '<p class="hint">Sin datos para mostrar.</p>';
    return;
  }

  const maximo = Math.max(1, ...items.map((item) => item.total));
  contenedor.innerHTML = items
    .map((item) => {
      const altura = Math.round((item.total / maximo) * 100);
      return `
        <div
          class="dashboard-bucket"
          tabindex="0"
          role="img"
          aria-label="${escapeHtml(item.etiqueta)}: ${item.total} ${unidad}"
        >
          <span class="dashboard-bucket__tooltip">${item.total} ${unidad}</span>
          <div class="dashboard-bucket__bars dashboard-bucket__bars--simple">
            <span class="dashboard-barra dashboard-barra--cita" style="height: ${altura}%"></span>
          </div>
          <span class="dashboard-bucket__label">${escapeHtml(item.etiqueta)}</span>
        </div>`;
    })
    .join('');
}

function renderDiasSemana(porDia) {
  const mapa = new Map(porDia.map((item) => [item.dia, item.total]));
  const items = ORDEN_DIAS.map((dia) => ({
    etiqueta: DIAS_SEMANA[dia].slice(0, 3),
    total: mapa.get(dia) || 0,
  }));
  renderBarrasVerticales('#dashboard-dias-semana', items);
}

function renderHoras(porHora) {
  const mapa = new Map(porHora.map((item) => [item.hora, item.total]));
  const horasConDatos = porHora.map((item) => item.hora);
  const minimo = Math.max(0, Math.min(7, ...horasConDatos));
  const maximo = Math.min(23, Math.max(18, ...horasConDatos));
  const items = [];

  for (let hora = minimo; hora <= maximo; hora += 1) {
    items.push({
      etiqueta: `${String(hora).padStart(2, '0')}h`,
      total: mapa.get(hora) || 0,
    });
  }

  renderBarrasVerticales('#dashboard-horas', items);
}

function renderMedicos(medicos) {
  const contenedor = $('#dashboard-medicos');

  if (!medicos.length) {
    contenedor.innerHTML = '<p class="hint">Sin citas activas en este periodo.</p>';
    return;
  }

  const maximo = Math.max(1, ...medicos.map((item) => item.total));
  contenedor.innerHTML = medicos
    .map(
      (medico) => `
      <div class="dashboard-barra-h">
        <div class="dashboard-barra-h__head">
          <span>${escapeHtml(medico.nombre)}</span>
          <strong>${medico.total}</strong>
        </div>
        <div class="dashboard-barra-h__track">
          <span style="width: ${Math.round((medico.total / maximo) * 100)}%"></span>
        </div>
      </div>`
    )
    .join('');
}

function renderMotivos(motivos) {
  const contenedor = $('#dashboard-motivos');

  if (!motivos.length) {
    contenedor.innerHTML =
      '<p class="hint">Todavía no hay motivos de consulta registrados.</p>';
    return;
  }

  const maximo = Math.max(1, ...motivos.map((motivo) => motivo.total));
  contenedor.innerHTML = motivos
    .map(
      (motivo) => `
      <div class="dashboard-motivo">
        <div class="dashboard-motivo__head">
          <span>${escapeHtml(motivo.motivo)}</span>
          <strong>${motivo.total}</strong>
        </div>
        <div class="dashboard-motivo__bar">
          <span style="width: ${Math.round((motivo.total / maximo) * 100)}%"></span>
        </div>
      </div>`
    )
    .join('');
}

function conectarEventos() {
  for (const boton of $$('#dashboard-periodo [data-periodo]')) {
    boton.addEventListener('click', () => cargar(boton.dataset.periodo));
  }
}

async function init() {
  estado.usuario = await initChrome({ active: 'dashboard-citas' });
  if (!estado.usuario) return;

  if (!puede(estado.usuario, 'agenda.ver')) {
    window.location.replace('/pacientes.html');
    return;
  }

  conectarEventos();
  await cargar();
}

init();
