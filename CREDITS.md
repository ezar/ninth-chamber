# Credits

The Ninth Chamber (La Novena Cámara) · © 2026 César. All rights reserved: the licence is still an open decision, see [docs/license.md](docs/license.md).

The in-game Credits screen reads the bullet items of the **Audio** and **Music** sections of this file at build time (`scripts/vite-site.ts`), so keep them as short bullet lists. The build ships this file as `credits.txt`, linked from that screen.

## Code

- Game by César.
- [Three.js](https://threejs.org) — MIT License. Rendering (WebGPU with WebGL2 fallback).
- [Zod](https://zod.dev) — MIT License. Level file validation.
- Development tooling, not shipped: Vite, Vitest, TypeScript, ESLint, Prettier, tsx (MIT / Apache-2.0).

## Audio

Recorded sound under open licences. The full list, file by file with source links, is in [public/audio/CREDITS.md](public/audio/CREDITS.md) (also served with the game at `audio/CREDITS.md`); `scripts/audio/build_audio.py` rebuilds every file from these sources.

- Sound effects from Freesound.org — CC0: Nox_Sound (footsteps on rock and sand, jumps, scuffs, stone impacts, rocks, debris, rock friction, campfire), CheatinSloth (stone slab dragged), PostProdDog (heavy stone door), ALLANZ10D (rocks crumbling), uagadugu and metrostock99 (earthquake rumble), Flamiffer (dungeon air), launemax (wind), spookymodem and Sclolex (cave drips), leonelmail (clothing), Crinkem (leather), newagesoup and morganveilleux (hands on concrete), the_very_Real_Horst (singing bowl).
- Kenney (kenney.nl) — CC0: Impact Sounds, RPG Audio and Interface Sounds packs.
- Secret motif, chimes, relic hum and reverbs synthesised in code (src/audio).

## Music

- "Tempting Secrets", "Lost Frontier", "Arcadia" and "Hero Theme" by Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License, https://creativecommons.org/licenses/by/4.0/

## Textures

- Surface textures from [Poly Haven](https://polyhaven.com) — CC0: `large_sandstone_blocks_01`, `sandstone_blocks_08`, `sandstone_cracks` and `sand_01` by Rob Tuytel; `rock_face_03` by Dario Barresi and Rico Cilliers. Sources in `public/textures/sources.json`.

## Models

- Art direction, interface and identity: the Claude Design canvas described in [docs/art/README.md](docs/art/README.md).
- Props and level art (`public/models`): procedural, built in Blender by the prop kit (`scripts/blender`) and in code (`src/render`).
- Nora Vidal: a Meshy model from the owner's reference, decimated and rigged in Blender (`scripts/character/rig_nora.py`).
- Indirect light baked with Blender Cycles (`scripts/bake`).

## Animation

- [Quaternius](https://quaternius.com) animation library — CC0.
- [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu). The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.
- Procedural animation layer in `src/render/nora.ts`.

## Fonts

- [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) by Christian Thalmann — SIL Open Font License 1.1.
- [Barlow](https://fonts.google.com/specimen/Barlow) by Jeremy Tribby — SIL Open Font License 1.1.
- [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) by IBM — SIL Open Font License 1.1.
- Served by Google Fonts.
