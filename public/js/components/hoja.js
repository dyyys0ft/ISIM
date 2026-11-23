import { fmtFecha } from '../ui.js';

function crearCelda({ firmaUrl = null, rol, nombre, especialidad = null, cedula, senecit = null }) {
  const celda = document.createElement('div');
  celda.className = 'firma-celda';

  if (firmaUrl) {
    const imagen = document.createElement('img');
    imagen.className = 'firma-capturada';
    imagen.src = firmaUrl;
    imagen.alt = rol;
    celda.append(imagen);
  }

  const linea = document.createElement('span');
  linea.className = 'firma-linea';
  celda.append(linea);

  const etiqueta = document.createElement('span');
  etiqueta.className = 'firma-rol';
  etiqueta.textContent = rol;
  celda.append(etiqueta);

  const nombreEl = document.createElement('strong');
  nombreEl.className = 'firma-nombre';
  nombreEl.textContent = nombre || '';
  celda.append(nombreEl);

  if (especialidad) {
    const especialidadEl = document.createElement('small');
    especialidadEl.className = 'firma-especialidad';
    especialidadEl.textContent = `Especialidad: ${especialidad}`;
    celda.append(especialidadEl);
  }

  if (cedula) {
    const cedulaEl = document.createElement('small');
    cedulaEl.className = 'firma-cedula';
    cedulaEl.textContent = `C.I. ${cedula}`;
    celda.append(cedulaEl);
  }

  if (senecit !== null && senecit !== undefined) {
    const senecitEl = document.createElement('small');
    senecitEl.className = 'firma-senecit';
    senecitEl.textContent = senecit ? `SENECYT: ${senecit}` : 'SENECYT: —';
    celda.append(senecitEl);
  }

  return celda;
}

/**
 * Inserta el logo, reconstruye el bloque de firmas (imagen sobre la línea)
 * y agrega el pie de firma digital.
 */
