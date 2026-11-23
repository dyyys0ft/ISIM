import { api } from '../../api.js';
import { $, $$, escapeHtml, fmtFecha, toast, confirmar } from '../../ui.js';

function campo(nombre, etiqueta, valor, opciones = {}) {
  const { clase = '', tipo = 'text', placeholder = '', extra = '' } = opciones;
  return `<label class="f ${clase}"><span>${escapeHtml(etiqueta)}</span>
    <input class="input" name="${nombre}" type="${tipo}" value="${escapeHtml(valor ?? '')}"
      ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''} ${extra} /></label>`;
}

function itemVacio() {
  return {
    medicamento: '',
    presentacion: '',
    dosis: '',
    via: '',
    frecuencia: '',
    duracion: '',
    cantidad: '',
    unidad: '',
    indicaciones: '',
    dci: '',
    concentracion: '',
  };
}

async function recordIdDe(ctx) {
  if (ctx.cita) {
    const lista = await api
      .get(`/api/clinical-records?appointmentId=${encodeURIComponent(ctx.cita.id)}`)
      .catch(() => []);
    if (lista?.[0]?.id) return lista[0].id;
  }
  const lista = await api
    .get(`/api/clinical-records?patientId=${encodeURIComponent(ctx.pacienteId)}&limit=1`)
    .catch(() => []);
  return lista?.[0]?.id || null;
}

