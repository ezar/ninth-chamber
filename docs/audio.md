# Audio and the adaptive score

Everything audible runs on Web Audio in `src/audio/`, listening to simulation and UI events (spec §12). The simulation never knows about sound: it emits events, and level rules can emit `music <name>`.

| File                   | Role                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `engine.ts`            | Facade used by `main.ts`: unlock, events, room, level, phase, health, pause.                                       |
| `graph.ts`             | Maps every event to sound effects (recorded samples first, synthesis as fallback) and forwards it to the director. |
| `director.ts`          | The music state machine (pure logic, no Web Audio): decides _what_ plays.                                          |
| `score.ts`             | Data: the cue each state plays, per chamber (palettes by level id).                                                |
| `score-player.ts`      | Plays the director's requests: streams, seamless loops, layers, stingers, ducking, heartbeat, muffling.            |
| `samples.ts`, `sfx.ts` | Sound-effect banks and the procedural sounds.                                                                      |
| `music.ts`             | Synthesised cues and motifs (secret chord, checkpoint chime, fallbacks).                                           |
| `samples.json`         | Manifest written by `scripts/audio/build_audio.py`: sfx banks and music cues.                                      |

## Music states

Highest priority first. Only one main cue plays at a time. Stingers play over it.

| State   | Starts on                                                                                                                                                   | Ends                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| death   | `player.died`: the death sting. The music cuts, and danger, heartbeat and muffling are reset.                                                               | `player.respawned`: silence, then exploration.                                       |
| boss    | rule `music boss` (the stone guardian)                                                                                                                      | rule `music calm`                                                                    |
| chase   | rule `music chase` (the rolling boulder)                                                                                                                    | rule `music calm`                                                                    |
| combat  | `enemy.alerted` (per enemy id); `enemy.hit`/`enemy.bite` keep it alive; rule `music combat`                                                                 | 4 s after the last hunter's `enemy.died`/`enemy.gaveUp`, or 25 s without enemy news. |
| tension | the worst of: a timed door's `door.tick` (stronger as `left` drops), `tile.cracked` (decays over 5 s), rule `music tension` (trap zones), health below 30 % | when every source is gone; rule `music calm` clears the manual one                   |
| base    | title, intro, exploration, relic, fanfare, end                                                                                                              | see below                                                                            |

Base states:

- **title**: on the title screen, from the first gesture. Loops.
- **intro**: `intro.start` (under the story cards). It fades out on `intro.end`.
- **exploration**: silence first (45–75 s after the intro, a respawn or a fight). Then one exploration cue plays through, followed by 100–170 s of silence before the next. Rule `music hall` / `music explore` starts a cue at once, for a marked moment such as entering a great hall.
- **relic**: rule `music relic`, the relic reveal.
- **fanfare**: rule `music fanfare` or `level.end` (plays once).
- **end**: `end.show`. The main theme returns under the end screen 4 s later.

Stingers duck the bed:

| Stinger    | Event                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| discovery  | `secret.found` (under the synthesised secret chord), `note.read` (journal), rule `music vista` (a new vista), `end.reveal`         |
| solved     | `door.opening` within 1.5 s of `lever.pulled` or `plate.pressed`, once per door per level; or rule `music solved`                  |
| death      | `player.died`                                                                                                                      |
| checkpoint | `checkpoint`, a synthesised motif. Skipped when a rule sets music in the same tick, during danger, or within 20 s of the last one. |

Techniques:

- **Vertical layering.** Each tension, combat, chase or boss loop runs through a low-pass whose cutoff follows the intensity (0: a dark drone at 280 Hz, 1: fully open), and its level rises with it. Above 0.6, a synthesised war-drum layer comes in, locked to the loop's bar grid (half time at fast tempos).
- **Horizontal re-sequencing.** A switch from one loop to another (tension → combat → back) waits for the next bar of the playing loop. Urgent switches (chase, boss, death) cut in at once with a short crossfade. Streams crossfade immediately.
- **Low health.** Below 30 %: a heartbeat (72–130 bpm, faster as health drops), a low-pass muffling the music (down to about 2 kHz), and tension.
- **Pause.** The audio context is suspended and streamed music elements pause. The director's clock is the audio clock, so its timers stop too.

