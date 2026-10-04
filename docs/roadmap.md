# Roadmap to 0.8.0

Agreed with the owner on 2026-10-04, after 0.7.1. Chamber IX needs the owner's decisions first, so the owner chose chamber V, the Root Halls, which needs none. It is the last of the middle chambers. As before, Claude takes its design decisions from the spec. Each decision taken is listed below for review. The roadmap to 0.7.0 is closed; its record is in the changelog.

**Status:** done. 0.7.5, 0.7.6 and 0.8.0 are released; see the changelog.

**Goal:** chamber V, the Root Halls: a forest buried when the mountain sank, whose roots have split the halls for three thousand years. Walls of roots Nora climbs, tangles that shrink from the torch, scorpions, root floors that give way, and the long climb up Erreth's trunk to the Stone Seed.

## Decisions

| Topic           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content         | Chamber V only, as spec §19 describes it: ten rooms, three secrets, three journal notes, no boss, and the Stone Seed.                                                                                                                                                                                                                                                                                                                                                            |
| Climbable walls | A sector flag `climb<D>` marks the face of that sector that looks towards D as climbable. Nora climbs it facing the other way: up, down and sideways, and jumps back off it (spec §5, "Escalar paredes"). She gets on from the ground (Action facing the face), from a jump (Action held, like a grab) and from a ledge above (back, while hanging). At the top of the face she hangs from its edge and climbs up as from any ledge; at the bottom she steps off onto the floor. |
| Tangles         | A tangle is a block of cells that is solid and climbable while grown. A lit torch close to it makes it shrink back and opens the way, and takes its handholds away. With the torch out or away, it grows back slowly. It never grows back onto Nora.                                                                                                                                                                                                                             |
| Scorpions       | A new small enemy in groups. Its sting poisons, like the darts of chamber IV.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Root floors     | The crumbling floor of chamber I with the `wood` material: the creak of wood and its own look. Thorns are the death pits with their own look.                                                                                                                                                                                                                                                                                                                                    |
| Erreth's trunk  | The climax: a long climb up the trunk while tangles close below, on a timer the rules start. It is soft: the tangles grow up behind Nora, never onto her.                                                                                                                                                                                                                                                                                                                        |
| Secrets         | As spec §19 lists them: a mat of roots opened only by the torch held over it, a face hidden behind a curtain of roots, and a chamber under the pool. As built, that chamber is an air pocket beyond a drowned tunnel, since nothing is picked up under water.                                                                                                                                                                                                                    |
| Models          | Procedural stand-ins (root walls, tangles, scorpions, the trunk, the seed) until the owner's models arrive, listed in docs/art/models-brief.md. The Mixamo climbing animations come with the owner's models; until then the climbing pose is built from the hanging one.                                                                                                                                                                                                         |

## 0.7.5 · Wall climbing

1. **The climbing mode** (`src/sim/player/modes/wall.ts`): getting on and off, the four directions, the jump back, the top and the bottom of the face, with movement tests.
2. **Reachability**: the validator counts climbable faces.
3. **Render**: the climbing pose, and roots drawn on climbable faces.

## 0.7.6 · Tangles, scorpions and root floors

1. **Tangles** (sim), with tests: they shrink from a lit torch and grow back slowly, and never onto Nora.
2. **Scorpions** (sim), with tests: small, in groups, poisonous.
3. **Render, sound and subtitles** for tangles, scorpions, wooden floors and thorns.

## 0.8.0 · Chamber V, the Root Halls

1. **The level**, following spec §19:
   - ten rooms (the rift, the first climbable wall, the gallery of tangles, the scorpions' nest, the pool of roots, the split hall, the root bridge, the forest vault, Erreth's trunk, the heart of the tree);
   - three secrets and three notes;
   - looks, a baked lightmap, a music palette, the campaign entry, hints, and texts in English, Spanish and Catalan.
2. **Verification**: a bot walkthrough with every secret and no deaths, "every puzzle is needed" tests, `pnpm smoke`, reference shots, and the reachability check.

## How it will be built

- **Three small releases** (0.7.5, 0.7.6, 0.8.0), each a PR with its own changelog entry, merged when CI is green.
- **Commit often.** Container restarts and usage limits have cost work before.
