import assert from 'node:assert/strict';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

let entorno = null;

function proximoLunes() {
  const fecha = new Date();
  fecha.setHours(0, 0, 0, 0);
  const delta = (8 - fecha.getDay()) % 7 || 7;
  fecha.setDate(fecha.getDate() + delta);
  return fecha;
}

function fechaHoraSemana(lunes, dia, hora) {
  const fecha = new Date(lunes);
  fecha.setDate(fecha.getDate() + dia);
  const ymd = fecha.toLocaleDateString('en-CA');
  return new Date(`${ymd}T${String(hora).padStart(2, '0')}:00:00-05:00`).toISOString();
}

try {
  entorno = await crearEntornoE2E();
  console.log(`Servidor de prueba: ${entorno.base}`);

  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  console.log('✓ Administrador autenticado');

  const medicos = await admin('/api/medicos');
  const medico = medicos[0];
  assert.ok(medico?.id, 'Debe existir un médico activo');

  const stamp = Date.now();
  const sufijo = String(stamp).slice(-8);
  const lunes = proximoLunes();
  const pacientes = [];

  for (let i = 0; i < 5; i += 1) {
    const paciente = await admin('/api/patients', {
      method: 'POST',
      body: {
        cedula: `PM${sufijo}${i}`,
        nombres: `PACIENTE MASIVO ${i + 1}`,
        apellidos: 'PRUEBA E2E',
        fecha_nacimiento: '1990-01-15',
        sexo: 'F',
        telefono: `09880000${i}`,
        email: `masivo-${stamp}-${i}@isim.local`,
        direccion: 'Dirección prueba masiva',
        ocupacion: 'Prueba',
        estado_civil: 'Soltera/o',
        ciudad: 'Riobamba',
      },
    });
    pacientes.push(paciente);
  }
  console.log(`✓ 5 pacientes registradas`);

  const citas = [];
  for (let dia = 0; dia < 5; dia += 1) {
    for (let slot = 0; slot < 8; slot += 1) {
      const indice = citas.length;
      const cita = await admin('/api/appointments', {
        method: 'POST',
        body: {
          patientId: pacientes[indice % pacientes.length].id,
          medicoId: medico.id,
          fechaHora: fechaHoraSemana(lunes, dia, 8 + slot),
          duracionMin: 30,
          motivo: `Cita semanal E2E ${indice + 1}`,
          estado: 'programada',
        },
      });
      citas.push(cita);
    }
  }
  assert.equal(citas.length, 40);
  console.log(`✓ 40 citas agendadas durante la semana`);

  for (let i = 0; i < 30; i += 1) {
    await admin(`/api/appointments/${encodeURIComponent(citas[i].id)}/cancel`, {
      method: 'POST',
    });
  }

  const canceladas = await Promise.all(
    citas.slice(0, 30).map((cita) =>
      admin(`/api/appointments/${encodeURIComponent(cita.id)}`)
    )
  );
  assert.ok(canceladas.every((cita) => cita.estado === 'cancelada'));
  console.log('✓ 30 citas canceladas');

  const reagendadas = [];
  for (let i = 0; i < 10; i += 1) {
    const cita = citas[30 + i];
    const dia = 14 + Math.floor(i / 5);
    const hora = 9 + (i % 5);
    const nuevaFecha = fechaHoraSemana(lunes, dia, hora);
    const nuevoMotivo = `Motivo reagendado E2E ${i + 1}`;

    await admin(`/api/appointments/${encodeURIComponent(cita.id)}`, {
      method: 'PATCH',
      body: {
        fechaHora: nuevaFecha,
        motivo: nuevoMotivo,
        motivoReagenda: 'Reagenda masiva E2E',
        estado: 'reagendada',
      },
    });
    reagendadas.push({ id: cita.id, fecha: nuevaFecha, motivo: nuevoMotivo });
  }

  for (const esperada of reagendadas) {
    const cita = await admin(`/api/appointments/${encodeURIComponent(esperada.id)}`);
    assert.equal(cita.estado, 'reagendada');
    assert.equal(cita.motivo, esperada.motivo);
    assert.equal(new Date(cita.fecha_hora).toISOString(), esperada.fecha);
  }
  console.log('✓ 10 citas reagendadas con nueva fecha y motivo');

  const idsCreados = new Set(citas.map((cita) => cita.id));
  const listado = await admin('/api/appointments?limit=500');
  const nuestras = listado.filter((cita) => idsCreados.has(cita.id));
  assert.equal(nuestras.filter((cita) => cita.estado === 'cancelada').length, 30);
  assert.equal(nuestras.filter((cita) => cita.estado === 'reagendada').length, 10);

  for (const paciente of pacientes) {
    const detalle = await admin(`/api/patients/${encodeURIComponent(paciente.id)}`);
    assert.equal(detalle.id, paciente.id);
  }
  console.log('✓ 5 pacientes verificadas');

  console.log('');
  console.log('E2E DE AGENDA MASIVA COMPLETADO');
  console.log(
    JSON.stringify(
      {
        pacientes: pacientes.length,
        citas: citas.length,
        canceladas: 30,
        reagendadas: 10,
        medico: medico.nombre,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error('');
  console.error('E2E DE AGENDA MASIVA FALLÓ:', error.message);
  if (entorno) {
    const log = entorno.obtenerLog();
    if (log) {
      console.error('');
      console.error('--- últimas líneas del servidor ---');
      console.error(log.split(/\r?\n/).slice(-40).join('\n'));
    }
  }
  process.exitCode = 1;
} finally {
  await entorno?.limpiar();
}
