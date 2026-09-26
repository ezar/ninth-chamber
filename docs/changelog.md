# Changelog

## Unreleased

- The repo is now in English: code comments, error messages, test names, CLAUDE.md, README and this changelog. docs/spec.md stays in Spanish as the source document.
- `main` is deployed to GitHub Pages (https://ezar.github.io/ninth-chamber/) by `.github/workflows/pages.yml`.
- Player-facing strings moved to `i18n/en.json` and `i18n/es.json`, read through `src/ui/i18n.ts`; the locale follows the browser and falls back to English.

## Milestone 1 · Skeleton

- Repo with Vite, strict TypeScript, Three.js (`WebGPURenderer` with automatic WebGL2 fallback), Vitest, ESLint and Prettier.
- 60 Hz fixed-step loop with an accumulator, at most 5 ticks per frame and render interpolation (`src/core/loop.ts`).
- `InputFrame` as plain data with press and release edges; the camera yaw is part of the frame so replays are deterministic (`src/core/input-frame.ts`).
- Input from keyboard and mouse, gamepad (standard Gamepad API) and touch (floating joystick, camera drag, buttons) (`src/core/input.ts`).
- Seeded RNG and simulation event queue.
- Demo: a box character that runs, walks and jumps on a floor with a 2 m grid, with an orbit camera.
- Tests: fixed loop, input, RNG, PoC movement constants (5.4 m/s, 2.2 m/s, 1.35 m / 0.67 s jump, ~3.6 m running jump) and determinism via a `World` hash.
- CI on GitHub Actions (lint, format, types, tests, build). Per-PR previews through `netlify.toml` once the repo is connected in Netlify.

### Decisions

- TypeScript 5.9: the spec asks for TS 5 and typescript-eslint does not support TS 7 yet.
- Gravity is integrated exactly so jump height and duration match the spec regardless of step size.
- `camYaw` is part of `InputFrame`: movement is camera-relative and the simulation cannot read the camera.
