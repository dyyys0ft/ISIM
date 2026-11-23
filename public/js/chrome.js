import { api } from './api.js';
import { $, $$, initials, registrarRoles, etiquetaRol } from './ui.js';
import { puede } from './permisos.js';
import { instalarNavegacion, generacionPagina } from './navegacion.js';
import { iniciarVersion } from './version.js';

let chromeGlobalListo = false;
let vigilanteSesion = null;
let eventosSesion = null;

function redirigirSesionCerrada() {
  eventosSesion?.close();
  eventosSesion = null;
  window.location.replace('/?sesion=otra');
}

function conectarEventosSesion() {
  if (eventosSesion || typeof EventSource === 'undefined') return;

  eventosSesion = new EventSource('/api/auth/session-events');
  eventosSesion.addEventListener('sesion-cerrada', redirigirSesionCerrada);
  eventosSesion.onerror = async () => {
    try {
      await api.get('/api/auth/me');
    } catch (error) {
      if (error.status === 401) redirigirSesionCerrada();
    }
  };
}

async function verificarSesionActual() {
  try {
    await api.get('/api/auth/me');
  } catch (error) {
    if (error.status === 401) redirigirSesionCerrada();
  }
}

/**
 * Menú general del sistema: la estructura que se usaba hasta ayer.
 * Se conservan etiquetas, orden y grupos; los permisos siguen ocultando
 * las entradas que cada rol no puede usar.
 */
const NAVEGACION = [
  {
    id: 'dashboard-citas',
    href: '/dashboard-citas.html',
    texto: 'Dashboard',
    permiso: 'agenda.ver',
    rolesExcluidos: ['operador'],
  },
  { id: 'agenda', href: '/agenda.html', texto: 'Agenda', permiso: 'agenda.ver' },
  {
    id: 'pacientes',
    href: '/pacientes.html',
    texto: 'Pacientes',
    permiso: 'pacientes.ver',
    rolesExcluidos: ['operador'],
  },
  {
    id: 'documentos',
    texto: 'Documentos',
    hijos: [
      { id: 'documentos', href: '/documentos.html', texto: 'Consentimientos', permiso: 'documentos.ver' },
      {
        id: 'plantillas',
        href: '/plantillas.html',
        texto: 'Plantillas',
        permiso: 'plantillas.gestionar',
      },
      { id: 'registro', href: '/registro.html', texto: 'Historial', permiso: 'registro.ver' },
      {
        id: 'dashboard',
        href: '/dashboard.html',
        texto: 'Estadísticas consentimientos',
        permiso: 'dashboard.ver',
      },
    ],
  },
  {
    id: 'ajustes',
    texto: 'Ajustes del sistema',
    hijos: [
      {
        id: 'ajustes',
        href: '/ajustes.html',
        texto: 'Configuración del sistema',
        permiso: 'configuracion.ver',
      },
      { id: 'usuarios', href: '/usuarios.html', texto: 'Usuarios', permiso: 'usuarios.gestionar' },
      {
        id: 'reportes',
        href: '/reportes.html',
        texto: 'Reportes de usuarios',
        permiso: 'reportes.ver',
      },
      // CRM se mantiene accesible desde Ajustes, oculto del menú principal.
      { id: 'crm', href: '/crm.html', texto: 'CRM', permiso: 'crm.ver' },
      { id: 'cuenta', href: '/cuenta.html', texto: 'Mi cuenta' },
    ],
  },
];

/** La ficha del paciente mantiene activo el módulo Pacientes. */
const EQUIVALENCIAS = {
  paciente: 'pacientes',
};

function visible(usuario, permiso) {
  if (!permiso) return true;
  if (Array.isArray(permiso)) return permiso.some((p) => puede(usuario, p));
  return puede(usuario, permiso);
}

function htmlNavegacion(usuario, active) {
  const vista = EQUIVALENCIAS[active] ?? active;
  const partes = [];

  for (const item of NAVEGACION) {
    if (item.rolesExcluidos?.includes(usuario.rol)) continue;
    if (!visible(usuario, item.permiso)) continue;

    if (!item.hijos) {
      const on = item.id === vista ? ' class="on"' : '';
      partes.push(`<a href="${item.href}" data-nav="${item.id}"${on}>${item.texto}</a>`);
      continue;
    }

    const hijos = item.hijos.filter((hijo) => visible(usuario, hijo.permiso));
    if (!hijos.length) continue;

    // Si el único acceso es la cuenta personal, se muestra como enlace directo
    // en lugar de un grupo "Ajustes del sistema" vacío.
    if (hijos.length === 1 && hijos[0].id === 'cuenta') {
      const hijo = hijos[0];
      partes.push(
        `<a href="${hijo.href}" data-nav="${hijo.id}"${
          hijo.id === vista ? ' class="on"' : ''
        }>${hijo.texto}</a>`
      );
      continue;
    }

    const algunoActivo = hijos.some((hijo) => hijo.id === vista);
    const enlaces = hijos
      .map(
        (hijo) =>
          `<a href="${hijo.href}" data-nav="${hijo.id}"${
            hijo.id === vista ? ' class="on"' : ''
          }>${hijo.texto}</a>`
      )
      .join('');

    partes.push(
      `<details class="nav-grupo"${algunoActivo ? ' data-activo="1"' : ''}>` +
        `<summary${algunoActivo ? ' class="on"' : ''}>${item.texto}</summary>` +
        `<div class="nav-panel">${enlaces}</div>` +
        `</details>`
    );
  }

  return partes.join('');
}

