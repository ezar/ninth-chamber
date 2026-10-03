# Roadmap to 0.7.0

Agreed with the owner on 2026-10-03, after 0.6.0. The owner asked for 0.7, the Observatory: chamber VIII, next in the spec's production order. As before, Claude takes its design decisions from the spec. Each decision taken is listed below for review. The roadmap to 0.6.0 is closed; its record is in the changelog.

**Goal:** chamber VIII, the Observatory: a dome carved at the summit to watch the stars, three rings that turn to align the sky with the clues of the first three relics, the light of the oculus, and Anzur, the eighth keeper, the largest of them, who rises from his seat.

## Decisions

| Topic                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content               | Chamber VIII only, as spec §19 describes it: ten rooms, three secrets, three journal notes, Anzur and the Astrolabe of the Nine.                                                                                                                                                                                                                                                                                                          |
| Rings                 | A ring has nine positions. Spring levers on the dome's rim turn it one position per pull. It is aligned at its target position, which is the ninth place, where the seal lacks its segment: the star of the Amber Heart's map, the new moon of the Tide Glass, the uncut ray of the Sun Disc. Every ring emits `<id>.set` when aligned and `<id>.at<N>` for its position, so rules can also react to a wrong position (the secret niche). |
| The oculus            | A pool of light on the floor under the oculus. Rules turn it on when the three rings are aligned (`sky.set and moon.set and horizon.set`). It opens the way, and it is what stops Anzur.                                                                                                                                                                                                                                                  |
| Night sky             | The Observatory's looks are night looks: cold moonlight through the openings, and a starfield beyond them in which the Amber Heart's eight stars are drawn as a constellation.                                                                                                                                                                                                                                                            |
| Anzur                 | The guardian's code with a third kind, `giant`: bigger, slower, three phases, and it never falls into a pit. Rules advance its phases (`<id>.advance`) as the rings are set. **Phase 1:** it sweeps the hall with a wide blow while Nora turns the first ring. **Phase 2:** its slams break the floor into pits. **Phase 3:** only the oculus light falling on it stops it. Blows from above and pistols do nothing.                      |
| Secrets               | A constellation aligned on the wrong star opens a niche. A ledge on the outside face of the dome is reached on the wind. An idol in Anzur's empty seat is reachable only during phase 2: a gate opens on `anzur.phase2` and closes on `anzur.phase3`.                                                                                                                                                                                     |
| Threats on the way up | Two or three jackals on the climb, as an echo of chamber I.                                                                                                                                                                                                                                                                                                                                                                               |
| Models                | Procedural stand-ins (the rings, the oculus, Anzur, the astrolabe) until the owner's models arrive, listed in docs/art/models-brief.md.                                                                                                                                                                                                                                                                                                   |

## 0.6.5 · Rings, the oculus and the night sky

1. **Rings** (`src/sim/mechanisms/rings.ts`): positions, target, `turn`, signals `set` and `at<N>`. **The oculus**: a light pool switched by rules. Tests.
2. **Render**: the three rings in the dome with their marks (stars, moon phases, the sun), the oculus shaft and its pool of light, the starfield with the Heart's constellation, and night looks.
3. **Sound and subtitles**: the rings grinding round, and the oculus opening.

## 0.6.6 · Anzur

1. **The giant guardian** (sim), with tests: three phases advanced by rules, the wide sweep, slams that break the floor in phase 2, defeat in the oculus light in phase 3, no falls, immune to blows from above.
2. **Render and sound**: a large seated figure that rises, stand-in until the model arrives.

## 0.7.0 · Chamber VIII, the Observatory

1. **The level**, following spec §19:
   - ten rooms (the outer terrace, the gallery of instruments, the first ring, the hall of moons, the hall of the horizon, the dome stairs, under the dome, the battle and the alignment, the oculus, the chamber of the astrolabe);
   - three secrets and three notes;
   - looks, a baked lightmap, a music palette, the campaign entry, hints, and texts in English, Spanish and Catalan.
2. **Verification**: a bot walkthrough with every secret and no deaths, "every puzzle is needed" tests, `pnpm smoke`, reference shots, and the reachability check.

## How it will be built

- **Three small releases** (0.6.5, 0.6.6, 0.7.0), each a PR with its own changelog entry, merged when CI is green.
- **Commit often.** Container restarts and usage limits have cost work before.
