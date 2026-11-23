import { readFileSync } from 'node:fs';
import { decodificarTexto } from '../encoding.js';

function desescapar(valor) {
  return String(valor).replace(/\\(.)/g, (_, caracter) => {
    if (caracter === 'n') return '\n';
    if (caracter === 'r') return '\r';
    if (caracter === 't') return '\t';
    if (caracter === '0') return '\0';
    if (caracter === 'Z') return '\x1a';
    return caracter;
  });
}

function comillasCerradas(texto) {
  let comilla = false;
  let escape = false;
  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (caracter === '\\') {
      escape = true;
      continue;
    }
    if (caracter === "'") comilla = !comilla;
  }
  return !comilla;
}

function dividirValores(texto) {
  let interior = texto.trim();
  interior = interior.replace(/^\(/, '').replace(/\)[,;]?$/, '');

  const valores = [];
  let actual = '';
  let comilla = false;
  let escape = false;

  for (let i = 0; i < interior.length; i += 1) {
    const caracter = interior[i];
    if (escape) {
      actual += `\\${caracter}`;
      escape = false;
      continue;
    }
    if (caracter === '\\') {
      escape = true;
      continue;
    }
    if (caracter === "'") {
      comilla = !comilla;
      actual += caracter;
      continue;
    }
    if (caracter === ',' && !comilla) {
      valores.push(actual.trim());
      actual = '';
      continue;
    }
    actual += caracter;
  }
  valores.push(actual.trim());

  return valores.map((valor) => {
    if (/^NULL$/i.test(valor)) return null;
    if (valor.startsWith("'") && valor.endsWith("'")) {
      return desescapar(valor.slice(1, -1));
    }
    return valor;
  });
}

function columnasDeCreate(sql) {
  const mapa = new Map();
  for (const coincidencia of sql.matchAll(/CREATE TABLE `([^`]+)` \(([\s\S]*?)\) ENGINE=/g)) {
    const columnas = [];
    for (const linea of coincidencia[2].split(/\r?\n/)) {
      const columna = linea.trim().match(/^`([^`]+)`\s+/);
      if (columna) columnas.push(columna[1]);
    }
    mapa.set(coincidencia[1], columnas);
  }
  return mapa;
}

