import { api } from '../../api.js';
import { $, $$, escapeHtml, fmtFecha, toast } from '../../ui.js';
import { mascararTelefono, mascararEmail, iconoOjo } from '../../privacidad.js';
import { abrirSelectorConsentimiento } from '../../lopdp.js';


const OPCIONES = {
  sexo: [
    ['', 'Sin especificar'],
    ['F', 'Femenino'],
    ['M', 'Masculino'],
    ['X', 'Otro / no declara'],
  ],
  tipo_doc: [
    ['cedula', 'Cédula'],
    ['pasaporte', 'Pasaporte'],
    ['otro', 'Otro'],
  ],
  estado_civil: [
    ['', 'Sin especificar'],
    ['Soltera/o', 'Soltera/o'],
    ['Casada/o', 'Casada/o'],
    ['Unión libre', 'Unión libre'],
    ['Divorciada/o', 'Divorciada/o'],
    ['Viuda/o', 'Viuda/o'],
    ['Otro', 'Otro'],
  ],
  grupo_sanguineo: [
    ['', 'Sin registrar'],
    ['A+', 'A+'], ['A-', 'A-'], ['B+', 'B+'], ['B-', 'B-'],
    ['AB+', 'AB+'], ['AB-', 'AB-'], ['O+', 'O+'], ['O-', 'O-'],
  ],
  parentesco: [
    ['', 'Sin especificar'],
    ['Madre', 'Madre'],
    ['Padre', 'Padre'],
    ['Tutor legal', 'Tutor legal'],
    ['Abuelo/a', 'Abuelo/a'],
    ['Hermano/a', 'Hermano/a'],
    ['Otro', 'Otro'],
  ],
};

function campo(nombre, etiqueta, valor, opciones = {}) {
  const {
    tipo = 'text',
    clase = '',
    requerido = false,
    placeholder = '',
    max = 200,
    extra = '',
  } = opciones;
  return `<label class="f ${clase}"><span>${escapeHtml(etiqueta)}${requerido ? ' *' : ''}</span>
    <input class="input" name="${nombre}" type="${tipo}" value="${escapeHtml(valor ?? '')}"
      ${requerido ? 'required' : ''} ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
      maxlength="${max}" ${extra} /></label>`;
}

function area(nombre, etiqueta, valor, opciones = {}) {
  const { clase = '', filas = 3, placeholder = '', max = 2000, extra = '' } = opciones;
  return `<label class="f ${clase}"><span>${escapeHtml(etiqueta)}</span>
    <textarea class="textarea" name="${nombre}" rows="${filas}" maxlength="${max}"
      ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''} ${extra}>${escapeHtml(valor ?? '')}</textarea></label>`;
}

function seleccion(nombre, etiqueta, valor, opciones, opcionesExtra = {}) {
  const { clase = '' } = opcionesExtra;
  return `<label class="f ${clase}"><span>${escapeHtml(etiqueta)}</span>
    <select class="select" name="${nombre}">
      ${opciones
        .map(
          ([valorOpcion, texto]) =>
            `<option value="${escapeHtml(valorOpcion)}"${valor === valorOpcion ? ' selected' : ''}>${escapeHtml(texto)}</option>`
        )
        .join('')}
    </select></label>`;
}

function seccion(numero, titulo, contenido) {
  return `<section class="sec"><h3><span class="n">${numero}</span>${escapeHtml(titulo)}</h3>
    <div class="b grid g3">${contenido}</div></section>`;
}

