export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let modalSeq = 0;

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fmtFecha(iso, { time = false, weekday = false } = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-EC', {
    ...(weekday ? { weekday: 'long' } : {}),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function initials(nombre) {
  const parts = String(nombre || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

const ETIQUETAS_ESTADO = {
  borrador: 'Borrador',
  pendiente_firma: 'Pendiente de firma',
  firmado: 'Firmado',
  firmada: 'Firmada',
  anulado: 'Anulado',
  anulada: 'Anulada',
};

export function etiquetaEstado(estado) {
  return ETIQUETAS_ESTADO[estado] || estado || '—';
}

export function badge(estado) {
  const seguro = escapeHtml(estado);
  return `<span class="badge badge--${seguro}">${escapeHtml(etiquetaEstado(estado))}</span>`;
}

const ETIQUETAS_ROL = {
  admin: 'Administrador',
  medico: 'Médico',
  operador: 'Secretario/a',
  enfermero: 'Enfermero',
  lectura: 'Solo lectura',
};

export function registrarRoles(roles) {
  if (!Array.isArray(roles)) return;
  for (const rol of roles) {
    if (rol?.slug && rol?.nombre) ETIQUETAS_ROL[rol.slug] = rol.nombre;
  }
}

export function etiquetaRol(rol) {
  return ETIQUETAS_ROL[rol] || rol || '';
}

let toastBox = null;

function getToastBox() {
  if (!toastBox) {
    toastBox = document.createElement('div');
    toastBox.className = 'toasts';
    toastBox.setAttribute('role', 'status');
    toastBox.setAttribute('aria-live', 'polite');
    // La capa superior (popover) mantiene los avisos por encima de los
    // diálogos modales y evita que desaparezcan al cerrarlos.
    toastBox.setAttribute('popover', 'manual');
    document.body.append(toastBox);
  }

  if (typeof toastBox.showPopover === 'function' && !toastBox.matches(':popover-open')) {
    try {
      toastBox.showPopover();
    } catch {
      // Si el navegador no lo permite, queda como contenedor fijo normal.
    }
  }

  return toastBox;
}

export function toast(mensaje, tipo = 'info', ms = 4500) {
  const box = getToastBox();
  const element = document.createElement('div');
  element.className = `toast${tipo === 'error' ? ' toast--error' : tipo === 'success' ? ' toast--success' : ''}`;
  element.textContent = mensaje;
  element.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  element.setAttribute('aria-live', tipo === 'error' ? 'assertive' : 'polite');
  element.title = 'Clic para cerrar';
  element.addEventListener('click', () => element.remove());
  box.append(element);

  const duracion = tipo === 'error' ? 8000 : tipo === 'success' ? 3500 : ms;
  setTimeout(() => {
    element.style.opacity = '0';
    element.style.transition = 'opacity .2s';
    setTimeout(() => element.remove(), 220);
  }, duracion);
}

/**
 * Abre un diálogo modal con la estética del sistema.
 * Devuelve el elemento <dialog> ya montado y abierto.
 */
export function modal(titulo, cuerpoHtml = '', pieHtml = '', { ancho = false } = {}) {
  const dialogo = document.createElement('dialog');
  const tituloId = `modal-titulo-${++modalSeq}`;
  dialogo.className = `modal${ancho ? ' modal--ancho' : ''}`;
  dialogo.setAttribute('aria-labelledby', tituloId);
  dialogo.innerHTML = `
    <div class="modal__caja">
      <div class="modal__cabecera">
        <h2 id="${tituloId}">${escapeHtml(titulo)}</h2>
        <button class="modal__cerrar" type="button" data-cerrar-modal aria-label="Cerrar">✕</button>
      </div>
      <div class="modal__cuerpo">${cuerpoHtml}</div>
      ${pieHtml ? `<div class="modal__pie">${pieHtml}</div>` : ''}
    </div>`;

  const cerrar = () => {
    if (!dialogo.isConnected) return;
    dialogo.close();
    dialogo.remove();
  };

  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo || evento.target.closest('[data-cerrar-modal]')) {
      evento.preventDefault();
      cerrar();
    }
  });
  dialogo.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    cerrar();
  });

  document.body.append(dialogo);
  dialogo.showModal();

  const inicial =
    dialogo.querySelector('[autofocus]') ||
    dialogo.querySelector('input, select, textarea') ||
    dialogo.querySelector('.modal__pie .btn.pri, .modal__pie .btn--primary') ||
    dialogo.querySelector('[data-cerrar-modal]');
  inicial?.focus?.();

  return dialogo;
}

/**
 * Pide confirmación con un diálogo. Devuelve una promesa que resuelve a
 * true si la persona acepta y a false si cancela o cierra.
 */
export function confirmar(
  mensaje,
  { titulo = 'Confirmar', textoAceptar = 'Aceptar', peligro = false } = {}
) {
  return new Promise((resolve) => {
    let respondido = false;
    const dialogo = modal(
      titulo,
      `<p>${escapeHtml(mensaje)}</p>`,
      `<button class="btn" type="button" data-cancelar>Cancelar</button>
       <button class="btn ${peligro ? 'danger' : 'pri'}" type="button" data-aceptar>${escapeHtml(
        textoAceptar
      )}</button>`
    );

    const responder = (valor) => {
      if (respondido) return;
      respondido = true;
      resolve(valor);
      if (dialogo.isConnected) {
        dialogo.close();
        dialogo.remove();
      }
    };

    dialogo.querySelector('[data-aceptar]')?.addEventListener('click', () => responder(true));
    dialogo.querySelector('[data-cancelar]')?.addEventListener('click', () => responder(false));
    dialogo.addEventListener('close', () => responder(false));
  });
}

