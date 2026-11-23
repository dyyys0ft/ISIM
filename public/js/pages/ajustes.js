import { api } from '../api.js';
import { $, $$, escapeHtml, registrarRoles, setBusy, toast } from '../ui.js';
import { initChrome } from '../chrome.js';
import { puede } from '../permisos.js';

let usuario = null;
let datos = null;
let rolesDatos = null;
let redDatos = null;
let respaldosDatos = null;
const estadosPing = new Map();
let rolEditando = null;
let logoPendiente = null;
let migracionAnalisis = null;

function leerArchivo(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(new Error('No se pudo leer la imagen'));
    lector.readAsDataURL(archivo);
  });
}

function renderLogo() {
  const contenedor = $('#logo-preview');
  const vista = $('#vista-previa-encabezado');

  if (datos?.logoUrl) {
    contenedor.innerHTML = `<img src="${datos.logoUrl}" alt="Logo actual del sistema">`;
    vista.hidden = false;
    vista.querySelector('img').src = datos.logoUrl;
  } else {
    contenedor.innerHTML = '<p class="muted small">Sin logo configurado.</p>';
    vista.hidden = true;
  }

  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  $('#btn-quitar-logo').hidden = !puedeCambiar || !datos?.logoUrl;
}

function renderCentro() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  $('#centro-nombre').value = datos?.centroNombre || '';
  $('#centro-direccion').value = datos?.centroDireccion || '';
  $('#centro-ruc').value = datos?.centroRuc || '';
  $('#centro-telefono').value = datos?.centroTelefono || '';
  $('#centro-nombre').disabled = !puedeCambiar;
  $('#centro-direccion').disabled = !puedeCambiar;
  $('#centro-ruc').disabled = !puedeCambiar;
  $('#centro-telefono').disabled = !puedeCambiar;
  $('#btn-guardar-centro').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-centro').hidden = puedeCambiar;

  $('#centro-preview-nombre').textContent =
    datos?.centroNombre || 'Sin nombre configurado';
  $('#centro-preview-direccion').textContent = datos?.centroDireccion || '';
  $('#centro-preview-direccion').hidden = !datos?.centroDireccion;
}

function actualizarContadorPie() {
  const texto = $('#pie-texto').value;
  $('#pie-contador').textContent = `${texto.length} / 1200 caracteres`;
  $('#pie-demo-texto').textContent = texto.trim() || 'Sin pie de página configurado.';
}

function renderAlertas() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  $('#alerta-examenes').checked = datos?.alertasExamenes !== false;
  $('#alerta-examenes').disabled = !puedeCambiar;
  $('#btn-guardar-alertas').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-alertas').hidden = puedeCambiar;
}

function renderAgenda() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  $('#permitir-citas-simultaneas').checked = datos?.permitirCitasSimultaneas === true;
  $('#permitir-citas-simultaneas').disabled = !puedeCambiar;
  $('#vista-agenda-defecto').value = datos?.vistaAgenda || 'jornada';
  $('#vista-agenda-defecto').disabled = !puedeCambiar;
  $('#btn-guardar-agenda').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-agenda').hidden = puedeCambiar;
}

