const INTERVALO_MS = 60_000;

let referencia = null;
let intervalo = null;
let banner = null;
let reintento = null;

function pintar(datos) {
  for (const elemento of document.querySelectorAll('[data-app-version]')) {
    elemento.textContent = `v${datos.version}`;
    elemento.setAttribute(
      'title',
      `Versión ${datos.version} · compilación ${datos.buildId || '—'}`
    );
  }
  for (const elemento of document.querySelectorAll('[data-app-build]')) {
    elemento.textContent = String(datos.buildId || '—').slice(0, 12);
  }
}

function puedeRecargar() {
  if (document.body.classList.contains('is-navigating')) return false;
  if (document.querySelector('dialog[open]')) return false;
  const activo = document.activeElement;
  return !activo || !['INPUT', 'TEXTAREA', 'SELECT'].includes(activo.tagName);
}

function quitarBanner() {
  if (reintento) {
    clearInterval(reintento);
    reintento = null;
  }
  banner?.remove();
  banner = null;
}

function crearBanner(datos) {
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = 'banner-actualizacion';
  banner.className = 'update-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = `
    <span class="update-banner__text">Nueva versión <strong>v${datos.version}</strong> disponible.</span>
    <button class="btn btn--sm btn--primary" type="button" data-actualizar>Actualizar ahora</button>
    <button class="btn btn--sm btn--ghost" type="button" data-descartar aria-label="Cerrar aviso">✕</button>
  `;

  banner.querySelector('[data-actualizar]').addEventListener('click', () => window.location.reload());
  banner.querySelector('[data-descartar]').addEventListener('click', quitarBanner);
  document.body.append(banner);
  return banner;
}

function avisar(datos, { cambioVersion = true } = {}) {
  const aviso = crearBanner(datos);
  const texto = aviso.querySelector('.update-banner__text');
  const automatico = datos.actualizacionesAutomaticas === true;
  const etiqueta = cambioVersion
    ? `Nueva versión v${datos.version} disponible.`
    : 'Nueva actualización del sistema disponible.';

  aviso.classList.toggle('update-banner--auto', automatico);

  if (!automatico) {
    texto.textContent = etiqueta;
    return;
  }

  const aplicar = () => {
    if (!banner) return;
    if (puedeRecargar()) {
      window.location.reload();
      return;
    }
    texto.textContent =
      'Nueva actualización disponible. Guarda tu trabajo: se aplicará al cerrar el cuadro o salir del campo.';
  };

  texto.textContent = `${etiqueta} Actualizando…`;
  setTimeout(aplicar, 3000);
  reintento = setInterval(aplicar, 10_000);
}

async function consultar() {
  let datos;
  try {
    const respuesta = await fetch('/api/version', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'x-version-check': '1' },
    });
    if (!respuesta.ok) return null;
    datos = await respuesta.json();
  } catch {
    return null;
  }

  if (!datos?.version) return null;
  pintar(datos);

  if (!referencia) {
    referencia = { version: datos.version, buildId: datos.buildId };
    return datos;
  }

  const cambioVersion = datos.version !== referencia.version;
  const cambio = cambioVersion || datos.buildId !== referencia.buildId;
  if (cambio) {
    referencia = { version: datos.version, buildId: datos.buildId };
    avisar(datos, { cambioVersion });
  }

  return datos;
}

/**
 * Muestra la versión en los elementos [data-app-version] y vigila si hay una
 * versión nueva. Con actualizaciones automáticas activas recarga la pantalla;
 * si están desactivadas solo muestra el aviso.
 */
export function iniciarVersion() {
  if (!intervalo) {
    intervalo = setInterval(consultar, INTERVALO_MS);
    window.addEventListener('focus', consultar);
    window.addEventListener('online', consultar);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) consultar();
    });
  }
  return consultar();
}

/** Comprueba inmediatamente y devuelve la versión actual del servidor. */
export function comprobarVersion() {
  return consultar();
}

export function versionMostrada() {
  return referencia;
}