function representantes(P) {
  if (!P.es_menor) return '';
  const r1 = P.representantes?.[0] || {};
  const r2 = P.representantes?.[1] || {};
  return `<section class="sec"><h3><span class="n">R</span>Representantes legales</h3>
    <div class="b stack">
      <div class="info small">La paciente es menor de 18 años. El representante legal 1 es obligatorio y es quien firma los consentimientos; el 2 es opcional.</div>
      <h4 class="small">Representante legal 1</h4>
      <div class="grid g3">
        ${campo('representante1_nombre', 'Nombre', r1.nombre || P.representante1_nombre, { requerido: true })}
        ${campo('representante1_cedula', 'Cédula', r1.cedula || P.representante1_cedula, { requerido: true })}
        ${seleccion('representante1_parentesco', 'Parentesco', r1.parentesco || P.representante1_parentesco, OPCIONES.parentesco)}
        ${campo('representante1_telefono', 'Teléfono', r1.telefono || P.representante1_telefono, { tipo: 'tel', max: 30 })}
      </div>
      <h4 class="small">Representante legal 2 (opcional)</h4>
      <div class="grid g3">
        ${campo('representante2_nombre', 'Nombre', r2.nombre || P.representante2_nombre)}
        ${campo('representante2_cedula', 'Cédula', r2.cedula || P.representante2_cedula)}
        ${seleccion('representante2_parentesco', 'Parentesco', r2.parentesco || P.representante2_parentesco, OPCIONES.parentesco)}
        ${campo('representante2_telefono', 'Teléfono', r2.telefono || P.representante2_telefono, { tipo: 'tel', max: 30 })}
      </div>
    </div></section>`;
}

function contactoFormulario(P, soloLectura) {
  const telefono = String(P.telefono ?? '').trim();
  const email = String(P.email ?? '').trim();
  const telefonoMascara = mascararTelefono(telefono);
  const emailMascara = mascararEmail(email);
  return `<div class="contacto-form" data-contacto-form
      data-paciente-id="${escapeHtml(P.id || '')}" data-revelado="0">
    <div class="contacto-form__head">
      <strong>Datos de contacto</strong>
      <button class="contacto-privado__ojo" type="button" data-revelar-contacto-form
        aria-pressed="false" aria-label="Mostrar datos de contacto"
        title="Mostrar datos de contacto">${iconoOjo()}</button>
    </div>
    <div class="contacto-form__grid">
      <label class="f"><span>Teléfono</span>
        <input class="input" id="datos-telefono" name="telefono" type="tel"
          value="${escapeHtml(telefonoMascara)}" data-real="${escapeHtml(telefono)}"
          data-mascara="${escapeHtml(telefonoMascara)}" readonly ${soloLectura ? 'disabled' : ''} />
      </label>
      <label class="f"><span>Correo electrónico</span>
        <input class="input" id="datos-email" name="email" type="email"
          value="${escapeHtml(emailMascara)}" data-real="${escapeHtml(email)}"
          data-mascara="${escapeHtml(emailMascara)}" readonly ${soloLectura ? 'disabled' : ''} />
      </label>
    </div>
  </div>`;
}

function puedeEditar(ctx) {
  return ctx.puede('pacientes.editar');
}

