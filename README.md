# La Novena Cámara · The Ninth Chamber

Aventura de exploración de tumbas en tercera persona para el navegador. El spec completo está en [docs/spec.md](docs/spec.md) y las reglas para Claude Code en [CLAUDE.md](CLAUDE.md).

## Desarrollo

```sh
pnpm install
pnpm dev        # servidor de desarrollo
pnpm test       # tests de simulación (Vitest)
pnpm lint       # ESLint
pnpm typecheck  # tipos, incluida la comprobación de que src/sim no usa el DOM
pnpm build      # build de producción en dist/
```

## Controles (hito 1)

- Teclado: WASD o flechas para moverse, Espacio saltar, Shift andar, arrastrar con el ratón para girar la cámara, rueda para el zoom, C recentrar.
- Mando: stick izquierdo mover, stick derecho cámara, A saltar, LT andar.
- Táctil: joystick en la mitad izquierda, arrastre en la derecha para la cámara y botones en pantalla.

Estado: ver [docs/changelog.md](docs/changelog.md).