export function parsearDump(sql) {
  const lineas = sql.split(/\r?\n/);
  const columnasCreate = columnasDeCreate(sql);
  const tablas = new Map();
  let tabla = null;
  let columnas = null;
  let buffer = '';

  const guardarFila = (texto) => {
    if (!tabla || !texto.trim()) return;
    const valores = dividirValores(texto);
    const nombresColumnas = columnas || columnasCreate.get(tabla) || [];
    if (!nombresColumnas.length) return;
    const fila = {};
    nombresColumnas.forEach((nombre, indice) => {
      fila[nombre] = valores[indice] ?? null;
    });
    if (!tablas.has(tabla)) tablas.set(tabla, []);
    tablas.get(tabla).push(fila);
  };

  for (const linea of lineas) {
    const insert = linea.match(/^INSERT INTO `([^`]+)`\s*(?:\(([^)]*)\))?\s*VALUES/i);
    if (insert) {
      tabla = insert[1];
      columnas = insert[2]
        ? insert[2]
            .split(',')
            .map((columna) => columna.trim().replace(/^`|`$/g, ''))
            .filter(Boolean)
        : null;
      buffer = '';
      continue;
    }

    if (!tabla) continue;

    buffer += buffer ? `\n${linea}` : linea;
    if (comillasCerradas(buffer) && /\)[,;]\s*$/.test(buffer)) {
      guardarFila(buffer);
      buffer = '';
      if (/;\s*$/.test(linea)) tabla = null;
    }
  }

  return tablas;
}

export function leerDump(ruta) {
  return parsearDump(decodificarTexto(readFileSync(ruta)));
}

export function fechaValida(valor) {
  if (!valor) return null;
  const fecha = String(valor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  if (fecha.startsWith('0000-')) return null;
  const comprobacion = new Date(`${fecha}T12:00:00Z`);
  return Number.isNaN(comprobacion.getTime()) ? null : fecha;
}

export function normalizarCedula(valor) {
  return String(valor || '').replace(/\D/g, '');
}

export function separarNombre(nombreCompleto) {
  const partes = String(nombreCompleto || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (!partes.length) return { nombres: '', apellidos: '' };
  if (partes.length === 1) return { nombres: partes[0], apellidos: '' };
  if (partes.length === 2) return { nombres: partes[1], apellidos: partes[0] };

  return {
    apellidos: partes.slice(0, 2).join(' '),
    nombres: partes.slice(2).join(' '),
  };
}

export function resumirDump(tablas) {
  const filas = (tabla) => tablas.get(tabla) || [];
  const datos = filas('datos');
  const citas = filas('citamedica');
  const consultas = filas('cons');
  const examenes = filas('examenes');
  const recetas = filas('receta');

  const cedulas = new Map();
  let sinCedula = 0;
  let fechaEnSexo = 0;
  let fechaNacimientoInvalida = 0;
  let nombreCorto = 0;

  for (const fila of datos) {
    const cedula = normalizarCedula(fila.cedula);
    if (!cedula) sinCedula += 1;
    else cedulas.set(cedula, (cedulas.get(cedula) || 0) + 1);

    if (!fechaValida(fila.fnac)) {
      fechaNacimientoInvalida += 1;
      if (fechaValida(fila.sexo)) fechaEnSexo += 1;
    }

    if (String(fila.nombres || '').trim().split(/\s+/).filter(Boolean).length < 2) {
      nombreCorto += 1;
    }
  }

  const cedulasDuplicadas = [...cedulas.values()].filter((total) => total > 1).length;
  const citasConConsulta = citas.filter((fila) => fila.consultacod && fila.consultacod !== '0').length;
  const consultacods = new Set(
    citas.map((fila) => fila.consultacod).filter((codigo) => codigo && codigo !== '0')
  );
  const consultasSinCita = consultas.filter((fila) => !consultacods.has(fila.codigo)).length;

  const usuarios = new Set();
  for (const tabla of ['sistema', 'datos', 'citamedica', 'cons', 'examenes', 'receta']) {
    for (const fila of filas(tabla)) {
      const usuario = String(fila.codigouser || fila.usuario || '').trim().toLowerCase();
      if (usuario) usuarios.add(usuario);
    }
  }

  return {
    tablas: Object.fromEntries(
      [...tablas.entries()].map(([nombre, lista]) => [nombre, lista.length])
    ),
    usuarios: {
      total: usuarios.size,
      enSistema: filas('sistema').length,
    },
    pacientes: {
      total: datos.length,
      sinCedula,
      cedulasDuplicadas,
      fechaNacimientoInvalida,
      fechaEnSexo,
      nombreCorto,
    },
    citas: {
      total: citas.length,
      conConsulta: citasConConsulta,
      sinConsulta: citas.length - citasConConsulta,
    },
    consultas: {
      total: consultas.length,
      sinCita: consultasSinCita,
    },
    examenes: {
      total: examenes.length,
      conInforme: examenes.filter((fila) => String(fila.informe || '').trim()).length,
      conImagenReferenciada: examenes.filter(
        (fila) =>
          String(fila.imagen1n || '').trim() ||
          String(fila.imagen2n || '').trim() ||
          String(fila.nombreo1 || '').trim() ||
          String(fila.nombreo2 || '').trim()
      ).length,
    },
    recetas: {
      total: recetas.length,
      grupos: new Set(
        recetas.map((fila) =>
          fila.conscod && fila.conscod !== '0' ? `C${fila.conscod}` : `A${fila.citacod}`
        )
      ).size,
    },
    catalogos: {
      diagnosticos: filas('diagnostico').length,
      medicinas: filas('medicina').length,
      tratamientos: filas('tratamiento').length,
      informes: filas('informe').length,
    },
  };
}
