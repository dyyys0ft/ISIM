import { api } from '../../api.js';
import { $$, escapeHtml, fmtFecha, toast, modal } from '../../ui.js';
import { consultaKV } from './consulta.js';

const TIPOS_EXAMEN = {
  clinico: 'Clínico',
  laboratorio: 'Laboratorio',
  imagen: 'Imagen',
  otro: 'Otro',
};
const ESTADOS_EXAMEN = {
  solicitado: 'Solicitado',
  recibido: 'Recibido',
  evaluado: 'Evaluado',
};

function fechaCorta(valor) {
  return fmtFecha(valor) || '—';
}

function primerDiagnostico(fila) {
  let datos = fila.datos;
  if (typeof datos === 'string') {
    try {
      datos = JSON.parse(datos);
    } catch {
      datos = null;
    }
  }
  return datos?.diagnosticos?.[0]?.desc || fila.motivo_consulta || fila.cita_motivo || '';
}

function resumenAntecedentes(P, firmaCount) {
  return `<div class="card ficha-resumen">
    <div class="row"><h3 class="grow">Resumen de antecedentes</h3>
      <span class="small muted">${firmaCount} consulta(s) firmada(s)</span></div>
    <dl class="kv">
      <dt>Alergias</dt><dd>${escapeHtml(P.alergias || '—')}</dd>
      <dt>Antecedentes personales</dt><dd>${escapeHtml(P.ant_personales || '—')}</dd>
      <dt>Quirúrgicos</dt><dd>${escapeHtml(P.ant_quirurgicos || '—')}</dd>
      <dt>Familiares</dt><dd>${escapeHtml(P.ant_familiares || '—')}</dd>
      <dt>Gineco-obstétricos</dt><dd>${escapeHtml(
        [
          P.menarquia && `Menarquia ${P.menarquia}`,
          P.ciclos && `Ciclos ${P.ciclos}`,
          P.gestas || P.partos || P.cesareas || P.abortos || P.hijos_vivos
            ? `G${P.gestas || 0} P${P.partos || 0} C${P.cesareas || 0} A${P.abortos || 0} HV${P.hijos_vivos || 0}`
            : '',
          P.fum && `FUM ${P.fum}`,
          P.ivsa && `IVSA ${P.ivsa}`,
          P.mac && `MAC ${P.mac}`,
          P.ultimo_pap && `PAP ${P.ultimo_pap}`,
        ]
          .filter(Boolean)
          .join(' · ') || '—'
      )}</dd>
    </dl>
  </div>`;
}

