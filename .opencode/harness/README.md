# Harness multiagente ISIM

Este harness coordina cinco agentes alrededor del harness E2E existente
(`tests/lib/e2e-harness.mjs`). No lo reemplaza: lo usa como sistema de
verificación.

## Reparto de modelos

| Rol | Agente | Modelo |
|---|---|---|
| Orquestador | `orquestador` | `opencode-go/gpt-6-luna#high` |
| Planificador | `planificador` | `opencode-go/gpt-6-luna#high` |
| Investigador | `investigador` | `opencode-go/claude-haiku-5-5#medium` |
| Ejecutor | `ejecutor` | `opencode-go/deepseek-v4.1-flash#high` |
| Revisor | `revisor` | `opencode-go/gpt-6-luna#high` |

Si se prefiere abaratar la planificación, el planificador puede cambiarse a
`opencode-go/claude-haiku-5-5#high`. La ejecución debe quedarse en DeepSeek y
la revisión en un modelo distinto al ejecutor.

## Uso

```text
/harness Implementar el filtro de pacientes por fecha de nacimiento
```

El comando cambia la sesión al `orquestador`. Este crea un `run-id`, investiga,
planifica, manda ejecutar en un worktree, manda revisar y solo integra con
`APPROVE`.

## Separación de funciones

- **Orquestador:** no edita código; coordina, controla puertas y autoriza.
- **Planificador:** solo lectura; produce el plan.
- **Investigador:** solo lectura; produce hechos con rutas y líneas.
- **Ejecutor:** edita únicamente su worktree; implementa, prueba y puede commitear en su rama.
- **Revisor:** no edita; revisa el diff y emite `APPROVE` o `REJECT`.
- **Integración:** el orquestador solo hace commit en `main` y push después de `APPROVE` y de la suite completa.

## Flujo

```text
G0 Intake
  ↓
G1 Investigación
  ↓
G2 Plan
  ↓
G3 Ejecución en worktree
  ↓
G4 Revisión
  ↓ APPROVE
G5 Integración, suite completa y entrega
```

Si el revisor devuelve `REJECT`, el ejecutor corrige y se repite G3–G4. Máximo
dos ciclos; después el orquestador escala al usuario.

## Artefactos

Fuera del repositorio:

```text
C:\Users\dyane\.opencode\harness\runs\<run-id>\
  goal.md
  research.md
  plan.md
  execution.md
  review.md
  final.md
```

Worktrees:

```text
C:\Users\dyane\.opencode\harness\worktrees\<run-id>\
```

Rama:

```text
harness/<run-id>
```

## Pruebas obligatorias

Según el cambio:

```bash
node --check <archivos-js>
node tests/e2e-<prueba-focalizada>.mjs
node tests/e2e-migracion-reglas.mjs
```

Antes de publicar:

- suite completa `node tests/e2e-*.mjs`;
- capturas 1440×900 y 390×844 si hay UI;
- revisión de que `data/`, `.env`, `old_db.sql`, evidencias, firmas y respaldos
  no estén en el diff;
- smoke test de producción si se despliega.

## Reglas no negociables

- No `DROP`, `RENAME`, `PRAGMA foreign_keys=OFF` ni reconstrucciones.
- No cambios de FK, PK, CHECK o UNIQUE existentes.
- No tocar `data/`, `.env`, `old_db.sql`, `reportes-bd/` ni producción.
- No usar `git add -f`.
- No publicar sin `APPROVE` y suite completa.
- No usar CDN externos ni polyfills.
- Mantener azul `#284f8c`, verde `#45989f`, Poppins y la estructura de menú.

## Plantillas

Las plantillas de los artefactos están en `.opencode/harness/templates/`.
El orquestador puede copiarlas al directorio de la corrida.
