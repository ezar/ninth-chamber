# The Ninth Chamber

Juego de exploración de tumbas en navegador. Spec completo en docs/spec.md: léelo antes de cualquier cambio de diseño.

## Reglas

- TypeScript strict. Sin any salvo en límites con librerías.
- src/sim no importa three ni nada del DOM. Todo lo de sim/ debe correr en Node.
- Prohibido Math.random y Date.now en sim/: usa world.rng y el contador de ticks.
- Nada de motores de física genéricos. Colisión de rejilla propia.
- Constantes de juego solo en src/sim/player/tuning.ts.
- La simulación emite eventos; audio, render y UI solo escuchan.
- Niveles en levels/*.level.json, validados con el esquema de src/sim/grid/schema.ts.
- No usar nombres, personajes ni recursos de Tomb Raider.
- Lo visual sigue art/looks/*.json y los concepts de Claude Design en docs/art/. Tras cualquier cambio visual, regenera las capturas de referencia con pnpm shots y compáralas con el concept.

## Flujo

- Antes de tocar sim/: escribe o actualiza el test de movimiento en tests/.
- pnpm test y pnpm validate:levels deben pasar antes de dar un hito por terminado.
- Cada hito termina con una demo en la URL de previsualización y una nota en docs/changelog.md.

## Comandos

- pnpm dev, pnpm test, pnpm validate:levels, pnpm replay:update, pnpm shots, pnpm build
- Disponibles desde el hito 1: pnpm dev, pnpm test, pnpm lint, pnpm typecheck, pnpm format, pnpm build. validate:levels, replay:update y shots llegan con los hitos 2 y V1.

## Cómo se hacen cumplir las reglas

- eslint.config.js prohíbe en src/sim importar three o capas de presentación, Math.random, Date.now y globales del DOM.
- tsconfig.sim.json compila src/sim y el núcleo puro (loop, rng, events, input-frame) sin lib DOM.