function montarShell(usuario, active) {
  let header = $('body > .top');

  if (!header) {
    // Retira la cabecera estática antigua y monta la del nuevo shell.
    $$('body > .app-header').forEach((viejo) => viejo.remove());

    header = document.createElement('header');
    header.className = 'top no-print';
    document.body.prepend(header);
  }

  const logo = usuario.logoUrl || '/img/isim-logo.png';
  const nombre = usuario.nombre || usuario.username || 'Usuario';
  const rol = etiquetaRol(usuario.rol);

  header.innerHTML = `
    <button class="nav-toggle" type="button" data-nav-toggle aria-label="Abrir menú" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <a class="brand-link" href="/agenda.html" aria-label="ISIM · Inicio">
      <img src="${logo}" alt="ISIM">
      <span class="brand-texto">
        <strong>ISIM</strong>
        <small>Salud Integral de la Mujer</small>
      </span>
    </a>
    <nav class="nav" aria-label="Principal">${htmlNavegacion(usuario, active)}</nav>
    <div class="user">
      <span class="avatar" data-user-avatar aria-hidden="true"></span>
      <div class="who">
        <b>${nombre}</b>
        <span>${rol}</span>
      </div>
      <button class="btn sm" data-logout type="button">Salir</button>
    </div>
  `;

  document.body.classList.add('isim-shell');

  // Enlaces sin permiso que aún queden en el contenido de la página.
  for (const elemento of $$('[data-permiso]')) {
    elemento.hidden = !visible(usuario, elemento.dataset.permiso);
  }
  for (const elemento of $$('[data-admin-only]')) {
    elemento.hidden = usuario.rol !== 'admin';
  }
  for (const elemento of $$('[data-user-name]')) elemento.textContent = nombre;
  for (const elemento of $$('[data-user-avatar]')) {
    if (usuario.fotoUrl) {
      elemento.innerHTML = `<img src="${usuario.fotoUrl}" alt="">`;
      elemento.classList.add('avatar--foto');
    } else {
      elemento.textContent = initials(nombre);
    }
  }
  for (const marca of $$('.brand__mark')) {
    marca.classList.add('brand__mark--logo');
    marca.innerHTML = `<img src="${logo}" alt="ISIM">`;
  }
}

function conectarShell() {
  const header = $('body > .top');
  if (!header) return;

  const botonMenu = $('[data-nav-toggle]', header);
  const cerrarMenu = () => {
    header.classList.remove('nav-open');
    botonMenu?.setAttribute('aria-expanded', 'false');
    botonMenu?.setAttribute('aria-label', 'Abrir menú');
  };

  botonMenu?.addEventListener('click', (evento) => {
    evento.stopPropagation();
    const abierto = header.classList.toggle('nav-open');
    botonMenu.setAttribute('aria-expanded', String(abierto));
    botonMenu.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
  });

  document.addEventListener('click', (evento) => {
    if (!evento.target.closest('.top')) cerrarMenu();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrarMenu();
  });
  header.addEventListener('click', (evento) => {
    if (evento.target.closest('.nav a')) cerrarMenu();
  });

  const grupos = $$('.nav-grupo', header);
  for (const grupo of grupos) {
    grupo.addEventListener('toggle', () => {
      if (!grupo.open) return;
      for (const otro of grupos) if (otro !== grupo && otro.open) otro.open = false;
    });
  }
  document.addEventListener('click', (evento) => {
    if (evento.target.closest('.nav-grupo')) return;
    for (const grupo of grupos) if (grupo.open) grupo.open = false;
  });

  for (const boton of $$('[data-logout]')) {
    boton.addEventListener('click', async () => {
      try {
        await api.post('/api/auth/logout');
      } catch {
        // La sesión ya no existía.
      }
      window.location.replace('/');
    });
  }
}

/**
 * Inicializa la cabecera común: usuario, navegación, permisos y salida.
 * Devuelve el usuario o null si no hay sesión (redirige al acceso).
 */
export async function initChrome({ active = '' } = {}) {
  instalarNavegacion();
  const generacion = generacionPagina();

  let usuario;
  try {
    usuario = await api.get('/api/auth/me');
  } catch {
    if (generacion !== generacionPagina()) return null;
    window.location.replace('/');
    return null;
  }

  // Mientras se consultaba la sesión pudo iniciarse otra navegación.
  if (generacion !== generacionPagina()) return null;

  try {
    registrarRoles(await api.get('/api/roles/nombres'));
  } catch {
    // Si falla, se mantienen las etiquetas por defecto.
  }

  if (!vigilanteSesion) {
    vigilanteSesion = setInterval(verificarSesionActual, 8000);
    window.addEventListener('focus', verificarSesionActual);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) verificarSesionActual();
    });
  }

  conectarEventosSesion();
  montarShell(usuario, active);

  if (!chromeGlobalListo) {
    chromeGlobalListo = true;
    conectarShell();
  } else {
    // La navegación parcial reemplaza el contenido: vuelve a enlazar lo nuevo.
    for (const boton of $$('[data-logout]')) {
      if (boton.dataset.enlazado) continue;
      boton.dataset.enlazado = '1';
      boton.addEventListener('click', async () => {
        try {
          await api.post('/api/auth/logout');
        } catch {
          // La sesión ya no existía.
        }
        window.location.replace('/');
      });
    }
  }

  iniciarVersion().catch(() => {});

  return usuario;
}
