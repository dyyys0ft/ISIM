import { activarDemo, contarDemo, desactivarDemo } from '../lib/demo.js';
import { db } from '../db/index.js';

const accion = String(process.argv[2] || '').toLowerCase();

if (!['on', 'off', 'estado', 'status'].includes(accion)) {
  console.error('Uso: npm run demo -- on|off|estado');
  process.exit(1);
}

if (accion === 'on') {
  console.log('Cargando datos de demostración (1000 pacientes, 5000 citas)…');
  const inicio = Date.now();
  const resultado = activarDemo();
  console.log(`Listo en ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
  console.log(resultado);
} else if (accion === 'off') {
  console.log('Eliminando datos de demostración…');
  const resultado = desactivarDemo();
  if (resultado.demoPacientesBloqueados > 0) {
    console.warn(
      `Se conservaron ${resultado.demoPacientesBloqueados} pacientes de demostración porque tienen documentos reales.`
    );
  }
  console.log(resultado);
} else {
  console.log(contarDemo());
}

db.close();
