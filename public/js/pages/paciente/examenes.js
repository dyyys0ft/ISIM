import { api } from '../../api.js';
import { $, $$, escapeHtml, fmtFecha, toast, modal, confirmar } from '../../ui.js';

const TIPOS = [
  ['clinico', 'Clínico'],
  ['laboratorio', 'Laboratorio'],
  ['imagen', 'Imagen'],
  ['otro', 'Otro'],
];
const ESTADOS = [
  ['solicitado', 'Solicitado'],
  ['recibido', 'Recibido'],
  ['evaluado', 'Evaluado'],
];

function etiqueta(lista, valor) {
  return lista.find(([clave]) => clave === valor)?.[1] || valor || '—';
}

function estadoBadge(estado) {
  const clase = estado === 'evaluado' ? 'green' : estado === 'recibido' ? 'new' : 'grey';
  return `<span class="badge badge--${clase}">${escapeHtml(etiqueta(ESTADOS, estado))}</span>`;
}

/** Pestaña "Exámenes": historial a la izquierda y alta a la derecha. */
export const tab = {
  id: 'examenes',
  titulo: 'Exámenes',
  permiso: ['historias.resumen', 'historias.ver'],
  async render(contenedor, ctx) {
    contenedor.innerHTML = '<div class="empty">Cargando exámenes…</div>';
    const [historias, pedidos] = await Promise.all([
      api.get(`/api/clinical-records?patientId=${encodeURIComponent(ctx.pacienteId)}`).catch(() => []),
      api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/pedidos`).catch(() => []),
    ]);
    const examenes = (historias || []).flatMap((h) =>
      (h.examenes || []).map((e) => ({
        ...e,
        fecha: h.cita_fecha || h.fecha,
        recordId: h.id,
        citaId: h.appointment_id,
        citaFecha: h.cita_fecha,
        citaMotivo: h.cita_motivo,
        medicoNombre: h.medico_nombre,
      }))
    );
    examenes.sort((a, b) => String(b.creado_en || '').localeCompare(String(a.creado_en || '')));
    const editable = ctx.puede('examenes.gestionar');
    const puedeEditarObservaciones = ['medico', 'admin'].includes(ctx.usuario?.rol);

    contenedor.innerHTML = `
      <div class="ficha-split">
        <section class="ficha-split__main">
          <div class="row" style="margin-bottom:10px">
            <h2 class="grow">Historial de exámenes</h2>
            <span class="small muted">${examenes.length} registro(s)</span>
          </div>
          ${examenes.length
            ? examenes
                .map(
                  (examen) => `<div class="card examen-card" style="margin-bottom:10px">
                    <div class="row">
                      <div class="grow">
                        <b>${escapeHtml(examen.nombre || 'Examen')}</b>
                        <div class="small muted">${escapeHtml(etiqueta(TIPOS, examen.tipo))} · ${escapeHtml(fmtFecha(examen.fecha || examen.creado_en))}${examen.pedido_id ? ' · asociado a pedido' : ''}</div>
                        <div class="small examen-cita">Cita: ${escapeHtml(
                          examen.citaFecha
                            ? fmtFecha(examen.citaFecha, { time: true })
                            : examen.fecha
                              ? fmtFecha(examen.fecha, { time: true })
                              : 'No registrada'
                        )}${examen.citaMotivo ? ` · ${escapeHtml(examen.citaMotivo)}` : ''}${examen.medicoNombre ? ` · ${escapeHtml(examen.medicoNombre)}` : ''}</div>
                      </div>
                      ${estadoBadge(examen.estado)}
                    </div>
                    ${examen.descripcion ? `<p class="small" style="margin-top:8px;white-space:pre-wrap">${escapeHtml(examen.descripcion)}</p>` : ''}
                    <div class="examen-observacion${examen.observaciones ? '' : ' examen-observacion--vacia'}">
                      <b>Observaciones del examen</b>
                      <p>${escapeHtml(examen.observaciones || 'Sin observaciones registradas.')}</p>
                    </div>
                    <div class="row" style="margin-top:8px">
                      ${(examen.adjuntos || [])
                        .map(
                          (archivo) => `<a class="btn btn--sm" href="/api/clinical-attachments/${encodeURIComponent(archivo.id)}/file" target="_blank" rel="noopener">📎 ${escapeHtml(archivo.nombre)}</a>`
                        )
                        .join(' ')}
                      <span class="grow"></span>
                      ${editable && puedeEditarObservaciones ? `<button class="btn btn--sm" type="button" data-observaciones="${escapeHtml(examen.id)}">Editar notas</button>` : ''}
                      ${editable ? `<select class="select" data-cambiar-estado="${escapeHtml(examen.id)}" style="max-width:150px">${ESTADOS.map(([v, t]) => `<option value="${v}"${examen.estado === v ? ' selected' : ''}>${t}</option>`).join('')}</select>` : ''}
                      ${editable ? `<button class="btn btn--sm" type="button" data-subir="${escapeHtml(examen.id)}" data-record="${escapeHtml(examen.recordId)}">Subir resultado</button>` : ''}
                      ${editable ? `<button class="btn btn--sm danger" type="button" data-borrar="${escapeHtml(examen.id)}">Eliminar</button>` : ''}
                    </div>
                  </div>`
                )
                .join('')
            : '<div class="card empty">Todavía no hay exámenes registrados para esta paciente.</div>'}
        </section>
        <aside class="ficha-split__side">
          <div class="card">
            <h3>Registrar nuevo examen</h3>
            ${
              editable
                ? `<form id="form-examen" class="stack" style="margin-top:10px">
                    <div class="error-formulario" role="alert" aria-live="assertive" id="error-examen" hidden></div>
                    <label class="f"><span>Nombre del examen *</span><input class="input" name="nombre" maxlength="200" required /></label>
                    <label class="f"><span>Tipo</span><select class="select" name="tipo">${TIPOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
                    <label class="f"><span>Pedido asociado (opcional)</span><select class="select" name="pedido"><option value="">— Ninguno —</option>${pedidos.map((p) => `<option value="${escapeHtml(p.id)}">N.º ${escapeHtml(p.numero)} · ${escapeHtml(p.tipo)}</option>`).join('')}</select></label>
                    <label class="f"><span>Indicaciones / descripción</span><textarea class="textarea" name="descripcion" rows="3" maxlength="5000"></textarea></label>
                    <label class="f"><span>Notas / observaciones del examen</span><textarea class="textarea" name="observaciones" rows="3" maxlength="5000" placeholder="Hallazgos, interpretación o notas para el seguimiento."></textarea></label>
                    <button class="btn pri" type="submit">Registrar examen</button>
                  </form>`
                : '<p class="muted">Tu perfil no tiene permiso para registrar exámenes.</p>'
            }
          </div>
        </aside>
      </div>`;

    if (!editable) return;

    const formulario = $('#form-examen', contenedor);
    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const datos = Object.fromEntries(new FormData(formulario).entries());
      const nombre = String(datos.nombre || '').trim();
      const error = $('#error-examen', formulario);
      if (!nombre) {
        error.hidden = false;
        error.textContent = 'El nombre del examen es obligatorio.';
        return;
      }
      error.hidden = true;
      const historial = await elegirHistorial(historias, ctx, contenedor);
      if (!historial) return;
      const boton = formulario.querySelector('button[type="submit"]');
      boton.disabled = true;
      boton.textContent = 'Guardando…';
      try {
        await api.post(`/api/clinical-records/${encodeURIComponent(historial)}/exams`, {
          nombre,
          tipo: datos.tipo,
          pedidoId: datos.pedido || undefined,
          descripcion: String(datos.descripcion || '').trim(),
          observaciones: String(datos.observaciones || '').trim(),
          estado: 'solicitado',
        });
        toast('Examen registrado');
        await tab.render(contenedor, ctx);
      } catch (fallo) {
        error.hidden = false;
        error.textContent = fallo.message;
        toast(fallo.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Registrar examen';
      }
    });

    for (const boton of $$('[data-observaciones]', contenedor)) {
      const examen = examenes.find((item) => item.id === boton.dataset.observaciones);
      boton.addEventListener('click', () => {
        if (!examen) return;
        const dialogo = modal(
          'Observaciones del examen',
          `<p class="small muted" style="margin-bottom:10px">${escapeHtml(
            examen.nombre || 'Examen'
          )}</p>
           <label class="f"><span>Notas / observaciones</span>
             <textarea class="textarea" id="examen-observaciones" rows="5" maxlength="5000"
               placeholder="Hallazgos, interpretación o notas para el seguimiento.">${escapeHtml(
                 examen.observaciones || ''
               )}</textarea>
           </label>`,
          `<button class="btn" type="button" data-cerrar-modal>Cancelar</button>
           <button class="btn pri" type="button" id="examen-observaciones-guardar">Guardar notas</button>`
        );
        dialogo.querySelector('#examen-observaciones')?.focus();
        dialogo
          .querySelector('#examen-observaciones-guardar')
          ?.addEventListener('click', async () => {
            const observaciones = dialogo
              .querySelector('#examen-observaciones')
              .value.trim();
            try {
              await api.patch(
                `/api/clinical-exams/${encodeURIComponent(examen.id)}`,
                { observaciones }
              );
              toast('Observaciones del examen guardadas');
              dialogo.close();
              dialogo.remove();
              await tab.render(contenedor, ctx);
            } catch (fallo) {
              toast(fallo.message, 'error');
            }
          });
      });
    }

    for (const selector of $$('[data-cambiar-estado]', contenedor)) {
      selector.addEventListener('change', async () => {
        try {
          await api.patch(`/api/clinical-exams/${encodeURIComponent(selector.dataset.cambiarEstado)}`, {
            estado: selector.value,
          });
          toast('Estado del examen actualizado');
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }

    for (const boton of $$('[data-subir]', contenedor)) {
      boton.addEventListener('click', () => {
        const entrada = document.createElement('input');
        entrada.type = 'file';
        entrada.accept = '.pdf,.png,.jpg,.jpeg';
        entrada.addEventListener('change', async () => {
          const archivo = entrada.files?.[0];
          if (!archivo) return;
          if (archivo.size > 8 * 1024 * 1024) {
            toast('El archivo no puede superar los 8 MB', 'error');
            return;
          }
          const data = await new Promise((resolver, rechazar) => {
            const lector = new FileReader();
            lector.onload = () => resolver(lector.result);
            lector.onerror = rechazar;
            lector.readAsDataURL(archivo);
          });
          try {
            await api.post(
              `/api/clinical-records/${encodeURIComponent(boton.dataset.record)}/attachments`,
              { examId: boton.dataset.subir, nombre: archivo.name, data }
            );
            toast('Resultado subido');
            await tab.render(contenedor, ctx);
          } catch (fallo) {
            toast(fallo.message, 'error');
          }
        });
        entrada.click();
      });
    }

    for (const boton of $$('[data-borrar]', contenedor)) {
      boton.addEventListener('click', async () => {
        if (!(await confirmar('¿Eliminar este examen y sus archivos?', { peligro: true }))) return;
        try {
          await api.delete(`/api/clinical-exams/${encodeURIComponent(boton.dataset.borrar)}`);
          toast('Examen eliminado');
          await tab.render(contenedor, ctx);
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }
  },
};

async function elegirHistorial(historias, ctx, contenedor) {
  if (ctx.cita) {
    const lista = await api
      .get(`/api/clinical-records?appointmentId=${encodeURIComponent(ctx.cita.id)}`)
      .catch(() => []);
    if (lista?.[0]?.id) return lista[0].id;
  }
  if (historias.length === 1) return historias[0].id;
  if (!historias.length) {
    toast('Primero registra una consulta para esta paciente', 'error');
    ctx.irA('consulta');
    return null;
  }
  return new Promise((resolver) => {
    const dialogo = modal(
      'Seleccionar consulta',
      `<p class="small muted">El examen quedará asociado a la consulta que elijas.</p>
       <label class="f"><span>Consulta</span><select class="select" id="hist-elegir">${historias
         .map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(fmtFecha(h.fecha || h.cita_fecha))}</option>`)
         .join('')}</select></label>`,
      `<button class="btn" type="button" data-cerrar-modal>Cancelar</button>
       <button class="btn pri" type="button" id="hist-confirmar">Aceptar</button>`
    );
    dialogo.querySelector('#hist-confirmar')?.addEventListener('click', () => {
      const id = dialogo.querySelector('#hist-elegir').value;
      dialogo.close();
      dialogo.remove();
      resolver(id);
    });
    dialogo.addEventListener('close', () => resolver(null));
    void contenedor;
  });
}