function verSoloResumen(contenedor, lista, ctx) {
  contenedor.innerHTML = `<div class="card"><div class="row"><h3 class="grow">Consultas registradas</h3>
      <span class="small muted">Vista resumida · sin datos clínicos</span></div>
    ${lista.length
      ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>Fecha</th><th>Motivo</th><th>CIE-10</th><th>Médico</th><th>Estado</th>
        </tr></thead><tbody>${lista
          .map(
            (fila) => `<tr>
              <td>${escapeHtml(fechaCorta(fila.fecha))}</td>
              <td>${escapeHtml(fila.motivo || fila.diagnostico || '—')}</td>
              <td>${escapeHtml(fila.cie || '—')}</td>
              <td>${escapeHtml(fila.medico || '—')}</td>
              <td><span class="badge ${fila.citaEstado === 'atendida' ? 'badge--green' : 'badge--grey'}">${fila.citaEstado === 'atendida' ? 'Firmada' : 'Borrador'}</span></td>
            </tr>`
          )
          .join('')}</tbody></table></div>`
      : '<p class="muted">Todavía no hay consultas registradas para esta paciente.</p>'}
    <div class="info small" style="margin-top:12px">Tu perfil solo puede consultar el resumen. Si necesitas los datos clínicos completos, solicita permiso de historia clínica.</div>
  </div>`;
  void ctx;
}

function datosDe(fila) {
  let datos = fila.datos;
  if (typeof datos === 'string') {
    try {
      datos = JSON.parse(datos);
    } catch {
      datos = null;
    }
  }
  return datos || {};
}

function motivoDe(fila) {
  const datos = datosDe(fila);
  return datos.motivo || fila.motivo_consulta || fila.cita_motivo || '';
}

function diagnosticoDe(fila) {
  const datos = datosDe(fila);
  const primero = (datos.diagnosticos || [])[0];
  return {
    desc: primero?.desc || fila.diagnostico || '',
    cie: primero?.cie || '',
  };
}

function recetasDeRegistro(recetas, registro) {
  return recetas.filter(
    (receta) =>
      receta.recordId === registro.id ||
      (receta.fecha || '').slice(0, 10) === (registro.fecha || '').slice(0, 10)
  );
}

function pedidosDeRegistro(pedidos, registro) {
  return pedidos.filter(
    (pedido) =>
      pedido.record_id === registro.id ||
      (pedido.fecha || '').slice(0, 10) === (registro.fecha || '').slice(0, 10)
  );
}

function detalleExamenHtml(actual, examen) {
  const adjuntos = (examen.adjuntos || [])
    .map(
      (archivo) =>
        `<a class="btn btn--sm" href="/api/clinical-attachments/${encodeURIComponent(
          archivo.id
        )}/file" target="_blank" rel="noopener">📎 ${escapeHtml(archivo.nombre)}</a>`
    )
    .join(' ');
  return `<div class="hc-examen">
    <div class="row">
      <b class="grow">${escapeHtml(examen.nombre || 'Examen')}</b>
      <span class="badge badge--${examen.estado === 'evaluado' ? 'green' : examen.estado === 'recibido' ? 'new' : 'grey'}">${escapeHtml(ESTADOS_EXAMEN[examen.estado] || examen.estado || 'Solicitado')}</span>
    </div>
    <div class="small muted">${escapeHtml(
      TIPOS_EXAMEN[examen.tipo] || examen.tipo || 'Clínico'
    )} · Cita: ${escapeHtml(
      fmtFecha(actual.cita_fecha, { time: true }) || actual.cita_fecha || 'No registrada'
    )}${actual.cita_motivo ? ` · ${escapeHtml(actual.cita_motivo)}` : ''}</div>
    ${examen.descripcion ? `<p class="small" style="white-space:pre-wrap">${escapeHtml(examen.descripcion)}</p>` : ''}
    <div class="hc-observacion"><b>Observaciones:</b> ${escapeHtml(examen.observaciones || 'Sin observaciones registradas.')}</div>
    ${adjuntos ? `<div class="row" style="margin-top:6px">${adjuntos}</div>` : ''}
  </div>`;
}

