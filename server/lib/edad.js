/** Utilidades de edad compartidas por pacientes y documentos. */

export function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento || !/^\d{4}-\d{2}-\d{2}$/.test(String(fechaNacimiento))) return null;
  const nacimiento = new Date(`${fechaNacimiento}T00:00:00`);
  if (Number.isNaN(nacimiento.getTime())) return null;

  const hoy = new Date();
  let edad = hoy.getFullYear() - nacimiento.getFullYear();
  const meses = hoy.getMonth() - nacimiento.getMonth();
  if (meses < 0 || (meses === 0 && hoy.getDate() < nacimiento.getDate())) edad -= 1;

  return edad >= 0 && edad < 130 ? edad : null;
}

/** true solo cuando la fecha es válida y la persona tiene menos de 18 años. */
export function esMenorDeEdad(fechaNacimiento) {
  const edad = calcularEdad(fechaNacimiento);
  return edad !== null && edad < 18;
}

/** Datos del representante legal principal (obligatorio) para un paciente menor. */
export function representantePrincipal(paciente) {
  if (!paciente?.representante1_nombre || !paciente?.representante1_cedula) return null;
  return {
    nombre: paciente.representante1_nombre,
    cedula: paciente.representante1_cedula,
    parentesco: paciente.representante1_parentesco || '',
    telefono: paciente.representante1_telefono || '',
  };
}

/** Lista de representantes registrados, con el principal primero. */
export function representantesDe(paciente) {
  if (!paciente) return [];
  const lista = [];

  if (paciente.representante1_nombre || paciente.representante1_cedula) {
    lista.push({
      nombre: paciente.representante1_nombre || '',
      cedula: paciente.representante1_cedula || '',
      parentesco: paciente.representante1_parentesco || '',
      telefono: paciente.representante1_telefono || '',
      principal: true,
    });
  }

  if (paciente.representante2_nombre || paciente.representante2_cedula) {
    lista.push({
      nombre: paciente.representante2_nombre || '',
      cedula: paciente.representante2_cedula || '',
      parentesco: paciente.representante2_parentesco || '',
      telefono: paciente.representante2_telefono || '',
      principal: false,
    });
  }

  return lista;
}
