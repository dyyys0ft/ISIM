import { api } from '../api.js';
import { $, $$, escapeHtml, etiquetaRol, toast } from '../ui.js';
import { initChrome } from '../chrome.js';

const documentId = new URLSearchParams(location.search).get('documentId') || '';

let registros = [];
let temporizador = null;

function isoInicio(fecha) {
  return fecha ? new Date(`${fecha}T00:00:00`).toISOString() : '';
}

function isoFin(fecha) {
  return fecha ? new Date(`${fecha}T23:59:59.999`).toISOString() : '';
}

function partesFecha(iso) {
  const fecha = new Date(iso);
  return {
    dia: fecha.toLocaleDateString('es-EC', { weekday: 'long' }),
    fecha: fecha.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }),
    hora: fecha.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }),
  };
}

async function cargarEmpleados() {
  try {
    const empleados = await api.get('/api/signatures/employees');
    const select = $('#f-empleado');
    const actual = select.value;
    select.innerHTML =
      '<option value="">Todos</option>' +
      empleados
        .map(
          (empleado) =>
            `<option value="${escapeHtml(empleado.id)}">${escapeHtml(
              empleado.nombre || 'Sin nombre'
            )} (${empleado.firmas})</option>`
        )
        .join('');
    select.value = actual;
  } catch {
    // el filtro queda solo con "Todos"
  }
}

async function cargar() {
  const query = new URLSearchParams();
  const desde = $('#f-desde').value;
  const hasta = $('#f-hasta').value;
  const empleado = $('#f-empleado').value;
  const q = $('#f-buscar').value.trim();

  if (desde) query.set('desde', isoInicio(desde));
  if (hasta) query.set('hasta', isoFin(hasta));
  if (empleado) query.set('userId', empleado);
  if (documentId) query.set('documentId', documentId);
  if (q) query.set('q', q);

  try {
    registros = await api.get(`/api/signatures?${query.toString()}`);
    render();
  } catch (error) {
    if (error.status === 401) return window.location.replace('/');
    toast(error.message, 'error');
  }
}

function render() {
  const timeline = $('#timeline');
  const vacio = $('#vacio');
  $('#contador').textContent = `${registros.length} firma${
    registros.length === 1 ? '' : 's'
  } registrada${registros.length === 1 ? '' : 's'}`;

  if (!registros.length) {
    timeline.replaceChildren();
    timeline.hidden = true;
    vacio.hidden = false;
    return;
  }

  vacio.hidden = true;
  timeline.hidden = false;

  const ordenados = registros.toSorted(
    (a, b) => new Date(b.firmadoEn) - new Date(a.firmadoEn)
  );
  const grupos = new Map();
  for (const registro of ordenados) {
    const clave = new Date(registro.firmadoEn).toLocaleDateString('en-CA');
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(registro);
  }

  timeline.innerHTML = [...grupos.entries()]
    .map(([, items]) => {
      const { dia, fecha } = partesFecha(items[0].firmadoEn);
      return `
        <section class="timeline-group">
          <h2 class="timeline-group__titulo">
            <span>${escapeHtml(dia)}</span> ${escapeHtml(fecha)}
          </h2>
          <div class="timeline-group__items">
            ${items
              .map((registro) => {
                const { hora } = partesFecha(registro.firmadoEn);
                const empleado = registro.empleado?.nombre || 'No registrado';
                const rol = registro.empleado?.rol
                  ? etiquetaRol(registro.empleado.rol)
                  : '';

                return `
                  <article class="timeline-item">
                    <div class="timeline-item__axis">
                      <span class="timeline-item__dot" aria-hidden="true"></span>
                      <time>${escapeHtml(hora)}</time>
                    </div>
                    <div class="timeline-item__card">
                      <div class="timeline-item__head">
                        <div>
                          <h3>${escapeHtml(registro.titulo)}</h3>
                          <span class="timeline-item__version">Versión V${registro.version}</span>
                        </div>
                        <span class="badge badge--activo">Firmado</span>
                      </div>
                      <div class="timeline-item__meta">
                        <span><strong>Paciente:</strong> ${escapeHtml(
                          registro.paciente.nombre || '—'
                        )} · C.I. ${escapeHtml(registro.paciente.cedula || '—')}</span>
                        <span><strong>Gestionado por:</strong> ${escapeHtml(empleado)}${
                          rol ? ` · ${escapeHtml(rol)}` : ''
                        }</span>
                      </div>
                      <div class="timeline-item__actions">
                        <a class="btn btn--sm btn--primary" href="/documento.html?id=${encodeURIComponent(
                          registro.documentId
                        )}">Abrir documento</a>
                        <a class="btn btn--sm" href="/api/signatures/${encodeURIComponent(
                          registro.id
                        )}/image" target="_blank" rel="noopener">Ver firma</a>
                        <a class="btn btn--sm btn--ghost" href="/registro.html?documentId=${encodeURIComponent(
                          registro.documentId
                        )}">Solo este documento</a>
                      </div>
                    </div>
                  </article>`;
              })
              .join('')}
          </div>
        </section>`;
    })
    .join('');
}