function detalleCitaHtml(actual, recetas, pedidos, ctx) {
  const d = datosDe(actual);
  const firmada = actual.consulta_finalizada || actual.cita_estado === 'atendida';
  const examenes = actual.examenes || [];
  const recetasCita = recetasDeRegistro(recetas, actual);
  const pedidosCita = pedidosDeRegistro(pedidos, actual);

  return `<div class="hc-detalle">
    <div class="hc-detalle__head">
      <div><span>Fecha</span><strong>${escapeHtml(
        fmtFecha(actual.fecha || actual.cita_fecha, { weekday: true, time: true })
      )}</strong></div>
      <div><span>Motivo</span><strong>${escapeHtml(motivoDe(actual) || 'Sin motivo')}</strong></div>
      <div><span>Médico</span><strong>${escapeHtml(actual.medico_nombre || '—')}</strong></div>
      <div><span>Estado</span><strong>${firmada ? 'Firmada' : 'Borrador'}</strong></div>
    </div>

    <section class="hc-bloque">
      <h4>Datos de la consulta</h4>
      ${consultaKV(d)}
    </section>

    <section class="hc-bloque">
      <h4>Exámenes (${examenes.length})</h4>
      ${
        examenes.length
          ? examenes.map((examen) => detalleExamenHtml(actual, examen)).join('')
          : '<p class="small muted">Sin exámenes en esta cita.</p>'
      }
    </section>

    <section class="hc-bloque">
      <h4>Recetas (${recetasCita.length})</h4>
      ${
        recetasCita.length
          ? recetasCita
              .map(
                (receta) => `<div class="hc-documento">
                  <div class="row"><b class="grow">Receta N.º ${escapeHtml(receta.numero)}${receta.anulada ? ' <span class="badge badge--red">ANULADA</span>' : ''}</b>
                    <a class="btn btn--sm" href="/receta.html?id=${encodeURIComponent(receta.id)}">Reimprimir</a></div>
                  <ol>${(receta.medicamentos || receta.items || [])
                    .map(
                      (item) =>
                        `<li>${escapeHtml(item.comercial || item.generico || item.descripcion || '')} — ${escapeHtml(item.indicacion || '')}</li>`
                    )
                    .join('')}</ol>
                </div>`
              )
              .join('')
          : '<p class="small muted">Sin recetas en esta cita.</p>'
      }
    </section>

    <section class="hc-bloque">
      <h4>Pedidos (${pedidosCita.length})</h4>
      ${
        pedidosCita.length
          ? pedidosCita
              .map(
                (pedido) => `<div class="row hc-pedido"><span class="grow small">${escapeHtml(
                  pedido.tipo || 'Pedido'
                )} · ${escapeHtml(pedido.fecha || '')}</span>
                  <a class="btn btn--sm" href="/pedido.html?id=${encodeURIComponent(pedido.id)}">Reimprimir</a></div>`
              )
              .join('')
          : '<p class="small muted">Sin pedidos en esta cita.</p>'
      }
    </section>

    <section class="hc-bloque">
      <h4>Notas aclaratorias (${(actual.addenda || []).length})</h4>
      ${
        (actual.addenda || []).length
          ? actual.addenda
              .map(
                (nota) => `<div class="ficha-addenda"><b>${escapeHtml(
                  fmtFecha(nota.creado_en, { time: true })
                )} · ${escapeHtml(nota.usuario_nombre || '')}</b><span>${escapeHtml(nota.texto)}</span></div>`
              )
              .join('')
          : '<p class="small muted">Sin notas aclaratorias.</p>'
      }
      ${
        firmada && ctx.puede('historias.gestionar')
          ? `<details class="hc-addenda-form">
              <summary>Agregar nota aclaratoria</summary>
              <label class="f"><span>Nota</span>
                <textarea class="textarea" id="detalle-addenda" rows="3" maxlength="5000"></textarea>
              </label>
              <button class="btn btn--sm" type="button" id="detalle-addenda-guardar">Guardar nota</button>
            </details>`
          : ''
      }
    </section>

    <p class="small muted hc-detalle__pie">${
      firmada
        ? `Firmada electrónicamente el ${escapeHtml(
            fmtFecha(actual.actualizado_en, { time: true })
          )}`
        : 'Consulta en borrador (sin firmar)'
    }</p>
  </div>`;
}

