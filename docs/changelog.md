# Changelog

## Milestones 2–4 · The Antechamber (in progress)

- Nora is the Meshy scan provided by the owner, turned into a game asset by `scripts/character/rig_nora.py` (Blender): 1.5 M → 45 k triangles, scaled to 1.72 m, facing -Z, a 19-bone humanoid skeleton fitted to the scan with automatic weights, then compressed with meshopt and WebP (65 MB → 1.2 MB, `public/models/nora.glb`). `src/render/nora-scan.ts` retargets the procedural animation in `src/render/nora.ts` onto it, with rest-pose corrections for the A-pose limbs; the procedural body remains the fallback.
- Scanned CC0 textures from Poly Haven replace the procedural ones (`public/textures`, sources in `sources.json`); the procedural textures remain the fallback.
- Indirect light is baked with Blender Cycles (`scripts/bake`) into `public/levels/antechamber.lightmap.png` and applied on the second UV set; direct light stays dynamic.
- Procedural Web Audio engine (`src/audio`): buses, generated reverbs, positional fire and relic loops, footsteps per material, mechanism sounds and short music cues.
- Recorded audio replaces the procedural sounds (spec §12 "Producción"), which stay as the fallback while files load or where Opus/WebM cannot be decoded. `scripts/audio/build_audio.py` downloads the CC0 and CC-BY sources (Freesound, Kenney, incompetech), slices, cleans, levels (-18 LUFS sfx, -20 LUFS music and beds) and encodes them to Opus/WebM in `public/audio/` (1.3 MB of sfx, 5.3 MB of music), with `src/audio/samples.json` as the bank manifest and credits in `CREDITS.md` and `public/audio/CREDITS.md`.
  - `src/audio/samples.ts` loads banks by category after the unlock gesture and picks variants without repeats, with ±4 % pitch and ±2 dB gain. Footsteps have walk and run banks for stone and sand (10 each), a cloth layer, alternating left/right pan and extra room reverb; jumps, landings (soft and hard), ledge grabs and climbs are layered from boots, hands on stone, cloth and leather (no voice).
  - Mechanisms play at the actor or tile that emits them: stone block drags, door grinding loop with debris, lever, plates, tile cracks and collapses, the rumble. Braziers burn with a recorded fire loop; rooms get recorded air and wind beds and sparse distant drips.
  - Music (Kevin MacLeod) streams through `<audio>` into the music bus with crossfades: a title theme that opens the level and fades, a single pass of "Lost Frontier" in the great hall, "Arcadia" in the relic chamber and "Hero Theme" when the Heart is taken; then silence. Menu buttons click.

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
