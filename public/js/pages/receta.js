import { escapeHtml, fmtFecha } from '../ui.js';
import { api } from '../api.js';

const params = new URLSearchParams(location.search);
const token = params.get('t');
const id = params.get('id');
const contenedor = document.getElementById('receta-doc');

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

const UNIDADES = [
  '',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
  'treinta',
];

function letras(cantidad) {
  const numero = Number(String(cantidad ?? '').replace(/[^\d]/g, ''));
  if (!Number.isFinite(numero) || numero <= 0) return '';
  if (numero <= 30) return UNIDADES[numero];
  if (numero < 100) {
    const decenas = Math.floor(numero / 10);
    const resto = numero % 10;
    const nombres = [
      '',
      'diez',
      'veinte',
      'treinta',
      'cuarenta',
      'cincuenta',
      'sesenta',
      'setenta',
      'ochenta',
      'noventa',
    ];
    return resto ? `${nombres[decenas]} y ${UNIDADES[resto]}` : nombres[decenas];
  }
  if (numero === 100) return 'cien';
  return String(numero);
}

function render(receta) {
  const paciente = receta.paciente || {};
  const nombre = `${paciente.apellidos || ''} ${paciente.nombres || ''}`.trim();
  const anios = edad(paciente.fecha_nacimiento);
  const items = receta.items || [];
  const datos = receta.datos || {};
  const centro = receta.centro || {};
  const recomendaciones = String(datos.recomendaciones || '')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);
  const numero = receta.numero
    ? String(receta.numero).padStart(5, '0')
    : '—';
  const elaborado =
    receta.elaborado && receta.elaborado !== receta.medico_nombre
      ? receta.elaborado
      : null;

  contenedor.innerHTML = `
    <div class="receta-isim">
      ${
        receta.anulada_en
          ? `<div class="receta-anulada">
               <strong>RECETA ANULADA</strong>
               <span>Anulada el ${escapeHtml(fmtFecha(receta.anulada_en))}${
                 receta.motivo_anulacion ? ` · ${escapeHtml(receta.motivo_anulacion)}` : ''
               }</span>
             </div>`
          : ''
      }
      <header class="receta-isim__head">
        ${
          receta.logoUrl
            ? `<img class="receta-isim__logo" src="${receta.logoUrl}" alt="Logo ISIM" />`
            : ''
        }
        <div class="receta-isim__centro">
          <h1>RECETA MÉDICA</h1>
          <strong>${escapeHtml(centro.nombre || receta.encabezado || 'ISIM')}</strong>
          ${centro.direccion ? `<span>${escapeHtml(centro.direccion)}</span>` : ''}
          <span>
            ${centro.telefono ? `Citas: ${escapeHtml(centro.telefono)}` : ''}
            ${centro.telefono && centro.ruc ? ' · ' : ''}
            ${centro.ruc ? `RUC ${escapeHtml(centro.ruc)}` : ''}
          </span>
        </div>
      </header>

      ${
        datos.para_pareja
          ? '<div class="receta-isim__tag">TRATAMIENTO EXCLUSIVO PARA LA PAREJA</div>'
          : ''
      }

      <section class="receta-isim__paciente">
        <div><span>Paciente</span><strong>${escapeHtml(nombre)}</strong></div>
        <div><span>C.I. / HC</span><strong>${escapeHtml(paciente.cedula || '—')}</strong></div>
        <div><span>Edad</span><strong>${anios != null ? `${anios} años` : '—'}</strong></div>
        <div><span>Fecha · N.º</span><strong>${escapeHtml(
          fmtFecha(`${receta.fecha}T12:00:00`)
        )} · ${numero}</strong></div>
        <div class="span2"><span>Diagnóstico</span><strong>${escapeHtml(
          datos.diagnostico || '—'
        )}</strong></div>
        <div><span>CIE-10</span><strong>${escapeHtml(datos.cie || '—')}</strong></div>
        <div class="span2"><span>Alergias</span><strong>${escapeHtml(
          datos.alergias || 'No refiere'
        )}</strong></div>
      </section>

      <section class="receta-isim__rx">
        <div class="receta-isim__rx-head">
          <span>Rp/ Prescripción</span>
          <span>Indicaciones</span>
        </div>
        ${items
          .map(
            (item, indice) => `
            <div class="receta-isim__item">
              <div class="receta-isim__med">
                <span class="receta-isim__num">${indice + 1}</span>
                <div>
                  <strong>${escapeHtml(item.medicamento || '')}</strong>
                  <small>${escapeHtml(
                    [item.presentacion, item.via].filter(Boolean).join(' · ')
                  )}</small>
                  <span class="receta-isim__cantidad">
                    Cantidad: #${escapeHtml(item.cantidad || '')}
                    ${letras(item.cantidad) ? `(${escapeHtml(letras(item.cantidad))})` : ''}
                    ${escapeHtml(item.unidad || '')}
                  </span>
                </div>
              </div>
              <div class="receta-isim__ind">
                ${escapeHtml(
                  item.indicaciones ||
                    [item.dosis, item.frecuencia, item.duracion].filter(Boolean).join(' · ')
                )}
              </div>
            </div>`
          )
          .join('')}
      </section>

      ${
        recomendaciones.length
          ? `<section class="receta-isim__reco">
               <h2>Recomendaciones</h2>
               ${recomendaciones.map((linea) => `<p>• ${escapeHtml(linea)}</p>`).join('')}
             </section>`
          : ''
      }

      ${
        receta.indicaciones
          ? `<section class="receta-isim__reco">
               <h2>Indicaciones generales</h2>
               <p>${escapeHtml(receta.indicaciones)}</p>
             </section>`
          : ''
      }

      <footer class="receta-isim__foot">
        <div class="receta-isim__firma">
          ${receta.firmaUrl ? `<img src="${receta.firmaUrl}" alt="Firma del médico" />` : ''}
          <span class="receta-isim__linea"></span>
          <strong>${escapeHtml(receta.medico_nombre || 'Profesional de la salud')}</strong>
          ${receta.medico_especialidad ? `<span>${escapeHtml(receta.medico_especialidad)}</span>` : ''}
          ${receta.medico_senecit ? `<span>Reg. profesional: ${escapeHtml(receta.medico_senecit)}</span>` : ''}
          <span>Firma y sello</span>
        </div>
      </footer>

      <div class="receta-isim__note">
        ${escapeHtml(receta.pie || '')}
        ${elaborado ? ` · Elaborada por: ${escapeHtml(elaborado)}` : ''}
        ${receta.anulada_en ? ' · RECETA ANULADA' : ''}
      </div>
    </div>
  `;
  document.title = `ISIM · Receta de ${nombre}`;
}

async function cargar() {
  try {
    const receta = token
      ? await api.get(`/api/prescriptions/share/${encodeURIComponent(token)}`)
      : id
        ? await api.get(`/api/prescriptions/${encodeURIComponent(id)}`)
        : null;
    if (!receta) throw new Error('Receta no encontrada');
    render(receta);
  } catch (error) {
    contenedor.innerHTML = `<div class="empty"><p><strong>${escapeHtml(
      error.message
    )}</strong></p><p class="small">Verifica el enlace de la receta.</p></div>`;
  }
}

document.getElementById('btn-imprimir-receta-pagina').addEventListener('click', () => {
  window.print();
});
document.getElementById('btn-volver-receta').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else window.location.href = '/';
});

cargar();
