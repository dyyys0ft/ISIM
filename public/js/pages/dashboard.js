import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';

function renderRecientes(firmas) {
  const contenedor = $('#recientes');

  if (!firmas.length) {
    contenedor.innerHTML = '<p class="muted">Todavía no hay firmas registradas.</p>';
    return;
  }

  contenedor.innerHTML = firmas
    .map(
      (firma) => `
      <div class="recent-row">
        <div>
          <strong>${escapeHtml(firma.paciente || 'Paciente')}</strong>
          <span class="cell-sub">${escapeHtml(firma.titulo || 'Documento')}</span>
        </div>
        <div class="recent-row__meta">
          <span>${escapeHtml(firma.empleado || '')}</span>
          <span>${escapeHtml(fmtFecha(firma.firmadoEn, { time: true }))}</span>
        </div>
      </div>`
    )
    .join('');
}

async function init() {
  const usuario = await initChrome({ active: 'dashboard' });
  if (!usuario) return;

  if (!puede(usuario, 'dashboard.ver')) {
    window.location.replace('/documentos.html');
    return;
  }

  try {
    const datos = await api.get('/api/dashboard');

    $('#firmas-hoy').textContent = datos.firmas.hoy;
    $('#firmas-semana').textContent = datos.firmas.semana;
    $('#firmas-mes').textContent = datos.firmas.mes;
    $('#pacientes-hoy').textContent = datos.pacientes.hoy;
    $('#pacientes-mes').textContent = datos.pacientes.mes;
    $('#total-firmados').textContent = datos.totales.firmados;
    $('#total-detalle').textContent = `${datos.totales.documentos} documentos · ${datos.totales.pacientes} pacientes activos`;

    renderRecientes(datos.recientes);
  } catch (error) {
    toast(error.message, 'error');
  }
}

init();