/** Pestaña "Datos de la paciente" — contrato ui-v2 SPEC §8. */
export const tab = {
  id: 'datos',
  titulo: 'Datos de la paciente',
  permiso: 'pacientes.ver',
  async render(contenedor, ctx) {
    const P = ctx.paciente;
    const soloLectura = !puedeEditar(ctx);
    const deshabilitar = soloLectura ? 'disabled' : '';

    contenedor.innerHTML = `
      <form id="form-datos" class="stack">
        <div class="error-formulario" role="alert" aria-live="assertive" id="error-datos" hidden></div>
        ${seccion(
          '1',
          'Datos de identificación y contacto (Admisión)',
          [
            campo('nombres', 'Nombres', P.nombres, { requerido: !soloLectura, extra: deshabilitar }),
            campo('apellidos', 'Apellidos', P.apellidos, { requerido: !soloLectura, extra: deshabilitar }),
            campo('cedula', 'Cédula', P.cedula, { requerido: !soloLectura, extra: deshabilitar }),
            campo('fecha_nacimiento', 'Fecha de nacimiento', P.fecha_nacimiento, { tipo: 'date', extra: deshabilitar }),
            seleccion('sexo', 'Sexo', P.sexo, OPCIONES.sexo),
            seleccion('tipo_doc', 'Tipo de documento', P.tipo_doc, OPCIONES.tipo_doc),
            campo('direccion', 'Dirección', P.direccion, { extra: deshabilitar }),
            campo('ciudad', 'Ciudad', P.ciudad, { extra: deshabilitar }),
            campo('provincia', 'Provincia', P.provincia, { extra: deshabilitar }),
            campo('canton', 'Cantón', P.canton, { extra: deshabilitar }),
            campo('parroquia', 'Parroquia', P.parroquia, { extra: deshabilitar }),
            campo('ocupacion', 'Ocupación', P.ocupacion, { extra: deshabilitar }),
            seleccion('estado_civil', 'Estado civil', P.estado_civil, OPCIONES.estado_civil),
            campo('instruccion', 'Instrucción', P.instruccion, { extra: deshabilitar }),
            campo('nacionalidad', 'Nacionalidad', P.nacionalidad, { extra: deshabilitar }),
            campo('etnia', 'Etnia', P.etnia, { extra: deshabilitar }),
            campo('seguro', 'Seguro', P.seguro, { extra: deshabilitar }),
            campo('contacto_nombre', 'Contacto de emergencia', P.contacto_nombre, { extra: deshabilitar }),
            campo('contacto_parentesco', 'Parentesco del contacto', P.contacto_parentesco, { extra: deshabilitar }),
            campo('contacto_telefono', 'Teléfono del contacto', P.contacto_telefono, { tipo: 'tel', max: 30, extra: deshabilitar }),
            campo('empresa', 'Empresa', P.empresa, { extra: deshabilitar }),
            campo('puesto', 'Puesto', P.puesto, { extra: deshabilitar }),
            campo('hc_numero', 'N.º de historia clínica', P.hc_numero, { extra: deshabilitar }),
            contactoFormulario(P, soloLectura),
          ].join('')
        )}
        ${ctx.puede('historias.ver') || ctx.puede('historias.resumen')
          ? seccion(
              '2',
              'Antecedentes personales',
              [
                area('alergias', 'Alergias (medicamentos, alimentos, otros)', P.alergias),
                seleccion('grupo_sanguineo', 'Grupo sanguíneo y factor', P.grupo_sanguineo, OPCIONES.grupo_sanguineo),
                area('medicacion_habitual', 'Medicación habitual', P.medicacion_habitual),
                area('ant_personales', 'Antecedentes patológicos personales', P.ant_personales),
                area('ant_quirurgicos', 'Antecedentes quirúrgicos', P.ant_quirurgicos),
                area('ant_familiares', 'Antecedentes patológicos familiares', P.ant_familiares),
                area('habitos', 'Hábitos (tabaco, alcohol, actividad física)', P.habitos),
                `<div class="embarazo-bloque">
                  <label class="chk embarazo-check">
                    <input type="checkbox" name="embarazada"${
                      Number(P.embarazada) === 1 ? ' checked' : ''
                    } ${deshabilitar} />
                    <span>Paciente embarazada</span>
                  </label>
                  <div class="grid g2">
                    ${campo('fum', 'Fecha de última menstruación (FUM)', P.fum, {
                      tipo: 'date',
                      extra: deshabilitar,
                    })}
                    ${area('embarazo_nota', 'Nota del embarazo', P.embarazo_nota, {
                      filas: 2,
                      placeholder: 'Ej.: embarazo de 12 semanas, control mensual.',
                      extra: deshabilitar,
                    })}
                  </div>
                </div>`,
              ].join('')
            )
          : ''}
        ${ctx.puede('historias.ver')
          ? seccion(
              '3',
              'Antecedentes gineco-obstétricos',
              [
                campo('menarquia', 'Menarquia (edad)', P.menarquia, { extra: deshabilitar }),
                campo('ciclos', 'Ciclos (días/duración)', P.ciclos, { extra: deshabilitar }),
                campo('ivsa', 'IVSA (edad)', P.ivsa, { extra: deshabilitar }),
                campo('parejas', 'N.º de parejas sexuales', P.parejas, { extra: deshabilitar }),
                campo('mac', 'Método anticonceptivo', P.mac, { extra: deshabilitar }),
                campo('gestas', 'Gestas', P.gestas, { extra: deshabilitar }),
                campo('partos', 'Partos', P.partos, { extra: deshabilitar }),
                campo('cesareas', 'Cesáreas', P.cesareas, { extra: deshabilitar }),
                campo('abortos', 'Abortos', P.abortos, { extra: deshabilitar }),
                campo('hijos_vivos', 'Hijos vivos', P.hijos_vivos, { extra: deshabilitar }),
                campo('ultimo_pap', 'Último Papanicolaou', P.ultimo_pap, { extra: deshabilitar }),
                campo('ultima_mamografia', 'Última mamografía / eco mamaria', P.ultima_mamografia, { extra: deshabilitar }),
              ].join('')
            )
          : ''}
        ${representantes(P)}
        <section class="sec"><h3><span class="n">${ctx.puede('historias.ver') ? '4' : '2'}</span>Observaciones</h3>
          <div class="b grid g2">
            ${area('notas', 'Observaciones administrativas', P.notas)}
            <label class="f"><span>Registro</span>
              <input class="input" value="${escapeHtml(
                fmtFecha(P.creado_en || P.fecha_registro_informacion, { time: true })
              )}" disabled />
            </label>
          </div>
        </section>
        <section class="sec"><h3><span class="n">L</span>Consentimiento de tratamiento de datos (LOPDP)</h3>
          <div class="b">
            <label class="chk">
              <input type="checkbox" name="consentimiento_datos"${P.consentimiento_datos ? ' checked' : ''} />
              <span>La paciente autoriza el tratamiento de sus datos personales para la atención médica y la gestión de su historia clínica.</span>
            </label>
            <p class="small muted" style="margin-top:8px">
              ${P.consentimiento_datos
                ? `Registrado el ${escapeHtml(P.consentimiento_datos)}.`
                : 'Sin registrar. Al marcar y guardar se anota la fecha y hora.'}
              El consentimiento una vez registrado se conserva por trazabilidad.
            </p>
            <div class="evidencia-consentimiento">
              <div class="row">
                <button class="btn" type="button" id="imprimir-consentimiento">Imprimir consentimiento</button>
                ${soloLectura
                  ? ''
                  : `<input type="file" id="archivo-evidencia" accept="image/png,image/jpeg,image/webp,application/pdf" hidden />
                     <button class="btn" type="button" id="subir-evidencia">${P.consentimientoEvidencia ? 'Reemplazar evidencia' : 'Subir foto de la evidencia firmada'}</button>`}
                ${P.consentimientoEvidencia ? `<a class="btn btn--ghost" href="${escapeHtml(P.consentimientoEvidencia.url)}" target="_blank" rel="noopener">Ver evidencia</a>` : ''}
              </div>
              <p class="small muted">
                ${P.consentimientoEvidencia
                  ? `Evidencia cargada: ${escapeHtml(P.consentimientoEvidencia.nombre)}${P.consentimientoEvidencia.subidoEn ? ` · ${escapeHtml(P.consentimientoEvidencia.subidoEn)}` : ''}.`
                  : 'Sin evidencia cargada. Puedes imprimir el consentimiento y subir la foto o PDF firmado antes o después de marcarlo.'}
              </p>
            </div>
          </div>
        </section>
        <div class="row">
          <span class="muted small grow">Los cambios quedan registrados en la bitácora de actividad (LOPDP).</span>
          ${soloLectura ? '' : '<button class="btn pri" type="submit">Guardar cambios</button>'}
        </div>
      </form>`;

    const formulario = $('#form-datos', contenedor);
    const error = $('#error-datos', formulario);
    const contactoForm = formulario.querySelector('[data-contacto-form]');
    const botonContacto = contactoForm?.querySelector('[data-revelar-contacto-form]');
    let contactoVisible = false;

    botonContacto?.addEventListener('click', async () => {
      contactoVisible = !contactoVisible;
      for (const input of contactoForm.querySelectorAll('[data-real]')) {
        input.value = contactoVisible ? input.dataset.real : input.dataset.mascara;
        input.readOnly = !contactoVisible;
      }
      contactoForm.dataset.revelado = contactoVisible ? '1' : '0';
      botonContacto.setAttribute('aria-pressed', String(contactoVisible));
      const etiqueta = contactoVisible
        ? 'Ocultar datos de contacto'
        : 'Mostrar datos de contacto';
      botonContacto.setAttribute('aria-label', etiqueta);
      botonContacto.title = etiqueta;

      if (contactoVisible) {
        try {
          await api.post(
            `/api/patients/${encodeURIComponent(P.id)}/contacto-visto`,
            {}
          );
        } catch {
          // La visualización no depende de la auditoría.
        }
      }
    });

    if (soloLectura) {
      for (const control of $$('input, select, textarea', formulario)) {
        if (!control.disabled) control.disabled = true;
      }
    }

    $('#imprimir-consentimiento')?.addEventListener('click', () => {
      abrirSelectorConsentimiento({
        paciente: P,
        citaId: ctx.cita?.id || null,
        puedeVerDocumentos: ctx.puede('documentos.ver'),
        puedeCrearDocumentos: ctx.puede('documentos.crear'),
      });
    });

    $('#subir-evidencia')?.addEventListener('click', () => {
      $('#archivo-evidencia')?.click();
    });

    $('#archivo-evidencia')?.addEventListener('change', async (evento) => {
      const archivo = evento.target.files?.[0];
      if (!archivo) return;
      if (archivo.size > 8 * 1024 * 1024) {
        toast('La evidencia no puede superar los 8 MB', 'error');
        evento.target.value = '';
        return;
      }
      const boton = $('#subir-evidencia');
      if (boton) {
        boton.disabled = true;
        boton.textContent = 'Subiendo…';
      }
      try {
        const data = await new Promise((resolver, rechazar) => {
          const lector = new FileReader();
          lector.onload = () => resolver(lector.result);
          lector.onerror = rechazar;
          lector.readAsDataURL(archivo);
        });
        await api.post(
          `/api/patients/${encodeURIComponent(P.id)}/consentimiento-evidencia`,
          { nombre: archivo.name, data }
        );
        toast('Evidencia firmada guardada');
        await ctx.recargar();
      } catch (fallo) {
        toast(fallo.message, 'error');
        if (boton) {
          boton.disabled = false;
          boton.textContent = P.consentimientoEvidencia
            ? 'Reemplazar evidencia'
            : 'Subir foto de la evidencia firmada';
        }
      } finally {
        evento.target.value = '';
      }
    });

    formulario.addEventListener(
      'invalid',
      (evento) => {
        error.hidden = false;
        error.textContent =
          'Hay campos obligatorios sin completar. Revisa los campos marcados en rojo.';
        const campoInvalido = evento.target.closest('.f');
        if (campoInvalido) campoInvalido.classList.add('field--invalido');
      },
      true
    );
    formulario.addEventListener('input', () => {
      if (formulario.checkValidity()) error.hidden = true;
    });

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      if (!formulario.checkValidity()) {
        formulario.reportValidity();
        return;
      }
      error.hidden = true;
      const datos = Object.fromEntries(new FormData(formulario).entries());
      if (!contactoVisible) {
        delete datos.telefono;
        delete datos.email;
      }
      datos.embarazada = formulario.querySelector('[name="embarazada"]')?.checked ? '1' : '0';
      const consienteAhora = datos.consentimiento_datos === 'on';
      delete datos.consentimiento_datos;
      // El consentimiento se registra una sola vez con fecha y hora; nunca se borra.
      if (P.consentimiento_datos) datos.consentimiento_datos = P.consentimiento_datos;
      else if (consienteAhora) datos.consentimiento_datos = new Date().toLocaleString('es-EC');

      const boton = formulario.querySelector('button[type="submit"]');
      if (boton) {
        boton.disabled = true;
        boton.textContent = 'Guardando…';
      }
      try {
        await api.patch(`/api/patients/${encodeURIComponent(P.id)}`, datos);
        toast('Datos guardados correctamente');
        await ctx.recargar();
      } catch (fallo) {
        error.hidden = false;
        error.textContent = fallo.message;
        toast(fallo.message, 'error');
        if (boton) {
          boton.disabled = false;
          boton.textContent = 'Guardar cambios';
        }
      }
    });

  },
};
