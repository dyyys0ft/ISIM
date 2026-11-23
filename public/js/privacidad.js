import { api } from './api.js';
import { escapeHtml } from './ui.js';

/** Deja visibles solo los últimos 4 caracteres del teléfono. */
export function mascararTelefono(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  const digitos = texto.replace(/\D/g, '');
  if (!digitos) return '••••';
  return `•••• ${digitos.slice(-4)}`;
}

/** Deja visibles solo los primeros 4 caracteres del correo y su dominio. */
export function mascararEmail(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  const [local, dominio] = texto.split('@');
  if (dominio) {
    const visibles = local.slice(0, 4) || '••••';
    return `${visibles}••••@${dominio}`;
  }
  return texto.length > 4 ? `${texto.slice(0, 4)}••••` : '••••';
}

export function iconoOjo() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>`;
}

/**
 * Contacto enmascarado con botón de ojo. Los valores completos solo se
 * muestran tras la acción del usuario y ese revelado queda auditado.
 */
export function htmlContactoPrivado(paciente, { compacto = false } = {}) {
  const telefono = String(paciente?.telefono ?? '').trim();
  const email = String(paciente?.email ?? '').trim();
  if (!telefono && !email) return '';

  const items = [
    telefono
      ? `<span class="contacto-privado__item" title="Teléfono">
           <span class="contacto-privado__icono" aria-hidden="true">☎</span>
           <span data-contacto="telefono" data-valor="${escapeHtml(telefono)}">${escapeHtml(
             mascararTelefono(telefono)
           )}</span>
         </span>`
      : '',
    email
      ? `<span class="contacto-privado__item" title="Correo electrónico">
           <span class="contacto-privado__icono" aria-hidden="true">✉</span>
           <span data-contacto="email" data-valor="${escapeHtml(email)}">${escapeHtml(
             mascararEmail(email)
           )}</span>
         </span>`
      : '',
  ].join('');

  return `<div class="contacto-privado${compacto ? ' contacto-privado--compacto' : ''}"
    data-contacto-privado data-paciente-id="${escapeHtml(paciente?.id || '')}">
    ${items}
    <button class="contacto-privado__ojo" type="button" data-revelar-contacto
      aria-pressed="false" aria-label="Mostrar datos de contacto"
      title="Mostrar datos de contacto">${iconoOjo()}</button>
  </div>`;
}

/** Conecta los botones de ojo dentro de un contenedor recién renderizado. */
export function activarContactoPrivado(raiz = document) {
  for (const boton of raiz.querySelectorAll('[data-revelar-contacto]')) {
    if (boton.dataset.conectado === '1') continue;
    boton.dataset.conectado = '1';

    boton.addEventListener('click', async () => {
      const contenedor = boton.closest('[data-contacto-privado]');
      if (!contenedor) return;

      const revelado = contenedor.dataset.revelado === '1';
      for (const item of contenedor.querySelectorAll('[data-contacto]')) {
        const completo = item.dataset.valor || '';
        item.textContent = revelado
          ? item.dataset.contacto === 'email'
            ? mascararEmail(completo)
            : mascararTelefono(completo)
          : completo;
      }

      contenedor.dataset.revelado = revelado ? '0' : '1';
      boton.setAttribute('aria-pressed', String(!revelado));
      const etiqueta = revelado ? 'Mostrar datos de contacto' : 'Ocultar datos de contacto';
      boton.setAttribute('aria-label', etiqueta);
      boton.title = etiqueta;

      if (!revelado) {
        try {
          await api.post(
            `/api/patients/${encodeURIComponent(contenedor.dataset.pacienteId)}/contacto-visto`,
            {}
          );
        } catch {
          // La visualización no debe romperse si falla la auditoría.
        }
      }
    });
  }
}
