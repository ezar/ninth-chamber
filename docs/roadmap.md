# Roadmap to 0.6.0

Agreed with the owner on 2026-10-03, after 0.5.1. The owner asked for 0.6. Following the spec's production order ("Orden de producción y dependencias"), it is chamber VII, the Wind Stair. As with the Forge, Claude takes its design decisions from the spec. Each decision taken is listed below for review. The roadmap to 0.5.0 is closed; its record is in the changelog.

**Goal:** chamber VII, the Wind Stair: an eighty-metre shaft through the mountain, gusts on a fixed rhythm that lengthen or shorten jumps and tear Nora off ledges, flute levers that change where the wind blows, the first hanging rope, rock birds that push, and a climb to the open sky.

## Decisions

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content       | Chamber VII only, as spec §19 describes it: ten rooms, three secrets, three journal notes, no boss, and the Wind Shell.                                                                                                                                                                                                                              |
| Wind          | A wind zone is a rectangle of cells blowing one way: north, east, south, west, or up. It gusts on a fixed cycle (period, gust length, offset), like the Temple's fire floors, or blows steadily. A rising flute tone and a warning before each gust. Rules turn zones on, off or toggle them: the flute levers are ordinary levers with rules.       |
| Gust strength | A horizontal gust carries Nora at 3 m/s in the air. That lengthens a running jump by about a block (the spec's test: with a following gust, a running jump clears a 3-block gap), and a head gust shortens it by as much. On the ground it pushes at a third of that: she can always walk against it, and walking still never drops her off an edge. |
| Updraughts    | An upward zone holds her up: it halves gravity in the air, so she jumps higher and falls slower. Fall damage still counts the height fallen.                                                                                                                                                                                                         |
| Ledges        | A zone may `tear`: Nora hanging in it is torn off once a gust has blown on her for 0.6 s, so she waits for the lull between gusts.                                                                                                                                                                                                                   |
| Rope          | A rope hangs from the ceiling over a cell. Jumping into it with Action held (or with auto-grab) she grabs and pulls it: it works like a lever (`<id>.pulled`), then she drops.                                                                                                                                                                       |
| Rock birds    | A new enemy, `bird`: fast and fragile, it flies at Nora and pushes her (a shove, little damage) instead of biting. Two or three in the nest.                                                                                                                                                                                                         |
| Camera        | Rooms can set a vertical framing (looking up or down the shaft) and fixed shots for the hanging traverse, in the level file.                                                                                                                                                                                                                         |
| Flute audio   | Synthesised flutes: each zone's tone rises before its gust and sounds while it blows, pitched by height in the shaft and spatialised.                                                                                                                                                                                                                |
| Models        | Procedural stand-ins (flutes, ropes, birds, the shell) until the owner's models arrive, listed in docs/art/models-brief.md.                                                                                                                                                                                                                          |

## 0.5.5 · Wind

1. **Wind zones** (`src/sim/mechanisms/wind.ts`): direction, strength, cycle, `tear`. Signals `<id>.gust`, actions `<id>.on`, `<id>.off` and `<id>.toggle`. Movement tests: a running jump with a following gust clears 3 blocks, a head gust stops it clearing 2, an updraught reaches a ledge out of reach, a gust tears her from a ledge and a lull does not, and walking against the wind never drops her off an edge.
2. **Render**: dust and leaves blown along each zone while it gusts.
3. **Audio and captions**: the flute tone, the warning and the gust, with subtitles.
4. The level validator's reachability counts the longer jumps and higher reach in wind.

## 0.5.6 · Rope, birds and camera

1. **The hanging rope** (sim, render), with tests.
2. **Rock birds** (sim, render, sound), with tests: they fly, push and die to the pistols.
3. **Vertical camera** framing and fixed shots per room.

## 0.6.0 · Chamber VII, the Wind Stair

1. **The level**, following spec §19:
   - ten rooms (the shaft's foot, the first flute's ledges, the counterweights, the flute-lever side room, the nest, the hanging traverse, the rope room, the great flute, the storm climb, the summit);
   - three secrets and three notes;
   - looks, a baked lightmap, a music palette, the campaign entry, hints, and texts in English, Spanish and Catalan.
2. **Verification**: a bot walkthrough with every secret and no deaths, "every puzzle is needed" tests, `pnpm smoke`, reference shots, and the reachability check.

## How it will be built

- **Three small releases** (0.5.5, 0.5.6, 0.6.0), each a PR with its own changelog entry, merged when CI is green.
- **Commit often.** Container restarts and usage limits have cost work before.
