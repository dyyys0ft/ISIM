import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, toast } from '../ui.js';

const id = new URLSearchParams(location.search).get('id');
const contenedor = $('#pedido-doc');

const TIPOS = {
  ecografia: 'Ecografía',
  colposcopia: 'Colposcopia',
  biopsia: 'Biopsia',
  laboratorio: 'Laboratorio',
};

function edad(fecha) {
  if (!fecha) return '—';
  const nacimiento = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return '—';
  const hoy = new Date();
  let anios = hoy.getFullYear() - nacimiento.getFullYear();
  const meses = hoy.getMonth() - nacimiento.getMonth();
  if (meses < 0 || (meses === 0 && hoy.getDate() < nacimiento.getDate())) anios -= 1;
  return anios >= 0 && anios < 130 ? `${anios} años` : '—';
}

function render(pedido) {
  const paciente = pedido.paciente || {};
  const medico = pedido.medico || {};
  const datos = pedido.datos || {};
  const nombre = `${paciente.apellidos || ''} ${paciente.nombres || ''}`.trim();
  const contenido = [
    datos.descripcion,
    datos.indicaciones,
    datos.motivo,
    datos.observaciones,
  ]
    .filter(Boolean)
    .join('\n');

  contenedor.innerHTML = `
    <header class="hoja-impresion__head">
      <div class="hoja-impresion__centro">
        <h1>PEDIDO DE EXAMEN</h1>
        <strong>ISIM · Instituto de la Salud Integral de la Mujer</strong>
        <span>Pedido N.º ${escapeHtml(String(pedido.numero ?? '—').padStart(5, '0'))}</span>
      </div>
      <div class="hoja-impresion__num">${escapeHtml(fmtFecha(pedido.fecha))}</div>
    </header>

    <div class="hoja-impresion__grid">
      <div class="hoja-impresion__span2"><span>Paciente</span><strong>${escapeHtml(nombre)}</strong></div>
      <div><span>C.I.</span><strong>${escapeHtml(paciente.cedula || '—')}</strong></div>
      <div><span>Edad</span><strong>${escapeHtml(edad(paciente.fechaNacimiento))}</strong></div>
      <div class="hoja-impresion__span2"><span>Tipo de pedido</span><strong>${escapeHtml(TIPOS[pedido.tipo] || pedido.tipo || '—')}</strong></div>
      <div><span>Estado</span><strong>${escapeHtml(pedido.estado || '—')}</strong></div>
      <div><span>Teléfono</span><strong>${escapeHtml(paciente.telefono || '—')}</strong></div>
    </div>

    <h2 style="font-size:12px;border-bottom:1px solid var(--line);padding-bottom:4px">Solicitud</h2>
    ${contenido ? `<p style="white-space:pre-wrap">${escapeHtml(contenido)}</p>` : '<p class="muted">Sin indicaciones registradas.</p>'}

    <div class="hoja-impresion__firmas">
      <div class="hoja-impresion__firma">
        <span class="hoja-impresion__linea"></span>
        <strong>${escapeHtml(medico.nombre || 'Profesional de la salud')}</strong>
        <span>${escapeHtml(medico.especialidad || '')}</span>
        <span>Reg. profesional: ${escapeHtml(medico.senecit || '—')}</span>
        <span>Firma y sello</span>
      </div>
    </div>

    ${datos.observaciones ? `<div class="hoja-impresion__nota">${escapeHtml(datos.observaciones)}</div>` : ''}
    <div class="hoja-impresion__pie">Documento generado por ISIM · No válido sin firma del profesional responsable.</div>`;
  document.title = `ISIM — Pedido de ${nombre}`;
}

async function cargar() {
  if (!id) {
    contenedor.innerHTML = '<div class="empty"><p>No se indicó el pedido.</p></div>';
    return;
  }
  try {
    render(await api.get(`/api/pedidos/${encodeURIComponent(id)}`));
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
