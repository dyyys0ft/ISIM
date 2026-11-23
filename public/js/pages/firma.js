import { api } from '../api.js';
import { $, fmtFecha, setBusy, toast } from '../ui.js';
import { SignaturePad } from '../components/signature-pad.js';
import { decorarHoja } from '../components/hoja.js';

const token = new URLSearchParams(location.search).get('t');

const estado = {
  info: null,
  pad: null,
  socket: null,
  enviando: false,
  firmado: false,
  confirmado: false,
  cancelado: false,
  canceladoPorPaciente: false,
  vigencia: null,
  reintentos: 0,
  timeoutEnvio: null,
};

function mostrarResultado(titulo, texto, tipo = 'ok') {
  $('#confirmacion').hidden = true;
  $('#sign-ui').hidden = true;
  $('#estado-badge').textContent =
    tipo === 'error' ? 'Enlace no disponible' : 'Documento firmado';
  $('#estado-badge').className = `badge badge--${tipo === 'error' ? 'anulada' : 'firmada'}`;

  const resultado = $('#resultado');
  resultado.hidden = false;
  $('#res-icono').textContent = tipo === 'error' ? '!' : '✓';
  $('#res-titulo').textContent = titulo;
  $('#res-texto').textContent = texto;
  $('#res-cerrar').hidden = tipo !== 'ok';
}

function actualizarBoton() {
  const listo =
    estado.pad && !estado.pad.isEmpty() && $('#acepto').checked && !estado.enviando && !estado.firmado;
  $('#btn-firmar').disabled = !listo;
}

function iniciarPad() {
  estado.pad = new SignaturePad($('#firma'), {
    onChange: () => {
      $('#pad-wrap').classList.toggle('has-ink', !estado.pad.isEmpty());
      actualizarBoton();
    },
  });
}

function conectar() {
  const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${protocolo}://${location.host}/ws/firma?t=${encodeURIComponent(token)}&role=signer`
  );
  estado.socket = socket;

  socket.addEventListener('open', () => {
    estado.reintentos = 0;
    $('#mensaje').textContent = 'Pantalla conectada. Puedes firmar.';
  });

  socket.addEventListener('message', (evento) => {
    let mensaje;
    try {
      mensaje = JSON.parse(evento.data);
    } catch {
      return;
    }

    if (mensaje.type === 'signed') {
      estado.firmado = true;
      estado.enviando = false;
      clearTimeout(estado.timeoutEnvio);
      clearInterval(estado.vigencia);
      estado.pad?.setEnabled(false);
      mostrarCodigoFirma();
      mostrarResultado(
        'Firma registrada',
        `Documento firmado el ${fmtFecha(mensaje.firmadoEn, { time: true })}.`
      );
      $('#res-cerrar').hidden = true;
      $('#pregunta-impresion').hidden = false;
      $('#mensaje-impresion').hidden = true;
      return;
    }

    if (mensaje.type === 'cancelled') {
      estado.cancelado = true;
      clearInterval(estado.vigencia);

      if (estado.canceladoPorPaciente) {
        mostrarResultado(
          'Datos no confirmados',
          'La sesión fue cancelada. Pide un código nuevo en recepción.',
          'error'
        );
        $('#res-cerrar').hidden = false;
      } else {
        mostrarResultado(
          'Firma cancelada',
          'El operador canceló esta firma. Solicita un enlace nuevo.',
          'error'
        );
      }
      return;
    }

    if (mensaje.type === 'error') {
      estado.enviando = false;
      clearTimeout(estado.timeoutEnvio);
      setBusy($('#btn-firmar'), false);
      actualizarBoton();
      $('#mensaje').textContent = mensaje.message;
      toast(mensaje.message, 'error');
    }
  });

  socket.addEventListener('close', () => {
    if (estado.firmado || estado.cancelado) return;
    if (estado.socket !== socket) return;
    estado.socket = null;

    if (estado.reintentos < 8) {
      estado.reintentos += 1;
      $('#mensaje').textContent = 'Conexión interrumpida. Reconectando…';
      setTimeout(conectar, Math.min(1200 * estado.reintentos, 4000));
    } else {
      $('#mensaje').textContent = 'No se pudo reconectar. Recarga la página o pide un enlace nuevo.';
    }
  });
}

