# Changelog

## The Antechamber grows to ten rooms

- The level now runs entrance → brazier hall → **Hall of Weights** → **Hourglass** → **Well of Light** → (terrace over the Hall of Weights) → **Sunken Causeway** → **Chamber of Scales** → **Descent** → gallery → relic chamber. The gallery and the relic chamber moved 48 rows north; their contents are unchanged.
- The level's new mechanic is the **weight plate**, introduced alone and then combined (spec §8, principle 2): in the Hall of Weights a plate holds its gate only while weighed down, so the hall's block has to hold it; in the Hourglass the gate lingers 12 s after the weight leaves, ticking, for a sprint with two jumps; in the Chamber of Scales two plates must be weighed at once, one block has to be pushed off a high shelf and the other is needed first as a step, with a spring lever that resets both blocks.
- Vertical exploration: the Well of Light is a 24 m sunlit shaft climbed with a block and a spiral of ledges; its top opens onto a terrace 12 m above the Hall of Weights, looking back over the plate and gate solved below. The Descent teaches lowering into a hang over a sunlit spike pit.
- Secrets: jade (entrance) and gold (brazier hall) stay; the stone idol moved from the gallery to a lone pillar in the Well, a standing jump away from the top walkway. A small medkit now sits on the gallery ledge where it was. Checkpoints precede every hard section; medkits follow the Well and the Causeway.
- New hints (`i18n/en.json`, `i18n/es.json`) for plates, holding weight, the ticking gate, the standing jump, filling a gap with a block, the two plates, the reset lever and lowering into a hang. New looks in `art/looks/`: `plate_hall`, `hourglass`, `well` (with a skylight), `causeway`, `scales`, `descent` (with a skylight).
- Sim: timed doors emit `door.tick` every second (a stone click in audio, doubled in the last three seconds); door actions only announce a move when the target changes; `"spring": true` levers can be pulled again; `<block>.reset` returns a block to its start; blocks fall when their support goes away; walking never drops off an edge the body already overhangs.
- Tests: the walkthrough bot (`tests/bot.ts`) plays the whole route through all ten rooms with the three secrets and no deaths (about 13 400 ticks); `tests/antechamber.test.ts` proves that each puzzle is needed, cannot be cheesed and never dead-ends.
- The baked lightmap (`public/levels/antechamber.lightmap.png`) predates the new geometry and must be re-baked.

## Milestones 2–4 · The Antechamber (in progress)

- Nora is the Meshy scan provided by the owner, turned into a game asset by `scripts/character/rig_nora.py` (Blender): 1.5 M → 45 k triangles, scaled to 1.72 m, facing -Z, a 19-bone humanoid skeleton fitted to the scan with automatic weights, then compressed with meshopt and WebP (65 MB → 1.2 MB, `public/models/nora.glb`). `src/render/nora-scan.ts` retargets the procedural animation in `src/render/nora.ts` onto it, with rest-pose corrections for the A-pose limbs; the procedural body remains the fallback.
- Scanned CC0 textures from Poly Haven replace the procedural ones (`public/textures`, sources in `sources.json`); the procedural textures remain the fallback.
- Indirect light is baked with Blender Cycles (`scripts/bake`) into `public/levels/antechamber.lightmap.png` and applied on the second UV set; direct light stays dynamic.
- Procedural Web Audio engine (`src/audio`): buses, generated reverbs, positional fire and relic loops, footsteps per material, mechanism sounds and short music cues.
- Touch controls redesigned for phones: shown only while playing, icon buttons in a thumb arc with reserved weapon slots, ghost stick and look hints, dead zone and trailing stick base, gentle push walks, haptics, hints at the top, a glowing action button when something is usable, fullscreen on start and a minimum horizontal field of view in portrait.
- Haptics (`src/core/haptics.ts`): phones vibrate (Android browsers) and gamepads rumble on hard landings, ledge grabs, hits, death, moving and falling blocks, cracking and falling tiles, doors, levers, pickups, the relic and checkpoints, scaled by distance; touch buttons tick. The setting persists in `localStorage` (`nc.haptics`).
- Camera: over-the-shoulder pivot, lazy follow behind the direction of travel, look-ahead, speed-driven field of view and trauma shake on landings, hits, blocks, falling tiles and doors.
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