async function abrirDetalleCita(contenedor, lista, ctx, id, aux = null) {
  const fila = lista.find((item) => item.id === id) || lista[0];
  if (!fila) return;

  let actual = fila;
  try {
    actual = await api.get(`/api/clinical-records/${encodeURIComponent(fila.id)}`);
  } catch (error) {
    toast(error.message, 'error');
  }

  const recetas =
    aux?.recetas ??
    (await api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/recetas`).catch(() => []));
  const pedidos =
    aux?.pedidos ??
    (await api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/pedidos`).catch(() => []));

  const dialogo = modal(
    `Consulta del ${fmtFecha(actual.fecha || actual.cita_fecha, {
      weekday: true,
    })}`,
    detalleCitaHtml(actual, recetas, pedidos, ctx),
    `<button class="btn" type="button" data-cerrar-modal>Cerrar</button>
     <button class="btn pri" type="button" id="detalle-imprimir">Imprimir consulta</button>`,
    { ancho: true }
  );

  dialogo.querySelector('#detalle-imprimir')?.addEventListener('click', () => {
    window.open(`/consulta-imprimir.html?id=${encodeURIComponent(actual.id)}`, '_blank');
  });

  dialogo.querySelector('#detalle-addenda-guardar')?.addEventListener('click', async () => {
    const texto = dialogo.querySelector('#detalle-addenda').value.trim();
    if (texto.length < 5) {
      toast('Escribe la nota aclaratoria (al menos 5 caracteres)', 'error');
      return;
    }
    try {
      await api.post(`/api/clinical-records/${encodeURIComponent(actual.id)}/addenda`, {
        texto,
      });
      toast('Nota aclaratoria guardada');
      dialogo.close();
      dialogo.remove();
      await renderHistoria(contenedor, lista, ctx, actual.id);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function renderHistoria(contenedor, lista, ctx, abrirId = null) {
  if (!lista.length) {
    contenedor.innerHTML =
      resumenAntecedentes(ctx.paciente, 0) +
      '<div class="card empty">Todavía no hay consultas registradas para esta paciente.</div>';
    return;
  }

  const [recetas, pedidos] = await Promise.all([
    api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/recetas`).catch(() => []),
    api.get(`/api/patients/${encodeURIComponent(ctx.pacienteId)}/pedidos`).catch(() => []),
  ]);
  const firmadas = lista.filter(
    (x) => x.consulta_finalizada || x.cita_estado === 'atendida'
  ).length;

  contenedor.innerHTML = `
    ${resumenAntecedentes(ctx.paciente, firmadas)}
    <div class="card">
      <div class="row">
        <h3 class="grow">Consultas registradas</h3>
        <span class="small muted">${lista.length} consulta(s) · ${firmadas} firmada(s)</span>
      </div>
      <div class="tbl-wrap" style="margin-top:10px">
        <table class="tbl">
          <thead><tr>
            <th>Fecha</th><th>Motivo / descripción</th><th>Diagnóstico / CIE-10</th><th>Médico</th>
            <th>Estado</th><th>Recetas</th><th>Exámenes</th><th>Pedidos</th><th>Notas</th><th></th>
          </tr></thead>
          <tbody>
            ${lista
              .map((x) => {
                const dx = diagnosticoDe(x);
                const firmadaFila = x.consulta_finalizada || x.cita_estado === 'atendida';
                return `<tr data-historia="${x.id}" tabindex="0"
                  aria-label="Abrir detalle de la consulta del ${escapeHtml(
                    fmtFecha(x.fecha || x.cita_fecha)
                  )}" style="cursor:pointer">
                  <td>${escapeHtml(fechaCorta(x.fecha))}</td>
                  <td>${escapeHtml(motivoDe(x) || '—')}</td>
                  <td>${escapeHtml([dx.cie, dx.desc].filter(Boolean).join(' · ') || '—')}</td>
                  <td>${escapeHtml(x.medico_nombre || '—')}</td>
                  <td><span class="badge ${firmadaFila ? 'badge--green' : 'badge--new'}">${firmadaFila ? 'Firmada' : 'Borrador'}</span></td>
                  <td class="num">${recetasDeRegistro(recetas, x).length}</td>
                  <td class="num">${(x.examenes || []).length}</td>
                  <td class="num">${pedidosDeRegistro(pedidos, x).length}</td>
                  <td class="num">${x.addenda_count || 0}</td>
                  <td><button class="btn btn--sm" type="button" data-detalle="${x.id}">Ver</button></td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const aux = { recetas, pedidos };
  for (const fila of $$('[data-historia]', contenedor)) {
    fila.addEventListener('click', (evento) => {
      if (evento.target.closest('button, a')) return;
      abrirDetalleCita(contenedor, lista, ctx, fila.dataset.historia, aux);
    });
    fila.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      evento.preventDefault();
      abrirDetalleCita(contenedor, lista, ctx, fila.dataset.historia, aux);
    });
  }
  for (const boton of $$('[data-detalle]', contenedor)) {
    boton.addEventListener('click', () =>
      abrirDetalleCita(contenedor, lista, ctx, boton.dataset.detalle, aux)
    );
  }

  if (abrirId) await abrirDetalleCita(contenedor, lista, ctx, abrirId, aux);
}

export const tab = {
  id: 'historia',
  titulo: 'Historia clínica',
  permiso: ['historias.resumen', 'historias.ver'],
  async render(contenedor, ctx) {
    contenedor.innerHTML = '<div class="empty">Cargando historia…</div>';
    try {
      if (!ctx.puede('historias.ver')) {
        const resumen = await api.get(
          `/api/patients/${encodeURIComponent(ctx.pacienteId)}/historia-resumen`
        );
        verSoloResumen(contenedor, resumen || [], ctx);
        return;
      }

      const lista = await api.get(
        `/api/clinical-records?patientId=${encodeURIComponent(ctx.pacienteId)}`
      );
      await renderHistoria(contenedor, lista || [], ctx);
    } catch (error) {
      toast(error.message, 'error');
      contenedor.innerHTML = `<div class="info">${escapeHtml(error.message)}</div>`;
    }
  },
};
