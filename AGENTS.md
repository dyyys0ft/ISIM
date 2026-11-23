# ISIM — Instrucciones para agentes

## Interfaz web
- Antes de modificar HTML, CSS o JavaScript del cliente, consulta la skill
  `modern-web-guidance` (`.agents/skills/modern-web-guidance/SKILL.md`).
- Mantén la identidad visual: azul `#284f8c`, verde `#45989f`, Poppins y la
  estructura de menú existente.
- Carga solo `/css/isim.css` y, si existe, la hoja de la página.
- Verifica con `node tests/e2e-*.mjs` y capturas a 1440×900 y 390×844.

## Navegador objetivo
- Chrome/Edge 119 o superior de escritorio, en intranet.
- No hay compilación ni CDN de polyfills. Si una función no es ampliamente
  compatible, debe degradar sin romper la pantalla o no usarse.
- `:user-invalid` se usa con fallback en `public/js/ui.js`.

## Privacidad
- El CLI de Modern Web Guidance envía telemetría anónima. Ejecútalo con
  `DISABLE_TELEMETRY=1` en este proyecto.

## Evolución de la base de datos (regla obligatoria)
1. **No romper relaciones existentes**: prohibido eliminar o renombrar tablas,
   columnas, índices o claves usadas por datos existentes.
2. **No alterar FK, PK, CHECK ni UNIQUE existentes**: prohibido reconstruir una
   tabla para cambiar sus restricciones.
3. **Solo cambios aditivos**: nuevas tablas, columnas opcionales o con default,
   índices nuevos y relaciones nuevas. Si se requiere un estado nuevo, usar una
   tabla de catálogo o validación en la aplicación; no modificar el CHECK.

Toda migración nueva debe incluir respaldo previo, prueba en copia, ejecución
idempotente, `PRAGMA foreign_key_check` en 0, comparación de conteos y
trazabilidad old → new. Las únicas excepciones son las migraciones históricas
marcadas `LEGACY-EXCEPTION`; el guard `tests/e2e-migracion-reglas.mjs` falla si
aparece un `DROP`, `RENAME`, `PRAGMA foreign_keys=OFF` o reconstrucción nueva.
