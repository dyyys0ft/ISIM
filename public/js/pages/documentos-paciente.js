import { api } from '../api.js';
import { escapeHtml, fmtFecha } from '../ui.js';

const token = new URLSearchParams(location.search).get('t');
const contenedor = document.getElementById('documentos-paciente');

function edad(fecha) {
  if (!fecha) return null;
  const nacimiento = new Date(`${fecha}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return null;
  const hoy = new Date();
  let anios = hoy.getFullYear() - nacimiento.getFullYear();
  const meses = hoy.getMonth() - nacimiento.getMonth();
  if (meses < 0 || (meses === 0 && hoy.getDate() < nacimiento.getDate())) anios -= 1;
  return anios >= 0 && anios < 130 ? anios : null;
}

function fechaExamen(examen) {
  const valor = examen.consulta_fecha || examen.cita_fecha;
  if (!valor) return '';
  return valor.length === 10 ? `${valor}T12:00:00` : valor;
}

function render(datos) {
  const paciente = datos.paciente || {};
  const nombre = `${paciente.nombres || ''} ${paciente.apellidos || ''}`.trim();
  const anios = edad(paciente.fecha_nacimiento);

  contenedor.innerHTML = `
    <header class="documentos-paciente__head">
      ${datos.logoUrl ? `<img class="documentos-paciente__logo" src="${datos.logoUrl}" alt="Logo ISIM" />` : ''}
      <h1>Documentos clínicos</h1>
      <p><strong>${escapeHtml(nombre)}</strong> · C.I. ${escapeHtml(paciente.cedula || '—')}${
        anios != null ? ` · ${anios} años` : ''
      }</p>
      <p class="hint">Enlace privado compartido por ISIM. No lo reenvíes a terceros.</p>
    </header>

    ${
      datos.examenes?.length
        ? datos.examenes
            .map(
              (examen) => `
              <section class="documentos-examen">
                <div class="documentos-examen__head">
                  <div>
                    <h2>${escapeHtml(examen.nombre || 'Examen')}</h2>
                    <p class="hint">
                      ${escapeHtml(fmtFecha(fechaExamen(examen)))} ·
                      ${escapeHtml(examen.tipo || 'otro')}
                    </p>
                  </div>
                  <span class="badge badge--programada">${examen.adjuntos.length} archivo${
                    examen.adjuntos.length === 1 ? '' : 's'
                  }</span>
                </div>
                ${
                  examen.observaciones
                    ? `<p class="small">${escapeHtml(examen.observaciones)}</p>`
                    : ''
                }
                <div class="documentos-archivos">
                  ${examen.adjuntos
                    .map((archivo) => {
                      const imagen = String(archivo.mime || '').startsWith('image/');
                      return `
                        <div class="documento-archivo">
                          ${
                            imagen
                              ? `<a href="${archivo.url}" target="_blank" rel="noopener"><img src="${archivo.url}" alt="${escapeHtml(
                                  archivo.nombre
                                )}" loading="lazy" /></a>`
                              : `<a class="documento-archivo__pdf" href="${archivo.url}" target="_blank" rel="noopener">PDF</a>`
                          }
                          <div>
                            <strong>${escapeHtml(archivo.nombre)}</strong>
                            <div class="row">
                              <a class="btn btn--sm" href="${archivo.url}" target="_blank" rel="noopener">Visualizar</a>
                              <a class="btn btn--sm" href="${archivo.url}?download=1">Descargar</a>
                            </div>
                          </div>
                        </div>`;
                    })
                    .join('')}
                </div>
              </section>`
            )
            .join('')
        : '<div class="empty"><p>No hay documentos disponibles.</p></div>'
    }
  `;
  document.title = `ISIM · Documentos de ${nombre}`;
}

async function cargar() {
  if (!token) {
    contenedor.innerHTML =
      '<div class="empty"><p><strong>Enlace no válido.</strong></p></div>';
    return;
  }

  try {
    render(await api.get(`/api/patients/share/${encodeURIComponent(token)}`));
  } catch (error) {
    contenedor.innerHTML = `<div class="empty"><p><strong>${escapeHtml(
      error.message
    )}</strong></p><p class="small">Pide un nuevo enlace a ISIM.</p></div>`;
  }
}

document.getElementById('btn-imprimir-documentos').addEventListener('click', () => {
  window.print();
});
document.getElementById('btn-volver-documentos').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.location.href = '/';
});

cargar();