function exportarCsv() {
  if (!registros.length) {
    toast('No hay firmas para exportar', 'error');
    return;
  }

  const filas = [['Día', 'Fecha', 'Hora', 'Paciente', 'Cédula', 'Documento', 'Versión', 'Empleado', 'Rol']];

  for (const registro of registros) {
    const { dia, fecha, hora } = partesFecha(registro.firmadoEn);
    filas.push([
      dia,
      fecha,
      hora,
      registro.paciente.nombre,
      registro.paciente.cedula,
      registro.titulo,
      `V${registro.version}`,
      registro.empleado?.nombre || '',
      etiquetaRol(registro.empleado?.rol),
    ]);
  }

  const csv =
    '\uFEFF' +
    filas
      .map((fila) =>
        fila
          .map((valor) => {
            let texto = String(valor ?? '');
            if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
            return `"${texto.replaceAll('"', '""')}"`;
          })
          .join(';')
      )
      .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `registro-firmas-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

async function cargarDocumentoFiltro() {
  if (!documentId) return;

  try {
    const documento = await api.get(`/api/documents/${encodeURIComponent(documentId)}`);
    $('#chip-documento-texto').textContent = documento.titulo;
    $('#chip-documento').hidden = false;
  } catch {
    toast('El documento del filtro no está disponible', 'error');
  }
}

function fechaLocal(fecha) {
  return fecha.toLocaleDateString('en-CA');
}

function marcarRango(valor) {
  for (const boton of $$('[data-rango]')) {
    boton.classList.toggle('is-active', boton.dataset.rango === valor);
  }
}

function aplicarRango(valor) {
  const hoy = new Date();
  let desde = '';
  let hasta = '';

  if (valor === 'hoy') {
    desde = fechaLocal(hoy);
    hasta = desde;
  } else if (valor === '7') {
    const inicio = new Date(hoy);
    inicio.setDate(inicio.getDate() - 6);
    desde = fechaLocal(inicio);
    hasta = fechaLocal(hoy);
  } else if (valor === 'mes') {
    desde = fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    hasta = fechaLocal(hoy);
  }

  $('#f-desde').value = desde;
  $('#f-hasta').value = hasta;
  marcarRango(valor);
  cargar();
}

function conectarEventos() {
  $('#filtros').addEventListener('submit', (evento) => {
    evento.preventDefault();
    cargar();
  });

  $('#f-empleado').addEventListener('change', cargar);

  $('#f-buscar').addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(cargar, 300);
  });

  for (const boton of $$('[data-rango]')) {
    boton.addEventListener('click', () => aplicarRango(boton.dataset.rango));
  }

  for (const selector of ['#f-desde', '#f-hasta']) {
    $(selector).addEventListener('change', () => marcarRango(''));
  }

  $('#btn-limpiar').addEventListener('click', () => {
    if (documentId) {
      window.location.href = '/registro.html';
      return;
    }
    $('#f-desde').value = '';
    $('#f-hasta').value = '';
    $('#f-empleado').value = '';
    $('#f-buscar').value = '';
    marcarRango('todos');
    cargar();
  });

  $('#quitar-documento').addEventListener('click', () => {
    window.location.href = '/registro.html';
  });

  $('#btn-csv').addEventListener('click', exportarCsv);
}

async function init() {
  const usuario = await initChrome({ active: 'registro' });
  if (!usuario) return;

  conectarEventos();
  marcarRango('todos');
  await cargarDocumentoFiltro();
  await cargarEmpleados();
  await cargar();
}

init();