function iniciarVigencia(expiraEn) {
  const fin = new Date(expiraEn).getTime();

  const actualizar = () => {
    const restante = fin - Date.now();

    if (restante <= 0) {
      clearInterval(estado.vigencia);
      $('#vigencia').textContent = 'Enlace expirado';
      $('#conf-vigencia').textContent = 'Enlace expirado';
      $('#btn-firmar').disabled = true;
      if (!estado.firmado) {
        mostrarResultado(
          'Enlace expirado',
          'El tiempo para firmar terminó. Pide al operador que genere un enlace nuevo.',
          'error'
        );
      }
      return;
    }

    const minutos = Math.floor(restante / 60000);
    const segundos = Math.floor((restante % 60000) / 1000);
    const textoVigencia = `Vigencia del enlace: ${minutos}:${String(segundos).padStart(2, '0')}`;
    $('#vigencia').textContent = textoVigencia;
    $('#conf-vigencia').textContent = textoVigencia;
  };

  actualizar();
  estado.vigencia = setInterval(actualizar, 1000);
}

function confirmarDatos() {
  if (estado.confirmado || estado.firmado || estado.cancelado) return;

  if (estado.info && new Date(estado.info.expiraEn).getTime() <= Date.now()) {
    mostrarResultado(
      'Enlace expirado',
      'El tiempo para firmar terminó. Pide al operador que genere un enlace nuevo.',
      'error'
    );
    return;
  }

  estado.confirmado = true;
  $('#confirmacion').hidden = true;
  $('#sign-ui').hidden = false;
  $('#estado-badge').textContent = 'Firma pendiente';

  if (!estado.pad) iniciarPad();
  actualizarBoton();
}

async function rechazarDatos() {
  if (estado.confirmado || estado.firmado || estado.cancelado) return;

  estado.cancelado = true;
  estado.canceladoPorPaciente = true;
  clearInterval(estado.vigencia);

  if (estado.socket && estado.socket.readyState === WebSocket.OPEN) {
    estado.socket.send(JSON.stringify({ type: 'cancel' }));
  } else {
    try {
      await api.post(`/api/sign-sessions/${encodeURIComponent(token)}/cancel`);
    } catch {
      // La sesión pudo expirar; de todos modos mostramos el mensaje.
    }
  }

  mostrarResultado(
    'Datos no confirmados',
    'La sesión fue cancelada. Pide un código nuevo en recepción.',
    'error'
  );
  $('#res-cerrar').hidden = false;
}

function enviarFirma() {
  if (!estado.confirmado || estado.enviando || estado.firmado) return;
  if (!estado.pad || estado.pad.isEmpty()) return toast('Firma primero en el recuadro', 'error');
  if (!$('#acepto').checked) return toast('Marca la declaración de consentimiento', 'error');

  if (!estado.socket || estado.socket.readyState !== WebSocket.OPEN) {
    return toast('Sin conexión con el sistema. Espera unos segundos.', 'error');
  }

  const imagen = estado.pad.toDataURL();
  if (!imagen) return toast('La firma está vacía', 'error');

  estado.enviando = true;
  setBusy($('#btn-firmar'), true, 'Guardando firma…');
  $('#mensaje').textContent = 'Guardando la firma…';

  estado.socket.send(JSON.stringify({ type: 'submit', image: imagen }));

  estado.timeoutEnvio = setTimeout(() => {
    if (!estado.enviando) return;
    estado.enviando = false;
    setBusy($('#btn-firmar'), false);
    actualizarBoton();
    $('#mensaje').textContent = 'No se recibió confirmación del servidor.';
    toast('No se recibió confirmación. Intenta nuevamente.', 'error');
  }, 20000);
}

function mostrarCodigoFirma() {
  if (!estado.info) return;
  $('#codigo-firma-codigo').textContent = estado.info.codigo
    ? `Código: ${estado.info.codigo}`
    : '';
  $('#codigo-firma-titulo').textContent = estado.info.titulo || '';
  $('#codigo-firma').hidden = false;
}

async function registrarDecisionCopia(solicitada) {
  if (estado.socket && estado.socket.readyState === WebSocket.OPEN) {
    estado.socket.send(JSON.stringify({ type: 'copia', solicitada }));
    return;
  }

  try {
    await api.post(`/api/sign-sessions/${encodeURIComponent(token)}/copia`, { solicitada });
  } catch (error) {
    toast(error.message, 'error');
  }
}

