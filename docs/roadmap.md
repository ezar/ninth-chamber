# Roadmap to 0.9.0

Agreed with the owner on 2026-10-04, after 0.8.1: chamber IX, the Ninth Chamber, the end of the campaign. The owner took the four open decisions of spec §19 (below). Claude takes the remaining design decisions from the spec; each is listed here for review. The roadmap to 0.8.0 is closed; its record is in the changelog.

**Status:** in progress.

**Goal:** chamber IX: the night of the conjunction, a crack seen only in its light, a walk back through every chamber in reverse order, and the seal, where Nora chooses whether to write her name in the ninth segment.

## The owner's decisions (spec §19, "Decisiones abiertas")

| Question                     | Decision                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One ending or two            | **Two endings (B).** Before the seal, with Action and no menu, Nora writes her name in the ninth segment (she stays as its keeper) or leaves it blank, as her grandmother did. |
| A real timer                 | **Real but generous.** A countdown on screen only for the last run in the conjunction's light, with a checkpoint every two rooms.                                              |
| Elena's 1956 letter          | **Shown**, as the chamber's second note: the letter she never sent, hidden in Qarrum's dais, which tells what she saw and why she left the Heart.                              |
| Guardians' and relics' names | **Final** as they are.                                                                                                                                                         |

## Claude's decisions

| Topic         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rooms         | Twelve, as spec §19 proposes: the crack of the ray, the antechamber of the eight, one echo room for each earlier chamber and the seal. The echo rooms run in reverse campaign order (VIII to I), as the spec's own rule says, rather than in the order its list gives.                                                                                                                                                          |
| The five keys | The crack's door opens with what the five middle relics give, each through the mechanism its chamber taught: the name written with light (a beam onto a receiver), the roots parted by the seed, the bronze segment set in its slot, the shell's note (a flute), and the astrolabe's moment (a ring set to its mark). Nora carries the relics, so the level's rules hand her each step rather than ask her to find items again. |
| The timer     | A countdown the rules start and stop (`timer.start <s>`, `timer.stop`), shown on the HUD. When it runs out she goes back to the last checkpoint, with the time she had there. It runs only from the last echo rooms to the seal.                                                                                                                                                                                                |
| The choice    | At the seal: Action at the ninth segment carves her name (the keeper's ending). The way back up into the open opens behind her; walking out through it leaves the segment blank (the grandmother's ending). Nothing else ends the chamber.                                                                                                                                                                                      |
| Endings       | Each ending has its own end texts and its own third note, the one Nora writes. After either, long credits play with the title music. The blank ending shows Elena's signature, "E. V. — 1956", beside Nora's.                                                                                                                                                                                                                   |
| Secrets       | One in each of the echo rooms of chambers I to III, as the spec says: the last three of the game.                                                                                                                                                                                                                                                                                                                               |
| Threats       | Little combat: the traps of every earlier chamber, combined. No boss.                                                                                                                                                                                                                                                                                                                                                           |
| Models        | Procedural stand-ins (the eight statues, the empty pedestal, the seal) until the owner's models arrive, listed in docs/art/models-brief.md.                                                                                                                                                                                                                                                                                     |

## 0.8.5 · The timer and the choice

1. **The conjunction timer** (sim), with tests: rules start and stop it, it counts down in ticks, and when it runs out Nora returns to the last checkpoint with the time she had there. HUD countdown.
2. **Endings**: `level.end <ending>` carries which ending was reached, and the end screen and the save remember it.

## 0.8.6 · The finale

1. **The end of the campaign**: per-ending end texts and third note, Elena's signature on the blank ending, and the credits with the title music.
2. **The eight on their pedestals**: the antechamber of the eight shows the eight relics in place, read from the campaign's progress.

## 0.9.0 · Chamber IX, the Ninth Chamber

1. **The level**, following spec §19:
   - twelve rooms;
   - three secrets and three notes, Elena's letter among them;
   - looks, a baked lightmap, a music palette, the campaign entry, hints, and texts in English, Spanish and Catalan.
2. **Verification**: bot walkthroughs to both endings with every secret and no deaths, "every puzzle is needed" tests, the timer's checkpoints, `pnpm smoke`, reference shots and the reachability check.

## How it will be built

- **Three small releases** (0.8.5, 0.8.6, 0.9.0), each a PR with its own changelog entry, merged when CI is green.
- **Commit often.** Container restarts and usage limits have cost work before.