// Resalta los campos que el navegador detecta como obligatorios o inválidos
// al enviar un formulario, para que se vea de inmediato qué falta completar.
if (typeof document !== 'undefined') {
  document.addEventListener(
    'invalid',
    (evento) => {
      const campo = evento.target;
      if (!(campo instanceof HTMLElement)) return;
      campo.classList.add('campo-invalido');
      campo.closest('.field')?.classList.add('field--invalido');
    },
    true
  );

  const limpiarCampo = (evento) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLElement)) return;
    if (!campo.classList.contains('campo-invalido')) return;
    if (campo.checkValidity()) {
      campo.classList.remove('campo-invalido');
      campo.closest('.field')?.classList.remove('field--invalido');
    }
  };
  document.addEventListener('input', limpiarCampo, true);
  document.addEventListener('change', limpiarCampo, true);

  // Sincroniza aria-invalid con el estado visual :user-invalid. La guía
  // accessible-error-announcement exige que el estado programático y el visual
  // cambien en el mismo momento; si no, los lectores de pantalla anuncian
  // "entrada no válida" antes de que la persona haya interactuado.
  const marcadosAria = new WeakSet();
  const interactuados = new WeakSet();
  const soportaUserInvalid =
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      ? CSS.supports('selector(:user-invalid)')
      : false;

  const sincronizarAria = (campo) => {
    if (!(campo instanceof HTMLElement) || !campo.matches('input, select, textarea')) return;
    // Fallback para navegadores sin :user-invalid (Chrome < 119): solo se
    // marca inválido después de que la persona interactuó con el campo.
    const invalido = soportaUserInvalid
      ? campo.matches(':user-invalid')
      : interactuados.has(campo) && !campo.validity.valid;

    if (invalido) {
      campo.setAttribute('aria-invalid', 'true');
      marcadosAria.add(campo);
    } else if (marcadosAria.has(campo) || campo.getAttribute('aria-invalid') !== 'true') {
      campo.setAttribute('aria-invalid', 'false');
      marcadosAria.delete(campo);
    }
  };
  const marcarInteraccion = (evento) => {
    if (evento.target instanceof HTMLElement) interactuados.add(evento.target);
  };

  document.querySelectorAll('input, select, textarea').forEach(sincronizarAria);
  document.addEventListener(
    'focusin',
    (evento) => {
      const campo = evento.target;
      if (
        campo instanceof HTMLElement &&
        campo.matches('input, select, textarea') &&
        !campo.hasAttribute('aria-invalid')
      ) {
        campo.setAttribute('aria-invalid', 'false');
      }
    },
    true
  );
  document.addEventListener(
    'blur',
    (evento) => {
      marcarInteraccion(evento);
      sincronizarAria(evento.target);
    },
    true
  );
  document.addEventListener(
    'change',
    (evento) => {
      marcarInteraccion(evento);
      sincronizarAria(evento.target);
    },
    true
  );
  document.addEventListener(
    'invalid',
    (evento) => {
      marcarInteraccion(evento);
      sincronizarAria(evento.target);
    },
    true
  );
  document.addEventListener('input', (evento) => {
    if (evento.target instanceof HTMLElement && evento.target.hasAttribute?.('aria-invalid')) {
      sincronizarAria(evento.target);
    }
  });
  document.addEventListener(
    'reset',
    (evento) => {
      setTimeout(() => {
        for (const campo of evento.target.elements || []) sincronizarAria(campo);
      }, 0);
    },
    true
  );
}

export function setBusy(button, busy, texto = 'Procesando…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${escapeHtml(texto)}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

let cargadorGlobal = null;

/**
 * Muestra un cargador de pantalla completa con un logo médico animado.
 * Úsalo para operaciones que pueden tardar (subidas, migraciones, etc.).
 */
export function mostrarCargador(titulo = 'Procesando…', detalle = '') {
  if (!cargadorGlobal) {
    cargadorGlobal = document.createElement('div');
    cargadorGlobal.className = 'app-loader';
    cargadorGlobal.setAttribute('role', 'status');
    cargadorGlobal.setAttribute('aria-live', 'assertive');
    cargadorGlobal.innerHTML = `
      <div class="app-loader__card">
        <div class="app-loader__logo" aria-hidden="true">
          <svg viewBox="0 0 64 64" role="img">
            <circle class="app-loader__ring" cx="32" cy="32" r="26"></circle>
            <path class="app-loader__pulse" d="M10 34h9l4-10 7 20 4-10h20"></path>
            <path class="app-loader__cross" d="M32 22v12M26 28h12"></path>
          </svg>
        </div>
        <strong class="app-loader__titulo"></strong>
        <span class="app-loader__detalle"></span>
      </div>`;
    document.body.append(cargadorGlobal);
  }

  cargadorGlobal.querySelector('.app-loader__titulo').textContent = titulo;
  cargadorGlobal.querySelector('.app-loader__detalle').textContent = detalle;
  document.body.setAttribute('aria-busy', 'true');
}

export function ocultarCargador() {
  if (!cargadorGlobal) return;
  cargadorGlobal.remove();
  cargadorGlobal = null;
  document.body.removeAttribute('aria-busy');
}
