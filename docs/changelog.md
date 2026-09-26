# Changelog

## Visual quality · tiers, post-processing and menus (in progress)

- Quality tiers (`src/render/quality.ts`, spec §11): **high** has volumetric sun shafts ray-marched through the sun's shadow map, full-resolution GTAO, shadows from the two nearest fires, depth of field in focus shots, SMAA, 16× anisotropy and a pixel ratio up to 2; **medium** has one live shadow at a time (the sun where it shines, otherwise the nearest fire), the modelled light cones, SMAA, 8× anisotropy, 60 % particles and a pixel ratio up to 1.5; **mobile** has a sun shadow refreshed once a second without Nora plus a contact blob under her, FXAA, 4× anisotropy, 35 % particles and a pixel ratio up to 1.25.
- The first run picks the tier with a ~3 s benchmark of the title scene (phones go straight to mobile; a hidden tab falls back to a device heuristic). The choice is stored in `localStorage` and can be changed in Options. Dynamic resolution drops the scene render scale a step after 1 s over 18 ms and recovers slowly; at its floor an automatically chosen tier steps down.
- Post-processing is one TSL `RenderPipeline` (`src/render/post.ts`): AO, depth of field, god rays, bloom, the room grade (saturation, tint and now `grade.contrast`, in log space around mid-grey), AgX, SMAA/FXAA on the display image, then vignette and 24 fps film grain. The CSS grain and vignette overlays are gone. Development views: `?view=ao`, `?view=rays`, `?view=raw`.
- Pause menu (Esc, gamepad Start, a touch button, or leaving the tab): Resume, Restart from checkpoint, Options, Quit to title, with confirmation. Pausing stops the fixed-step simulation, freezes the frame and suspends audio.
- Options (also from the title): quality, master / music / effects volume, camera sensitivity, invert vertical look, reduced motion (no grain, no title sway), subtitles (placeholder), language. Keyboard, gamepad, mouse and touch share one amber focus.
- The start screen shows loading progress (files, shader warm-up, first-run calibration) and keeps the start button disabled until the tomb is ready.

## Milestones 2–4 · The Antechamber (in progress)

- Nora is the Meshy scan provided by the owner, turned into a game asset by `scripts/character/rig_nora.py` (Blender): 1.5 M → 45 k triangles, scaled to 1.72 m, facing -Z, a 19-bone humanoid skeleton fitted to the scan with automatic weights, then compressed with meshopt and WebP (65 MB → 1.2 MB, `public/models/nora.glb`). `src/render/nora-scan.ts` retargets the procedural animation in `src/render/nora.ts` onto it, with rest-pose corrections for the A-pose limbs; the procedural body remains the fallback.
- Scanned CC0 textures from Poly Haven replace the procedural ones (`public/textures`, sources in `sources.json`); the procedural textures remain the fallback.
- Indirect light is baked with Blender Cycles (`scripts/bake`) into `public/levels/antechamber.lightmap.png` and applied on the second UV set; direct light stays dynamic.
- Procedural Web Audio engine (`src/audio`): buses, generated reverbs, positional fire and relic loops, footsteps per material, mechanism sounds and short music cues.

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