## Level rules

The `music <name>` action (`levels/*.level.json`, logic `do` lists) accepts these names. Unknown names are ignored.

| Name                 | Effect                                                 |
| -------------------- | ------------------------------------------------------ |
| `hall`, `explore`    | Play the next exploration cue now (not during danger). |
| `relic`              | The relic reveal.                                      |
| `fanfare`            | The level-end fanfare.                                 |
| `tension`            | Tension on (for trap zones) until `calm`.              |
| `combat`             | Force combat until `calm`.                             |
| `chase`, `boss`      | The chase or boss state until `calm`.                  |
| `calm`               | Clear tension, combat, chase and boss.                 |
| `vista`, `discovery` | The discovery stinger.                                 |
| `solved`             | The puzzle-solved stinger.                             |
| `silence`            | Fade the base music out.                               |

For example, a trap corridor: `{ "when": "z_traps.entered", "do": ["music tension"] }` and `{ "when": "z_traps_end.entered", "do": ["music calm"] }`. For the boulder: `"music chase"` when it starts rolling and `"music calm"` when it stops.

## Palettes

`score.ts` maps each level id to its cues; unknown levels use the Antechamber's.

| Chamber                                 | Intro                      | Exploration                                                      | Tension          | Combat              | Relic         | Fanfare           |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------- | ---------------- | ------------------- | ------------- | ----------------- |
| `antechamber` (ancient, desert, solemn) | Memories Of Stone          | Passage of Time; Lost Frontier                                   | Oppressive Gloom | Curse of the Scarab | Arcadia       | Hero Theme        |
| `cisterns` (dark, watery, echoing)      | Permafrost                 | Mirage; Decoherence                                              | Long Note Three  | Constance           | The Great Sea | Hero Theme        |
| `sun_temple` (majestic, golden, a boss) | Hymn to the Dawn (opening) | Hymn to the Dawn (the build); Passage of Time (the regal finale) | Enter the Maze   | Juggernaut          | Victor Lux    | The Curtain Rises |

Shared: title (Age of Wonder), chase (Mistake the Getaway), boss (Goliath). Stingers: Discovery Hit (vista), Greta Sting (journal), Mystery Sting (secret), Danse Macabre big hits (solved), Darkness Speaks (death).

Composers: Scott Buckley (CC-BY 4.0) and Kevin MacLeod (CC-BY 4.0). Credits are in `CREDITS.md` and `public/audio/CREDITS.md`.

## Adding a cue

1. Add the source to `INCOMPETECH` or `SCOTT_BUCKLEY` in `scripts/audio/build_audio.py` (other sources need a `Sources` method that checks the licence on the source page; only CC0 or CC-BY).
2. Add a `Cue` to `CUES`:
   - `stream` for music that plays through;
   - `loop` for a state bed. Give `bpm` (0 estimates it, -1 for free time) and `bars`. The build searches the window for the loop point where the music matches itself one loop later, and cross-fades the seam;
   - `sting` for a short hit over the bed.

   Levels: beds and streams at -20 to -22 LUFS integrated, climaxes -18, stingers -15 to -18 (max momentary).

3. Run `python scripts/audio/build_audio.py --only <cue id>` (or `--only music`). It writes `public/audio/music/<id>.webm`, the entry in `src/audio/samples.json` and the credits.
4. Use the cue id in a palette in `src/audio/score.ts`. `tests/music.test.ts` checks that every palette cue exists with the right kind and that loops hold whole bars.

Budget: about 18 MB of music (Opus in WebM, 56–64 kbps). Streams are never decoded in the game. Loops decode at 24–32 kHz, and a level prefetches only its own loops and stingers after the start.
