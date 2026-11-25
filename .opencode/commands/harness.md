---
description: Inicia una corrida del harness multiagente ISIM con investigación, plan, ejecución y revisión.
agent: orquestador
model: opencode-go/deepseek-v4.1-flash#high
subagent: false
---

Inicia una corrida del harness ISIM para el siguiente objetivo:

$ARGUMENTS

Sigue el protocolo de `.opencode/harness/README.md` y las reglas de `AGENTS.md`.

Orden obligatorio:

1. Crea el `run-id` y `goal.md`.
2. Lanza la investigación.
3. Pide el plan al planificador.
4. Manda ejecutar en un worktree aislado.
5. Manda revisar el diff.
6. Solo con `APPROVE` y la suite completa, integra y solicita confirmación para publicar.

No edites código desde el orquestador. No publiques ni despliegues sin pruebas.
