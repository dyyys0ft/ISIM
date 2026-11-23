import { api } from '../api.js';
import { $, $$, badge, escapeHtml, fmtFecha, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';
import { decorarHoja } from '../components/hoja.js';
import { alSalir } from '../navegacion.js';

const docId = new URLSearchParams(location.search).get('id');

let qrCargado = null;
function cargarGeneradorQr() {
  if (typeof window.qrcode === 'function') return Promise.resolve();
  if (!qrCargado) {
    qrCargado = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = '/js/vendor/qrcode.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.head.append(script);
    });
  }
  return qrCargado;
}

const estado = {
  usuario: null,
  documento: null,
  version: null,
  socket: null,
  keepalive: null,
  tokenExterno: null,
  consentTipo: null,
};

function versionActual() {
  return estado.documento.versiones.find((v) => v.numero === estado.documento.version_actual);
}

function firmaDeVersion(versionId) {
  return estado.documento.firmas.find((f) => f.version_id === versionId);
}

function renderCabecera() {
  const doc = estado.documento;
  $('#doc-titulo').textContent = doc.titulo;
  $('#doc-badge').innerHTML = badge(doc.estado);
  $('#doc-paciente').textContent = `${doc.paciente.nombres} ${doc.paciente.apellidos} · C.I. ${doc.paciente.cedula}`;
  $('#doc-codigo').textContent = doc.codigo ? `Código: ${doc.codigo}` : '';
  document.title = `${doc.titulo} · ISIM`;
}

function renderVersiones() {
  const contenedor = $('#versiones');
  contenedor.innerHTML = estado.documento.versiones
    .map(
      (version) => `
      <button class="version-btn" type="button" data-version="${version.numero}"
              aria-pressed="${version.numero === estado.version.numero}">
        <span>V${version.numero} · ${escapeHtml(fmtFecha(version.creado_en))}</span>
        ${badge(version.estado)}
      </button>`
    )
    .join('');

  for (const boton of $$('[data-version]', contenedor)) {
    boton.addEventListener('click', () => {
      estado.version = estado.documento.versiones.find(
        (v) => v.numero === Number(boton.dataset.version)
      );
      render();
    });
  }

  const actual = versionActual();
  $('#nota-versiones').textContent = actual
    ? `Versión vigente: V${actual.numero}. Las versiones firmadas son inmutables; al editarlas se crea una nueva versión.`
    : '';
}

function renderHoja() {
  const firma = firmaDeVersion(estado.version.id);
  $('#hoja').innerHTML = estado.version.contenido_html;

  decorarHoja($('#hoja'), {
    logoUrl: estado.documento.logoUrl,
    centro: estado.documento.centro,
    pieTexto: estado.documento.pieTexto,
    codigo: estado.documento.codigo,
    titulo: estado.documento.titulo,
    paciente: estado.documento.paciente,
    firmante: estado.documento.firmante,
    medico: estado.documento.medico,
    firmaPacienteUrl: firma
      ? `/api/signatures/${encodeURIComponent(firma.id)}/image`
      : null,
    firmaModo: estado.documento.firmaModo,
    firmadoEn: firma?.firmado_en || null,
    gestionadoNombre: firma?.gestionado_nombre || null,
    anuladoEn: estado.documento.estado === 'anulado' ? estado.documento.anulado_en : null,
  });

  renderAlertaCopia(firma);
}

// Alerta roja que permanece visible hasta que el operador imprime la copia.
function renderAlertaCopia(firma) {
  const pendiente = Boolean(firma?.copia_solicitada && !firma.copia_entregada);
  $('#alerta-copia').hidden = !pendiente;
}

function renderAcciones() {
  const doc = estado.documento;
  const version = estado.version;
  const esVigente = version.numero === doc.version_actual;
  const firmada = version.estado === 'firmada';
  const anulado = doc.estado === 'anulado';

  const puedeFirmar =
    puede(estado.usuario, 'documentos.firmar') &&
    esVigente &&
    !firmada &&
    !anulado &&
    estado.documento.requiereFirmaPaciente !== false;
  $('#btn-firmar-aqui').hidden = !puedeFirmar;
  $('#btn-firmar-aqui').textContent = `Firmar aquí (V${version.numero})`;
  $('#btn-firmar-externo').hidden = !puedeFirmar;

  const notaModo = $('#nota-firma-modo');
  const soloProfesional = estado.documento.requiereFirmaPaciente === false;
  notaModo.hidden = !soloProfesional;
  notaModo.textContent = soloProfesional
    ? 'La configuración actual usa solo la firma del profesional: este documento no requiere la firma de la paciente.'
    : '';

  $('#btn-editar').hidden = !puede(estado.usuario, 'documentos.editar') || anulado;
  $('#btn-editar').textContent =
    version.estado === 'firmada' ? 'Corregir con nueva versión' : 'Editar documento';

  $('#btn-anular').hidden = !puede(estado.usuario, 'documentos.anular') || anulado;
}

