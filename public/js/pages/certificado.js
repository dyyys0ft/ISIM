import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, toast } from '../ui.js';

const id = new URLSearchParams(location.search).get('id');
const contenedor = $('#certificado-doc');

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

function render(documento, membretes) {
  const P = documento.paciente || {};
  const medico = documento.medico || {};
  const datos = documento.datos || {};
  const tipo = documento.subtipo === 'iess' ? 'iess' : 'atencion';
  const membrete = membretes?.[tipo] || { encabezado: '', pie: '', ciudad: 'Riobamba' };
  const nombre = `${P.apellidos || ''} ${P.nombres || ''}`.trim();
  const contenido = [
    datos.diagnostico && `Diagnóstico: ${datos.diagnostico}`,
    datos.cie && `CIE-10: ${datos.cie}`,
    datos.dias_reposo && `Días de reposo: ${datos.dias_reposo}`,
    datos.empresa && `Institución: ${datos.empresa}`,
    datos.puesto && `Puesto: ${datos.puesto}`,
    datos.procedimiento && `Procedimiento: ${datos.procedimiento}`,
    datos.semanas && `Semanas de embarazo: ${datos.semanas}`,
    datos.observaciones,
  ]
    .filter(Boolean)
    .join('\n');

  contenedor.innerHTML = `
    <header class="hoja-impresion__head">
      ${documento.logoUrl ? `<img src="${escapeHtml(documento.logoUrl)}" alt="Logo ISIM" />` : ''}
      <div class="hoja-impresion__centro">
        <h1>${tipo === 'iess' ? 'CERTIFICADO PARA EL IESS' : 'CERTIFICADO DE ATENCIÓN'}</h1>
        <strong>${escapeHtml(membrete.encabezado || 'ISIM · Instituto de la Salud Integral de la Mujer')}</strong>
        <span>${escapeHtml(membrete.ciudad || 'Riobamba')}</span>
      </div>
      <div class="hoja-impresion__num">
        N.º ${escapeHtml(documento.numero ?? '—')}<br />
        ${escapeHtml(fmtFecha(datos.fecha || documento.creado_en))}
      </div>
    </header>

    ${documento.estado === 'anulado' ? '<div class="hoja-impresion__anulada">CERTIFICADO ANULADO</div>' : ''}

    <p style="text-align:justify">
      Yo, <strong>${escapeHtml(medico.nombre || 'profesional de la salud')}</strong>, con registro profesional
      N.º ${escapeHtml(medico.senecit || '—')}, certifico que <strong>${escapeHtml(nombre)}</strong>,
      de ${escapeHtml(edad(P.fecha_nacimiento))}, con C.I. ${escapeHtml(P.cedula || '—')},
      ${tipo === 'iess' ? 'fue atendida en esta institución y requiere' : 'acudió a consulta en esta institución el'}
      ${escapeHtml(fmtFecha(datos.fecha_atencion || datos.fecha || documento.creado_en))}.
    </p>

    ${contenido ? `<div class="hoja-impresion__nota" style="white-space:pre-wrap">${escapeHtml(contenido)}</div>` : ''}

    <div class="hoja-impresion__firmas">
      <div class="hoja-impresion__firma">
        ${medico.firmaUrl ? `<img src="${escapeHtml(medico.firmaUrl)}" alt="Firma médica" />` : ''}
        <span class="hoja-impresion__linea"></span>
        <strong>${escapeHtml(medico.nombre || 'Profesional de la salud')}</strong>
        <span>${escapeHtml(medico.especialidad || '')}</span>
        <span>C.I. ${escapeHtml(medico.cedula || '—')}</span>
        <span>Reg. profesional: ${escapeHtml(medico.senecit || '—')}</span>
        <span>Firma y sello</span>
      </div>
      <div class="hoja-impresion__firma">
        <span class="hoja-impresion__linea"></span>
        <strong>${escapeHtml(nombre)}</strong>
        <span>C.I. ${escapeHtml(P.cedula || '—')}</span>
        <span>Firma de la paciente o representante</span>
      </div>
    </div>

    <div class="hoja-impresion__pie">${escapeHtml(membrete.pie || documento.pieTexto || 'ISIM · Salud Integral de la Mujer')}</div>`;
  document.title = `ISIM — Certificado de ${nombre}`;
}

async function cargar() {
  if (!id) {
    contenedor.innerHTML = '<div class="empty"><p>No se indicó el certificado.</p></div>';
    return;
  }
  try {
    const documento = await api.get(`/api/documents/${encodeURIComponent(id)}`);
    const membretes = await api.get('/api/settings/membretes').catch(() => null);
    render(documento, membretes);
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