/** Pestaña "Receta" — contrato ui-v2 SPEC §8. */
export const tab = {
  id: 'receta',
  titulo: 'Receta',
  permiso: 'historias.ver',
  async render(contenedor, ctx) {
    contenedor.innerHTML = '<div class="empty">Cargando receta…</div>';
    const recordId = await recordIdDe(ctx);
    if (!recordId) {
      contenedor.innerHTML = `<div class="card empty">Todavía no hay consulta registrada para esta paciente, por lo que no se puede emitir una receta.<br /><br />
        <button class="btn pri" type="button" id="ir-consulta">Ir a la consulta</button></div>`;
      $('#ir-consulta', contenedor)?.addEventListener('click', () => ctx.irA('consulta'));
      return;
    }

    const [receta, previas, esquemas] = await Promise.all([
      api.get(`/api/clinical-records/${encodeURIComponent(recordId)}/prescription`).catch(() => null),
      api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/recetas`).catch(() => []),
      api.get('/api/catalogs/esquemas').catch(() => []),
    ]);
    if (!receta) {
      contenedor.innerHTML = '<div class="info">No se pudo cargar la receta de esta consulta.</div>';
      return;
    }

    const datos = receta.datos || {};
    const items = Array.isArray(receta.items) ? receta.items.map((x) => ({ ...itemVacio(), ...x })) : [];
    const editable = ctx.puede('historias.gestionar');
    const hoy = new Date().toLocaleDateString('en-CA');

    contenedor.innerHTML = `
      <div class="ficha-split">
        <section class="ficha-split__main">
          <div class="card">
            <div class="row">
              <h3 class="grow">Recetas de la paciente</h3>
              <span class="small muted">${previas.length} registro(s)</span>
            </div>
            ${previas.length
              ? previas
                  .map(
                    (r) => `<div class="row" style="margin-top:8px">
                      <span class="grow small">N.º ${escapeHtml(r.numero)} · ${escapeHtml(fmtFecha(r.fecha))} — ${escapeHtml(r.medicamentosTexto || 'sin medicamentos')}
                        ${r.anulada ? '<span class="badge badge--red">ANULADA</span>' : ''}</span>
                      <a class="btn btn--sm" href="/receta.html?id=${encodeURIComponent(r.id)}">Ver</a>
                      ${!r.anulada && editable ? `<button class="btn btn--sm danger" type="button" data-anular="${encodeURIComponent(r.id)}">Anular</button>` : ''}
                    </div>`
                  )
                  .join('')
              : '<p class="muted" style="margin-top:8px">Todavía no hay recetas registradas para esta paciente.</p>'}
          </div>
        </section>
        <aside class="ficha-split__side">
          <form id="form-receta" class="stack">
            <div class="error-formulario" role="alert" aria-live="assertive" id="error-receta" hidden></div>
            <section class="sec"><h3><span class="n">1</span>Datos de la receta</h3>
              <div class="b grid g2">
                ${campo('diagnostico', 'Diagnóstico', datos.diagnostico || receta.diagnostico || '', { clase: 'span2' })}
                ${campo('cie', 'CIE-10', datos.cie || receta.cie10 || '')}
                ${campo('alergias', 'Alergias', datos.alergias || receta.alergias || ctx.paciente.alergias || '', { placeholder: 'Registrar; "No refiere" solo si se verificó' })}
                <label class="f span2"><span>Aplicar esquema del recetario</span>
                  <select class="select" name="esquema">
                    <option value="">— Seleccione un esquema (opcional) —</option>
                    ${esquemas.map((e) => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.nombre)}${e.cie ? ` · ${escapeHtml(e.cie)}` : ''}</option>`).join('')}
                  </select></label>
                <label class="chk span2" style="align-self:end"><input type="checkbox" name="para_pareja"${datos.para_pareja ? ' checked' : ''} />
                  <span>Tratamiento exclusivo para la <b>pareja</b> (receta complementaria)</span></label>
              </div></section>
            <section class="sec"><h3><span class="n">2</span>Prescripción</h3>
              <div class="b stack">
                <div id="rx-items"></div>
                <div class="row">
                  <input class="input grow" id="rx-buscar" placeholder="Buscar medicamento en el catálogo…" autocomplete="off" />
                  <button class="btn" type="button" id="rx-libre">＋ Medicamento no catalogado</button>
                </div>
                <div id="rx-sugerencias"></div>
              </div></section>
            <section class="sec"><h3><span class="n">3</span>Recomendaciones</h3>
              <div class="b"><textarea class="textarea" name="recomendaciones" rows="3" maxlength="3000" placeholder="Una recomendación por línea">${escapeHtml(datos.recomendaciones || receta.recomendaciones || '')}</textarea></div></section>
            <div class="row">
              <span class="small muted grow">La receta incluye nombre genérico (DCI), cantidad en número y letras, indicaciones, firma y registro profesional.</span>
              ${editable ? '<button class="btn pri" type="submit">Guardar e imprimir receta</button>' : ''}
            </div>
          </form>
        </aside>
      </div>`;

    const formulario = $('#form-receta', contenedor);
    const error = $('#error-receta', formulario);
    if (!editable) {
      for (const control of $$('input, select, textarea', formulario)) control.disabled = true;
    }

    const dibujarItems = () => {
      $('#rx-items', formulario).innerHTML =
        items
          .map(
            (item, i) => `<div class="rx-item">
              <div class="num">${i + 1}</div>
              <div class="grid g2" style="gap:8px">
                <label class="f"><span>Nombre comercial *</span><input class="input" data-k="medicamento" data-i="${i}" value="${escapeHtml(item.medicamento)}" /></label>
                <label class="f"><span>Genérico (DCI) y concentración *</span><input class="input" data-k="dci" data-i="${i}" value="${escapeHtml(item.dci || item.generico || '')}" /></label>
                <label class="f"><span>Presentación / forma · vía</span><input class="input" data-k="presentacion" data-i="${i}" value="${escapeHtml(item.presentacion)}" /></label>
                <label class="f"><span>Dosis · frecuencia · duración</span><input class="input" data-k="indicaciones" data-i="${i}" value="${escapeHtml(item.indicaciones)}" /></label>
                <label class="f"><span>Cantidad *</span><input class="input" type="number" min="1" data-k="cantidad" data-i="${i}" value="${escapeHtml(item.cantidad)}" /></label>
                <label class="f"><span>Unidad</span><input class="input" data-k="unidad" data-i="${i}" value="${escapeHtml(item.unidad)}" /></label>
              </div>
              ${editable ? `<button class="btn btn--sm ghost danger x" type="button" data-quitar="${i}" aria-label="Quitar">✕</button>` : ''}
            </div>`
          )
          .join('') || '<p class="muted small">Sin medicamentos todavía.</p>';

      for (const control of $$('[data-k]', formulario)) {
        control.addEventListener('input', () => {
          items[Number(control.dataset.i)][control.dataset.k] = control.value;
        });
      }
      for (const boton of $$('[data-quitar]', formulario)) {
        boton.addEventListener('click', () => {
          items.splice(Number(boton.dataset.quitar), 1);
          dibujarItems();
        });
      }
    };
    dibujarItems();

    $('#rx-libre', formulario)?.addEventListener('click', () => {
      items.push(itemVacio());
      dibujarItems();
    });

    let temporizador = null;
    $('#rx-buscar', formulario)?.addEventListener('input', (evento) => {
      clearTimeout(temporizador);
      const q = evento.target.value.trim();
      if (q.length < 2) {
        $('#rx-sugerencias', formulario).replaceChildren();
        return;
      }
      temporizador = setTimeout(async () => {
        const medicamentos = await api
          .get(`/api/catalogs/medications?q=${encodeURIComponent(q)}&limit=10`)
          .catch(() => []);
        $('#rx-sugerencias', formulario).innerHTML =
          medicamentos
            .map(
              (m, i) => `<button class="btn btn--sm" type="button" data-med="${i}">${escapeHtml(m.comercial)} <span class="muted small">${escapeHtml(m.generico)}</span></button>`
            )
            .join(' ') || '<p class="small muted">No está en el catálogo. Use “Medicamento no catalogado”.</p>';
        for (const boton of $$('[data-med]', formulario)) {
          boton.addEventListener('click', () => {
            const m = medicamentos[Number(boton.dataset.med)];
            items.push({
              ...itemVacio(),
              medicamento: m.comercial,
              dci: m.generico,
              presentacion: [m.forma, m.via].filter(Boolean).join(' · '),
              indicaciones: m.indicacion,
              dosis: m.dosis,
              frecuencia: m.frecuencia,
              duracion: m.duracion,
            });
            $('#rx-buscar', formulario).value = '';
            $('#rx-sugerencias', formulario).replaceChildren();
            dibujarItems();
          });
        }
      }, 250);
    });

    $('[name="esquema"]', formulario)?.addEventListener('change', (evento) => {
      const esquema = esquemas.find((e) => String(e.id) === evento.target.value);
      if (!esquema) return;
      for (const medicamento of esquema.items || []) {
        items.push({ ...itemVacio(), ...medicamento });
      }
      if (esquema.recomendaciones) {
        $('[name="recomendaciones"]', formulario).value = esquema.recomendaciones;
      }
      if (!$('[name="diagnostico"]', formulario).value && esquema.diagnostico) {
        $('[name="diagnostico"]', formulario).value = esquema.diagnostico;
        $('[name="cie"]', formulario).value = esquema.cie || '';
      }
      dibujarItems();
    });

    for (const boton of $$('[data-anular]', contenedor)) {
      boton.addEventListener('click', async () => {
        if (!(await confirmar('¿Anular esta receta? La acción queda registrada.', { peligro: true }))) return;
        try {
          await api.post(`/api/prescriptions/${boton.dataset.anular}/annul`);
          toast('Receta anulada');
          await ctx.recargar();
        } catch (fallo) {
          toast(fallo.message, 'error');
        }
      });
    }

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const datosForm = new FormData(formulario);
      if (!items.length || items.some((x) => !x.medicamento || !x.cantidad)) {
        error.hidden = false;
        error.textContent = 'Completa el nombre comercial y la cantidad de cada medicamento.';
        return;
      }
      error.hidden = true;
      const datos = {
        diagnostico: datosForm.get('diagnostico') || '',
        cie: datosForm.get('cie') || '',
        alergias: datosForm.get('alergias') || '',
        recomendaciones: datosForm.get('recomendaciones') || '',
        para_pareja: datosForm.has('para_pareja') ? 1 : 0,
      };
      const boton = formulario.querySelector('button[type="submit"]');
      boton.disabled = true;
      boton.textContent = 'Guardando…';
      try {
        const respuesta = await api.put(`/api/clinical-records/${encodeURIComponent(recordId)}/prescription`, {
          fecha: hoy,
          hora: new Date().toTimeString().slice(0, 5),
          items,
          datos,
          diagnostico: datos.diagnostico,
          cie10: datos.cie,
          alergias: datos.alergias,
          recomendaciones: datos.recomendaciones,
          paraPareja: datos.para_pareja,
        });
        toast('Receta guardada en la historia clínica');
        const id = respuesta?.id || receta.id;
        if (id) window.open(`/receta.html?id=${encodeURIComponent(id)}`, '_blank');
        await ctx.recargar();
      } catch (fallo) {
        error.hidden = false;
        error.textContent = fallo.message;
        toast(fallo.message, 'error');
        boton.disabled = false;
        boton.textContent = 'Guardar e imprimir receta';
      }
    });
  },
};