function renderConsentimiento() {
  const doc = estado.documento;
  const eventos = doc.consentEvents || [];
  const ultimo = eventos[0] || null;
  const anulado = doc.estado === 'anulado';
  const firmado = doc.estado === 'firmado';
  const puedeRegistrar =
    puede(estado.usuario, 'documentos.anular') && doc.esConsentimiento && !anulado && !ultimo;

  $('#btn-negativa').hidden = !puedeRegistrar || firmado;
  $('#btn-revocatoria').hidden = !puedeRegistrar || !firmado;

  const alerta = $('#alerta-consent');
  if (ultimo) {
    alerta.hidden = false;
    alerta.innerHTML = `
      <strong>${ultimo.tipo === 'negativa' ? 'NEGATIVA' : 'REVOCATORIA'} REGISTRADA</strong>
      <span>
        ${escapeHtml(fmtFecha(ultimo.creado_en))}
        ${ultimo.usuario_nombre ? ` · ${escapeHtml(ultimo.usuario_nombre)}` : ''}
      </span>
      ${ultimo.motivo ? `<p>${escapeHtml(ultimo.motivo)}</p>` : ''}
    `;
  } else {
    alerta.hidden = true;
    alerta.replaceChildren();
  }

  const panel = $('#consent-eventos');
  const lista = $('#consent-lista');
  if (!doc.esConsentimiento || !eventos.length) {
    panel.hidden = true;
    lista.replaceChildren();
    return;
  }

  panel.hidden = false;
  lista.innerHTML = eventos
    .map(
      (evento) => `
      <article class="consent-evento consent-evento--${evento.tipo}">
        <strong>${evento.tipo === 'negativa' ? 'Negativa' : 'Revocatoria'}</strong>
        <span>${escapeHtml(fmtFecha(evento.creado_en))}</span>
        ${evento.usuario_nombre ? `<span>${escapeHtml(evento.usuario_nombre)}</span>` : ''}
        ${evento.motivo ? `<p>${escapeHtml(evento.motivo)}</p>` : ''}
      </article>`
    )
    .join('');
}

function render() {
  renderCabecera();
  renderVersiones();
  renderHoja();
  renderAcciones();
  renderConsentimiento();
}

async function cargar() {
  estado.documento = await api.get(`/api/documents/${encodeURIComponent(docId)}`);
  const actual = versionActual() || estado.documento.versiones[0];
  estado.version = actual;
  render();
}

async function firmar(modo) {
  const boton = modo === 'externo' ? $('#btn-firmar-externo') : $('#btn-firmar-aqui');

  // En "firmar aquí" abrimos la ventana antes del await para no ser bloqueados.
  const ventana =
    modo === 'aqui'
      ? window.open('', 'firma_consentimiento', 'popup=yes,width=1080,height=860')
      : null;

  setBusy(boton, true, 'Preparando…');

  try {
    const sesion = await api.post(
      `/api/documents/${encodeURIComponent(estado.documento.id)}/sign-session`
    );
    const urlAbsoluta = new URL(sesion.url, location.origin).href;

    if (modo === 'externo') {
      estado.tokenExterno = sesion.token;
      await mostrarQR(sesion);
      toast('QR generado. Esperando que el paciente confirme sus datos…');
    } else if (ventana && !ventana.closed) {
      ventana.location.href = urlAbsoluta;
      ubicarEnSegundoMonitor(ventana);
      ventana.focus();
      toast('Pantalla de firma abierta. Esperando la firma…');
    } else {
      $('#enlace-firma').href = urlAbsoluta;
      $('#enlace-firma').textContent = urlAbsoluta;
      $('#dlg-enlace').showModal();
      toast('El navegador bloqueó la ventana. Abre el enlace manualmente.');
    }

    conectarControl(sesion.token);

    const vigente = versionActual();
    if (vigente) vigente.estado = 'pendiente_firma';
    estado.documento.estado = 'pendiente_firma';
    render();
  } catch (error) {
    if (ventana) ventana.close();
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
    renderAcciones();
  }
}

