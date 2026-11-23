import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Normaliza un nombre de usuario: sin tildes, minúsculas y sin espacios externos. */
export function normalizarUsername(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function esUsernameValido(valor) {
  return USERNAME_RE.test(normalizarUsername(valor));
}

export function validarUsername(valor) {
  const username = normalizarUsername(valor);
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(
      400,
      'El usuario debe tener entre 3 y 32 caracteres: minúsculas, números, punto, guion o guion bajo, y empezar por letra o número'
    );
  }
  return username;
}

export function validarPassword(valor) {
  const password = String(valor ?? '');
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'La contraseña debe tener entre 8 y 128 caracteres');
  }
  if (!/[a-záéíóúüñ]/i.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'La contraseña debe incluir al menos una letra y un número');
  }
  return password;
}

export function hashSecret(secreto) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(secreto), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifySecret(secreto, almacenado) {
  try {
    const [algo, salt, hash] = String(almacenado).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const candidato = scryptSync(String(secreto), salt, 32);
    const esperado = Buffer.from(hash, 'hex');
    return candidato.length === esperado.length && timingSafeEqual(candidato, esperado);
  } catch {
    return false;
  }
}

/** Genera un usuario legible a partir del nombre; la cédula ayuda si el nombre queda vacío. */
export function usernameDesdeNombre(nombre, cedula = '') {
  const base = normalizarUsername(nombre)
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 32);

  if (base.length >= 3) return base;

  const digitos = String(cedula ?? '').replace(/\D/g, '').slice(-8);
  return `usuario${digitos || String(Date.now()).slice(-6)}`;
}
