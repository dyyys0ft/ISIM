import { api } from '../../api.js';
import { $, escapeHtml, fmtFecha, toast } from '../../ui.js';

function datosDe(fila) {
  let datos = fila?.datos;
  if (typeof datos === 'string') {
    try {
      datos = JSON.parse(datos);
    } catch {
      datos = null;
    }
  }
  return datos || {};
}

function campo(nombre, etiqueta, valor, extra = '') {
  return `<label class="f"><span>${escapeHtml(etiqueta)}</span>
    <input class="input" name="${nombre}" value="${escapeHtml(valor ?? '')}" maxlength="30" ${extra} /></label>`;
}

function filaVitales(registro) {
  const d = datosDe(registro);
  return `<tr>
    <td>${escapeHtml(fmtFecha(registro.fecha || registro.cita_fecha, { time: true }))}</td>
    <td class="num">${escapeHtml(d.pa_sis || '—')}/${escapeHtml(d.pa_dia || '—')}</td>
    <td class="num">${escapeHtml(d.fc || '—')}</td>
    <td class="num">${escapeHtml(d.fr || '—')}</td>
    <td class="num">${escapeHtml(d.temp || '—')}</td>
    <td class="num">${escapeHtml(d.sat || '—')}</td>
    <td class="num">${escapeHtml(d.peso || '—')}</td>
    <td class="num">${escapeHtml(d.talla || '—')}</td>
    <td class="num">${escapeHtml(d.imc || '—')}</td>
    <td>${escapeHtml(registro.medico_nombre || '—')}</td>
  </tr>`;
}

async function registroDeCita(citaId) {
  if (!citaId) return null;
  const lista = await api
    .get(`/api/clinical-records?appointmentId=${encodeURIComponent(citaId)}`)
    .catch(() => []);
  if (!lista?.[0]?.id) return null;
  return api
    .get(`/api/clinical-records/${encodeURIComponent(lista[0].id)}`)
    .catch(() => lista[0]);
}

/** Pestaña "Signos vitales" — historial y registro en la consulta actual. */
export const tab = {
  id: 'signos',
  titulo: 'Signos vitales',
  permiso: ['historias.resumen', 'historias.ver'],
  async render(contenedor, ctx) {
    contenedor.innerHTML = '<div class="empty">Cargando signos vitales…</div>';

    const [lista, actual] = await Promise.all([
      api
        .get(`/api/clinical-records?patientId=${encodeURIComponent(ctx.pacienteId)}`)
        .catch(() => []),
      registroDeCita(ctx.cita?.id),
    ]);
    const editable =
      ctx.puede('historias.gestionar') &&
      actual &&
      !(actual.consulta_finalizada || actual.cita_estado === 'atendida');
    const d = actual?.datos || {};
    const formulario = editable
      ? `<form id="form-signos" class="stack">
          <div class="error-formulario" id="error-signos" hidden></div>
          <div class="grid g2">
            ${campo('pa_sis', 'PA sistólica (mmHg)', d.pa_sis)}
            ${campo('pa_dia', 'PA diastólica (mmHg)', d.pa_dia)}
            ${campo('fc', 'Frec. cardíaca (lpm)', d.fc)}
            ${campo('fr', 'Frec. respiratoria (rpm)', d.fr)}
            ${campo('temp', 'Temperatura (°C)', d.temp)}
            ${campo('sat', 'Sat. O₂ (%)', d.sat)}
            ${campo('peso', 'Peso (kg)', d.peso)}
            ${campo('talla', 'Talla (cm)', d.talla)}
            ${campo('imc', 'IMC', d.imc, 'disabled')}
          </div>
          <div class="row">
            <span class="small muted grow">Se guardan en la consulta del día.</span>
            <button class="btn pri" type="submit">Guardar signos vitales</button>
          </div>
        </form>`
      : '';

    const aviso = !ctx.cita
      ? `<div class="card empty">La paciente no tiene un turno activo. Abre una consulta para registrar signos vitales de hoy.</div>`
      : !actual
        ? `<div class="card"><p class="muted">La consulta de hoy todavía no se ha iniciado.</p>
             ${ctx.puede('historias.gestionar') ? '<button class="btn pri" type="button" id="iniciar-signos">Iniciar consulta</button>' : ''}</div>`
        : actual.consulta_finalizada || actual.cita_estado === 'atendida'
          ? `<div class="card"><div class="items-center row"><span class="grow small muted">Consulta firmada: los signos vitales quedaron bloqueados.</span><span class="badge badge--green">Firmada</span></div></div>`
          : `<div class="card">${editable ? formulario : '<p class="muted">No tienes permiso para registrar signos vitales.</p>'}</div>`;

    contenedor.innerHTML = `
      <div class="ficha-split">
        <section class="ficha-split__main">
          <div class="card">
            <div class="row">
              <h3 class="grow">Historial de signos vitales</h3>
              <span class="small muted">${lista.length} registro(s)</span>
            </div>
            ${lista.length
              ? `<div class="tbl-wrap" style="margin-top:10px">
                  <table class="tbl">
                    <thead><tr>
                      <th>Fecha</th><th>PA</th><th>FC</th><th>FR</th><th>T°</th>
                      <th>SatO₂</th><th>Peso</th><th>Talla</th><th>IMC</th><th>Médico</th>
                    </tr></thead>
                    <tbody>${lista.map(filaVitales).join('')}</tbody>
                  </table>
                </div>`
              : '<p class="muted">Todavía no hay signos vitales registrados.</p>'}
          </div>
        </section>
        <aside class="ficha-split__side">${aviso}</aside>
      </div>`;

    $('#iniciar-signos')?.addEventListener('click', async (evento) => {
      const boton = evento.currentTarget;
      boton.disabled = true;
      try {
        await api.post(`/api/appointments/${encodeURIComponent(ctx.cita.id)}/start-consultation`);
        toast('Consulta iniciada');
        await ctx.recargar();
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
    });

    const form = $('#form-signos', contenedor);
    if (!form) return;
    const calcularImc = () => {
      const peso = Number(form.elements.peso.value);
      const talla = Number(form.elements.talla.value);
      form.elements.imc.value = peso && talla ? (peso / (talla / 100) ** 2).toFixed(1) : '';
    };
    form.elements.peso?.addEventListener('input', calcularImc);
    form.elements.talla?.addEventListener('input', calcularImc);
    calcularImc();

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const datos = { ...(actual.datos || {}) };
      for (const nombre of ['pa_sis', 'pa_dia', 'fc', 'fr', 'temp', 'sat', 'peso', 'talla', 'imc']) {
        datos[nombre] = form.elements[nombre]?.value.trim() || '';
      }
      const boton = form.querySelector('button[type="submit"]');
      boton.disabled = true;
      boton.textContent = 'Guardando…';
      try {
        await api.patch(`/api/clinical-records/${encodeURIComponent(actual.id)}`, { datos });
        toast('Signos vitales guardados');
        await ctx.recargar();
      } catch (error) {
        const errorBox = $('#error-signos', form);
        errorBox.hidden = false;
        errorBox.textContent = error.message;
        toast(error.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Guardar signos vitales';
      }
    });
  },
};