export function decorarHoja(
  hoja,
  {
    logoUrl = null,
    centro = null,
    pieTexto = null,
    codigo = null,
    titulo = null,
    paciente = null,
    firmante = null,
    medico = null,
    firmaPacienteUrl = null,
    firmaModo = 'ambas',
    firmadoEn = null,
    gestionadoNombre = null,
    anuladoEn = null,
  } = {}
) {
  hoja
    .querySelectorAll(
      '.firma-impresa, .doc-footer-firmado, .doc-codigo, .doc-identificacion, .doc-representante, .doc-pie, .marca-agua-anulado'
    )
    .forEach((nodo) => nodo.remove());

  let encabezado = null;
  if (logoUrl) {
    encabezado = document.createElement('div');
    encabezado.className = 'doc-encabezado';
    const imagen = document.createElement('img');
    imagen.src = logoUrl;
    imagen.alt = 'Encabezado institucional';
    encabezado.append(imagen);
    hoja.prepend(encabezado);
  }

  // El código y el nombre van juntos arriba de la imagen del encabezado.
  if (codigo || titulo) {
    const identificacion = document.createElement('div');
    identificacion.className = 'doc-identificacion';

    if (codigo) {
      const lineaCodigo = document.createElement('span');
      lineaCodigo.className = 'doc-identificacion__codigo';
      lineaCodigo.textContent = `Código: ${codigo}`;
      identificacion.append(lineaCodigo);
    }

    if (titulo) {
      const lineaTitulo = document.createElement('strong');
      lineaTitulo.className = 'doc-identificacion__titulo';
      lineaTitulo.textContent = titulo;
      identificacion.append(lineaTitulo);
    }

    hoja.prepend(identificacion);
  }

  // Sin logo configurado: se usa el nombre y la dirección del centro médico.
  if (!logoUrl && centro?.nombre) {
    const bloqueCentro = document.createElement('div');
    bloqueCentro.className = 'doc-centro';

    const nombreCentroEl = document.createElement('strong');
    nombreCentroEl.textContent = centro.nombre;
    bloqueCentro.append(nombreCentroEl);

    if (centro.direccion) {
      const direccionEl = document.createElement('span');
      direccionEl.textContent = centro.direccion;
      bloqueCentro.append(direccionEl);
    }

    hoja.prepend(bloqueCentro);
  }

  // La fecha de la carta queda justo debajo del encabezado, alineada a la derecha.
  const fechaCarta = hoja.querySelector('.doc-fecha-carta');
  if (fechaCarta && encabezado) {
    encabezado.after(fechaCarta);
  }

  // Con logo, la dirección del centro se muestra como una línea discreta.
  if (logoUrl && centro?.direccion && encabezado) {
    const direccionEl = document.createElement('p');
    direccionEl.className = 'doc-centro-direccion';
    direccionEl.textContent = centro.direccion;
    if (fechaCarta) fechaCarta.after(direccionEl);
    else encabezado.after(direccionEl);
  }

  // Paciente menor de edad: se informa quién firma en su representación.
  if (paciente?.es_menor && (firmante || paciente?.representantes?.length)) {
    const aviso = document.createElement('div');
    aviso.className = 'doc-representante';

    const tituloAviso = document.createElement('strong');
    tituloAviso.textContent = 'Paciente menor de edad';
    aviso.append(tituloAviso);

    for (const representante of paciente.representantes || []) {
      const linea = document.createElement('span');
      const etiqueta = representante.principal
        ? 'Representante legal'
        : 'Representante legal alterno';
      linea.textContent = `${etiqueta}: ${representante.nombre}${
        representante.cedula ? ` · C.I. ${representante.cedula}` : ''
      }${representante.parentesco ? ` · ${representante.parentesco}` : ''}`;
      aviso.append(linea);
    }

    if (firmante) {
      const lineaFirma = document.createElement('span');
      lineaFirma.className = 'doc-representante__firma';
      lineaFirma.textContent = 'El consentimiento lo firma el representante legal.';
      aviso.append(lineaFirma);
    }

    const firmas = hoja.querySelector('.doc-firmas');
    if (firmas) firmas.before(aviso);
    else hoja.append(aviso);
  }

  const bloqueAnterior = hoja.querySelector('.doc-firmas');
  const bloque = document.createElement('div');
  bloque.className = 'doc-firmas';

  const nombrePaciente =
    paciente?.nombre || `${paciente?.nombres || ''} ${paciente?.apellidos || ''}`.trim();

  const mostrarPaciente = firmaModo !== 'medico';
  const mostrarMedico = firmaModo !== 'paciente';
  const celdas = [];

  if (mostrarPaciente) {
    celdas.push(
      crearCelda({
        firmaUrl: firmaPacienteUrl,
        rol: firmante?.rol || 'Firma de la paciente',
        nombre: firmante?.nombre || nombrePaciente,
        cedula: firmante?.cedula || paciente?.cedula || '',
      })
    );
  }

  if (mostrarMedico) {
    celdas.push(
      crearCelda({
        firmaUrl: medico?.firmaUrl || null,
        rol: 'Firma del profesional',
        nombre: medico?.nombre || '',
        especialidad: medico?.especialidad || null,
        cedula: medico?.cedula || '',
        senecit: medico ? medico.senecit || '' : null,
      })
    );
  }

  if (celdas.length === 1) bloque.classList.add('doc-firmas--unica');
  bloque.append(...celdas);

  if (bloqueAnterior) {
    bloqueAnterior.replaceWith(bloque);
  } else {
    const fechaAntigua = hoja.querySelector('.doc-fecha');
    if (fechaAntigua) fechaAntigua.before(bloque);
    else hoja.append(bloque);
  }

  if (firmadoEn) {
    const pie = document.createElement('p');
    pie.className = 'doc-footer-firmado';
    const fecha = fmtFecha(firmadoEn, { time: true, weekday: true });
    pie.textContent = `Firmado Digitalmente el ${fecha}${
      gestionadoNombre ? ` · Registrado por ${gestionadoNombre}` : ''
    }`;
    hoja.append(pie);
  }

  // Pie de página configurable: texto que se muestra al final del documento.
  if (pieTexto) {
    const pie = document.createElement('footer');
    pie.className = 'doc-pie';
    const texto = document.createElement('p');
    texto.className = 'doc-pie__texto';
    texto.textContent = pieTexto;
    pie.append(texto);
    hoja.append(pie);
  }

  if (anuladoEn) {
    const marca = document.createElement('div');
    marca.className = 'marca-agua-anulado';
    const titulo = document.createElement('strong');
    titulo.textContent = 'ANULADO';
    const fecha = document.createElement('span');
    fecha.textContent = fmtFecha(anuladoEn, { weekday: true, time: true });
    marca.append(titulo, fecha);
    hoja.append(marca);
  }
}
