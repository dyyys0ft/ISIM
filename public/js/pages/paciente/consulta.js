import { api } from '../../api.js';
import {
  $,
  $$,
  escapeHtml,
  fmtFecha,
  toast,
  modal,
  confirmar,
} from '../../ui.js';

const CAMPOS_RESUMEN = [
  ['motivo', 'Motivo de consulta'],
  ['enfermedad_actual', 'Enfermedad o problema actual'],
  ['ros', 'Revisión de órganos y sistemas'],
  ['_vitales', 'Signos vitales y antropometría'],
  ['_obst', 'Control obstétrico'],
  ['examen_fisico', 'Examen físico general'],
  ['examen_gineco', 'Examen ginecológico / mamario'],
  ['_dx', 'Diagnósticos (CIE-10)'],
  ['plan', 'Plan diagnóstico y terapéutico'],
  ['indicaciones', 'Indicaciones / educación'],
  ['proxima_cita', 'Próxima cita'],
];

function vitales(d) {
  const partes = [];
  if (d.pa_sis || d.pa_dia) partes.push(`PA ${d.pa_sis || '-'}/${d.pa_dia || '-'} mmHg`);
  if (d.fc) partes.push(`FC ${d.fc} lpm`);
  if (d.fr) partes.push(`FR ${d.fr} rpm`);
  if (d.temp) partes.push(`T° ${d.temp} °C`);
  if (d.sat) partes.push(`SatO₂ ${d.sat}%`);
  if (d.peso) partes.push(`Peso ${d.peso} kg`);
  if (d.talla) partes.push(`Talla ${d.talla} cm`);
  if (d.peso && d.talla) {
    partes.push(`IMC ${(d.peso / (d.talla / 100) ** 2).toFixed(1)}`);
  }
  return partes.join(' · ');
}

function obstetricia(d) {
  if (!d.embarazo) return '';
  const partes = [];
  if (d.fum) partes.push(`FUM ${d.fum}`);
  if (d.eg) partes.push(`EG ${d.eg}`);
  if (d.fpp) partes.push(`FPP ${d.fpp}`);
  if (d.au) partes.push(`AU ${d.au} cm`);
  if (d.fcf) partes.push(`FCF ${d.fcf} lpm`);
  if (d.mov) partes.push(`Mov. fetales: ${d.mov}`);
  if (d.presentacion) partes.push(`Presentación: ${d.presentacion}`);
  if (d.edemas) partes.push(`Edemas: ${d.edemas}`);
  return partes.join(' · ');
}

/** Vista de solo lectura de una consulta, compartida con la historia. */
export function consultaKV(datos = {}) {
  return `<dl class="kv">${CAMPOS_RESUMEN.map(([clave, etiqueta]) => {
    let valor =
      clave === '_vitales'
        ? vitales(datos)
        : clave === '_obst'
          ? obstetricia(datos)
          : clave === '_dx'
            ? (datos.diagnosticos || [])
                .map((x) => `${x.cie || ''} ${x.desc || ''} (${x.tipo || 'PRE'})`.trim())
                .join('\n')
            : clave === 'proxima_cita'
              ? fmtFecha(datos[clave])
              : datos[clave];
    return valor ? `<dt>${etiqueta}</dt><dd>${escapeHtml(valor)}</dd>` : '';
  }).join('')}</dl>`;
}

function campo(nombre, etiqueta, valor, opciones = {}) {
  const { tipo = 'text', clase = '', requerido = false, extra = '' } = opciones;
  return `<label class="f ${clase}"><span>${escapeHtml(etiqueta)}${requerido ? ' *' : ''}</span>
    <input class="input" name="${nombre}" type="${tipo}" value="${escapeHtml(valor ?? '')}"
      ${requerido ? 'required' : ''} maxlength="200" ${extra} /></label>`;
}

function area(nombre, etiqueta, valor, opciones = {}) {
  const { clase = '', filas = 3, placeholder = '', max = 5000 } = opciones;
  return `<label class="f ${clase}"><span>${escapeHtml(etiqueta)}</span>
    <textarea class="textarea" name="${nombre}" rows="${filas}" maxlength="${max}"
      ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}>${escapeHtml(valor ?? '')}</textarea></label>`;
}

function seccion(letra, titulo, contenido) {
  return `<section class="sec"><h3><span class="n">${letra}</span>${escapeHtml(titulo)}</h3>
    <div class="b grid g2">${contenido}</div></section>`;
}

