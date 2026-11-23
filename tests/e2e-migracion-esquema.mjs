import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { crearEntornoE2E } from './lib/e2e-harness.mjs';

/**
 * Migración aditiva de la base: columnas, tablas, estados y permisos nuevos.
 * Se ejecuta sobre una base temporal creada por el arranque del servidor.
 */

function columnas(db, tabla) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().map((fila) => fila.name);
}

const entorno = await crearEntornoE2E();
try {
  const db = new DatabaseSync(entorno.dbFile);

  const pacientes = columnas(db, 'patients');
  for (const campo of [
    'grupo_sanguineo',
    'habitos',
    'medicacion_habitual',
    'menarquia',
    'ciclos',
    'gestas',
    'partos',
    'cesareas',
    'abortos',
    'hijos_vivos',
    'mac',
    'ivsa',
    'parejas',
    'ultimo_pap',
    'ultima_mamografia',
    'consentimiento_datos',
    'consentimiento_evidencia_path',
    'consentimiento_evidencia_mime',
    'consentimiento_evidencia_hash',
    'consentimiento_evidencia_nombre',
    'consentimiento_evidencia_en',
    'nota_importante',
    'embarazada',
    'embarazo_nota',
  ]) {
    assert.ok(pacientes.includes(campo), `Falta patients.${campo}`);
  }
  console.log('✓ patients: campos clínicos + consentimiento, embarazo y notas');

  const documentos = columnas(db, 'documents');
  for (const campo of ['numero', 'subtipo', 'datos']) {
    assert.ok(documentos.includes(campo), `Falta documents.${campo}`);
  }
  console.log('✓ documents: numero, subtipo y datos');

  const items = columnas(db, 'prescription_items');
  assert.ok(items.includes('dci'));
  assert.ok(items.includes('concentracion'));
  console.log('✓ prescription_items: dci y concentracion');

  const examenes = columnas(db, 'clinical_exams');
  assert.ok(examenes.includes('pedido_id'));
  console.log('✓ clinical_exams: pedido_id');

  const tablas = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((fila) => fila.name);
  assert.ok(tablas.includes('clinical_orders'));
  assert.ok(tablas.includes('clinical_addenda'));
  console.log('✓ Tablas nuevas: clinical_orders y clinical_addenda');

  const sqlCitas = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'appointments'")
    .get().sql;
  assert.match(sqlCitas, /en_sala_espera/);
  console.log('✓ appointments admite en_sala_espera');

  const ajustes = db.prepare('SELECT clave FROM settings').all().map((fila) => fila.clave);
  for (const clave of ['horario_agenda', 'membretes', 'migracion_permisos_ui_v2']) {
    assert.ok(ajustes.includes(clave), `Falta settings.${clave}`);
  }
  const horario = JSON.parse(
    db.prepare("SELECT valor FROM settings WHERE clave = 'horario_agenda'").get().valor
  );
  assert.equal(horario.cupos_por_hora, 2);
  assert.ok(Array.isArray(horario.lv.manana) && horario.lv.manana.length === 5);
  console.log('✓ settings: horario, membretes y migración de permisos');

  const permisos = (rol) =>
    db
      .prepare('SELECT permiso FROM role_permissions WHERE role_slug = ?')
      .all(rol)
      .map((fila) => fila.permiso);
  const operador = permisos('operador');
  const enfermero = permisos('enfermero');
  const medico = permisos('medico');
  assert.equal(operador.includes('historias.ver'), false, 'Operador no debe ver historias');
  assert.ok(enfermero.includes('historias.resumen'));
  assert.ok(enfermero.includes('examenes.gestionar'));
  assert.ok(medico.includes('historias.gestionar'));
  console.log('✓ Matriz de permisos aplicada por rol');

  // Los datos existentes no se pierden: se crea una paciente y se recupera.
  const admin = entorno.crearCliente();
  await entorno.iniciarSesion(admin, 'admin', '54321');
  const creada = await admin('/api/patients', {
    method: 'POST',
    body: {
      cedula: `ESQ${String(Date.now()).slice(-6)}`,
      nombres: 'Paciente',
      apellidos: 'Esquema',
      fecha_nacimiento: '1988-12-01',
      sexo: 'F',
      grupo_sanguineo: 'O+',
      menarquia: '12',
    },
  });
  const recuperada = await admin(`/api/patients/${encodeURIComponent(creada.id)}`);
  assert.equal(recuperada.grupo_sanguineo, 'O+');
  assert.equal(recuperada.menarquia, '12');
  console.log('✓ Datos nuevos legibles por API después de la migración');

  db.close();
  console.log('');
  console.log('MIGRACIÓN DE ESQUEMA COMPLETADA');
} finally {
  await entorno.limpiar();
}
