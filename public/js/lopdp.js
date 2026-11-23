import { api } from './api.js';
import { escapeHtml, fmtFecha, modal, toast } from './ui.js';

const MAX_EVIDENCIA = 8 * 1024 * 1024;

function leerComoDataUrl(archivo) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result);
    lector.onerror = rechazar;
    lector.readAsDataURL(archivo);
  });
}

/**
 * Pregunta qué consentimiento imprimir: el documento LOPDP o una plantilla
 * activa (excepto certificados). Se usa en la ficha y en la admisión de Agenda.
 */
export async function abrirSelectorConsentimiento({
  paciente,
  citaId = null,
  puedeVerDocumentos = false,
  puedeCrearDocumentos = false,
}) {
  if (!paciente?.id) return null;

  let plantillas = [];
  if (puedeVerDocumentos) {
    plantillas = (await api.get('/api/templates').catch(() => [])).filter(
      (plantilla) => !/certificado/i.test(`${plantilla.tipo || ''} ${plantilla.nombre || ''}`)
    );
  }

  const opciones = [
    '<option value="lopdp">Consentimiento LOPDP — datos de la paciente</option>',
    ...(puedeCrearDocumentos
      ? plantillas.map(
          (plantilla) =>
            `<option value="plantilla:${escapeHtml(plantilla.id)}">${escapeHtml(
              plantilla.nombre
            )}</option>`
        )
      : []),
  ].join('');

  const dialogo = modal(
    'Consentimiento a imprimir',
    `<label class="f"><span>Selecciona el consentimiento</span>
       <select class="select" id="consentimiento-opcion">${opciones}</select></label>
     <p class="small muted" style="margin-top:8px">El LOPDP imprime los datos de la paciente. Las plantillas generan el documento con sus datos para imprimirlo.</p>`,
    `<button class="btn" type="button" data-cerrar-modal>Cancelar</button>
     <button class="btn pri" type="button" id="consentimiento-abrir">Abrir para imprimir</button>`
  );

  dialogo.querySelector('#consentimiento-abrir')?.addEventListener('click', async () => {
    const seleccion = dialogo.querySelector('#consentimiento-opcion').value;
    const boton = dialogo.querySelector('#consentimiento-abrir');
    boton.disabled = true;
    try {
      if (seleccion === 'lopdp') {
        window.open(
          `/consentimiento-datos.html?id=${encodeURIComponent(paciente.id)}`,
          '_blank',
          'noopener'
        );
      } else {
        const templateId = seleccion.replace('plantilla:', '');
        const documento = await api.post('/api/documents', {
          patientId: paciente.id,
          templateId,
          appointmentId: citaId || undefined,
          subtipo: 'consentimiento',
        });
        window.open(
          `/documento.html?id=${encodeURIComponent(documento.id)}`,
          '_blank',
          'noopener'
        );
        toast('Documento generado para imprimir');
      }
      dialogo.close();
      dialogo.remove();
    } catch (fallo) {
      toast(fallo.message, 'error');
      boton.disabled = false;
    }
  });

  return dialogo;
}

/** Abre un selector de archivo, sube la evidencia y avisa al llamador. */
export function abrirCargaEvidencia({ paciente, onSubida }) {
  if (!paciente?.id) return;
  const entrada = document.createElement('input');
  entrada.type = 'file';
  entrada.accept = 'image/png,image/jpeg,image/webp,application/pdf';
  entrada.hidden = true;
  document.body.append(entrada);

  entrada.addEventListener('change', async () => {
    const archivo = entrada.files?.[0];
    if (!archivo) {
      entrada.remove();
      return;
    }
    if (archivo.size > MAX_EVIDENCIA) {
      toast('La evidencia no puede superar los 8 MB', 'error');
      entrada.remove();
      return;
    }

    try {
      const data = await leerComoDataUrl(archivo);
      await api.post(
        `/api/patients/${encodeURIComponent(paciente.id)}/consentimiento-evidencia`,
        { nombre: archivo.name, data }
      );
      toast('Evidencia firmada guardada');
      await onSubida?.();
    } catch (fallo) {
      toast(fallo.message, 'error');
    } finally {
      entrada.remove();
    }
  });

  entrada.click();
}

/**
 * Acciones posteriores al alta de una paciente nueva: imprimir el LOPDP,
 * elegir una plantilla y subir la evidencia firmada.
 */
export async function abrirAccionesLopdp({
  paciente,
  citaId = null,
  puedeVerDocumentos = false,
  puedeCrearDocumentos = false,
  puedeEditar = false,
  onCambio = null,
}) {
  if (!paciente?.id) return null;
  let actual = paciente;

  const estadoHtml = () => {
    const registrado = String(actual.consentimiento_datos || '').trim();
    const evidencia = actual.consentimientoEvidencia;
    return `<p class="small" id="lopdp-estado">
      <strong>Consentimiento:</strong> ${
        registrado
          ? `registrado${/^\d{4}-\d{2}-\d{2}/.test(registrado) ? ` el ${escapeHtml(fmtFecha(registrado, { time: true }))}` : `: ${escapeHtml(registrado)}`}`
          : 'sin registrar'
      }.<br />
      <strong>Evidencia firmada:</strong> ${
        evidencia ? escapeHtml(evidencia.nombre || 'cargada') : 'sin cargar'
      }.
    </p>`;
  };

  const dialogo = modal(
    'Consentimiento LOPDP',
    `<p class="small" style="margin-bottom:8px">Paciente: <strong>${escapeHtml(
      `${actual.nombres || ''} ${actual.apellidos || ''}`.trim()
    )}</strong></p>
     <div id="lopdp-estado-contenedor">${estadoHtml()}</div>
     <p class="small muted" style="margin-top:8px">Puedes imprimir el consentimiento ahora y subir después la foto o PDF firmado.</p>`,
    `<button class="btn" type="button" data-cerrar-modal>Más tarde</button>
     ${
       puedeEditar
         ? '<button class="btn" type="button" id="lopdp-subir">Subir evidencia</button>'
         : ''
     }
     <button class="btn pri" type="button" id="lopdp-imprimir">Imprimir consentimiento</button>`
  );

  dialogo.querySelector('#lopdp-imprimir')?.addEventListener('click', async () => {
    dialogo.close();
    dialogo.remove();
    await abrirSelectorConsentimiento({
      paciente: actual,
      citaId,
      puedeVerDocumentos,
      puedeCrearDocumentos,
    });
  });

  dialogo.querySelector('#lopdp-subir')?.addEventListener('click', () => {
    abrirCargaEvidencia({
      paciente: actual,
      onSubida: async () => {
        const actualizado = await api
          .get(`/api/patients/${encodeURIComponent(actual.id)}`)
          .catch(() => null);
        if (actualizado) actual = actualizado;
        const contenedorEstado = dialogo.querySelector('#lopdp-estado-contenedor');
        if (contenedorEstado) contenedorEstado.innerHTML = estadoHtml();
        const botonSubir = dialogo.querySelector('#lopdp-subir');
        if (botonSubir && actual.consentimientoEvidencia) {
          botonSubir.textContent = 'Reemplazar evidencia';
        }
        await onCambio?.(actual);
      },
    });
  });

  return dialogo;
}