function avisoPendiente(cita, irA) {
  if (!cita?.consentimiento || cita.consentimiento.firmado) return '';
  return `<div class="ficha-warn">
    <span class="grow">✍ Esta paciente tiene <b>consentimiento(s) pendiente(s) de firma</b>. Explíquelo y hágalo firmar antes del procedimiento.</span>
    <button class="btn btn--sm pri" type="button" id="ir-consentimientos">Ver consentimientos ›</button>
  </div>`;
}

async function verFirmada(contenedor, historia, ctx) {
  const datos = historia.datos || {};
  const firmada = fmtFecha(historia.actualizado_en, { time: true });
  contenedor.innerHTML = `
    <div class="card">
      <div class="row">
        <h2 class="grow">Consulta del ${fmtFecha(historia.fecha || ctx.cita.fecha_hora)}</h2>
        <span class="badge badge--firmado">Firmada ${escapeHtml(firmada)}</span>
        ${ctx.puede('historias.ver') ? '<button class="btn btn--sm" type="button" id="imprimir-consulta">Imprimir</button>' : ''}
        <button class="btn btn--sm pri" type="button" id="ir-receta">Ir a receta ›</button>
      </div>
      ${consultaKV(datos)}
      ${(historia.addenda || [])
        .map(
          (nota) => `<div class="ficha-addenda"><b>Nota aclaratoria · ${escapeHtml(fmtFecha(nota.creado_en, { time: true }))} · ${escapeHtml(nota.usuario_nombre || '')}</b>${escapeHtml(nota.texto)}</div>`
        )
        .join('')}
      <div class="ficha-bloqueo">
        La consulta firmada es inmutable (integridad de la historia clínica). Para corregir o completar
        un dato, registre una nota aclaratoria; la firma original se conserva.
      </div>
      <div class="row" style="margin-top:12px">
        <span class="muted small grow">${escapeHtml(historia.medico_nombre || '')}${historia.actualizado_por_nombre ? ` · Última edición: ${escapeHtml(historia.actualizado_por_nombre)}` : ''}</span>
        ${ctx.puede('historias.gestionar') ? '<button class="btn btn--sm" type="button" id="agregar-addenda">＋ Nota aclaratoria</button>' : ''}
      </div>
    </div>`;

  $('#imprimir-consulta', contenedor)?.addEventListener('click', () => {
    window.open(`/consulta-imprimir.html?id=${encodeURIComponent(historia.id)}`, '_blank');
  });
  $('#ir-receta', contenedor)?.addEventListener('click', () => ctx.irA('receta'));
  $('#ir-consentimientos', contenedor)?.addEventListener('click', () => ctx.irA('consentimientos'));

  $('#agregar-addenda', contenedor)?.addEventListener('click', () => {
    const dialogo = modal(
      'Nota aclaratoria',
      `<div class="info small" style="margin-bottom:10px">La consulta firmada no se modifica. La nota queda registrada con fecha, hora y usuario.</div>
       <label class="f"><span>Texto</span><textarea id="addenda-texto" rows="5" maxlength="5000" placeholder="Describa la aclaración…"></textarea></label>`,
      `<button class="btn" type="button" data-cerrar-modal>Cancelar</button>
       <button class="btn pri" type="button" id="addenda-guardar">Guardar nota</button>`
    );
    dialogo.querySelector('#addenda-texto')?.focus();
    dialogo.querySelector('#addenda-guardar')?.addEventListener('click', async () => {
      const texto = dialogo.querySelector('#addenda-texto').value.trim();
      if (texto.length < 5) {
        toast('Escribe la nota aclaratoria (al menos 5 caracteres)', 'error');
        return;
      }
      try {
        await api.post(`/api/clinical-records/${encodeURIComponent(historia.id)}/addenda`, { texto });
        toast('Nota aclaratoria guardada');
        dialogo.close();
        dialogo.remove();
        await verFirmada(contenedor, await recargarHistoria(historia.id), ctx);
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  });
}

async function recargarHistoria(id) {
  return api.get(`/api/clinical-records/${encodeURIComponent(id)}`);
}

async function verFormulario(contenedor, historia, ctx) {
  const P = ctx.paciente;
  const d = {
    fum: P.fum || '',
    diagnosticos: [],
    ...(historia?.datos || {}),
  };
  if (!Array.isArray(d.diagnosticos)) d.diagnosticos = [];
  const editable = ctx.puede('historias.gestionar');

  contenedor.innerHTML = `
    <form id="form-consulta" class="stack">
      <div class="error-formulario" role="alert" aria-live="assertive" id="error-consulta" hidden></div>
      ${avisoPendiente(ctx.cita, ctx.irA)}
      <div class="row">
        <h2 class="grow">Consulta externa — ${escapeHtml(fmtFecha(ctx.cita.fecha_hora))}</h2>
        ${historia ? '<span class="badge badge--new">Borrador guardado</span>' : ''}
      </div>
      ${seccion(
        'A',
        'Motivo de consulta',
        area('motivo', 'Motivo por el que acude la paciente', d.motivo, {
          clase: 'spanall',
          filas: 2,
          requerido: true,
        })
      )}
      <section class="sec"><h3><span class="n">B</span>Antecedentes relevantes (de la ficha)</h3>
        <div class="b small">
          <dl class="kv" style="margin-top:0">
            <dt>Alergias</dt><dd>${escapeHtml(P.alergias || '—')}</dd>
            <dt>Personales / quirúrgicos</dt><dd>${escapeHtml([P.ant_personales, P.ant_quirurgicos].filter(Boolean).join(' · ') || '—')}</dd>
            <dt>Familiares</dt><dd>${escapeHtml(P.ant_familiares || '—')}</dd>
            <dt>Gineco-obstétricos</dt><dd>${escapeHtml([P.menarquia && `Menarquia ${P.menarquia}`, P.ciclos && `Ciclos ${P.ciclos}`, P.gestas && `G${P.gestas} P${P.partos || 0} C${P.cesareas || 0} A${P.abortos || 0} HV${P.hijos_vivos || 0}`, P.mac && `MAC ${P.mac}`].filter(Boolean).join(' · ') || '—')}</dd>
          </dl>
          <button class="btn btn--sm" type="button" id="editar-antecedentes">Editar antecedentes en Datos de la paciente ›</button>
        </div>
      </section>
      ${seccion('C', 'Enfermedad o problema actual', area('enfermedad_actual', 'Cronología, localización, características, intensidad, causa aparente y síntomas asociados', d.enfermedad_actual, { clase: 'spanall', filas: 4 }))}
      ${seccion('D', 'Revisión actual de órganos y sistemas', area('ros', '', d.ros, { clase: 'spanall', filas: 2 }))}
      ${seccion(
        'E',
        'Signos vitales y antropometría',
        [
          campo('pa_sis', 'PA sistólica (mmHg)', d.pa_sis),
          campo('pa_dia', 'PA diastólica (mmHg)', d.pa_dia),
          campo('fc', 'Frec. cardíaca (lpm)', d.fc),
          campo('fr', 'Frec. respiratoria (rpm)', d.fr),
          campo('temp', 'Temperatura (°C)', d.temp),
          campo('sat', 'Sat. O₂ (%)', d.sat),
          campo('peso', 'Peso (kg)', d.peso),
          campo('talla', 'Talla (cm)', d.talla),
          campo('imc', 'IMC', d.imc, { extra: 'disabled' }),
        ].join('')
      )}
      <section class="sec"><h3><span class="n">F</span>Ginecología / obstetricia</h3>
        <div class="b">
          <div class="grid g3">
            <label class="f"><span>FUM</span><input class="input" type="date" name="fum" value="${escapeHtml(d.fum || '')}" /></label>
            <label class="chk" style="align-self:end"><input type="checkbox" name="embarazo" value="1"${d.embarazo ? ' checked' : ''} /><span>Paciente embarazada</span></label>
          </div>
          <div id="bloque-obst" class="grid g3" style="margin-top:12px;${d.embarazo ? '' : 'display:none'}">
            ${campo('eg', 'Edad gestacional', d.eg)}
            ${campo('fpp', 'FPP', d.fpp, { tipo: 'date' })}
            ${campo('au', 'Altura uterina (cm)', d.au)}
            ${campo('fcf', 'FCF (lpm)', d.fcf)}
            ${campo('mov', 'Movimientos fetales', d.mov)}
            ${campo('presentacion', 'Presentación', d.presentacion)}
            ${campo('edemas', 'Edemas', d.edemas)}
          </div>
        </div>
      </section>
      ${seccion(
        'G',
        'Examen físico',
        area('examen_fisico', 'Examen físico general / regional', d.examen_fisico, { filas: 4 }) +
          area('examen_gineco', 'Mamas, abdomen, genitales externos, especuloscopia, tacto vaginal', d.examen_gineco, { filas: 4 })
      )}
      <section class="sec"><h3><span class="n">H</span>Diagnósticos (CIE-10) <span style="color:var(--red)">*</span></h3>
        <div class="b stack">
          <div id="diagnosticos"></div>
          <div class="dx-nuevo">
            <label><span>Código CIE</span><input class="input" id="dx-cie" maxlength="20" placeholder="N76" /></label>
            <label><span>Descripción</span><input class="input" id="dx-desc" maxlength="200" placeholder="Vaginitis" /></label>
            <label><span>Tipo</span><select class="select" id="dx-tipo"><option>PRE</option><option>DEF</option></select></label>
            <button class="btn" type="button" id="dx-agregar">Agregar</button>
          </div>
          <p class="small muted">PRE = presuntivo · DEF = definitivo. Al menos un diagnóstico para firmar.</p>
        </div>
      </section>
      ${seccion(
        'I',
        'Plan de tratamiento',
        area('plan', 'Plan diagnóstico y terapéutico (la receta se emite en la pestaña Receta)', d.plan, { filas: 3 }) +
          area('indicaciones', 'Indicaciones generales / educación a la paciente', d.indicaciones, { filas: 3 }) +
          campo('proxima_cita', 'Próxima cita / control', d.proxima_cita, { tipo: 'date' })
      )}
      <div class="row form-acciones-fijas">
        <span class="small muted grow">Al firmar, la consulta queda cerrada. <span id="consulta-estado-guardado" class="estado-guardado" role="status" aria-live="polite"></span></span>
        ${editable ? '<button class="btn" type="button" id="guardar-borrador">Guardar borrador</button><button class="btn ok" type="button" id="firmar-consulta">Firmar y cerrar consulta</button>' : ''}
      </div>
    </form>`;

  const formulario = $('#form-consulta', contenedor);
  for (const control of $$('input, select, textarea', formulario)) {
    if (!editable) control.disabled = true;
  }
  $('#editar-antecedentes', contenedor)?.addEventListener('click', () => ctx.irA('datos'));
  $('#ir-consentimientos', contenedor)?.addEventListener('click', () => ctx.irA('consentimientos'));

  const calcularImc = () => {
    const peso = Number(formulario.elements.peso.value);
    const talla = Number(formulario.elements.talla.value);
    formulario.elements.imc.value = peso && talla ? (peso / (talla / 100) ** 2).toFixed(1) : '';
  };
  for (const nombre of ['peso', 'talla']) {
    formulario.elements[nombre]?.addEventListener('input', calcularImc);
  }
  calcularImc();

  const checkEmbarazo = formulario.elements.embarazo;
  checkEmbarazo?.addEventListener('change', () => {
    $('#bloque-obst', formulario).style.display = checkEmbarazo.checked ? '' : 'none';
  });

  let diagnosticos = d.diagnosticos.slice();
  const dibujarDiagnosticos = () => {
    $('#diagnosticos', formulario).innerHTML =
      diagnosticos
        .map(
          (x, i) => `<span class="dx-chip"><b>${escapeHtml(x.cie || 'S/E')}</b>${escapeHtml(x.desc || '')}
            <select data-tipo="${i}" ${editable ? '' : 'disabled'}>
              <option${x.tipo === 'PRE' ? ' selected' : ''}>PRE</option>
              <option${x.tipo === 'DEF' ? ' selected' : ''}>DEF</option>
            </select>
            ${editable ? `<button class="btn btn--sm ghost" type="button" data-borrar="${i}" aria-label="Quitar">✕</button>` : ''}
          </span>`
        )
        .join('') || '<p class="small muted">Sin diagnósticos todavía.</p>';

    for (const selector of $$('[data-tipo]', formulario)) {
      selector.addEventListener('change', () => {
        diagnosticos[Number(selector.dataset.tipo)].tipo = selector.value;
      });
    }
    for (const boton of $$('[data-borrar]', formulario)) {
      boton.addEventListener('click', () => {
        diagnosticos.splice(Number(boton.dataset.borrar), 1);
        dibujarDiagnosticos();
      });
    }
  };
  dibujarDiagnosticos();

  $('#dx-agregar', formulario)?.addEventListener('click', () => {
    const cie = $('#dx-cie', formulario).value.trim();
    const desc = $('#dx-desc', formulario).value.trim();
    if (!cie && !desc) {
      toast('Ingresa el código CIE o la descripción', 'error');
      return;
    }
    diagnosticos.push({ cie, desc, tipo: $('#dx-tipo', formulario).value });
    $('#dx-cie', formulario).value = '';
    $('#dx-desc', formulario).value = '';
    dibujarDiagnosticos();
  });

  const error = $('#error-consulta', formulario);
  formulario.addEventListener(
    'invalid',
    (evento) => {
      error.hidden = false;
      error.textContent = 'Falta el motivo de consulta. Revisa el campo marcado en rojo.';
      evento.target.closest('.f')?.classList.add('field--invalido');
    },
    true
  );
  formulario.addEventListener('input', () => {
    if (formulario.checkValidity()) error.hidden = true;
  });

  function leerDatos() {
    const datos = {};
    for (const [clave, control] of Object.entries(formulario.elements)) {
      if (!control?.name || control.disabled) continue;
      if (control.type === 'checkbox') datos[control.name] = control.checked ? 1 : 0;
      else datos[control.name] = control.value.trim();
    }
    datos.diagnosticos = diagnosticos;
    return datos;
  }

  const estadoGuardado = $('#consulta-estado-guardado', formulario);
  let cambiosPendientes = false;
  let ultimoGuardado = JSON.stringify(leerDatos());
  let autosaveTimer = null;
  let guardando = false;

  function pintarEstadoGuardado(texto, tipo = '') {
    if (!estadoGuardado) return;
    estadoGuardado.textContent = texto;
    estadoGuardado.classList.toggle('estado-guardado--ok', tipo === 'ok');
    estadoGuardado.classList.toggle('estado-guardado--pendiente', tipo === 'pendiente');
  }

  function marcarCambios() {
    if (guardando) return;
    cambiosPendientes = true;
    pintarEstadoGuardado('· Cambios sin guardar', 'pendiente');
  }

  async function guardar({ requerirDiagnostico = true, silencioso = false } = {}) {
    const datos = leerDatos();
    if (!datos.motivo) {
      if (!silencioso) {
        error.hidden = false;
        error.textContent = 'El motivo de consulta es obligatorio.';
        formulario.elements.motivo?.focus();
      }
      throw new Error('Motivo obligatorio');
    }
    if (requerirDiagnostico && !diagnosticos.length) {
      if (!silencioso) {
        error.hidden = false;
        error.textContent = 'Registra al menos un diagnóstico (puede ser presuntivo).';
      }
      throw new Error('Diagnóstico obligatorio');
    }

    guardando = true;
    try {
      await api.patch(`/api/clinical-records/${encodeURIComponent(historia.id)}`, {
        datos,
        motivoConsulta: datos.motivo,
        diagnostico: diagnosticos.map((x) => `${x.cie || ''} ${x.desc || ''}`.trim()).join('; '),
        indicaciones: datos.indicaciones,
        recomendaciones: datos.plan,
      });
      cambiosPendientes = false;
      ultimoGuardado = JSON.stringify(datos);
      pintarEstadoGuardado(
        `· Guardado ${new Date().toLocaleTimeString('es-EC', {
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        'ok'
      );
      return datos;
    } finally {
      guardando = false;
    }
  }

  async function autoguardar() {
    if (!formulario.isConnected || !cambiosPendientes || guardando) return;
    const datos = leerDatos();
    if (!datos.motivo || JSON.stringify(datos) === ultimoGuardado) return;
    try {
      await guardar({ requerirDiagnostico: false, silencioso: true });
    } catch {
      pintarEstadoGuardado('· No se pudo autoguardar', 'pendiente');
    }
  }

  function programarAutoguardado() {
    autosaveTimer = setTimeout(async () => {
      await autoguardar();
      if (formulario.isConnected) programarAutoguardado();
    }, 60000);
  }

  formulario.addEventListener('input', marcarCambios);
  formulario.addEventListener('change', marcarCambios);
  programarAutoguardado();

  const controlador = new AbortController();
  const observador = new MutationObserver(() => {
    if (formulario.isConnected) return;
    clearTimeout(autosaveTimer);
    controlador.abort();
    observador.disconnect();
  });
  observador.observe(contenedor, { childList: true, subtree: true });

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) autoguardar();
    },
    { signal: controlador.signal }
  );

  window.addEventListener(
    'beforeunload',
    (evento) => {
      if (!cambiosPendientes || !formulario.isConnected) return;
      evento.preventDefault();
      evento.returnValue = '';
    },
    { signal: controlador.signal }
  );

  document.addEventListener(
    'keydown',
    (evento) => {
      const esGuardar = (evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 's';
      if (!esGuardar || !formulario.isConnected) return;
      evento.preventDefault();
      $('#guardar-borrador', formulario)?.click();
    },
    { signal: controlador.signal }
  );

  $('#guardar-borrador', formulario)?.addEventListener('click', async (evento) => {
    const boton = evento.currentTarget;
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      await guardar({ requerirDiagnostico: false });
      toast('Borrador guardado');
      await ctx.recargar();
    } catch (fallo) {
      if (fallo.message !== 'Motivo obligatorio') {
        error.hidden = false;
        error.textContent = fallo.message;
        toast(fallo.message, 'error');
      }
      boton.disabled = false;
      boton.textContent = 'Guardar borrador';
    }
  });

  $('#firmar-consulta', formulario)?.addEventListener('click', async (evento) => {
    const boton = evento.currentTarget;
    if (
      !(await confirmar(
        '¿Firmar y cerrar la consulta? Después de firmar no se podrá modificar; solo se podrán añadir notas aclaratorias.',
        { titulo: 'Firmar consulta', textoAceptar: 'Firmar consulta' }
      ))
    ) {
      return;
    }
    boton.disabled = true;
    boton.textContent = 'Firmando…';
    try {
      await guardar();
      await api.post(`/api/appointments/${encodeURIComponent(ctx.cita.id)}/finish-consultation`);
      toast('Consulta firmada y cerrada');
      await ctx.recargar();
    } catch (fallo) {
      error.hidden = false;
      error.textContent = fallo.message;
      toast(fallo.message, 'error');
      boton.disabled = false;
      boton.textContent = 'Firmar y cerrar consulta';
    }
  });
}

/** Pestaña "Consulta del día" — contrato ui-v2 SPEC §8. */
export const tab = {
  id: 'consulta',
  titulo: 'Consulta del día',
  permiso: 'historias.ver',
  async render(contenedor, ctx) {
    if (!ctx.cita) {
      contenedor.innerHTML = `<div class="card empty">
        Esta paciente no tiene turno para hoy, por eso no hay consulta del día.<br /><br />
        <a class="btn pri" href="/agenda.html?patientId=${encodeURIComponent(ctx.pacienteId)}">Agendar una cita ›</a>
      </div>`;
      return;
    }

    contenedor.innerHTML = '<div class="empty">Cargando consulta…</div>';
    let historia = null;
    try {
      const lista = await api.get(
        `/api/clinical-records?appointmentId=${encodeURIComponent(ctx.cita.id)}`
      );
      const resumen = Array.isArray(lista) ? lista[0] || null : null;
      if (resumen?.id) {
        historia = await api.get(`/api/clinical-records/${encodeURIComponent(resumen.id)}`);
      }
    } catch (error) {
      toast(error.message, 'error');
      contenedor.innerHTML = `<div class="info">${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!historia) {
      if (!ctx.puede('historias.gestionar')) {
        contenedor.innerHTML = '<div class="card empty">Todavía no hay consulta registrada para este turno.</div>';
        return;
      }
      contenedor.innerHTML = `<div class="card">
        <div class="row"><h2 class="grow">Consulta del ${escapeHtml(fmtFecha(ctx.cita.fecha_hora))}</h2></div>
        <p class="muted">La historia clínica de este turno todavía no se ha iniciado.</p>
        ${avisoPendiente(ctx.cita, ctx.irA)}
        <button class="btn pri" type="button" id="iniciar-consulta">Iniciar consulta</button>
      </div>`;
      $('#iniciar-consulta', contenedor)?.addEventListener('click', async (evento) => {
        const boton = evento.currentTarget;
        boton.disabled = true;
        boton.textContent = 'Iniciando…';
        try {
          await api.post(`/api/appointments/${encodeURIComponent(ctx.cita.id)}/start-consultation`);
          toast('Consulta iniciada');
          await ctx.recargar();
        } catch (error) {
          toast(error.message, 'error');
          boton.disabled = false;
          boton.textContent = 'Iniciar consulta';
        }
      });
      $('#ir-consentimientos', contenedor)?.addEventListener('click', () => ctx.irA('consentimientos'));
      return;
    }

    if (historia.consulta_finalizada || ctx.cita.estado === 'atendida') {
      await verFirmada(contenedor, historia, ctx);
      return;
    }
    await verFormulario(contenedor, historia, ctx);
  },
};
