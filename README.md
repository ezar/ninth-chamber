# The Ninth Chamber · La Novena Cámara

Play the latest build from `main`: https://ezar.github.io/ninth-chamber/

Third-person tomb-exploration adventure for the browser. The full spec is in [docs/spec.md](docs/spec.md) (Spanish) and the rules for Claude Code are in [CLAUDE.md](CLAUDE.md).

## Development

```sh
pnpm install
pnpm dev        # dev server
pnpm test       # simulation tests (Vitest)
pnpm lint       # ESLint
pnpm typecheck  # types, including the check that src/sim does not use the DOM
pnpm build      # production build in dist/
pnpm anim:build <manifest> <folder>  # rebuild Nora's motion clips (docs/animation.md)
```

Credits for third-party assets are in [CREDITS.md](CREDITS.md).

## Controls (milestone 1)

- Keyboard: WASD or arrows to move, Space jump, Shift walk, drag with the mouse to turn the camera, wheel to zoom, C recenter.
- Gamepad: left stick move, right stick camera, A jump, LT walk.
- Touch: joystick on the left half, drag on the right half for the camera, and on-screen buttons.

The UI language follows the browser (English or Spanish for now).

Status: see [docs/changelog.md](docs/changelog.md). Credits: [CREDITS.md](CREDITS.md). Licence: all rights reserved for now; the choice is still open ([docs/license.md](docs/license.md)).