async function mostrarQR(sesion) {
  const contenedor = $('#qr-contenedor');
  contenedor.replaceChildren();

  await cargarGeneradorQr();

  $('#qr-codigo').textContent = estado.documento.codigo
    ? `Código: ${estado.documento.codigo}`
    : '';
  $('#qr-enlace').href = sesion.urlExterna;
  $('#qr-enlace').textContent = sesion.urlExterna;
  $('#qr-estado').textContent = 'Esperando al paciente…';

  if (sesion.certificadoUrl) {
    $('#qr-certificado').href = sesion.certificadoUrl;
    $('#qr-certificado').textContent = 'instala este certificado';
    $('#qr-certificado-aviso').hidden = false;
  } else {
    $('#qr-certificado-aviso').hidden = true;
  }

  if (typeof window.qrcode !== 'function') {
    contenedor.innerHTML =
      '<p class="muted small">No se pudo cargar el generador de QR. Usa el enlace de abajo.</p>';
  } else {
    const qr = window.qrcode(0, 'M');
    qr.addData(sesion.urlExterna);
    qr.make();
    contenedor.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  }

  $('#dlg-qr').showModal();
}

async function copiarEnlaceQR() {
  const enlace = $('#qr-enlace').href;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(enlace);
    } else {
      const area = document.createElement('textarea');
      area.value = enlace;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast('Enlace copiado', 'success');
  } catch {
    toast('No se pudo copiar el enlace', 'error');
  }
}

