# Credits

The Ninth Chamber (La Novena Cámara) · © 2026 César. The code is open source under the MIT License; the game's own assets (levels, texts, art, models and animation) are all rights reserved. See [LICENSE](LICENSE) and [docs/license.md](docs/license.md). Third-party work below keeps its own licence.

The in-game Credits screen reads the bullet items of the **Audio** and **Music** sections of this file at build time (`scripts/vite-site.ts`), so keep them as short bullet lists. The build ships this file as `credits.txt`, linked from that screen.

## Code

- Game by César.
- [Three.js](https://threejs.org) — MIT License. Rendering (WebGPU with WebGL2 fallback).
- [Zod](https://zod.dev) — MIT License. Level file validation.
- Water ripple and caustic textures are generated in code at load time (src/render/water-maths.ts): no texture assets.
- Development tooling, not shipped: Vite, Vitest, TypeScript, ESLint, Prettier, tsx (MIT / Apache-2.0).

## Audio

Recorded sound under open licences. The full list, file by file with source links, is in [public/audio/CREDITS.md](public/audio/CREDITS.md) (also served with the game at `audio/CREDITS.md`); `scripts/audio/build_audio.py` rebuilds every file from these sources.

- Sound effects from Freesound.org — CC0: Nox_Sound (footsteps on rock and sand, jumps, scuffs, stone impacts, rocks, debris, rock friction, campfire), CheatinSloth (stone slab dragged), PostProdDog (heavy stone door), ALLANZ10D (rocks crumbling), uagadugu and metrostock99 (earthquake rumble), Flamiffer (dungeon air), launemax (wind), spookymodem and Sclolex (cave drips), leonelmail (clothing), Crinkem (leather), newagesoup and morganveilleux (hands on concrete), the_very_Real_Horst (singing bowl).
- Kenney (kenney.nl) — CC0: Impact Sounds, RPG Audio and Interface Sounds packs.
- Secret motif, chimes, relic hum and reverbs synthesised in code (src/audio).

## Music

- "Age of Wonder", "Memories Of Stone", "Passage of Time", "Hymn to the Dawn", "Permafrost", "Decoherence", "The Great Sea", "Victor Lux", "Juggernaut", "Goliath", "Shadows and Dust", "In Search Of Solitude", "Chronicle", "Borealis", "Petrichor", "Within Our Nature", "Song Of The Forge", "Machina", "Path Through The Mountains", "Cirrus", "Ride The Wind", "Celestial", "Adrift Among Infinite Stars", "Where Stars Fall", "Last and First Light", "I Walk With Ghosts", "Echoes" and "Light in Dark Places (2019 Remaster)" by Scott Buckley — released under CC-BY 4.0. www.scottbuckley.com.au
- "Lost Frontier", "Arcadia", "Hero Theme", "The Curtain Rises", "Mirage", "Oppressive Gloom", "Curse of the Scarab", "Long Note Three", "Constance", "Enter the Maze", "Mistake the Getaway", "Discovery Hit", "Greta Sting", "Mystery Sting", "Danse Macabre - Big Hit 1", "Danse Macabre - Big Hit 2", "Darkness Speaks", "Teller of the Tales", "Ibn Al-Noor", "Willow and the Light", "Magic Forest", "Trouble with Tribals", "Crusade - Heavy Industry", "Industrial Revolution", "Mechanolith", "Evening of Chaos", "When The Wind Blows", "Crypto" and "Infinite Perspective" by Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License, https://creativecommons.org/licenses/by/4.0/
- Excerpted, looped and levelled for the adaptive score by `scripts/audio/build_audio.py`; file by file in [public/audio/CREDITS.md](public/audio/CREDITS.md).

## Textures

- Surface textures from [Poly Haven](https://polyhaven.com) — CC0: `large_sandstone_blocks_01`, `sandstone_blocks_08`, `sandstone_cracks` and `sand_01` by Rob Tuytel; `rock_face_03` by Dario Barresi and Rico Cilliers. Sources in `art/textures/sources.json` (the scans; the game ships them as KTX2 in `public/textures`).

## Models

- Art direction, interface and identity: the Claude Design canvas described in [docs/art/README.md](docs/art/README.md).
- Props and level art (`public/models`): procedural, built in Blender by the prop kit (`scripts/blender`) and in code (`src/render`).
- Nora Vidal: a Meshy model from the owner's reference, decimated and rigged in Blender (`scripts/character/rig_nora.py`).
- Indirect light baked with Blender Cycles (`scripts/bake`).

## Animation

- Nora's motion clips (`public/anim/*.json`) are **Mixamo** animations (Adobe, https://www.mixamo.com), made on Nora's own mesh and retargeted onto her game skeleton: Breathing Idle, Walking, Walking Backwards, Running, Run To Stop, Left/Right Turn 90, Jump, Running Jump, Falling Idle, Falling To Landing, Hanging Idle, Braced Hang Shimmy (and mirror), Braced Hang To Crouch, Pushing, Picking Up, Hit Reaction, Dying, Pistol Idle, Pistol Run, Shooting, Treading Water, Swimming and Swimming To Edge. Mixamo animations are free to use in games (royalty-free, per Adobe's Mixamo terms). The FBX downloads are not in the repo; `pnpm anim:build scripts/anim/sources/mixamo.json <folder>` rebuilds the clips (see `docs/animation.md`).
- Earlier clips came from the **Universal Animation Library** (Standard) by [Quaternius](https://quaternius.com), CC0 1.0; the pipeline still supports it (`scripts/anim/sources/ual.json`).
- Procedural animation layer (climbing, mechanisms, aiming) in `src/render/nora.ts`.

## Fonts

- [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) by Christian Thalmann — SIL Open Font License 1.1.
- [Barlow](https://fonts.google.com/specimen/Barlow) by Jeremy Tribby — SIL Open Font License 1.1.
- [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) by IBM — SIL Open Font License 1.1.
- Served by Google Fonts.
