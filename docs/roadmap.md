# Roadmap to 0.5.0

Agreed with the owner on 2026-10-03, after 0.4.0. The owner chose chamber VI, the Bronze Forge (spec §19), for 0.5, and left its design decisions to Claude, following the spec. Each decision taken is listed below for review. The roadmap to 0.4.0 (Phase 3) is closed; its record is in the changelog.

**Goal:** chamber VI, the Bronze Forge: molten bronze that is diverted and cools into bridges, bellows that wake the forges, heat, bronze automatons and Bazûr, the founder, in a chamber of ten rooms whose relic Nora casts herself.

## Decisions

| Topic           | Decision                                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content         | Chamber VI only, as spec §19 describes it: ten rooms, three secrets, three journal notes, Bazûr and the Mould of the Ninth Segment.                                                                                                                              |
| Molten bronze   | A pour fills a trench along a path of cells: it runs from its source at a set speed, kills on contact while it glows, and cools into solid floor at the trench's lip in a few seconds. Gates are levers and rules: which trench gets the bronze is logic, not physics. |
| Repeating pours | A pour may repeat on a period: the bridge it leaves is covered by the next pour (spec §19, "Puente de bronce").                                                                                                                                                  |
| Bellows         | A pushable block with the bellows' look. Pushed onto a forge's plate it wakes the forge (a cold brazier that lights by rule), and a lit forge opens its doors by heat. No new physics.                                                                            |
| Heat            | Heat zones drain health slowly outside the shade of their walls (sectors flagged `shade`), with a screen warning and a sound. Heat can kill, so checkpoints sit before each zone.                                                                                 |
| Automatons      | A new enemy, `automaton`: slow, armoured (pistols do a tenth of their damage), and destroyed for good by quench water (1 m or deeper) or by molten bronze over it.                                                                                                |
| Bazûr           | The stone guardian's code with a bronze variant. A pour over it costs it a phase (it climbs out cooled and slower to start), a blow from above to its core still works, and two blows defeat it. In phase 2 its rules turn the hall's side pours towards Nora. |
| Models          | Procedural stand-ins (crucibles, channels, bellows, automatons, Bazûr) until the owner's models arrive, listed in docs/art/models-brief.md.                                                                                                                       |

## 0.4.5 · Bronze

1. **Pours** (`src/sim/mechanisms/bronze.ts`): trench, path, speed, cooling time, optional period; signals `<id>.molten` and `<id>.solid`; actions `<id>.pour` and `<id>.stop`; deadly while hot, solid floor once cooled. Movement tests.
2. **Bellows and forges**: blocks with a `look`, and the `light` action for cold braziers.
3. **Heat zones** with damage, the `shade` flag, warnings and captions.
4. **Render**: the glowing bronze that darkens as it cools (emissive TSL), crucibles, channels, bellows, the heat shimmer on screen.
5. The level validator's reachability counts a pour's cooled bridge.

## 0.4.6 · Automatons and Bazûr

1. **Automatons** (sim, render, sound), with tests: armour, quench, bronze.
2. **Bazûr**: the guardian's bronze variant, with tests: a pour costs a phase, phase-2 rules, defeat.

## 0.5.0 · Chamber VI, the Bronze Forge

1. **The level**, following spec §19:
   - ten rooms (cold moulds, the first pour, bellows, the main channel with three gates, the automaton workshop, the quench pit, the furnaces, the bronze bridge, the casting hall with Bazûr, the mould of the seal);
   - three secrets and three notes;
   - looks, a baked lightmap, a music palette, the campaign entry, hints, and texts in English, Spanish and Catalan.
2. **Verification**: a bot walkthrough with every secret and no deaths, "every puzzle is needed" tests, `pnpm smoke`, reference shots, and the reachability check.

## How it will be built

- **Three small releases** (0.4.5, 0.4.6, 0.5.0), each a PR with its own changelog entry, merged when CI is green.
- **Commit often.** Container restarts and usage limits have cost work before.
