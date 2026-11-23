import { api } from '../../api.js';
import { $, $$, escapeHtml, fmtFecha, toast, modal } from '../../ui.js';

const TIPOS = [
  ['ecografia', 'Ecografía'],
  ['colposcopia', 'Colposcopia'],
  ['biopsia', 'Biopsia'],
  ['laboratorio', 'Laboratorio'],
];
const ESTADOS = [
  ['pendiente', 'Pendiente'],
  ['con_resultado', 'Con resultado'],
  ['sin_resultado', 'Sin resultado'],
];

function etiqueta(lista, valor) {
  return lista.find(([clave]) => clave === valor)?.[1] || valor || '—';
}

function badgePedido(estado) {
  const clase = estado === 'con_resultado' ? 'green' : estado === 'pendiente' ? 'new' : 'grey';
  return `<span class="badge badge--${clase}">${escapeHtml(etiqueta(ESTADOS, estado))}</span>`;
}

function resumen(datos) {
  if (!datos || typeof datos !== 'object') return '';
  return [datos.descripcion, datos.indicaciones, datos.motivo].filter(Boolean).join(' · ');
}

/** Pestaña "Pedidos": historial a la izquierda y alta a la derecha. */
export const tab = {
  id: 'pedidos',
  titulo: 'Pedidos',
  permiso: 'historias.ver',
  async render(contenedor, ctx) {
    contenedor.innerHTML = '<div class="empty">Cargando pedidos…</div>';
    const [pedidos, historias] = await Promise.all([
      api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/pedidos`).catch(() => []),
      api.get(`/api/clinical-records?patientId=${encodeURIComponent(ctx.pacienteId)}`).catch(() => []),
    ]);
    const editable = ctx.puede('historias.gestionar');
    const hoy = new Date().toLocaleDateString('en-CA');

    contenedor.innerHTML = `
      <div class="ficha-split">
        <section class="ficha-split__main">
          <div class="row" style="margin-bottom:10px">
            <h2 class="grow">Historial de pedidos</h2>
            <span class="small muted">${pedidos.length} registro(s)</span>
          </div>
          ${pedidos.length
            ? pedidos
                .map(
                  (pedido) => `<div class="card" style="margin-bottom:10px">
                    <div class="row">
                      <div class="grow">
                        <b>Pedido N.º ${escapeHtml(pedido.numero)} · ${escapeHtml(etiqueta(TIPOS, pedido.tipo))}</b>
                        <div class="small muted">${escapeHtml(fmtFecha(pedido.fecha))} · ${escapeHtml(pedido.medico_nombre || 'Sin médico asignado')}</div>
                      </div>
                      ${badgePedido(pedido.estado)}
                    </div>
                    ${resumen(pedido.datos) ? `<p class="small" style="margin-top:8px">${escapeHtml(resumen(pedido.datos))}</p>` : ''}
                    <div class="row" style="margin-top:8px">
                      <a class="btn btn--sm" href="/pedido.html?id=${encodeURIComponent(pedido.id)}">Imprimir / ver</a>
                      <button class="btn btn--sm" type="button" data-ver="${encodeURIComponent(pedido.id)}">Detalles</button>
                      <span class="grow"></span>
                      ${editable ? `<select class="select" data-estado="${escapeHtml(pedido.id)}" style="max-width:170px">${ESTADOS.map(([v, t]) => `<option value="${v}"${pedido.estado === v ? ' selected' : ''}>${t}</option>`).join('')}</select>` : ''}
                    </div>
                  </div>`
                )
                .join('')
            : '<div class="card empty">Todavía no hay pedidos registrados para esta paciente.</div>'}
        </section>
        <aside class="ficha-split__side">
          <div class="card">
            <h3>Nuevo pedido</h3>
            ${
              editable
                ? `<form id="form-pedido" class="stack" style="margin-top:10px">
                    <div class="error-formulario" role="alert" aria-live="assertive" id="error-pedido" hidden></div>
                    <label class="f"><span>Tipo *</span><select class="select" name="tipo">${TIPOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
                    <label class="f"><span>Fecha *</span><input class="input" type="date" name="fecha" value="${hoy}" required /></label>
                    <label class="f"><span>Consulta asociada (opcional)</span><select class="select" name="record"><option value="">— Ninguna —</option>${(historias || []).map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(fmtFecha(h.fecha || h.cita_fecha))}</option>`).join('')}</select></label>
                    <label class="f"><span>Descripción / indicaciones</span><textarea class="textarea" name="descripcion" rows="4" maxlength="5000" placeholder="Describe el estudio o procedimiento solicitado…"></textarea></label>
                    <button class="btn pri" type="submit">Guardar pedido</button>
                  </form>`
                : '<p class="muted">Tu perfil no tiene permiso para crear pedidos.</p>'
            }
          </div>
        </aside>
      </div>`;

    const formulario = $('#form-pedido', contenedor);
    formulario?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const datos = Object.fromEntries(new FormData(formulario).entries());
      const error = $('#error-pedido', formulario);
      if (!datos.fecha) {
        error.hidden = false;
        error.textContent = 'La fecha del pedido es obligatoria.';
        return;
      }
      error.hidden = true;
      const boton = formulario.querySelector('button[type="submit"]');
      boton.disabled = true;
      boton.textContent = 'Guardando…';
      try {
        await api.post(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/pedidos`, {
          tipo: datos.tipo,
          fecha: datos.fecha,
          recordId: datos.record || undefined,
          datos: { descripcion: String(datos.descripcion || '').trim() },
        });
        toast('Pedido creado');
        await tab.render(contenedor, ctx);
      } catch (fallo) {
        error.hidden = false;
        error.textContent = fallo.message;
        toast(fallo.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Guardar pedido';
      }
    });

    for (const selector of $$('[data-estado]', contenedor)) {
      selector.addEventListener('change', async () => {
        try {
          await api.put(`/api/pedidos/${encodeURIComponent(selector.dataset.estado)}`, {
            estado: selector.value,
          });
          toast('Estado del pedido actualizado');
          await tab.render(contenedor, ctx);
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }

    for (const boton of $$('[data-ver]', contenedor)) {
      boton.addEventListener('click', async () => {
        try {
          const pedido = await api.get(`/api/pedidos/${encodeURIComponent(boton.dataset.ver)}`);
          modal(
            `Pedido N.º ${pedido.numero}`,
            `<dl class="kv">
              <dt>Tipo</dt><dd>${escapeHtml(etiqueta(TIPOS, pedido.tipo))}</dd>
              <dt>Fecha</dt><dd>${escapeHtml(fmtFecha(pedido.fecha))}</dd>
              <dt>Estado</dt><dd>${escapeHtml(etiqueta(ESTADOS, pedido.estado))}</dd>
              <dt>Médico</dt><dd>${escapeHtml(pedido.medico_nombre || '—')}</dd>
              <dt>Datos</dt><dd>${escapeHtml(JSON.stringify(pedido.datos || {}, null, 2))}</dd>
            </dl>`,
            '<button class="btn" type="button" data-cerrar-modal>Cerrar</button>'
          );
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }
  },
};