function formatoAcceso(iso) {
  if (!iso) return 'Nunca';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return 'Desconocido';
  return fecha.toLocaleString('es-EC', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function insigniaRed(ip) {
  const estado = estadosPing.get(ip);
  if (!estado) return '<span class="badge">Sin verificar</span>';
  if (estado.enRed === true) {
    const latencia = estado.ms === null ? '' : ` <span class="muted small">${estado.ms} ms</span>`;
    return `<span class="badge badge--activo">En red</span>${latencia}`;
  }
  if (estado.enRed === false) return '<span class="badge">Fuera de red</span>';
  return '<span class="badge">Ping no disponible</span>';
}

function renderListaIps(ips, puedeCambiar) {
  const contenedor = $('#lista-ips');

  if (!ips.length) {
    contenedor.innerHTML = '<p class="muted small">Todavía no hay IPs en la lista.</p>';
    return;
  }

  contenedor.innerHTML = ips
    .map(
      (item) => `
      <div class="stack" style="border:1px solid #e2e8f0; border-radius:.75rem; padding:.75rem">
        <div class="row row--between">
          <div>
            <code>${escapeHtml(item.ip)}</code>
            ${item.descripcion ? `<span class="muted small"> · ${escapeHtml(item.descripcion)}</span>` : ''}
          </div>
          <div class="row">
            <button class="btn" type="button" data-ping-ip="${escapeHtml(item.ip)}">Ping</button>
            <button class="btn" type="button" data-detectar-mac="${escapeHtml(item.ip)}">
              Detectar MAC
            </button>
            ${
              puedeCambiar
                ? `<button class="btn btn--danger" type="button" data-eliminar-ip="${escapeHtml(item.ip)}">Quitar</button>`
                : ''
            }
          </div>
        </div>
        <div class="muted small">
          MAC: ${item.mac ? `<code>${escapeHtml(item.mac)}</code>` : '<span>solo IP</span>'}
          · Último acceso: ${escapeHtml(formatoAcceso(item.ultimoAccesoEn))}
          · Accesos: ${item.accesos || 0}
          · En red: <span data-estado-ip="${escapeHtml(item.ip)}">${insigniaRed(item.ip)}</span>
        </div>
      </div>`
    )
    .join('');

  for (const boton of contenedor.querySelectorAll('[data-eliminar-ip]')) {
    boton.addEventListener('click', () => eliminarIp(boton.dataset.eliminarIp));
  }
  for (const boton of contenedor.querySelectorAll('[data-ping-ip]')) {
    boton.addEventListener('click', () => pingIp(boton.dataset.pingIp));
  }
  for (const boton of contenedor.querySelectorAll('[data-detectar-mac]')) {
    boton.addEventListener('click', () =>
      detectarMacIp(boton.dataset.detectarMac, boton)
    );
  }
}

function renderRed() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  const info = redDatos || {};
  const proxy = info.proxy || {};

  $('#red-url-acceso').textContent = info.urlAcceso || '—';
  $('#red-ip-local').value = info.ipLocal || '—';
  $('#lista-direcciones').innerHTML =
    (info.direccionesLocales || [])
      .map(
        (direccion) => `
        <div class="row row--between">
          <span>${escapeHtml(direccion.nombre)}</span>
          <code>${escapeHtml(direccion.ip)}${direccion.ip === info.ipLocal ? ' · principal' : ''}</code>
        </div>`
      )
      .join('') || '<p class="muted small">No se detectaron direcciones de red.</p>';
  $('#red-url-local').value = info.urlLocal || '—';
  $('#red-url-https').value = info.urlAccesoHttps || '—';
  $('#red-detalle-puertos').textContent =
    `Puerto del servidor: ${info.puertoEscucha ?? '—'} · ` +
    `Puerto de acceso: ${info.puertoSeleccionado ?? '—'} · ` +
    `Puerto HTTPS: ${info.puertoHttps ?? '—'}`;

  if (proxy.error) {
    $('#red-estado-proxy').textContent = `Último error: ${proxy.error}`;
  } else if (proxy.sinProxy) {
    $('#red-estado-proxy').textContent = 'El sistema ya escucha directamente en ese puerto.';
  } else if (proxy.activo) {
    $('#red-estado-proxy').textContent =
      `Puerto ${proxy.puerto} expuesto hacia el servidor interno ${proxy.destino}.`;
  } else {
    $('#red-estado-proxy').textContent = 'No hay un puerto adicional expuesto.';
  }

  const selector = $('#red-puerto');
  const lista = info.puertos || [];
  const seleccionado = info.puertoSeleccionado;
  selector.innerHTML = lista.length
    ? lista
        .map((item) => {
          const etiqueta = `${item.puerto}${item.delServidor ? ' (servidor)' : ''}${
            item.libre || item.delServidor || item.seleccionado ? '' : ' — ocupado'
          }`;
          const deshabilitado = item.libre || item.delServidor || item.seleccionado ? '' : ' disabled';
          return `<option value="${item.puerto}"${item.puerto === seleccionado ? ' selected' : ''}${deshabilitado}>${escapeHtml(etiqueta)}</option>`;
        })
        .join('')
    : `<option value="${seleccionado ?? ''}">${seleccionado ?? '—'}</option>`;

  selector.disabled = !puedeCambiar;
  $('#red-puerto-custom').disabled = !puedeCambiar;
  $('#btn-guardar-puerto').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-red-puerto').hidden = puedeCambiar;

  $('#red-restriccion').checked = info.activa === true;
  $('#red-confiar-proxy').checked = info.confiarProxy === true;
  $('#red-restriccion').disabled = !puedeCambiar;
  $('#red-confiar-proxy').disabled = !puedeCambiar;
  $('#btn-guardar-restriccion').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-red').hidden = puedeCambiar;
  $('#form-ip').hidden = !puedeCambiar;
  $('#red-ips-vacio').hidden = !puedeCambiar || (info.ips || []).length > 0;

  renderListaIps(info.ips || [], puedeCambiar);
}

function formatoBytes(bytes) {
  const valor = Number(bytes) || 0;
  if (valor < 1024) return `${valor} B`;
  if (valor < 1024 * 1024) return `${(valor / 1024).toFixed(1)} KB`;
  if (valor < 1024 * 1024 * 1024) return `${(valor / 1024 / 1024).toFixed(1)} MB`;
  return `${(valor / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const ETIQUETAS_RESPALDO = {
  base: 'Base de datos',
  firmas: 'Firmas y fotos',
  historias: 'Archivos de exámenes',
  configuracion: 'Configuración y logo',
};

function actualizarCamposFrecuencia() {
  const frecuencia = $('#respaldos-frecuencia').value;
  $('#respaldos-campo-hora').hidden = !['diario', 'semanal'].includes(frecuencia);
  $('#respaldos-campo-dia').hidden = frecuencia !== 'semanal';
}

function renderListaRespaldos(lista, puedeCambiar) {
  const contenedor = $('#respaldos-lista');

  if (!lista.length) {
    contenedor.innerHTML = '<p class="muted small">Todavía no hay respaldos creados.</p>';
    return;
  }

  contenedor.innerHTML = lista
    .map(
      (item) => `
      <div class="stack" style="border:1px solid #e2e8f0;border-radius:.75rem;padding:.75rem">
        <div class="row row--between">
          <div>
            <strong>${escapeHtml(item.archivo || '—')}</strong>
            <span class="muted small"> · ${escapeHtml(formatoAcceso(item.creadoEn))} · ${formatoBytes(item.bytes)}</span>
            <span class="badge badge--${item.estado === 'ok' ? 'activo' : 'cancelada'}">${escapeHtml(item.estado)}</span>
            ${item.existe ? '' : '<span class="badge">Eliminado</span>'}
          </div>
          <div class="row">
            ${
              item.existe
                ? `<button class="btn" type="button" data-verificar-respaldo="${escapeHtml(item.archivo)}">Verificar</button>`
                : ''
            }
          </div>
        </div>
        <div class="muted small">
          Incluye: ${(item.items || []).map((clave) => ETIQUETAS_RESPALDO[clave] || clave).join(', ') || '—'}
        </div>
        ${item.error ? `<p class="hint">${escapeHtml(item.error)}</p>` : ''}
      </div>`
    )
    .join('');

  for (const boton of contenedor.querySelectorAll('[data-verificar-respaldo]')) {
    boton.addEventListener('click', () =>
      verificarRespaldo(boton.dataset.verificarRespaldo, boton)
    );
  }
}

function renderRespaldos() {
  const info = respaldosDatos || {};
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');

  $('#respaldos-ultimo').textContent = info.ultimoEn
    ? `${formatoAcceso(info.ultimoEn)}${info.ultimoArchivo ? ` · ${info.ultimoArchivo}` : ''}`
    : 'Nunca';
  $('#respaldos-proximo').textContent = info.proximoEn
    ? formatoAcceso(info.proximoEn)
    : info.frecuencia === 'manual'
      ? 'Manual'
      : '—';
  $('#respaldos-huella').textContent = info.huellaClave || 'Se creará al primer respaldo';
  $('#respaldos-conservar-actual').textContent = info.conservar || 14;

  const error = $('#respaldos-ultimo-error');
  error.hidden = !info.ultimoError;
  error.textContent = info.ultimoError ? `Último error: ${info.ultimoError}` : '';

  $('#respaldos-directorio').value = info.directorio || '';
  $('#respaldos-frecuencia').value = info.frecuencia || 'diario';
  $('#respaldos-hora').value = info.hora || '22:00';
  $('#respaldos-dia').value = String(info.dia ?? 1);
  $('#respaldos-conservar').value = info.conservar || 14;
  $('#respaldos-firmas').checked = info.incluirFirmas !== false;
  $('#respaldos-historias').checked = info.incluirHistorias !== false;
  $('#respaldos-configuracion').checked = info.incluirConfiguracion !== false;

  const tamanos = info.tamanos || {};
  $('#respaldos-tamano-firmas').textContent = `(${formatoBytes(tamanos.firmas)})`;
  $('#respaldos-tamano-historias').textContent = `(${formatoBytes(tamanos.historias)})`;
  $('#respaldos-tamano-configuracion').textContent = `(${formatoBytes(tamanos.configuracion)})`;
  $('#respaldos-tamanos').textContent =
    `Base de datos: ${formatoBytes(tamanos.base)} · Total estimado: ${formatoBytes(tamanos.total)}`;

  for (const selector of [
    '#respaldos-directorio',
    '#respaldos-frecuencia',
    '#respaldos-hora',
    '#respaldos-dia',
    '#respaldos-conservar',
    '#respaldos-firmas',
    '#respaldos-historias',
    '#respaldos-configuracion',
  ]) {
    $(selector).disabled = !puedeCambiar;
  }
  $('#btn-guardar-respaldos').hidden = !puedeCambiar;
  $('#btn-respaldar-ahora').hidden = !puedeCambiar;
  $('#btn-descargar-clave').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-respaldos').hidden = puedeCambiar;

  actualizarCamposFrecuencia();
  renderListaRespaldos(info.respaldos || [], puedeCambiar);
}

function renderActualizaciones() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  $('#actualizaciones-version').textContent = `v${datos?.version || '—'}`;
  $('#actualizaciones-build').textContent = datos?.buildId || '—';
  $('#actualizaciones-automaticas').checked = datos?.actualizacionesAutomaticas === true;
  $('#actualizaciones-automaticas').disabled = !puedeCambiar;
  $('#btn-guardar-actualizaciones').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-actualizaciones').hidden = puedeCambiar;
}

function slugPreview(nombre) {
  const base = String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 32);
  return base.length >= 3 ? base : '';
}

function renderListaRoles() {
  const lista = $('#lista-roles');
  const roles = rolesDatos?.roles || [];

  if (!roles.length) {
    lista.innerHTML = '<p class="muted small">Todavía no hay roles configurados.</p>';
    return;
  }

  lista.innerHTML = roles
    .map(
      (rol) => `
      <button class="role-card${rol.slug === rolEditando ? ' is-active' : ''}" type="button" data-rol="${escapeHtml(rol.slug)}">
        <span class="role-card__main">
          <span class="role-card__title">${escapeHtml(rol.nombre)}</span>
          <span class="role-card__slug">${escapeHtml(rol.slug)}</span>
        </span>
        <span class="role-card__meta">
          ${rol.protegido ? '<span class="badge badge--activo">Sistema</span>' : '<span class="badge">Personalizado</span>'}
          <span class="muted small">${rol.usuarios} usuario${rol.usuarios === 1 ? '' : 's'}</span>
        </span>
      </button>`
    )
    .join('');

  for (const boton of $$('[data-rol]', lista)) {
    boton.addEventListener('click', () => seleccionarRol(boton.dataset.rol));
  }
}

function renderPermisosRol(rol) {
  const contenedor = $('#roles-permisos');
  const catalogo = rolesDatos?.catalogo || [];
  const activos = new Set(rol?.permisos || []);
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');

  contenedor.innerHTML = catalogo
    .map((grupo) => {
      const lectura = grupo.permisos.filter((item) => item.tipo === 'lectura');
      const edicion = grupo.permisos.filter((item) => item.tipo === 'edicion');

      const casillas = (items) =>
        items.length
          ? items
              .map(
                (item) => `
                <label class="consent consent--compact">
                  <input type="checkbox" data-permiso="${escapeHtml(item.permiso)}"
                    ${activos.has(item.permiso) ? 'checked' : ''}
                    ${puedeCambiar ? '' : 'disabled'} />
                  <span>${escapeHtml(item.etiqueta)}</span>
                </label>`
              )
              .join('')
          : '<span class="muted small">—</span>';

      return `
        <div class="permiso-grupo">
          <div class="permiso-grupo__head">
            <strong>${escapeHtml(grupo.nombre)}</strong>
            <span class="muted small">${escapeHtml(grupo.descripcion || '')}</span>
          </div>
          <div class="permiso-grupo__cols">
            <div class="permiso-col">
              <span class="permiso-col__title">Lectura</span>
              ${casillas(lectura)}
            </div>
            <div class="permiso-col">
              <span class="permiso-col__title">Edición</span>
              ${casillas(edicion)}
            </div>
          </div>
        </div>`;
    })
    .join('');
}

function seleccionarRol(slug) {
  const rol = rolesDatos?.roles?.find((item) => item.slug === slug);
  if (!rol) return;

  rolEditando = rol.slug;
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');

  $('#rol-titulo').textContent = rol.nombre;
  $('#rol-subtitulo').textContent = `Código ${rol.slug} · ${rol.usuarios} usuario${
    rol.usuarios === 1 ? '' : 's'
  } · ${rol.permisos.length} permiso${rol.permisos.length === 1 ? '' : 's'}`;
  $('#rol-nombre').value = rol.nombre;
  $('#rol-slug').value = rol.slug;
  $('#rol-descripcion').value = rol.descripcion || '';

  $('#rol-nombre').disabled = !puedeCambiar;
  $('#rol-descripcion').disabled = !puedeCambiar;

  renderPermisosRol(rol);
  renderListaRoles();

  $('#btn-guardar-rol').hidden = !puedeCambiar;
  $('#btn-eliminar-rol').hidden =
    !puedeCambiar || Boolean(rol.protegido) || rol.usuarios > 0;
  $('#aviso-sin-permiso-roles').hidden = puedeCambiar;
}

function nuevoRol() {
  rolEditando = null;
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');

  $('#form-rol').reset();
  $('#rol-titulo').textContent = 'Nuevo rol';
  $('#rol-subtitulo').textContent = 'Define el nombre y los permisos de lectura y edición.';
  $('#rol-slug').value = '';
  $('#rol-nombre').disabled = !puedeCambiar;
  $('#rol-descripcion').disabled = !puedeCambiar;
  $('#btn-eliminar-rol').hidden = true;
  $('#btn-guardar-rol').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-roles').hidden = puedeCambiar;

  renderPermisosRol(null);
  renderListaRoles();
  $('#rol-nombre').focus();
}

function renderRoles() {
  $('#btn-nuevo-rol').hidden = !puede(usuario, 'configuracion.gestionar');
  const roles = rolesDatos?.roles || [];
  if (!roles.length) {
    nuevoRol();
    return;
  }

  if (!rolEditando || !roles.some((rol) => rol.slug === rolEditando)) {
    rolEditando = roles[0].slug;
  }

  seleccionarRol(rolEditando);
}

async function guardarRol(evento) {
  evento.preventDefault();
  if (!puede(usuario, 'configuracion.gestionar')) return;

  const nombre = $('#rol-nombre').value.trim();
  const descripcion = $('#rol-descripcion').value.trim();
  const permisos = $$('#roles-permisos [data-permiso]:checked').map(
    (casilla) => casilla.dataset.permiso
  );

  if (!nombre) return toast('Escribe el nombre del rol', 'error');

  const boton = $('#btn-guardar-rol');
  setBusy(boton, true, 'Guardando…');

  try {
    if (rolEditando) {
      await api.patch(`/api/roles/${encodeURIComponent(rolEditando)}`, {
        nombre,
        descripcion,
        permisos,
      });
      toast('Rol actualizado', 'success');
    } else {
      const creado = await api.post('/api/roles', { nombre, descripcion, permisos });
      rolEditando = creado.slug;
      toast('Rol creado', 'success');
    }
    setBusy(boton, false);
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function eliminarRol() {
  if (!rolEditando) return;
  const rol = rolesDatos?.roles?.find((item) => item.slug === rolEditando);
  if (!rol) return;

  if (
    !window.confirm(
      `¿Eliminar el rol “${rol.nombre}”? Esta acción no se puede deshacer.`
    )
  ) {
    return;
  }

  try {
    await api.delete(`/api/roles/${encodeURIComponent(rolEditando)}`);
    rolEditando = null;
    toast('Rol eliminado', 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderWhatsApp() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  const campos = [
    '#whatsapp-habilitado',
    '#whatsapp-auto',
    '#whatsapp-phone-id',
    '#whatsapp-api-version',
    '#whatsapp-template',
    '#whatsapp-language',
    '#whatsapp-country-code',
    '#whatsapp-token',
    '#whatsapp-verify-token',
    '#whatsapp-app-secret',
  ];

  $('#whatsapp-habilitado').checked = datos?.whatsappHabilitado === true;
  $('#whatsapp-auto').checked = datos?.whatsappAuto === true;
  $('#whatsapp-phone-id').value = datos?.whatsappPhoneNumberId || '';
  $('#whatsapp-api-version').value = datos?.whatsappApiVersion || 'v21.0';
  $('#whatsapp-template').value = datos?.whatsappTemplate || 'confirmacion_cita';
  $('#whatsapp-language').value = datos?.whatsappLanguage || 'es';
  $('#whatsapp-country-code').value = datos?.whatsappCountryCode || '593';
  $('#whatsapp-verify-token').value = datos?.whatsappVerifyToken || '';
  $('#whatsapp-app-secret').value = '';
  $('#whatsapp-app-secret-estado').textContent = datos?.whatsappTieneAppSecret
    ? 'App Secret configurado. Déjalo vacío para conservarlo.'
    : 'Sin App Secret configurado.';
  $('#whatsapp-webhook-url').value = `${location.origin}/api/whatsapp/webhook`;
  $('#whatsapp-token').value = '';

  for (const selector of campos) $(selector).disabled = !puedeCambiar;

  $('#whatsapp-token-estado').textContent = datos?.whatsappTieneToken
    ? 'Token configurado. Deja el campo vacío para conservarlo.'
    : 'Sin token configurado.';
  $('#btn-guardar-whatsapp').hidden = !puedeCambiar;
  $('#btn-quitar-token-whatsapp').hidden = !puedeCambiar || !datos?.whatsappTieneToken;
  $('#aviso-sin-permiso-whatsapp').hidden = puedeCambiar;
}

function renderDemo() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  const activo = datos?.demoActivo === true;

  $('#demo-activo').checked = activo;
  $('#demo-activo').disabled = !puedeCambiar;
  $('#demo-pacientes').textContent = datos?.demoPacientes ?? 0;
  $('#demo-citas').textContent = datos?.demoCitas ?? 0;
  $('#demo-historias').textContent = datos?.demoHistorias ?? 0;
  $('#demo-examenes').textContent = datos?.demoExamenes ?? 0;

  const boton = $('#btn-guardar-demo');
  boton.hidden = !puedeCambiar;
  boton.textContent = activo
    ? 'Desactivar DEMO y borrar datos'
    : 'Activar DEMO y cargar datos';

  const bloqueados = datos?.demoPacientesBloqueados || 0;
  $('#aviso-demo-bloqueados').hidden = !bloqueados;
  $('#aviso-demo-bloqueados').textContent = bloqueados
    ? `Se conservaron ${bloqueados} pacientes de demostración porque tienen documentos reales asociados.`
    : '';

  $('#aviso-sin-permiso-demo').hidden = puedeCambiar;
}

function renderMigracion() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  $('#migracion-archivo').disabled = !puedeCambiar;
  $('#btn-analizar-migracion').hidden = !puedeCambiar;
  $('#btn-revisar-duplicados').hidden = !puedeCambiar;
  $('#btn-depurar-duplicados').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-migracion').hidden = puedeCambiar;
  if (!puedeCambiar) {
    $('#migracion-acciones').hidden = true;
  }
}

function renderResumenMigracion(resumen, titulo = 'Resumen del archivo') {
  const contenedor = $('#migracion-resumen');
  if (!resumen) {
    contenedor.hidden = true;
    contenedor.replaceChildren();
    return;
  }

  const origen = resumen.origen || resumen;
  const filas = [
    [
      'Pacientes',
      origen.pacientes?.total ?? 0,
      `${origen.pacientes?.sinCedula ?? 0} sin cédula · ${
        origen.pacientes?.cedulasDuplicadas ?? 0
      } cédulas duplicadas`,
    ],
    [
      'Citas',
      origen.citas?.total ?? 0,
      `${origen.citas?.conConsulta ?? 0} con consulta · ${
        origen.citas?.sinConsulta ?? 0
      } sin consulta`,
    ],
    [
      'Consultas',
      origen.consultas?.total ?? 0,
      `${origen.consultas?.sinCita ?? 0} sin cita (se crearán citas históricas)`,
    ],
    [
      'Exámenes',
      origen.examenes?.total ?? 0,
      `${origen.examenes?.conInforme ?? 0} con informe · ${
        origen.examenes?.conImagenReferenciada ?? 0
      } con imágenes referenciadas`,
    ],
    [
      'Recetas',
      origen.recetas?.total ?? 0,
      `${origen.recetas?.grupos ?? 0} grupos de receta`,
    ],
    [
      'Catálogos',
      (origen.catalogos?.diagnosticos ?? 0) +
        (origen.catalogos?.medicinas ?? 0) +
        (origen.catalogos?.tratamientos ?? 0) +
        (origen.catalogos?.informes ?? 0),
      `${origen.catalogos?.diagnosticos ?? 0} diagnósticos · ${
        origen.catalogos?.medicinas ?? 0
      } medicinas · ${origen.catalogos?.tratamientos ?? 0} tratamientos`,
    ],
  ];

  const insertados =
    Number.isFinite(resumen.pacientes?.insertados) && resumen.citas
      ? `
      <h3 class="side-title">Registros migrados</h3>
      <div class="migracion-resultado-grid">
        <div><strong>${resumen.pacientes.insertados}</strong><span>Pacientes</span></div>
        <div><strong>${resumen.citas.insertadas ?? 0}</strong><span>Citas</span></div>
        <div><strong>${resumen.citasHistoricas?.insertadas ?? 0}</strong><span>Citas históricas</span></div>
        <div><strong>${resumen.consultas?.insertadas ?? 0}</strong><span>Consultas</span></div>
        <div><strong>${resumen.examenes?.insertados ?? 0}</strong><span>Exámenes</span></div>
        <div><strong>${resumen.recetasAgrupadas ?? 0}</strong><span>Recetas agrupadas</span></div>
      </div>
    `
      : '';

  const advertencias = (resumen.advertencias || []).length
    ? `<div class="migracion-advertencias">
         <strong>Advertencias (${resumen.advertencias.length})</strong>
         <ul>${resumen.advertencias
           .slice(0, 12)
           .map((mensaje) => `<li>${escapeHtml(mensaje)}</li>`)
           .join('')}</ul>
       </div>`
    : '';

  contenedor.innerHTML = `
    <h3 class="side-title">${escapeHtml(titulo)}</h3>
    <div class="migracion-tabla">
      ${filas
        .map(
          ([nombre, total, detalle]) => `
          <div class="migracion-fila">
            <span>${nombre}</span>
            <strong>${total}</strong>
            <small>${escapeHtml(detalle)}</small>
          </div>`
        )
        .join('')}
    </div>
    ${insertados}
    ${advertencias}
  `;
  contenedor.hidden = false;
}

async function analizarMigracion() {
  const archivo = $('#migracion-archivo').files?.[0];
  if (!archivo) return toast('Selecciona el archivo old_db.sql', 'error');
  if (!archivo.name.toLowerCase().endsWith('.sql')) {
    return toast('El archivo debe ser un respaldo .sql', 'error');
  }
  if (archivo.size > 150 * 1024 * 1024) {
    return toast('El archivo supera el límite de 150 MB', 'error');
  }

  const boton = $('#btn-analizar-migracion');
  setBusy(boton, true, 'Analizando…');
  $('#migracion-estado').textContent = 'Leyendo la estructura del archivo…';

  try {
    const resultado = await api.subirSql('/api/migration/old-db/analyze', archivo);
    migracionAnalisis = resultado;
    setBusy(boton, false);
    renderResumenMigracion(resultado.resumen, 'Datos encontrados en el archivo');
    $('#migracion-acciones').hidden = false;
    $('#migracion-estado').textContent =
      'Análisis completado. Revisa el resumen y confirma la migración.';
  } catch (error) {
    setBusy(boton, false);
    $('#migracion-estado').textContent = '';
    toast(error.message, 'error');
  }
}

function renderDuplicados(datos) {
  const contenedor = $('#duplicados-resumen');
  if (!datos) {
    contenedor.hidden = true;
    contenedor.replaceChildren();
    return;
  }

  contenedor.innerHTML = `
    <div class="migracion-tabla">
      <div class="migracion-fila">
        <span>Pacientes</span>
        <strong>${datos.pacientes?.eliminables ?? 0}</strong>
        <small>${datos.pacientes?.grupos ?? 0} grupos · ${
          datos.pacientes?.registros ?? 0
        } registros revisados</small>
      </div>
      <div class="migracion-fila">
        <span>Consultas</span>
        <strong>${datos.historias?.eliminables ?? 0}</strong>
        <small>${datos.historias?.grupos ?? 0} grupos · ${
          datos.historias?.registros ?? 0
        } registros revisados</small>
      </div>
    </div>
  `;
  contenedor.hidden = false;
}

async function revisarDuplicados() {
  const boton = $('#btn-revisar-duplicados');
  setBusy(boton, true, 'Revisando…');
  try {
    const datos = await api.get('/api/migration/duplicados');
    setBusy(boton, false);
    renderDuplicados(datos);
    const hay = datos.pacientes?.eliminables || datos.historias?.eliminables;
    $('#btn-depurar-duplicados').hidden = !hay;
    if (!hay) toast('No hay duplicados pendientes', 'success');
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function depurarDuplicados() {
  const confirmado = window.confirm(
    'Se creará un respaldo y se fusionarán los pacientes y consultas duplicadas. ¿Continuar?'
  );
  if (!confirmado) return;

  const boton = $('#btn-depurar-duplicados');
  setBusy(boton, true, 'Depurando…');
  try {
    const resultado = await api.post('/api/migration/depurar');
    setBusy(boton, false);
    renderDuplicados(resultado.antes);
    $('#btn-depurar-duplicados').hidden = true;
    const resumen = resultado.resumen;
    if (resumen) {
      toast(
        `Depuración completada: ${resumen.pacientesEliminados} pacientes y ${resumen.historiasEliminadas} consultas eliminadas`,
        'success'
      );
    } else {
      toast(resultado.mensaje || 'No hay duplicados pendientes', 'success');
    }
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function ejecutarMigracion() {
  if (!migracionAnalisis?.id) return;
  const confirmado = window.confirm(
    'Se creará un respaldo automático de la base actual y luego se fusionarán los datos antiguos. ¿Continuar?'
  );
  if (!confirmado) return;

  const boton = $('#btn-ejecutar-migracion');
  setBusy(boton, true, 'Migrando…');
  $('#migracion-estado').textContent =
    'Migrando pacientes, citas, consultas, exámenes y recetas. No cierres esta ventana.';

  try {
    const resultado = await api.post('/api/migration/old-db/run', {
      id: migracionAnalisis.id,
    });
    setBusy(boton, false);
    $('#migracion-acciones').hidden = true;
    $('#migracion-estado').textContent = 'Migración completada correctamente.';
    renderResumenMigracion(resultado.resumen, 'Migración completada');
    toast('Migración completada', 'success');
  } catch (error) {
    setBusy(boton, false);
    $('#migracion-estado').textContent = '';
    toast(error.message, 'error');
  }
}

function renderPie() {
  const texto = datos?.pieTexto || '';
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');

  $('#pie-texto').value = texto;
  $('#pie-texto').disabled = !puedeCambiar;
  $('#btn-guardar-pie').hidden = !puedeCambiar;
  $('#btn-quitar-pie').hidden = !puedeCambiar || !texto;
  $('#pie-demo-texto').textContent = texto || 'Sin pie de página configurado.';
  actualizarContadorPie();
}

const TEXTOS_CONSENTIMIENTO_POR_DEFECTO = {
  declaracion:
    'Yo, {{paciente.nombre_completo}}, con Cédula de Identidad {{paciente.cedula}}, declaro que he recibido información clara, suficiente y comprensible sobre el procedimiento, sus beneficios, riesgos, alternativas y consecuencias; que he tenido la oportunidad de formular preguntas y que estas fueron respondidas satisfactoriamente. En consecuencia, otorgo mi consentimiento libre, informado y voluntario para la realización del procedimiento.',
  negativa:
    'La paciente o su representante legal manifiesta que NO otorga el consentimiento para el procedimiento, después de haber recibido la información correspondiente.',
  revocatoria:
    'La paciente o su representante legal revoca el consentimiento otorgado para el procedimiento, dejando constancia de su decisión.',
};

function renderTextosConsentimiento() {
  const puedeCambiar = puede(usuario, 'configuracion.gestionar');

  $('#consent-declaracion').value =
    datos?.consentimientoDeclaracion || TEXTOS_CONSENTIMIENTO_POR_DEFECTO.declaracion;
  $('#consent-negativa').value =
    datos?.consentimientoNegativa || TEXTOS_CONSENTIMIENTO_POR_DEFECTO.negativa;
  $('#consent-revocatoria').value =
    datos?.consentimientoRevocatoria || TEXTOS_CONSENTIMIENTO_POR_DEFECTO.revocatoria;

  for (const id of ['#consent-declaracion', '#consent-negativa', '#consent-revocatoria']) {
    $(id).disabled = !puedeCambiar;
  }
  $('#btn-guardar-consentimiento').hidden = !puedeCambiar;
  $('#btn-restaurar-consentimiento').hidden = !puedeCambiar;
  $('#aviso-sin-permiso-consentimiento').hidden = puedeCambiar;
  actualizarPreviewConsentimiento();
}

function actualizarPreviewConsentimiento() {
  const limpiarVista = (texto) =>
    texto
      .replace(/\{\{paciente\.nombre_completo\}\}/g, 'María Pérez')
      .replace(/\{\{paciente\.cedula\}\}/g, '0601234567')
      .replace(/\{\{institucion\}\}/g, datos?.centroNombre || 'ISIM')
      .replace(/\{\{fecha\}\}/g, new Date().toLocaleDateString('es-EC'))
      .replace(/\{\{hora\}\}/g, new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }))
      .replace(/\{\{[\w.]+\}\}/g, '—');

  $('#consent-preview-declaracion').textContent = limpiarVista(
    $('#consent-declaracion').value
  );
  $('#consent-preview-negativa').textContent = limpiarVista($('#consent-negativa').value);
  $('#consent-preview-revocatoria').textContent = limpiarVista(
    $('#consent-revocatoria').value
  );
}

async function guardarTextosConsentimiento({ restaurar = false } = {}) {
  const boton = restaurar ? $('#btn-restaurar-consentimiento') : $('#btn-guardar-consentimiento');

  if (restaurar) {
    if (!window.confirm('¿Restaurar los textos de consentimiento por defecto?')) return;
    $('#consent-declaracion').value = TEXTOS_CONSENTIMIENTO_POR_DEFECTO.declaracion;
    $('#consent-negativa').value = TEXTOS_CONSENTIMIENTO_POR_DEFECTO.negativa;
    $('#consent-revocatoria').value = TEXTOS_CONSENTIMIENTO_POR_DEFECTO.revocatoria;
  }

  const declaracion = $('#consent-declaracion').value.trim();
  const negativa = $('#consent-negativa').value.trim();
  const revocatoria = $('#consent-revocatoria').value.trim();

  if (declaracion.length < 20) {
    return toast('La declaración de consentimiento es demasiado corta', 'error');
  }
  if (negativa.length < 10) return toast('El texto de la negativa es demasiado corto', 'error');
  if (revocatoria.length < 10) {
    return toast('El texto de la revocatoria es demasiado corto', 'error');
  }

  setBusy(boton, true, 'Guardando…');
  try {
    const resultado = await api.post('/api/settings/consentimiento', {
      declaracion,
      negativa,
      revocatoria,
    });
    datos = { ...datos, ...resultado };
    actualizarPreviewConsentimiento();
    toast(
      restaurar ? 'Textos de consentimiento restaurados' : 'Textos de consentimiento guardados',
      'success'
    );
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
  }
}

async function cargar() {
  const [configuracion, roles, red, puertos, respaldos] = await Promise.all([
    api.get('/api/settings'),
    api.get('/api/roles'),
    api.get('/api/settings/red'),
    api.get('/api/settings/red/puertos'),
    api.get('/api/settings/backups'),
  ]);
  datos = configuracion;
  rolesDatos = roles;
  redDatos = { ...red, puertos: puertos.puertos || [] };
  respaldosDatos = respaldos;
  registrarRoles(roles.roles);

  $('#info-sistema').textContent = datos.sistema || 'SGCPM-ISIM';
  $('#info-version').textContent = datos.version ? `v${datos.version}` : '—';
  $('#info-build').textContent = datos.buildId || '—';
  $('#info-desarrollador').textContent = datos.desarrolladoPor || '—';
  $('#info-potenciado').textContent = datos.potenciadoPor || '—';
  $('#info-stack').textContent = datos.stack || '—';

  const puedeCambiar = puede(usuario, 'configuracion.gestionar');
  $('#zona-carga').hidden = !puedeCambiar;
  $('#aviso-sin-permiso').hidden = puedeCambiar;
  $('#aviso-sin-permiso-pie').hidden = puedeCambiar;

  renderLogo();
  renderCentro();
  renderPie();
  renderTextosConsentimiento();
  renderAlertas();
  renderAgenda();
  renderRed();
  renderRespaldos();
  renderActualizaciones();
  renderRoles();
  renderWhatsApp();
  renderDemo();
  renderMigracion();
}

async function seleccionarArchivo() {
  const archivo = $('#archivo-logo').files?.[0];
  if (!archivo) return;

  if (archivo.type !== 'image/png') {
    toast('El logo debe ser una imagen PNG', 'error');
    return;
  }
  if (archivo.size > 2 * 1024 * 1024) {
    toast('El PNG supera los 2 MB', 'error');
    return;
  }

  try {
    logoPendiente = await leerArchivo(archivo);
    $('#logo-preview').innerHTML = `<img src="${logoPendiente}" alt="Vista previa del logo">`;
    $('#vista-previa-encabezado').hidden = false;
    $('#vista-previa-encabezado img').src = logoPendiente;
    $('#btn-guardar-logo').disabled = false;
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function guardarCentro() {
  const boton = $('#btn-guardar-centro');
  const nombre = $('#centro-nombre').value.trim();
  const direccion = $('#centro-direccion').value.trim();
  const ruc = $('#centro-ruc').value.trim();
  const telefono = $('#centro-telefono').value.trim();

  if (!nombre) return toast('Escribe el nombre del centro médico', 'error');

  setBusy(boton, true, 'Guardando…');

  try {
    await api.post('/api/settings/centro', { nombre, direccion, ruc, telefono });
    setBusy(boton, false);
    toast('Datos del centro médico actualizados', 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function guardarLogo() {
  if (!logoPendiente) return;

  const boton = $('#btn-guardar-logo');
  setBusy(boton, true, 'Guardando…');

  try {
    await api.post('/api/settings/logo', { image: logoPendiente });
    setBusy(boton, false);
    logoPendiente = null;
    $('#archivo-logo').value = '';
    $('#btn-guardar-logo').disabled = true;
    toast('Logo del encabezado actualizado', 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function quitarLogo() {
  if (!window.confirm('¿Quitar el logo del encabezado de los documentos?')) return;

  try {
    await api.delete('/api/settings/logo');
    toast('Logo eliminado', 'success');
    logoPendiente = null;
    $('#archivo-logo').value = '';
    $('#btn-guardar-logo').disabled = true;
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function guardarPie() {
  const boton = $('#btn-guardar-pie');
  const texto = $('#pie-texto').value.trim();

  setBusy(boton, true, 'Guardando…');

  try {
    await api.post('/api/settings/pie', { texto });
    setBusy(boton, false);
    toast(texto ? 'Pie de página actualizado' : 'Pie de página eliminado', 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function quitarPie() {
  if (!window.confirm('¿Quitar el pie de página de los documentos?')) return;

  try {
    await api.delete('/api/settings/pie');
    toast('Pie de página eliminado', 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function guardarAlertas() {
  const boton = $('#btn-guardar-alertas');
  setBusy(boton, true, 'Guardando…');

  try {
    await api.post('/api/settings/alertas', {
      examenesPendientes: $('#alerta-examenes').checked,
    });
    setBusy(boton, false);
    toast('Preferencia de alertas actualizada', 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

function aplicarRespuestaRed(resultado) {
  redDatos = { ...redDatos, ...resultado, puertos: redDatos?.puertos || [] };
  renderRed();
}

async function guardarPuerto() {
  const boton = $('#btn-guardar-puerto');
  const aviso = $('#red-puerto-error');
  const personalizado = $('#red-puerto-custom').value.trim();
  const puerto = personalizado ? Number(personalizado) : Number($('#red-puerto').value);

  aviso.hidden = true;
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    aviso.textContent = 'Elige un puerto válido entre 1 y 65535.';
    aviso.hidden = false;
    return;
  }

  setBusy(boton, true, 'Aplicando…');
  try {
    const resultado = await api.post('/api/settings/red/puerto', { puerto });
    $('#red-puerto-custom').value = '';
    aplicarRespuestaRed(resultado);
    toast(`Puerto ${puerto} aplicado`, 'success');

    const disponibles = await api.get('/api/settings/red/puertos');
    redDatos.puertos = disponibles.puertos || [];
    renderRed();
  } catch (error) {
    aviso.textContent = error.message;
    aviso.hidden = false;
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
  }
}

async function guardarRestriccion() {
  const boton = $('#btn-guardar-restriccion');
  setBusy(boton, true, 'Guardando…');

  try {
    const resultado = await api.post('/api/settings/red/restriccion', {
      activa: $('#red-restriccion').checked,
      confiarProxy: $('#red-confiar-proxy').checked,
    });
    aplicarRespuestaRed(resultado);
    toast('Restricción por IP actualizada', 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
  }
}

async function detectarMacIp(ip, boton = null) {
  setBusy(boton, true, 'Detectando…');
  try {
    const { mac } = await api.post('/api/settings/red/mac', { ip });
    const entrada = (redDatos?.ips || []).find((item) => item.ip === ip);
    if (entrada) {
      const resultado = await api.post('/api/settings/red/ips', {
        ip,
        mac,
        descripcion: entrada.descripcion || '',
      });
      aplicarRespuestaRed(resultado);
    }
    toast(`MAC de ${ip}: ${mac}`, 'success');
    return mac;
  } catch (error) {
    toast(error.message, 'error');
    return null;
  } finally {
    setBusy(boton, false);
  }
}

async function detectarMacFormulario() {
  const ip = $('#red-ip').value.trim();
  if (!ip || ip.includes('/')) {
    return toast('Escribe una IP exacta para detectar la MAC', 'error');
  }
  const mac = await detectarMacIp(ip, $('#btn-detectar-mac'));
  if (mac) $('#red-mac').value = mac;
}

async function agregarIp(evento) {
  evento.preventDefault();

  const ip = $('#red-ip').value.trim();
  if (!ip) return toast('Escribe una IP o un rango CIDR', 'error');

  try {
    const resultado = await api.post('/api/settings/red/ips', {
      ip,
      mac: $('#red-mac').value.trim(),
      descripcion: $('#red-ip-descripcion').value.trim(),
    });
    $('#red-ip').value = '';
    $('#red-mac').value = '';
    $('#red-ip-descripcion').value = '';
    aplicarRespuestaRed(resultado);
    toast('IP agregada a la lista', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function eliminarIp(ip) {
  if (!window.confirm(`¿Quitar ${ip} de la lista de IPs permitidas?`)) return;

  try {
    const resultado = await api.delete('/api/settings/red/ips', { ip });
    aplicarRespuestaRed(resultado);
    toast('IP eliminada de la lista', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function pingIp(ip, silencioso = false) {
  const indicador = document.querySelector(`[data-estado-ip="${ip}"]`);
  if (indicador) indicador.textContent = 'Verificando…';

  try {
    const resultado = await api.post('/api/settings/red/ping', { ip });
    estadosPing.set(ip, resultado);
  } catch (error) {
    estadosPing.set(ip, {
      enRed: null,
      ms: null,
      detalle: error.message,
    });
  }

  if (indicador) {
    indicador.innerHTML = insigniaRed(ip);
    indicador.title = estadosPing.get(ip).detalle || '';
  }
  if (!silencioso && estadosPing.get(ip).enRed === null) {
    toast(estadosPing.get(ip).detalle || 'No se pudo verificar', 'error');
  }
  return estadosPing.get(ip);
}

async function pingTodos() {
  const boton = $('#btn-ping-todos');
  const ips = (redDatos?.ips || []).map((item) => item.ip);
  if (!ips.length) return toast('No hay IPs en la lista', 'error');

  setBusy(boton, true, 'Verificando…');
  try {
    await Promise.all(ips.map((ip) => pingIp(ip, true)));
    toast('Verificación de red terminada', 'success');
  } finally {
    setBusy(boton, false);
  }
}

async function guardarRespaldos() {
  const boton = $('#btn-guardar-respaldos');
  const aviso = $('#respaldos-config-error');
  aviso.hidden = true;
  setBusy(boton, true, 'Guardando…');

  try {
    const resultado = await api.post('/api/settings/backups/config', {
      directorio: $('#respaldos-directorio').value.trim(),
      frecuencia: $('#respaldos-frecuencia').value,
      hora: $('#respaldos-hora').value || '22:00',
      dia: Number($('#respaldos-dia').value),
      conservar: Number($('#respaldos-conservar').value),
      incluirFirmas: $('#respaldos-firmas').checked,
      incluirHistorias: $('#respaldos-historias').checked,
      incluirConfiguracion: $('#respaldos-configuracion').checked,
    });
    respaldosDatos = resultado;
    renderRespaldos();
    toast('Configuración de respaldos guardada', 'success');
  } catch (error) {
    aviso.textContent = error.message;
    aviso.hidden = false;
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
  }
}

async function respaldarAhora() {
  const boton = $('#btn-respaldar-ahora');
  const estado = $('#respaldos-accion-estado');
  estado.hidden = false;
  estado.textContent = 'Creando respaldo cifrado…';
  setBusy(boton, true, 'Respaldando…');

  try {
    const resultado = await api.post('/api/settings/backups/run', {});
    respaldosDatos = resultado;
    renderRespaldos();
    const archivo = resultado.resultado?.archivo || 'respaldo';
    estado.textContent = `Respaldo creado: ${archivo} · ${formatoBytes(resultado.resultado?.bytes)}`;
    toast(`Respaldo creado: ${archivo}`, 'success');
  } catch (error) {
    estado.textContent = error.message;
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
  }
}

async function verificarRespaldo(archivo, boton) {
  setBusy(boton, true, 'Verificando…');
  try {
    const resultado = await api.post('/api/settings/backups/verify', { archivo });
    const items = (resultado.manifiesto?.items || [])
      .map((clave) => ETIQUETAS_RESPALDO[clave] || clave)
      .join(', ');
    toast(`Respaldo verificado correctamente${items ? `: ${items}` : ''}`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(boton, false);
  }
}

function descargarClaveRespaldos() {
  window.location.href = '/api/settings/backups/clave';
}

async function guardarAgenda() {
  const boton = $('#btn-guardar-agenda');
  setBusy(boton, true, 'Guardando…');

  try {
    await api.post('/api/settings/agenda', {
      permitirCitasSimultaneas: $('#permitir-citas-simultaneas').checked,
      vistaAgenda: $('#vista-agenda-defecto').value,
    });
    setBusy(boton, false);
    toast('Configuración de agenda actualizada', 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function guardarActualizaciones() {
  const boton = $('#btn-guardar-actualizaciones');
  setBusy(boton, true, 'Guardando…');

  try {
    await api.post('/api/settings/actualizaciones', {
      automaticas: $('#actualizaciones-automaticas').checked,
    });
    setBusy(boton, false);
    toast('Preferencia de actualizaciones guardada', 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function guardarWhatsApp() {
  const boton = $('#btn-guardar-whatsapp');
  setBusy(boton, true, 'Guardando…');

  const datosWhatsApp = {
    habilitado: $('#whatsapp-habilitado').checked,
    auto: $('#whatsapp-auto').checked,
    phoneNumberId: $('#whatsapp-phone-id').value.trim(),
    apiVersion: $('#whatsapp-api-version').value.trim(),
    template: $('#whatsapp-template').value.trim(),
    language: $('#whatsapp-language').value.trim(),
    countryCode: $('#whatsapp-country-code').value.trim(),
    verifyToken: $('#whatsapp-verify-token').value.trim(),
  };

  const token = $('#whatsapp-token').value.trim();
  if (token) datosWhatsApp.token = token;
  const appSecret = $('#whatsapp-app-secret').value.trim();
  if (appSecret) datosWhatsApp.appSecret = appSecret;

  try {
    await api.post('/api/settings/whatsapp', datosWhatsApp);
    setBusy(boton, false);
    toast('Configuración de WhatsApp guardada', 'success');
    await cargar();
  } catch (error) {
    setBusy(boton, false);
    toast(error.message, 'error');
  }
}

async function quitarTokenWhatsApp() {
  if (!window.confirm('¿Quitar el token de WhatsApp guardado?')) return;

  try {
    await api.delete('/api/settings/whatsapp/token');
    toast('Token de WhatsApp eliminado', 'success');
    await cargar();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function guardarDemo() {
  const activo = $('#demo-activo').checked;

  if (activo === (datos?.demoActivo === true)) {
    toast('El modo DEMO ya tiene ese estado');
    return;
  }

  const mensaje = activo
    ? 'Se cargarán 1000 pacientes y 5000 citas de demostración. ¿Continuar?'
    : 'Se eliminarán todos los datos de demostración. Los datos reales no se modificarán. ¿Continuar?';

  if (!window.confirm(mensaje)) {
    renderDemo();
    return;
  }

  const boton = $('#btn-guardar-demo');
  setBusy(boton, true, activo ? 'Cargando datos…' : 'Eliminando datos…');

  try {
    const resultado = await api.post('/api/settings/demo', { activo });
    setBusy(boton, false);
    toast(
      activo ? 'Datos de demostración cargados' : 'Datos de demostración eliminados',
      'success'
    );
    await cargar();

    if (resultado.demoPacientesBloqueados > 0) {
      toast(
        `Se conservaron ${resultado.demoPacientesBloqueados} pacientes de demostración con documentos reales.`,
        'error'
      );
    }
  } catch (error) {
    setBusy(boton, false);
    renderDemo();
    toast(error.message, 'error');
  }
}

function cambiarPestana(nombre) {
  for (const tab of $$('.tab')) {
    const activo = tab.dataset.tab === nombre;
    tab.classList.toggle('is-active', activo);
    tab.setAttribute('aria-selected', String(activo));
  }
  $('#panel-encabezado').hidden = nombre !== 'encabezado';
  $('#panel-pie').hidden = nombre !== 'pie';
  $('#panel-consentimiento').hidden = nombre !== 'consentimiento';
  $('#panel-alertas').hidden = nombre !== 'alertas';
  $('#panel-agenda').hidden = nombre !== 'agenda';
  $('#panel-red').hidden = nombre !== 'red';
  $('#panel-respaldos').hidden = nombre !== 'respaldos';
  $('#panel-roles').hidden = nombre !== 'roles';
  $('#panel-whatsapp').hidden = nombre !== 'whatsapp';
  $('#panel-demo').hidden = nombre !== 'demo';
  $('#panel-migracion').hidden = nombre !== 'migracion';
  $('#panel-actualizaciones').hidden = nombre !== 'actualizaciones';
  $('#panel-info').hidden = nombre !== 'info';
}

function conectarEventos() {
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => cambiarPestana(tab.dataset.tab));
  }

  $('#archivo-logo').addEventListener('change', seleccionarArchivo);
  $('#btn-guardar-logo').addEventListener('click', guardarLogo);
  $('#btn-quitar-logo').addEventListener('click', quitarLogo);
  $('#btn-guardar-centro').addEventListener('click', guardarCentro);

  $('#pie-texto').addEventListener('input', actualizarContadorPie);
  $('#btn-guardar-pie').addEventListener('click', guardarPie);
  $('#btn-quitar-pie').addEventListener('click', quitarPie);
  for (const id of ['#consent-declaracion', '#consent-negativa', '#consent-revocatoria']) {
    $(id).addEventListener('input', actualizarPreviewConsentimiento);
  }
  $('#btn-guardar-consentimiento').addEventListener('click', () =>
    guardarTextosConsentimiento()
  );
  $('#btn-restaurar-consentimiento').addEventListener('click', () =>
    guardarTextosConsentimiento({ restaurar: true })
  );
  $('#btn-guardar-alertas').addEventListener('click', guardarAlertas);
  $('#btn-guardar-agenda').addEventListener('click', guardarAgenda);
  $('#btn-guardar-puerto').addEventListener('click', guardarPuerto);
  $('#btn-guardar-restriccion').addEventListener('click', guardarRestriccion);
  $('#respaldos-frecuencia').addEventListener('change', actualizarCamposFrecuencia);
  $('#btn-guardar-respaldos').addEventListener('click', guardarRespaldos);
  $('#btn-respaldar-ahora').addEventListener('click', respaldarAhora);
  $('#btn-descargar-clave').addEventListener('click', descargarClaveRespaldos);
  $('#btn-ping-todos').addEventListener('click', pingTodos);
  $('#btn-detectar-mac').addEventListener('click', detectarMacFormulario);
  $('#form-ip').addEventListener('submit', agregarIp);
  $('#btn-guardar-actualizaciones').addEventListener('click', guardarActualizaciones);
  $('#btn-nuevo-rol').addEventListener('click', nuevoRol);
  $('#form-rol').addEventListener('submit', guardarRol);
  $('#btn-eliminar-rol').addEventListener('click', eliminarRol);
  $('#rol-nombre').addEventListener('input', () => {
    if (!rolEditando) $('#rol-slug').value = slugPreview($('#rol-nombre').value);
  });
  $('#btn-guardar-whatsapp').addEventListener('click', guardarWhatsApp);
  $('#btn-quitar-token-whatsapp').addEventListener('click', quitarTokenWhatsApp);
  $('#btn-guardar-demo').addEventListener('click', guardarDemo);
  $('#btn-analizar-migracion').addEventListener('click', analizarMigracion);
  $('#btn-ejecutar-migracion').addEventListener('click', ejecutarMigracion);
  $('#btn-revisar-duplicados').addEventListener('click', revisarDuplicados);
  $('#btn-depurar-duplicados').addEventListener('click', depurarDuplicados);
  $('#migracion-archivo').addEventListener('change', () => {
    migracionAnalisis = null;
    $('#migracion-resumen').hidden = true;
    $('#migracion-acciones').hidden = true;
    $('#migracion-estado').textContent = '';
  });
}

async function init() {
  usuario = await initChrome({ active: 'ajustes' });
  if (!usuario) return;

  if (!puede(usuario, 'configuracion.ver')) {
    window.location.replace('/documentos.html');
    return;
  }

  conectarEventos();
  await cargar();
}

init();
