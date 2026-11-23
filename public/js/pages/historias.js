import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, initials, toast } from '../ui.js';
import { initChrome } from '../chrome.js';

const LIMITE = 24;
const estado = { pagina: 1, paginas: 1, total: 0, orden: 'nombre_asc' };
let usuario = null;
let pacientes = [];

function renderPaginacion() {
  const contenedor = $('#paginacion-historias');
  if (estado.paginas <= 1) {
    contenedor.hidden = true;
    contenedor.replaceChildren();
    return;
  }
  contenedor.hidden = false;
  contenedor.innerHTML = `
    <button class="btn btn--sm" id="pag-anterior" type="button" ${estado.pagina <= 1 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="paginacion__pagina">Página ${estado.pagina} de ${estado.paginas}</span>
    <button class="btn btn--sm" id="pag-siguiente" type="button" ${estado.pagina >= estado.paginas ? 'disabled' : ''}>Siguiente ›</button>
    <span class="paginacion__info">${estado.total} registros</span>`;
  $('#pag-anterior')?.addEventListener('click', () => cargar(estado.pagina - 1));
  $('#pag-siguiente')?.addEventListener('click', () => cargar(estado.pagina + 1));
}

function render() {
  const lista = $('#lista-historias');
  const vacio = $('#vacio-historias');
  $('#contador-historias').textContent = `${estado.total} paciente${estado.total === 1 ? '' : 's'}`;
  renderPaginacion();

  if (!pacientes.length) {
    lista.replaceChildren();
    vacio.hidden = false;
    return;
  }
  vacio.hidden = true;

  lista.innerHTML = pacientes
    .map((paciente) => {
      const nombre = `${paciente.apellidos} ${paciente.nombres}`.trim();
      const edad = paciente.edad != null ? `${paciente.edad} años` : 'Edad no registrada';
      const ultima = paciente.ultima_historia
        ? `Última consulta: ${fmtFecha(paciente.ultima_historia)}`
        : 'Sin consultas registradas';
      return `<article class="patient-card" data-id="${escapeHtml(paciente.id)}">
        <div class="patient-card__head">
          <span class="avatar patient-card__avatar" aria-hidden="true">${escapeHtml(initials(nombre))}</span>
          <div class="patient-card__identity">
            <h3 class="patient-card__name">${escapeHtml(nombre)}</h3>
            <p class="patient-card__cedula">C.I. ${escapeHtml(paciente.cedula)}</p>
          </div>
        </div>
        <div class="patient-card__badges">
          ${paciente.es_menor ? '<span class="badge badge--programada">Menor</span>' : ''}
          ${paciente.examenes_pendientes ? `<span class="badge badge--reagendada">${paciente.examenes_pendientes} examen(es) pendiente(s)</span>` : ''}
          ${paciente.total_historias ? `<span class="badge badge--atendida">${paciente.total_historias} consulta(s)</span>` : '<span class="badge badge--cancelada">Sin consultas</span>'}
        </div>
        <div class="patient-card__chips">
          <span class="patient-chip">${escapeHtml(edad)}</span>
          <span class="patient-chip">${escapeHtml(ultima)}</span>
        </div>
        <div class="patient-card__actions">
          <a class="btn btn--sm btn--primary" href="/paciente.html?id=${encodeURIComponent(paciente.id)}&tab=historia">Abrir historia</a>
          <a class="btn btn--sm" href="/paciente.html?id=${encodeURIComponent(paciente.id)}">Ficha</a>
        </div>
      </article>`;
    })
    .join('');
}

async function cargar(pagina = 1) {
  const params = new URLSearchParams({
    page: String(pagina),
    limit: String(LIMITE),
    orden: estado.orden,
  });
  const nombre = $('#buscar-nombre').value.trim();
  const apellido = $('#buscar-apellido').value.trim();
  const cedula = $('#buscar-cedula').value.trim();
  if (nombre) params.set('nombre', nombre);
  if (apellido) params.set('apellido', apellido);
  if (cedula) params.set('cedula', cedula);

  try {
    const resultado = await api.get(`/api/clinical-history/patients/paginated?${params}`);
    pacientes = resultado.items;
    estado.pagina = resultado.page;
    estado.paginas = resultado.pages;
    estado.total = resultado.total;
    render();
  } catch (error) {
    if (error.status === 401) return location.replace('/');
    if (error.status === 403) {
      $('#lista-historias').innerHTML =
        '<div class="card empty">Tu perfil no tiene permiso para ver historias clínicas.</div>';
      toast(error.message, 'error');
      return;
    }
    toast(error.message, 'error');
  }
}

async function iniciar() {
  usuario = await initChrome({ active: 'historias' });
  if (!usuario) return;

  $('#form-filtros-historias').addEventListener('submit', (evento) => {
    evento.preventDefault();
    cargar(1);
  });
  $('#orden-historias').addEventListener('change', (evento) => {
    estado.orden = evento.target.value;
    cargar(1);
  });
  $('#btn-limpiar-historias').addEventListener('click', () => {
    $('#buscar-nombre').value = '';
    $('#buscar-apellido').value = '';
    $('#buscar-cedula').value = '';
    estado.orden = 'nombre_asc';
    $('#orden-historias').value = 'nombre_asc';
    cargar(1);
  });

  await cargar(1);
}

iniciar();
