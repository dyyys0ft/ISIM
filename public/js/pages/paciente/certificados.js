import { api } from '../../api.js';
import { $, $$, escapeHtml, fmtFecha, toast, modal } from '../../ui.js';

const SUBTIPOS = [
  ['iess', 'Certificado para el IESS'],
  ['atencion', 'Certificado de atención'],
];

function nombreSubtipo(valor) {
  return SUBTIPOS.find(([clave]) => clave === valor)?.[1] || valor || 'Certificado';
}

/** Pestaña "Certificados" — contrato ui-v2 SPEC §8. */
export const tab = {
  id: 'certificados',
  titulo: 'Certificados',
  permiso: 'historias.ver',
  async render(contenedor, ctx) {
    contenedor.innerHTML = '<div class="empty">Cargando certificados…</div>';
    const certificados = await api
      .get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/certificados`)
      .catch(() => []);
    const editable = ctx.puede('historias.gestionar');
    const hoy = new Date().toLocaleDateString('en-CA');
    const P = ctx.paciente;

    contenedor.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <h2 class="grow">Certificados emitidos</h2>
        ${editable ? '<button class="btn pri" type="button" id="nuevo-certificado">＋ Nuevo certificado</button>' : ''}
      </div>
      ${certificados.length
        ? certificados
            .map(
              (certificado) => `<div class="card" style="margin-bottom:10px">
                <div class="row">
                  <div class="grow">
                    <b>${escapeHtml(certificado.titulo || nombreSubtipo(certificado.subtipo))}</b>
                    <div class="small muted">N.º ${escapeHtml(certificado.numero || '—')} · ${escapeHtml(fmtFecha(certificado.creado_en, { time: true }))}</div>
                  </div>
                  <span class="badge badge--${certificado.estado === 'firmado' ? 'green' : certificado.estado === 'anulado' ? 'grey' : 'red'}">${escapeHtml(certificado.estado || 'borrador')}</span>
                </div>
                <div class="row" style="margin-top:8px">
                  <a class="btn btn--sm" href="/documento.html?id=${encodeURIComponent(certificado.id)}">Ver</a>
                  <a class="btn btn--sm" href="/certificado.html?id=${encodeURIComponent(certificado.id)}" target="_blank">Imprimir</a>
                  <button class="btn btn--sm" type="button" data-detalle="${encodeURIComponent(certificado.id)}">Detalles</button>
                </div>
              </div>`
            )
            .join('')
        : '<div class="card empty">Todavía no hay certificados emitidos para esta paciente.</div>'}`;

    $('#nuevo-certificado', contenedor)?.addEventListener('click', () => {
      const dialogo = modal(
        'Nuevo certificado',
        `<div class="error-formulario" role="alert" aria-live="assertive" id="error-certificado" hidden></div>
         <div class="stack">
          <label class="f"><span>Tipo de certificado *</span><select class="select" id="cert-tipo">${SUBTIPOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
          <label class="f"><span>Fecha de emisión *</span><input class="input" type="date" id="cert-fecha" value="${hoy}" /></label>
          <label class="f"><span>Institución / empresa</span><input class="input" id="cert-empresa" value="${escapeHtml(P.empresa || '')}" /></label>
          <label class="f"><span>Diagnóstico</span><input class="input" id="cert-diagnostico" maxlength="500" placeholder="Diagnóstico a consignar" /></label>
          <label class="f"><span>CIE-10</span><input class="input" id="cert-cie" maxlength="80" /></label>
          <label class="f"><span>Días de reposo</span><input class="input" type="number" min="1" id="cert-dias" /></label>
          <label class="f"><span>Observaciones</span><textarea class="textarea" id="cert-obs" rows="3" maxlength="3000"></textarea></label>
         </div>`,
        `<button class="btn" type="button" data-cerrar-modal>Cancelar</button>
         <button class="btn pri" type="button" id="cert-guardar">Generar certificado</button>`
      );
      dialogo.querySelector('#cert-guardar')?.addEventListener('click', async () => {
        const error = dialogo.querySelector('#error-certificado');
        const fecha = dialogo.querySelector('#cert-fecha').value;
        if (!fecha) {
          error.hidden = false;
          error.textContent = 'La fecha de emisión es obligatoria.';
          return;
        }
        const boton = dialogo.querySelector('#cert-guardar');
        boton.disabled = true;
        boton.textContent = 'Generando…';
        try {
          const respuesta = await api.post(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/certificados`, {
            subtipo: dialogo.querySelector('#cert-tipo').value,
            fecha,
            datos: {
              empresa: dialogo.querySelector('#cert-empresa').value.trim(),
              puesto: P.puesto || '',
              diagnostico: dialogo.querySelector('#cert-diagnostico').value.trim(),
              cie: dialogo.querySelector('#cert-cie').value.trim(),
              dias_reposo: dialogo.querySelector('#cert-dias').value.trim(),
              observaciones: dialogo.querySelector('#cert-obs').value.trim(),
            },
          });
          toast(`Certificado N.º ${respuesta.numero ?? ''} generado`);
          dialogo.close();
          dialogo.remove();
          await tab.render(contenedor, ctx);
        } catch (fallo) {
          error.hidden = false;
          error.textContent = fallo.message;
          toast(fallo.message, 'error');
          boton.disabled = false;
          boton.textContent = 'Generar certificado';
        }
      });
    });

    for (const boton of $$('[data-detalle]', contenedor)) {
      boton.addEventListener('click', async () => {
        try {
          const id = encodeURIComponent(boton.dataset.detalle);
          const [documento, certificado] = await Promise.all([
            api.get(`/api/documents/${id}`),
            api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/certificados`),
          ]);
          const datos = certificado.find((c) => c.id === boton.dataset.detalle)?.datos || documento.datos || {};
          modal(
            'Detalle del certificado',
            `<dl class="kv">
              <dt>Tipo</dt><dd>${escapeHtml(nombreSubtipo(documento.subtipo))}</dd>
              <dt>Estado</dt><dd>${escapeHtml(documento.estado || '')}</dd>
              <dt>Emitido</dt><dd>${escapeHtml(fmtFecha(documento.creado_en, { time: true }))}</dd>
              <dt>Datos</dt><dd>${escapeHtml(JSON.stringify(datos, null, 2))}</dd>
            </dl>
            ${(documento.consentEvents || []).length ? `<div class="small muted" style="margin-top:10px">Eventos: ${documento.consentEvents.map((e) => escapeHtml(e.tipo)).join(', ')}</div>` : ''}`,
            '<button class="btn" type="button" data-cerrar-modal>Cerrar</button>'
          );
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }
  },
};
