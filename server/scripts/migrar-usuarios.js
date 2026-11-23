import { resolve } from 'node:path';
import { db, tx } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { leerDump } from '../lib/migracion/oldDb.js';
import {
  escribirCredencialesMigracion,
  migrarUsuarios,
} from '../lib/migracion/migrar.js';

const archivoSql = resolve(process.argv[2] || 'old_db.sql');
const tablas = leerDump(archivoSql);
const runId = `usuarios-${Date.now()}`;

let resultado;
tx(() => {
  resultado = migrarUsuarios(tablas, runId);
});

const archivoCredenciales = escribirCredencialesMigracion(
  resultado.credenciales,
  runId
);

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
if (admin) {
  audit(admin.id, 'usuarios_migrados', 'users', null, {
    ...resultado.resumen,
    archivoCredenciales,
  });
}

console.log(
  JSON.stringify(
    {
      insertados: resultado.resumen.insertados,
      reutilizados: resultado.resumen.reutilizados,
      omitidos: resultado.resumen.omitidos,
      archivoCredenciales,
      usuarios: resultado.credenciales.map((item) => ({
        nombre: item.nombre,
        usuario: item.usuario,
        rol: item.rol,
        origen: item.origen,
      })),
    },
    null,
    2
  )
);