function conectarEventos() {
  $('#btn-confirmar-datos').addEventListener('click', confirmarDatos);
  $('#btn-rechazar-datos').addEventListener('click', rechazarDatos);
  $('#acepto').addEventListener('change', actualizarBoton);
  $('#btn-firmar').addEventListener('click', enviarFirma);
  $('#limpiar').addEventListener('click', () => estado.pad?.clear());
  $('#deshacer').addEventListener('click', () => estado.pad?.undo());
  $('#res-cerrar').addEventListener('click', () => window.close());

  $('#btn-si-imprimir').addEventListener('click', async () => {
    await registrarDecisionCopia(true);
    const identificacion = [estado.info?.codigo, estado.info?.titulo].filter(Boolean).join(' · ');
    $('#pregunta-impresion').hidden = true;
    $('#mensaje-impresion').hidden = false;
    $('#mensaje-impresion').textContent = `Pregunta en recepción por la copia de tu consentimiento${
      identificacion ? ` — ${identificacion}` : ''
    }. No lo recibas si no tiene el sello puesto.`;
    $('#res-texto').textContent = '';
    $('#res-cerrar').hidden = false;
  });

  $('#btn-no-imprimir').addEventListener('click', async () => {
    await registrarDecisionCopia(false);
    $('#pregunta-impresion').hidden = true;
    $('#mensaje-impresion').hidden = true;
    $('#res-texto').textContent = 'Puede cerrar esta ventana.';
    $('#res-cerrar').hidden = false;
  });
}

async function init() {
  conectarEventos();

  if (!token) {
    mostrarResultado(
      'Enlace no válido',
      'Esta página debe abrirse desde el enlace generado por el sistema.',
      'error'
    );
    return;
  }

  try {
    const info = await api.get(`/api/sign-sessions/${encodeURIComponent(token)}`);

    if (info.estado !== 'abierta') {
      if (info.estado === 'completada') {
        mostrarResultado('Documento ya firmado', 'Esta firma ya fue registrada correctamente.');
      } else if (info.estado === 'expirada') {
        mostrarResultado('Enlace expirado', 'Pide al operador que genere un enlace nuevo.', 'error');
      } else {
        mostrarResultado('Enlace cancelado', 'Esta firma fue cancelada por el operador.', 'error');
      }
      return;
    }

    estado.info = info;
    $('#titulo').textContent = info.titulo;
    $('#paciente').textContent = `${info.paciente.nombre} · C.I. ${info.paciente.cedula}${
      info.paciente.es_menor ? ` · ${info.paciente.edad} años (menor de edad)` : ''
    }`;

    // Confirmación de datos antes de habilitar la firma (especialmente tras escanear el QR).
    $('#conf-paciente').textContent = info.paciente.nombre;
    $('#conf-cedula').textContent = info.paciente.cedula;
    $('#conf-titulo').textContent = info.titulo;
    $('#conf-codigo').textContent = info.codigo || '—';
    $('#estado-badge').textContent = 'Confirma tus datos';

    if (info.firmante) {
      $('#titulo-firma').textContent = 'Firma del representante legal';
      $('#firmante-info').textContent = `Representante legal: ${info.firmante.nombre} · C.I. ${info.firmante.cedula}`;
      $('#firmante-info').hidden = false;
      $('#aviso-representante').textContent =
        'El paciente es menor de edad: el consentimiento lo firma su representante legal.';
      $('#aviso-representante').hidden = false;

      $('#conf-representante').textContent = `${info.firmante.nombre} · C.I. ${info.firmante.cedula}`;
      $('#conf-representante-fila').hidden = false;
    }

    $('#contenido').innerHTML = info.contenidoHtml;
    decorarHoja($('#contenido'), {
      logoUrl: info.logoUrl,
      centro: info.centro,
      pieTexto: info.pieTexto,
      codigo: info.codigo,
      titulo: info.titulo,
      paciente: info.paciente,
      firmante: info.firmante,
      medico: info.medico,
      firmaPacienteUrl: null,
      firmaModo: info.firmaModo,
    });

    $('#confirmacion').hidden = false;
    iniciarVigencia(info.expiraEn);
    conectar();
  } catch (error) {
    mostrarResultado('Enlace no válido', error.message, 'error');
  }
}

init();
