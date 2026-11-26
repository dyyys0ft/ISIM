# Fixture sintético de migración

Este directorio contiene `old_db_fixture.sql`, un dump **sintético y sanitizado**
usado por `tests/e2e-migration.mjs` y `tests/e2e-migracion-credenciales.mjs`
cuando no existe `old_db.sql` en la raíz del repositorio (worktree/CI).

- No contiene datos reales ni una copia de `old_db.sql`.
- Replica las tablas/columnas que consume `server/lib/migracion/oldDb.js` y el
  importador: `datos`, `datosgen`, `citamedica`, `cons`, `examenes`, `receta`,
  `diagnostico`, `medicina`, `tratamiento`, `informe` y `sistema`.
- Incluye 12 pacientes sintéticos con casos de cédula válida, sin cédula,
  cédula duplicada, fecha inválida, fecha en la columna `sexo`, nombre corto y
  caracteres acentuados.
- Incluye citas con y sin consulta, cancelada, sin turno y con fecha inválida;
  consultas con y sin cita; exámenes con y sin informe; recetas; catálogos; y
  cuatro usuarios antiguos (`adminis`, `rec`, `doctor2`, `adminin`) con clave
  débil `12345` para probar la conservación de credenciales solo bajo el flag
  correspondiente.
- Si existe `old_db.sql`, las pruebas siguen usando el dump real. El fixture no
  se copia ni se escribe en `data/`.
