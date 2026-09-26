# Changelog

## Hito 1 · Esqueleto

- Repo con Vite, TypeScript strict, Three.js (`WebGPURenderer` con caída automática a WebGL2), Vitest, ESLint y Prettier.
- Bucle de paso fijo a 60 Hz con acumulador, máximo 5 ticks por frame e interpolación en el render (`src/core/loop.ts`).
- `InputFrame` como datos puros con flancos de pulsación y suelta; la orientación de la cámara va en el frame para que las repeticiones sean deterministas (`src/core/input-frame.ts`).
- Entrada desde teclado y ratón, mando (Gamepad API estándar) y táctil (joystick flotante, arrastre de cámara, botones) (`src/core/input.ts`).
- RNG con semilla y cola de eventos de simulación.
- Demo: personaje de cajas que corre, anda y salta sobre un suelo con rejilla de 2 m, con cámara orbital.
- Tests: bucle fijo, input, RNG, constantes de movimiento del PoC (5,4 m/s, 2,2 m/s, salto de 1,35 m y 0,67 s, ~3,6 m con carrerilla) y determinismo por hash de `World`.
- CI en GitHub Actions (lint, formato, tipos, tests, build). Previsualización por PR vía `netlify.toml` una vez conectado el repo en Netlify.

### Decisiones

- TypeScript 5.9: el spec pide TS 5 y typescript-eslint aún no soporta TS 7.
- Gravedad integrada de forma exacta para que la altura y la duración del salto coincidan con el spec sin depender del paso.
- `camYaw` forma parte de `InputFrame`: el movimiento es relativo a cámara y la simulación no puede leer la cámara.
