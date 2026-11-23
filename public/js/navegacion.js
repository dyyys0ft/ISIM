import { toast } from './ui.js';

const limpiezas = [];
let instalada = false;
let rutaActual = location.pathname + location.search;
let peticionActual = 0;
let generacion = 0;
let posiciones = new Map();

/** Identificador de la página que está activa; cambia con cada navegación. */
export function generacionPagina() {
  return generacion;
}

/**
 * Registra una función que se ejecuta antes de abandonar la página actual.
 * Sirve para limpiar intervalos, sockets y listeners globales.
 */
export function alSalir(fn) {
  if (typeof fn === 'function') limpiezas.push(fn);
}

function ejecutarLimpieza() {
  while (limpiezas.length) {
    const fn = limpiezas.pop();
    try {
      fn();
    } catch (error) {
      console.error('[navegacion] Error al limpiar la página:', error);
    }
  }
}

function esEnlaceNavegable(enlace) {
  if (!enlace || enlace.target === '_blank' || enlace.hasAttribute('download')) return false;
  if (enlace.origin !== location.origin) return false;
  return enlace.protocol === 'http:' || enlace.protocol === 'https:';
}

function rutaDe(url) {
  return `${url.pathname}${url.search}`;
}

async function navegar(destino, { push = true } = {}) {
  const url = new URL(destino, location.href);
  const token = ++peticionActual;
  generacion += 1;

  posiciones.set(rutaActual, window.scrollY);
  document.body.classList.add('is-navigating');

  try {
    const respuesta = await fetch(url.href, {
      credentials: 'same-origin',
      headers: { 'x-navegacion': 'parcial' },
    });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

    const html = await respuesta.text();
    if (token !== peticionActual) return;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nuevoHeader =
      doc.querySelector('body > .app-header') || doc.querySelector('body > .top');
    const nuevoMain = doc.querySelector('main');

    // Si la respuesta no es una página de la aplicación (por ejemplo, el
    // acceso por falta de sesión), se hace una navegación normal.
    if (!nuevoHeader || !nuevoMain) {
      window.location.href = url.href;
      return;
    }

    ejecutarLimpieza();

    const header =
      document.querySelector('body > .top') ||
      document.querySelector('body > .app-header');
    for (const nodo of [...document.body.children]) {
      if (nodo !== header) nodo.remove();
    }

    for (const nodo of [...doc.body.children]) {
      if (nodo === nuevoHeader || nodo.tagName === 'SCRIPT') continue;
      // El shell nuevo pinta su propia cabecera; se descarta la estática.
      if (nodo.matches?.('.app-header, .top')) continue;
      document.body.append(document.importNode(nodo, true));
    }

    document.body.className = doc.body.className;
    document.body.classList.add('is-navigating');
    document.title = doc.title;

    const script = [...doc.querySelectorAll('script[type="module"][src]')].at(-1);
    const src = script?.getAttribute('src');
    if (!src) throw new Error('La página no tiene un módulo principal');

    rutaActual = rutaDe(url);
    if (push) {
      history.pushState({ ruta: rutaActual }, '', url.href);
    }

    // Mantiene el foco en el contenido nuevo y evita heredar el scroll anterior.
    const main = document.querySelector('main');
    main?.classList.add('pagina-entrando');
    window.scrollTo(0, 0);

    await import(`${new URL(src, url.href).href}?v=${Date.now()}`);
  } catch (error) {
    console.error('[navegacion] No se pudo cambiar de página:', error);
    toast('No se pudo cambiar de sección. Recargando…', 'error');
    window.location.href = url.href;
  } finally {
    if (token === peticionActual) {
      document.body.classList.remove('is-navigating');
      const mainActual = document.querySelector('main');
      setTimeout(() => mainActual?.classList.remove('pagina-entrando'), 240);
    }
  }
}

/** Instala una sola vez el enrutador de la navegación principal. */
export function instalarNavegacion() {
  if (instalada) return;
  instalada = true;

  document.addEventListener('click', (evento) => {
    if (evento.defaultPrevented || evento.button !== 0) return;
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;

    const enlace = evento.target.closest('a[data-nav], a.brand-link');
    if (!enlace || !esEnlaceNavegable(enlace)) return;

    const url = new URL(enlace.href, location.href);
    if (url.href === location.href) {
      evento.preventDefault();
      return;
    }

    for (const grupo of document.querySelectorAll('.nav-group[open], .nav-grupo[open]')) {
      grupo.open = false;
      grupo.querySelector('summary')?.blur();
    }

    evento.preventDefault();
    navegar(url.href, { push: true });
  });

  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    if (rutaDe(url) === rutaActual) return;
    navegar(url.href, { push: false }).then(() => {
      const y = posiciones.get(rutaDe(url));
      if (Number.isFinite(y)) window.scrollTo(0, y);
    });
  });
}
