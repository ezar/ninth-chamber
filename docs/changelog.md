# Changelog

## Milestone 5 · Combat: the jackal and the pistols (in progress)

- Enemies in the simulation (`src/sim/actors/enemies.ts`): stats and behaviour name are data in `enemyTypes` (`src/sim/player/tuning.ts`). The jackal has 4 health, runs at 4.1 m/s, bites for 9 every 0.9 s within 1.1 m, climbs one click, never jumps or drops more than 1 m, and hunts in pairs: pack mates alert each other and flank from Nora's sides. States idle, alert, chase, attack, hurt, flee and dead. It perceives by distance, height and grid line of sight, and hears running (6 m), shots (14 m) and cracking tiles (10 m).
- A\* on the sector grid with height costs and no corner cutting (`src/sim/actors/pathfind.ts`), searched at most every 0.5 s and straightened with a walkability test. A high place is a refuge: out of reach, the jackal prowls right below and leaves after 8 s. Enemy bodies use the grid box sweep and push each other apart lightly. Enemy state lives in `world.state`, so checkpoints capture it; respawning sends the living ones home and they forget Nora.
- Dual pistols (`src/sim/player/weapons.ts`): R / LB / RB draw and holster (Fire also draws, for touch), 1 damage, 0.24 s cadence alternating hands, 16 m range, 85% hit chance rolled on `world.rng`. Holding Fire locks the nearest visible enemy and keeps it while visible; Tab / d-pad right cycles targets. Standing, Nora turns to her target; running, only her torso and arms follow it. Hanging, climbing or interacting holsters them. Medkits: H / Y uses the smallest kit that heals fully, else the largest.
- Levels: `enemy` entities (type, facing, pack) with a `<id>.dead` signal; the validator checks placement, headroom and packs of one. A pair of jackals rests in the brazier hall of The Antechamber; the walkthrough bot shoots them.
- Presentation: `src/render/enemies.ts` draws each jackal through a `JackalView`: a skinned glTF driven by named clips (`models/jackal.glb`, when present) or the procedural fallback, a lean golden jackal (dark saddle, cream throat and belly, rufous legs, big ears, black-tipped tail; ~3.7 k triangles) on a small bone hierarchy with a skinned spine and tail, animated from the sim state (idle sniffing, trot, rotary gallop, alert, bite strike, flinch, hurt, collapse). `src/render/combat.ts` adds pistols in Nora's hands, muzzle flashes with a brief light, hit and ricochet puffs and a subtle marker over the locked target. Nora gets an aiming arms layer (torso twist and two-bone IK of both arms, legs untouched). With the pistols out the camera moves over the right shoulder and closes to 4 m; shots and bites shake it a little.
- Audio: procedural gunshot (dry crack, thump and a tail into the room reverb), ricochets, bullet impacts, jackal growl, yelp, death whimper, bite and huff, holster clicks and medkit sounds. Haptics for shots, hits, bites and deaths.
- HUD: red edges when hurt; the end screen adds enemies, accuracy and medkits used. Touch: Fire (hold) and Draw / Holster buttons in the reserved arc slots.
- Tests (`tests/combat.test.ts`): perception, noise, packs, A\* round a pillar, step limits, refuge, bite damage and cadence, pistol cadence and seeded hit chance, auto-aim selection, medkits, checkpoint reset and the level format.

## Milestones 2–4 · The Antechamber (in progress)

- Nora is the Meshy scan provided by the owner, turned into a game asset by `scripts/character/rig_nora.py` (Blender): 1.5 M → 45 k triangles, scaled to 1.72 m, facing -Z, a 19-bone humanoid skeleton fitted to the scan with automatic weights, then compressed with meshopt and WebP (65 MB → 1.2 MB, `public/models/nora.glb`). `src/render/nora-scan.ts` retargets the procedural animation in `src/render/nora.ts` onto it, with rest-pose corrections for the A-pose limbs; the procedural body remains the fallback.
- Scanned CC0 textures from Poly Haven replace the procedural ones (`public/textures`, sources in `sources.json`); the procedural textures remain the fallback.
- Indirect light is baked with Blender Cycles (`scripts/bake`) into `public/levels/antechamber.lightmap.png` and applied on the second UV set; direct light stays dynamic.
- Procedural Web Audio engine (`src/audio`): buses, generated reverbs, positional fire and relic loops, footsteps per material, mechanism sounds and short music cues.
- Touch controls redesigned for phones: shown only while playing, icon buttons in a thumb arc with reserved weapon slots, ghost stick and look hints, dead zone and trailing stick base, gentle push walks, haptics, hints at the top, a glowing action button when something is usable, fullscreen on start and a minimum horizontal field of view in portrait.
- Haptics (`src/core/haptics.ts`): phones vibrate (Android browsers) and gamepads rumble on hard landings, ledge grabs, hits, death, moving and falling blocks, cracking and falling tiles, doors, levers, pickups, the relic and checkpoints, scaled by distance; touch buttons tick. The setting persists in `localStorage` (`nc.haptics`).
- Camera: over-the-shoulder pivot, lazy follow behind the direction of travel, look-ahead, speed-driven field of view and trauma shake on landings, hits, blocks, falling tiles and doors.

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