async function cancelarEnlaceQR() {
  if (!window.confirm('¿Cancelar este enlace de firma externa?')) return;

  try {
    if (estado.tokenExterno) {
      await api.post(`/api/sign-sessions/${encodeURIComponent(estado.tokenExterno)}/cancel`);
    }
    estado.tokenExterno = null;
    $('#dlg-qr').close();
    toast('Enlace cancelado', 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function ubicarEnSegundoMonitor(ventana) {
  try {
    if (!('getScreenDetails' in window)) return;
    const detalles = await window.getScreenDetails();
    const otra = detalles.screens.find(
      (pantalla) => pantalla !== detalles.currentScreen && pantalla.availWidth > 0
    );
    if (!otra) return;

    const ancho = Math.min(1100, Math.max(520, otra.availWidth - 80));
    const alto = Math.min(900, Math.max(520, otra.availHeight - 80));
    ventana.moveTo(otra.availLeft + 40, otra.availTop + 40);
    ventana.resizeTo(ancho, alto);
  } catch {
    // El navegador puede requerir permiso; el usuario puede arrastrar la ventana.
  }
}

function conectarControl(token) {
  if (estado.socket) estado.socket.close();
  if (estado.keepalive) clearInterval(estado.keepalive);

  const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${protocolo}://${location.host}/ws/firma?t=${encodeURIComponent(token)}&role=controller`
  );
  estado.socket = socket;

  socket.addEventListener('message', async (evento) => {
    let mensaje;
    try {
      mensaje = JSON.parse(evento.data);
    } catch {
      return;
    }

    if (mensaje.type === 'signed') {
      estado.tokenExterno = null;
      toast('Firma registrada. Esperando decisión sobre la copia…', 'success');
      if ($('#dlg-qr').open) {
        $('#qr-estado').textContent = 'Firma registrada correctamente.';
        setTimeout(() => $('#dlg-qr').close(), 1200);
      }
      try {
        await cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
    } else if (mensaje.type === 'copia') {
      toast(
        mensaje.solicitada
          ? 'El paciente desea una copia impresa'
          : 'El paciente no desea copia impresa'
      );
      try {
        await cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
    } else if (mensaje.type === 'cancelled') {
      estado.tokenExterno = null;
      toast('La firma fue cancelada por el paciente', 'error');
      if ($('#dlg-qr').open) $('#dlg-qr').close();
      try {
        await cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
    } else if (mensaje.type === 'error') {
      toast(mensaje.message, 'error');
    } else if (mensaje.type === 'signer-connected') {
      if ($('#dlg-qr').open) $('#qr-estado').textContent = 'Paciente conectado. Confirmando datos…';
      toast('Pantalla de firma conectada');
    } else if (mensaje.type === 'signer-disconnected') {
      if ($('#dlg-qr').open) $('#qr-estado').textContent = 'Paciente desconectado. Esperando…';
    }
  });

  socket.addEventListener('close', () => {
    if (estado.socket === socket) estado.socket = null;
  });

  estado.keepalive = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping' }));
    } else {
      clearInterval(estado.keepalive);
    }
  }, 25000);
}

function abrirEditor() {
  const version = estado.version;
  const firmada = version.estado === 'firmada';

  $('#aviso-edicion').textContent = firmada
    ? 'Esta versión está firmada y no se modificará. Al guardar se creará una nueva versión con el contenido corregido.'
    : 'Los cambios se guardan en la versión vigente mientras no esté firmada.';

  $('#editar-contenido').value = version.contenido_html;
  $('#dlg-editar').showModal();
}

async function guardarVersion(evento) {
  evento.preventDefault();
  const contenidoHtml = $('#editar-contenido').value;
  const boton = $('#btn-guardar');
  setBusy(boton, true, 'Guardando…');

  try {
    const resultado = await api.post(
      `/api/documents/${encodeURIComponent(estado.documento.id)}/versions`,
      { contenidoHtml, hashEsperado: estado.version.hash }
    );
    $('#dlg-editar').close();
    toast(`Versión V${resultado.numero} guardada`, 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
    if (error.status === 409) setTimeout(() => location.reload(), 1800);
  }
}

async function anular() {
  const confirmado = window.confirm(
    '¿Anular este documento? Seguirá apareciendo en la lista con estado Anulado y sus versiones firmadas se conservan.'
  );
  if (!confirmado) return;

  try {
    await api.post(`/api/documents/${encodeURIComponent(estado.documento.id)}/annul`);
    toast('Documento anulado', 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function abrirConsentimiento(tipo) {
  estado.consentTipo = tipo;
  const esNegativa = tipo === 'negativa';

  $('#consent-titulo').textContent = esNegativa
    ? 'Registrar negativa del consentimiento'
    : 'Registrar revocatoria del consentimiento';
  $('#consent-aviso').textContent = esNegativa
    ? 'La paciente o su representante legal rechaza otorgar el consentimiento. El documento quedará anulado y se conservará en el historial.'
    : 'La paciente o su representante legal revoca un consentimiento ya firmado. El documento quedará anulado y la versión firmada se conservará.';
  $('#btn-guardar-consent').textContent = esNegativa
    ? 'Registrar negativa'
    : 'Registrar revocatoria';
  $('#consent-motivo').value = '';
  $('#dlg-consent').showModal();
}

async function guardarConsentimiento(evento) {
  evento.preventDefault();
  const tipo = estado.consentTipo;
  if (!tipo) return;

  const boton = $('#btn-guardar-consent');
  setBusy(boton, true, 'Registrando…');
  try {
    await api.post(`/api/documents/${encodeURIComponent(estado.documento.id)}/consent-event`, {
      tipo,
      motivo: $('#consent-motivo').value.trim(),
    });
    $('#dlg-consent').close();
    toast(
      tipo === 'negativa' ? 'Negativa registrada' : 'Revocatoria registrada',
      'success'
    );
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function imprimir() {
  const firma = firmaDeVersion(estado.version.id);

  if (
    firma?.copia_solicitada &&
    !firma.copia_entregada &&
    puede(estado.usuario, 'documentos.editar')
  ) {
    try {
      await api.post(`/api/documents/${encodeURIComponent(estado.documento.id)}/copia`, {
        versionId: firma.version_id,
        entregada: true,
      });
      firma.copia_entregada = 1;
      renderAlertaCopia(firma);
      toast('Copia impresa registrada', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  window.print();
}

function conectarEventos() {
  $('#btn-firmar-aqui').addEventListener('click', () => firmar('aqui'));
  $('#btn-firmar-externo').addEventListener('click', () => firmar('externo'));
  $('#btn-editar').addEventListener('click', abrirEditor);
  $('#btn-anular').addEventListener('click', anular);
  $('#btn-negativa').addEventListener('click', () => abrirConsentimiento('negativa'));
  $('#btn-revocatoria').addEventListener('click', () => abrirConsentimiento('revocatoria'));
  $('#form-consent').addEventListener('submit', guardarConsentimiento);
  $('#btn-imprimir').addEventListener('click', imprimir);
  $('#form-editar').addEventListener('submit', guardarVersion);

  $('#btn-copiar-enlace').addEventListener('click', copiarEnlaceQR);
  $('#btn-cancelar-enlace').addEventListener('click', cancelarEnlaceQR);
  $('#btn-cerrar-qr').addEventListener('click', () => $('#dlg-qr').close());
  $$('[data-cerrar-qr]').forEach((boton) =>
    boton.addEventListener('click', () => $('#dlg-qr').close())
  );

  $$('[data-cerrar]').forEach((boton) =>
    boton.addEventListener('click', () => boton.closest('dialog').close())
  );

  alSalir(() => {
    try {
      estado.socket?.close();
    } catch {
      // el socket pudo haberse cerrado antes
    }
    clearInterval(estado.keepalive);
  });
}

async function init() {
  if (!docId) {
    window.location.replace('/documentos.html');
    return;
  }

  const usuario = await initChrome({ active: 'documentos' });
  if (!usuario) return;

  estado.usuario = usuario;
  conectarEventos();

  try {
    await cargar();
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
    $('#doc-titulo').textContent = 'Documento no disponible';
  }
}

init();
