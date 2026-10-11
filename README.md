# The Ninth Chamber · La Novena Cámara

![The Ninth Chamber](public/og-image.jpg)

**[Play it in your browser →](https://ezar.github.io/ninth-chamber/)** (desktop, phone or gamepad; built from `main`)

A third-person tomb-exploration adventure for the browser, in the spirit of the classics of 1996–2000: read the architecture, move the stones, find the way, survive the tomb.

> Eight chambers are known, sealed with the same mark: a ring of nine segments. Eight are carved in the stone; the ninth is only an outline. In 1956 the Ferrand expedition entered the tomb of Qarrum. Only Elena Vidal came back, and she never told what she saw. Seventy years later the sand has opened the door again, and her granddaughter **Nora Vidal**, an archaeologist, follows Elena's notebooks inside.

|                                         |                                             |                                     |                                        |
| --------------------------------------- | ------------------------------------------- | ----------------------------------- | -------------------------------------- |
| ![Entrance](public/loading/reel-1.webp) | ![Brazier hall](public/loading/reel-2.webp) | ![Nora](public/loading/reel-3.webp) | ![Gallery](public/loading/reel-4.webp) |

## What's in the game

- **Nine chambers**, a campaign of one tomb after another, each built around its own mechanism, with secrets, journal notes and a relic at the end:
  1. **The Antechamber:** weight plates, timed gates and a shaft of daylight.
  2. **The Cisterns:** flooded halls where the water rises and falls.
  3. **The Temple of the Sun:** bronze mirrors that carry the sun into the mountain.
  4. **The Clay Archive:** glyph locks, shelves to push and a clay guardian.
  5. **The Root Halls:** walls of roots to climb, tangles and scorpions.
  6. **The Bronze Forge:** bronze pours, bellows, heat and automatons.
  7. **The Wind Stair:** gusts on a cycle, flute levers, rock birds and lifts.
  8. **The Observatory:** rings to align under the dome, and a giant guardian.
  9. **The Ninth Chamber:** every mechanism at once, under the conjunction's light, and two endings.
- **Nora** is a scanned character with motion-captured animation (Mixamo clips made on her own mesh) and foot planting. She runs, jumps, grabs ledges, shimmies, climbs, pushes and pulls blocks, and draws dual pistols.
- **Combat:** jackals with perception, grid pathfinding and pack hunting; auto-aim pistols; medkits.
- **Puzzles as data:** levels are JSON grids with declarative `when → do` rules. A bot plays every level end to end in the test suite.
- **Look:**
  - Indirect light baked with Blender Cycles, and scanned CC0 textures.
  - Volumetric sun shafts, GTAO, bloom and a per-room grade.
  - Quality tiers with dynamic resolution, so it runs on phones.
- **Sound:**
  - Recorded footsteps, foley and ambience.
  - An adaptive orchestral score that reacts to exploration, tension, combat, chases and bosses, with stingers for discoveries.
  - Haptics on phones and gamepads.
- **Story:** a cinematic intro, journal notes, an end screen with a relic reveal, rank and best time, and a campaign across nine chambers.
- **Languages:** English, Spanish and Catalan. The UI follows the browser and can be changed in Options.
- **Plays offline:** installed from the browser (or added to the Home Screen), it saves the whole game and plays without a connection.

## Controls

| Action                                         | Keyboard and mouse            | Gamepad           | Touch                                |
| ---------------------------------------------- | ----------------------------- | ----------------- | ------------------------------------ |
| Move                                           | WASD / arrows                 | Left stick        | Left-half stick (a light push walks) |
| Camera                                         | Drag the mouse, wheel to zoom | Right stick       | Drag on the right half               |
| Jump                                           | Space                         | A                 | Jump                                 |
| Action (grab, push/pull, lever, pick up, read) | E                             | X                 | Action                               |
| Walk (stops at edges)                          | Shift                         | LT                | Walk                                 |
| Fire (auto-aim)                                | F / right click               | RT                | Fire                                 |
| Draw / holster                                 | R                             | RB / LB           | Draw                                 |
| Next target                                    | Tab                           | D-pad right       |                                      |
| Medkit                                         | H                             | Y                 |                                      |
| Recenter camera                                | C                             | Right stick click |                                      |
| Pause                                          | Esc                           | Start             | ❚❚                                   |

## Development

Requires Node 22 and pnpm.

```sh
pnpm install
pnpm dev               # dev server
pnpm test              # Vitest: movement, mechanisms, combat, animation, music, full-level bot walkthroughs
pnpm lint              # ESLint (also enforces the simulation's purity rules)
pnpm typecheck         # types, plus the check that src/sim compiles without the DOM or Three.js
pnpm format            # Prettier
pnpm validate:levels   # schema and reachability checks for levels/*.level.json
pnpm build             # validate levels, typecheck and build to dist/
```

CI runs lint, format check, typecheck, tests and build on every PR. `main` is deployed to GitHub Pages.

### Architecture

| Folder        | What lives there                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/sim/`    | The deterministic simulation: grid collision, Nora's state machine, mechanisms, enemies and level logic. It runs in Node, with a fixed 60 Hz step and seeded RNG; it has no Three.js and no DOM. |
| `src/render/` | Three.js (`WebGPURenderer` with WebGL2 fallback): level meshes, props, Nora, post-processing and quality tiers.                                                                                  |
| `src/audio/`  | The Web Audio engine: recorded sample banks, positional sound, reverbs and the adaptive music director.                                                                                          |
| `src/ui/`     | HUD, menus, loading, intro, journal reader, end screen and i18n (`i18n/*.json`).                                                                                                                 |
| `levels/`     | Level files: text-row grids with a legend, entities and rules, validated by `src/sim/grid/schema.ts`.                                                                                            |
| `art/looks/`  | Per-room lighting and grade.                                                                                                                                                                     |

The simulation emits events; render, audio and UI only listen. The rules for contributors, human or Claude Code, are in [CLAUDE.md](CLAUDE.md). The design spec is in [docs/spec.md](docs/spec.md) (Spanish).

### Asset pipelines

| Asset     | How it is built                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lightmaps | `scripts/bake/`: `export-level.ts` exports the level, then Blender Cycles bakes the indirect light with `bake_lightmap.py`.                        |
| Nora      | `scripts/character/rig_nora.py` turns the Meshy scan into a rigged, optimised GLB.                                                                 |
| Models    | `pnpm models:fit` fits a Meshy model (guardians, keepers, relics, props) to the game, then `pnpm textures:ktx2 --only models` compresses it.       |
| Animation | `pnpm anim:build scripts/anim/sources/mixamo.json <folder>` retargets Mixamo FBX clips onto Nora ([docs/animation.md](docs/animation.md)).         |
| Props     | `scripts/blender/build_props.py` models and bakes the PBR prop kit in Blender.                                                                     |
| Audio     | `scripts/audio/build_audio.py` downloads, checks licences, trims, loops and normalises every sound and music cue ([docs/audio.md](docs/audio.md)). |

## Credits and licence

All third-party assets are CC0 or CC-BY, or were made for the project. The full list with authors and licences is in [CREDITS.md](CREDITS.md), and the game shows it on its Credits screen.

© 2026 César. The code is open source under the [MIT License](LICENSE); the game's own assets (levels, texts, art, models, animation, images and sound made for it) are all rights reserved. Third-party assets keep their own licences. The split, folder by folder, is in [docs/license.md](docs/license.md). Progress notes are in [docs/changelog.md](docs/changelog.md).
