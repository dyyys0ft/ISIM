import { api } from '../api.js';
import { $, escapeHtml, fmtFecha, toast } from '../ui.js';

const id = new URLSearchParams(location.search).get('id');
const contenedor = $('#consentimiento-doc');

function dato(valor, vacio = '—') {
  const texto = String(valor ?? '').trim();
  return escapeHtml(texto || vacio);
}

function render(paciente) {
  const nombre = `${paciente.apellidos || ''} ${paciente.nombres || ''}`.trim();
  const edad = paciente.edad != null ? `${paciente.edad} años` : 'No registrada';
  const fechaConsentimiento = paciente.consentimiento_datos
    ? String(paciente.consentimiento_datos)
    : 'Pendiente de registro al firmar';
  const evidencia = paciente.consentimientoEvidencia;

  contenedor.innerHTML = `
    <header class="hoja-impresion__head">
      <img src="${escapeHtml(paciente.logoUrl || '/img/isim-logo.png')}" alt="ISIM" />
      <div class="hoja-impresion__centro">
        <h1>CONSENTIMIENTO DE TRATAMIENTO DE DATOS PERSONALES</h1>
        <strong>ISIM · Instituto de la Salud Integral de la Mujer</strong>
        <span>Ley Orgánica de Protección de Datos Personales (LOPDP)</span>
      </div>
      <div class="hoja-impresion__num">${escapeHtml(fmtFecha(new Date()))}</div>
    </header>

    <p style="text-align:justify;margin:10px 0 14px">
      Yo, <strong>${escapeHtml(nombre)}</strong>, con documento de identidad
      <strong>${dato(paciente.cedula)}</strong>, autorizo a ISIM · Instituto de la Salud
      Integral de la Mujer el tratamiento de mis datos personales para la atención médica,
      la gestión de mi historia clínica, el agendamiento de citas y las comunicaciones
      relacionadas con mi atención.
    </p>

    <h2 style="font-size:12px;color:#284f8c;border-bottom:1px solid #d8deea;padding-bottom:4px">
      Datos de la paciente
    </h2>
    <div class="hoja-impresion__grid" style="margin-top:10px">
      <div class="hoja-impresion__span2"><span>Apellidos y nombres</span><strong>${escapeHtml(nombre)}</strong></div>
      <div><span>Cédula</span><strong>${dato(paciente.cedula)}</strong></div>
      <div><span>Edad</span><strong>${escapeHtml(edad)}</strong></div>
      <div><span>Fecha de nacimiento</span><strong>${escapeHtml(fmtFecha(paciente.fecha_nacimiento) || '—')}</strong></div>
      <div><span>Sexo</span><strong>${dato({ F: 'Femenino', M: 'Masculino', X: 'Otro' }[paciente.sexo])}</strong></div>
      <div><span>Teléfono</span><strong>${dato(paciente.telefono)}</strong></div>
      <div><span>Correo electrónico</span><strong>${dato(paciente.email)}</strong></div>
      <div class="hoja-impresion__span2"><span>Dirección</span><strong>${dato(paciente.direccion)}</strong></div>
      <div><span>Ciudad</span><strong>${dato(paciente.ciudad)}</strong></div>
      <div><span>Ocupación</span><strong>${dato(paciente.ocupacion)}</strong></div>
      <div><span>Estado civil</span><strong>${dato(paciente.estado_civil)}</strong></div>
      <div><span>N.º de historia clínica</span><strong>${dato(paciente.hc_numero || paciente.cedula)}</strong></div>
    </div>

    <div class="hoja-impresion__nota" style="font-size:10px">
      <strong>Registro del consentimiento:</strong> ${escapeHtml(fechaConsentimiento)}.
      La paciente o su representante legal declara haber leído y comprendido esta autorización.
      Puede ejercer sus derechos de acceso, rectificación, eliminación, oposición y portabilidad
      ante la institución.
    </div>

    ${
      evidencia
        ? `<p class="small" style="margin:6px 0 0;color:#444">
             Evidencia firmada cargada: <strong>${escapeHtml(evidencia.nombre)}</strong>
             ${evidencia.subidoEn ? ` · ${escapeHtml(evidencia.subidoEn)}` : ''}
           </p>`
        : ''
    }

    <div class="hoja-impresion__firmas">
      <div class="hoja-impresion__firma">
        <span class="hoja-impresion__linea"></span>
        <strong>${escapeHtml(nombre)}</strong>
        <span>C.I. ${dato(paciente.cedula)}</span>
        <span>Firma de la paciente o representante legal</span>
      </div>
      <div class="hoja-impresion__firma">
        <span class="hoja-impresion__linea"></span>
        <strong>Profesional responsable</strong>
        <span>Firma y sello</span>
      </div>
    </div>

    <div class="hoja-impresion__pie">
      Documento generado por ISIM. Conservar como evidencia del consentimiento de tratamiento de datos.
    </div>`;
  document.title = `ISIM — Consentimiento de ${nombre}`;
}

async function cargar() {
  if (!id) {
    contenedor.innerHTML = '<div class="empty"><p>No se indicó la paciente.</p></div>';
    return;
  }
  try {
    const paciente = await api.get(`/api/patients/${encodeURIComponent(id)}`);
    render(paciente);
  } catch (error) {
    contenedor.innerHTML = `<div class="empty"><p><strong>${escapeHtml(error.message)}</strong></p></div>`;
    toast(error.message, 'error');
  }
}

$('#btn-imprimir')?.addEventListener('click', () => window.print());
$('#btn-volver')?.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = '/pacientes.html';
});

cargar();
