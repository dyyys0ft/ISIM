import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, toast } from '../ui.js';
import { consultaKV } from './paciente/consulta.js';

const id = new URLSearchParams(location.search).get('id');
const contenedor = $('#consulta-doc');

function render(historia) {
  const P = historia.paciente || {};
  const nombre = `${P.apellidos || ''} ${P.nombres || ''}`.trim();
  const datos = historia.datos || {};
  const firmada = historia.consulta_finalizada || historia.cita_estado === 'atendida';

  contenedor.innerHTML = `
    <header class="hoja-impresion__head">
      <div class="hoja-impresion__centro">
        <h1>HISTORIA CLÍNICA · CONSULTA EXTERNA</h1>
        <strong>ISIM · Instituto de la Salud Integral de la Mujer</strong>
        <span>${escapeHtml(fmtFecha(historia.fecha || historia.cita_fecha, { weekday: true }))}</span>
      </div>
      <div class="hoja-impresion__num">${firmada ? 'CONSULTA FIRMADA' : 'BORRADOR'}</div>
    </header>

    <div class="hoja-impresion__grid">
      <div class="hoja-impresion__span2"><span>Paciente</span><strong>${escapeHtml(nombre)}</strong></div>
      <div><span>C.I.</span><strong>${escapeHtml(P.cedula || '—')}</strong></div>
      <div><span>Teléfono</span><strong>${escapeHtml(P.telefono || '—')}</strong></div>
      <div class="hoja-impresion__span2"><span>Médico</span><strong>${escapeHtml(historia.medico_nombre || '—')}</strong></div>
      <div class="hoja-impresion__span2"><span>Registro</span><strong>${escapeHtml(historia.creado_en ? fmtFecha(historia.creado_en, { time: true }) : '—')}</strong></div>
    </div>

    ${consultaKV(datos)}

    ${(historia.addenda || [])
      .map(
        (nota) => `<div class="hoja-impresion__nota">
          <strong>Nota aclaratoria · ${escapeHtml(fmtFecha(nota.creado_en, { time: true }))} · ${escapeHtml(nota.usuario_nombre || '')}</strong><br />
          ${escapeHtml(nota.texto)}
        </div>`
      )
      .join('')}

    <div class="hoja-impresion__firmas">
      <div class="hoja-impresion__firma">
        <span class="hoja-impresion__linea"></span>
        <strong>${escapeHtml(historia.medico_nombre || 'Profesional de la salud')}</strong>
        <span>Firma y sello del médico tratante</span>
      </div>
      <div class="hoja-impresion__firma">
        <span class="hoja-impresion__linea"></span>
        <strong>${escapeHtml(nombre)}</strong>
        <span>Firma de la paciente o representante</span>
      </div>
    </div>

    ${P.alergias ? `<div class="hoja-impresion__nota">Alergias registradas: ${escapeHtml(P.alergias)}</div>` : ''}
    <div class="hoja-impresion__pie">Documento generado electrónicamente por ISIM · Conservar en la historia clínica.</div>`;
  document.title = `ISIM — Consulta de ${nombre}`;
}

async function cargar() {
  if (!id) {
    contenedor.innerHTML = '<div class="empty"><p>No se indicó la consulta.</p></div>';
    return;
  }
  try {
    render(await api.get(`/api/clinical-records/${encodeURIComponent(id)}`));
  } catch (error) {
    contenedor.innerHTML = `<div class="empty"><p><strong>${escapeHtml(error.message)}</strong></p></div>`;
    toast(error.message, 'error');
  }
}

$('#btn-imprimir')?.addEventListener('click', () => window.print());
$('#btn-volver')?.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = '/pacientes.html';
});

cargar();
