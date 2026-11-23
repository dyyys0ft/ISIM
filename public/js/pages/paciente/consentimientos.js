import { api } from '../../api.js';
import { $, $$, escapeHtml, fmtFecha, toast, modal, confirmar } from '../../ui.js';

function estadoConsentimiento(doc) {
  if (doc.estado === 'firmado') {
    return { clase: 'green', texto: 'Firmado' };
  }
  if (doc.estado === 'anulado') {
    return { clase: 'grey', texto: 'Anulado' };
  }
  return { clase: 'red', texto: 'Pendiente de firma' };
}

/** Pestaña "Consentimientos" — contrato ui-v2 SPEC §8. */
export const tab = {
  id: 'consentimientos',
  titulo: 'Consentimientos',
  permiso: 'documentos.ver',
  async render(contenedor, ctx) {
    contenedor.innerHTML = '<div class="empty">Cargando consentimientos…</div>';
    const documentos = await api
      .get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/documents`)
      .catch(() => []);
    const plantillas = await api.get('/api/templates').catch(() => []);
    const consentimientos = (documentos || []).filter(
      (doc) => /consentimiento/i.test(doc.titulo || '') || !doc.codigo
    );
    const puedeCrear = ctx.puede('documentos.crear');
    const puedeFirmar = ctx.puede('documentos.firmar');
    const puedeAnular = ctx.puede('documentos.anular');
    const pendientes = consentimientos.filter((doc) => !['firmado', 'anulado'].includes(doc.estado));
    const menor = Boolean(ctx.paciente.es_menor);

    const opciones = plantillas.filter((p) => /consentimiento/i.test(p.tipo || p.nombre));

    contenedor.innerHTML = `
      ${menor
        ? `<div class="ficha-warn">
            <span class="grow">⚠ <b>Paciente menor de edad.</b> Los consentimientos deben generarse y firmarse por el representante legal antes de la cita.</span>
          </div>`
        : ''}
      ${pendientes.length
        ? `<div class="info small" style="margin-bottom:12px">Hay ${pendientes.length} consentimiento(s) pendiente(s) de firma. No se debe iniciar el procedimiento hasta que estén firmados.</div>`
        : ''}
      <div class="ficha-split">
        <section class="ficha-split__main">
          <div class="row" style="margin-bottom:10px">
            <h2 class="grow">Historial de consentimientos</h2>
            <span class="small muted">${consentimientos.length} registro(s)</span>
          </div>
          ${consentimientos.length
            ? consentimientos
                .map((doc) => {
                  const estado = estadoConsentimiento(doc);
                  return `<div class="card" style="margin-bottom:10px">
                    <div class="row">
                      <div class="grow">
                        <b>${escapeHtml(doc.titulo || 'Consentimiento informado')}</b>
                        <div class="small muted">${escapeHtml(doc.codigo || '')} · ${escapeHtml(fmtFecha(doc.creado_en, { time: true }))} · ${escapeHtml(String(doc.firmas || 0))} firma(s)</div>
                      </div>
                      <span class="badge badge--${estado.clase}">${estado.texto}</span>
                    </div>
                    <div class="row" style="margin-top:8px">
                      <a class="btn btn--sm" href="/documento.html?id=${encodeURIComponent(doc.id)}">Ver documento</a>
                      ${puedeFirmar && ['borrador', 'pendiente_firma'].includes(doc.estado) ? `<button class="btn btn--sm pri" type="button" data-firmar="${encodeURIComponent(doc.id)}">Enviar a firmar</button>` : ''}
                      ${puedeCrear && !['firmado', 'anulado'].includes(doc.estado) ? `<button class="btn btn--sm" type="button" data-riesgos="${encodeURIComponent(doc.id)}">Riesgos específicos</button>` : ''}
                      ${puedeAnular && doc.estado !== 'anulado' ? `<button class="btn btn--sm danger" type="button" data-evento="${encodeURIComponent(doc.id)}" data-tipo="${doc.estado === 'firmado' ? 'revocatoria' : 'negativa'}">${doc.estado === 'firmado' ? 'Revocar' : 'Negativa'}</button>` : ''}
                    </div>
                  </div>`;
                })
                .join('')
            : '<div class="card empty">Esta paciente todavía no tiene consentimientos registrados.</div>'}
        </section>
        <aside class="ficha-split__side">
          <div class="card">
            <h3>Nuevo consentimiento</h3>
            ${
              puedeCrear
                ? `<div class="error-formulario" role="alert" aria-live="assertive" id="error-ci" hidden></div>
                   ${
                     ctx.cita && menor
                       ? `<p class="small muted" style="margin-top:8px">Se usará la plantilla ISIM (Form. 024) y quedará enlazado al turno actual.</p>
                          <button class="btn pri" type="button" id="generar-ci" style="margin-top:10px">Generar consentimiento para esta cita</button>`
                       : opciones.length
                         ? `<label class="f" style="margin-top:10px"><span>Plantilla</span><select class="select" id="ci-plantilla">${opciones
                             .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)}</option>`)
                             .join('')}</select></label>
                            <button class="btn pri" type="button" id="generar-ci" style="margin-top:10px">Generar consentimiento</button>`
                         : '<p class="small muted" style="margin-top:8px">No hay plantillas de consentimiento activas.</p>'
                   }`
                : '<p class="muted" style="margin-top:8px">Tu perfil no tiene permiso para crear consentimientos.</p>'
            }
          </div>
        </aside>
      </div>`;

    $('#generar-ci', contenedor)?.addEventListener('click', async (evento) => {
      const boton = evento.currentTarget;
      const error = $('#error-ci', contenedor);
      if (error) error.hidden = true;
      boton.disabled = true;
      boton.textContent = 'Generando…';
      try {
        if (ctx.cita && menor) {
          await api.post(`/api/appointments/${encodeURIComponent(ctx.cita.id)}/consent`);
        } else {
          const templateId = $('#ci-plantilla', contenedor)?.value;
          if (!templateId) throw new Error('No hay una plantilla de consentimiento activa');
          await api.post('/api/documents', {
            patientId: ctx.pacienteId,
            templateId,
            appointmentId: ctx.cita?.id || undefined,
            subtipo: 'consentimiento',
          });
        }
        toast('Consentimiento generado');
        await tab.render(contenedor, ctx);
      } catch (fallo) {
        if (error) {
          error.hidden = false;
          error.textContent = fallo.message;
        }
        toast(fallo.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Generar consentimiento';
      }
    });

    for (const boton of $$('[data-firmar]', contenedor)) {
      boton.addEventListener('click', async () => {
        try {
          const sesion = await api.post(
            `/api/documents/${encodeURIComponent(boton.dataset.firmar)}/sign-session`
          );
          window.open(sesion.url, '_blank');
          toast('Sesión de firma iniciada');
          await tab.render(contenedor, ctx);
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }

    for (const boton of $$('[data-riesgos]', contenedor)) {
      boton.addEventListener('click', async () => {
        try {
          const doc = await api.get(`/api/documents/${encodeURIComponent(boton.dataset.riesgos)}`);
          const actual = doc.datos?.riesgosEspecificos || '';
          const dialogo = modal(
            'Riesgos específicos',
            `<div class="info small" style="margin-bottom:10px">Se agregan al borrador del consentimiento. No se puede modificar un documento ya firmado.</div>
             <label class="f"><span>Riesgos y consideraciones de esta paciente</span>
               <textarea class="textarea" id="riesgos-texto" rows="5" maxlength="5000" placeholder="Ej.: alergia a penicilina, anticoagulación, embarazo de alto riesgo…">${escapeHtml(actual)}</textarea></label>`,
            `<button class="btn" type="button" data-cerrar-modal>Cancelar</button>
             <button class="btn pri" type="button" id="riesgos-guardar">Guardar</button>`
          );
          dialogo.querySelector('#riesgos-guardar')?.addEventListener('click', async () => {
            try {
              await api.put(`/api/documents/${encodeURIComponent(doc.id)}/datos`, {
                riesgosEspecificos: dialogo.querySelector('#riesgos-texto').value.trim(),
              });
              toast('Riesgos guardados y borrador actualizado');
              dialogo.close();
              dialogo.remove();
              await tab.render(contenedor, ctx);
            } catch (fallo) {
              toast(fallo.message, 'error');
            }
          });
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }

    for (const boton of $$('[data-evento]', contenedor)) {
      boton.addEventListener('click', async () => {
        const tipo = boton.dataset.tipo;
        const titulo = tipo === 'revocatoria' ? 'Revocar consentimiento' : 'Registrar negativa';
        const mensaje =
          tipo === 'revocatoria'
            ? '¿Revocar el consentimiento firmado? Se conservarán las versiones firmadas y el evento quedará auditado.'
            : '¿Registrar la negativa de la paciente o su representante? El documento se anulará y no podrá firmarse.';
        if (!(await confirmar(mensaje, { titulo, peligro: true }))) return;
        const dialogo = modal(
          titulo,
          `<label class="f"><span>Motivo</span><textarea class="textarea" id="evento-motivo" rows="3" maxlength="1000" placeholder="Motivo de la negativa o revocatoria"></textarea></label>`,
          `<button class="btn" type="button" data-cerrar-modal>Cancelar</button>
           <button class="btn danger" type="button" id="evento-guardar">Confirmar</button>`
        );
        dialogo.querySelector('#evento-guardar')?.addEventListener('click', async () => {
          try {
            await api.post(`/api/documents/${encodeURIComponent(boton.dataset.evento)}/consent-event`, {
              tipo,
              motivo: dialogo.querySelector('#evento-motivo').value.trim(),
            });
            toast(tipo === 'revocatoria' ? 'Consentimiento revocado' : 'Negativa registrada');
            dialogo.close();
            dialogo.remove();
            await tab.render(contenedor, ctx);
          } catch (fallo) {
            toast(fallo.message, 'error');
          }
        });
      });
    }
  },
};
