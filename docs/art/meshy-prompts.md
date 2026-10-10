# Meshy prompts

Prompts for generating placeholder and candidate assets with [Meshy](https://www.meshy.ai). They follow the art direction in [README.md](README.md) (Claude Design canvas). Meshy works best with English prompts.

## General settings

- **Mode:** Text to 3D (or Image to 3D using a frame from the Claude Design canvas as reference, which usually gives a closer match).
- **Art style:** Realistic. **PBR maps:** on. **Symmetry:** auto (on for characters and props that are symmetric).
- **Topology:** quad for characters (better for rigging), triangle for static props.
- **Target polycount:** characters 30k, enemies 10k, props 2k–5k (see spec §11 "Assets").
- **Export:** GLB with the textures embedded. Send the file in the chat; Claude puts it in `public/models/<name>.glb` and fits it to the game.
- **Characters:** generate in A-pose, then use Meshy's auto-rigging (humanoid) and export the rigged GLB. Nora's animations come from Mixamo (docs/animation.md); the guardians are animated in code, so they need the rig but no animations.
- **Licence:** check that your Meshy plan grants commercial use and private assets before shipping anything (free-tier outputs may carry an attribution licence).

Always add the shared negative prompt below.

**Shared negative prompt:** `cartoon, anime, low detail, blurry texture, extra limbs, deformed hands, text, logo, watermark, turquoise, teal, Lara Croft, Tomb Raider, braid, ponytail, tank top, thigh holsters, twin pistols, shorts, backpack with two straps`

## Nora Vidal (protagonist)

```text
Full-body realistic 3D character of Nora Vidal, a 34-year-old Spanish field archaeologist, 1.68 m tall, athletic but not exaggerated, grounded and practical. Sand-olive waxed canvas field jacket with sleeves rolled to the elbow, off-white cotton shirt, tobacco-brown canvas work trousers, ankle-high oiled brown leather boots, a worn saddle-leather satchel on a cross-body strap with a field notebook peeking out, a madder-red cotton neckerchief. Dark brown hair gathered in a low loose knot with a pencil pushed through it. Warm olive skin, calm determined expression, light dust and wear on the clothes. A-pose, arms slightly away from the body, neutral lighting, PBR, game-ready, clean topology for rigging.
```

## Enemies

**Jackal (level 1 enemy):**

```text
Realistic desert jackal, lean and wiry, sandy golden fur with darker back and black-tipped tail, large ears, amber eyes, slightly scarred and dusty, standing four-legged neutral pose, game-ready PBR, 10k polygons.
```

**Stone guardian (mini boss, phase 2):**

```text
Ancient stone guardian statue from a lost Bronze Age civilization, stacked and corbelled sandstone body, heavy square shoulders, carved nine-segment seal on the chest with an amber crystal core glowing in the ninth segment, eroded edges, cracks with sand in them, no arches or circles except the seal, standing neutral pose, realistic PBR, game-ready.
```

## Props (The Antechamber)

**Brazier:**

```text
Ancient oxidized bronze brazier on a three-legged tripod, wide shallow bowl with a thick rim, verdigris green patina with warm bright bronze worn where hands touch, soot on the bowl, about 1.2 m tall, realistic PBR, game prop.
```

**Amber Heart (the relic):**

```text
The Amber Heart relic: a fist-sized polished amber gemstone shaped like a stylised heart with nine facets, warm inner glow, tiny trapped inclusions, set in a thin worn gold cage with engraved nine-segment motif, realistic PBR, hero prop, high detail.
```

**Idols (secrets), one per material:**

```text
Small ancient votive idol statuette, 30 cm, abstract seated figure with folded arms and an elongated head, carved from polished green jade, on a small round plinth, worn edges, realistic PBR, game prop.
```

Repeat with `solid gold, slightly worn` and `weathered grey stone` instead of `polished green jade`.

**Pushable block:**

```text
Monolithic dressed sandstone block, exactly cube-shaped 2 m on each side, bevelled worn edges, shallow grip notches carved on each face at chest height, drag grooves and scuffs near the bottom, faint carved glyph band, realistic PBR, game prop, low poly with detailed textures.
```

**Wall lever:**

```text
Ancient bronze wall lever mechanism, rectangular bronze wall plate with rivets and a single long handle ending in a round gold-worn knob, verdigris patina, worn bright metal on the handle, realistic PBR, game prop.
```

**Sealed stone door:**

```text
Massive trapezoidal sandstone slab door, 2 m wide and 5 m tall, 45 cm thick, carved nine-segment circular seal in the centre with the ninth segment outlined in amber, eroded corners, sand in the carvings, realistic PBR, game prop.
```

**Medkit (field satchel):**

```text
Small worn leather field medical pouch with a buckled flap, canvas side panels, a stitched green leaf emblem (no red cross), realistic PBR, game prop.
```

## Chambers IV to IX

One prompt for each model in [models-brief.md](models-brief.md), which gives the file name, size, triangle budget and the parts the game needs. The prompts are short because Meshy limits prompt length; add the shared negative prompt to every one.

**How to send them.** Export each model as GLB, name it as in the heading (`tamrit.glb` and so on) and send it in the chat. Claude fits it to the game: scale and origin, the KTX2 textures, splitting off the parts the game lights or moves (`core`, `glow`, `drum`, `embers`, `coals`, `ninth`), and the skeleton the game animates. Meshy gives one mesh, so those parts are described in the prompts with their own colour or glow, which makes them easy to cut out.

**Rigs.** Humanoid guardians (Tamrit, Bazûr, the automaton, Anzur): Meshy's humanoid auto-rig, A-pose. The bird and the scorpion: no rig, Claude rigs them. Statues and props: no rig.

**Guardians: from a concept image.** Meshy's Text to 3D turns any humanoid into a person in clay- or bronze-coloured clothes. What works is two steps: Text to Image first (A-pose, front view, plain grey background; a few candidates for the owner to pick from), then Image to 3D from the chosen image with the texture on, and the humanoid auto-rig on the result. Tamrit was made this way. Claude then runs `pnpm models:fit <rigged.glb> <name>` (drops Meshy's sample animations, resizes the textures, compresses the geometry) and `pnpm textures:ktx2 --only models <name>`. The game drives Meshy's own 24-bone rig (`Hips`, `Spine02`, `Head`, `LeftArm` and so on), so the bone names in models-brief.md do not apply to Meshy models.

**Writing.** Meshy cannot write text: the carved signs come out as invented marks, which is what the game wants. Elena's initials on the ninth pedestal are added by Claude in the texture.

### Chamber IV · The Clay Archive

**Tamrit, the clay guardian** · `tamrit.glb` · 12k · A-pose, humanoid auto-rig · **in the game since 0.9.16** (made from a concept image, see above)

```text
Tall ancient guardian figure made of wet, cracked ochre and burnt-red clay, about 2.4 m tall, slender scribe-like body with long arms, a reed stylus in the right hand, a smooth featureless face with two thin eye slits, deep drying cracks, flakes and drips of clay, a fist-sized glowing amber core visible through a crack in the chest, A-pose with arms slightly away from the body, realistic PBR, game-ready.
```

**Glyph lock** · `glyph_lock.glb` · 2k

```text
Ancient stone glyph lock: a waist-high carved stone plinth 0.8 m wide holding a stone drum 0.6 m across with six flat faces around it, each face carved with one deep, clear abstract glyph, ochre clay dust in the carvings, worn edges, realistic PBR, game prop.
```

**Dart niche** · `dart_niche.glb` · 800 · wall prop

```text
Small square niche cut into a sandstone wall, 0.6 m wide, 0.6 m tall and 0.3 m deep, one small dark round hole at its back where darts shoot out, cracked clay plaster around the rim, dust, flat back for mounting on a wall, realistic PBR, game prop.
```

**Dart** · `dart.glb` · 200

```text
Single ancient dart, 25 cm long, thin sharpened bone shaft with a small bronze tip and frayed fibre fletching at the back, perfectly straight, realistic PBR, small game prop.
```

**Archive shelf** · `shelf.glb` · 2.5k · pushed like a block: it must fill a 2 m cube

```text
Archive shelf carved from a single block of rock, exactly a 2 m cube, three deep horizontal shelves crammed with clay tablets stacked flat and on edge, ochre dust, chipped edges, solid back and sides, realistic PBR, game prop.
```

**Clay tablet** · `tablet.glb` · 150 · drawn thousands of times: keep it very simple

```text
Single small rectangular clay tablet, 18 cm by 12 cm and 3 cm thick, slightly pillowed sides, rows of tiny impressed wedge marks, baked ochre clay with a darker burnt edge, very simple shape, realistic PBR, low-poly game prop.
```

**Kiln** · `kiln.glb` · 3k · the embers glow

```text
Ancient domed clay kiln for baking tablets, 2 m wide and 2.2 m tall, beehive shape of mud bricks plastered with cracked burnt-red clay, a low square stoking mouth with a stone lintel at the front, glowing orange embers inside, soot above the mouth, realistic PBR, game prop.
```

**The Tablet of the Name (relic)** · `name_tablet.glb` · 2k · the ninth sign glows

```text
Hero relic: a small upright clay tablet 28 cm tall and 20 cm wide, finely baked dark ochre clay, polished, carved with nine vertical columns of signs, the first eight columns full of small engraved signs, the ninth column holding a single larger sign that glows warm amber from within, worn edges, realistic PBR, high detail.
```

### Chamber V · The Root Halls

**Root panels** · `root_kit.glb` · 3k each · three pieces, one prompt each; send them as `root_panel.glb`, `root_top.glb` and `root_bottom.glb` and Claude joins them

```text
Flat square panel of living tree roots grown over a stone wall, 2 m by 2 m and 0.3 m deep, thick pale grey-beige roots woven into a climbable net with knots and hand-holds, a few hair roots and patches of moss, flat back, edges that tile on all four sides, realistic PBR, game-ready.
```

```text
Top piece of a wall of living tree roots, 2 m wide and 2 m tall, thick pale grey-beige roots climbing the wall and curling over its top edge onto a stone ledge, knots and hand-holds, moss, flat back, sides that tile with a plain root panel, realistic PBR, game-ready.
```

```text
Bottom piece of a wall of living tree roots, 2 m wide and 2 m tall, thick pale grey-beige roots coming down the wall and spreading out into the earth floor at its foot, knots and hand-holds, moss, flat back, sides that tile with a plain root panel, realistic PBR, game-ready.
```

**Scorpion** · `scorpion.glb` · 6k · no rig

```text
Large desert scorpion about 50 cm long, glossy dark amber-brown armoured shell with lighter joints, two heavy pincers held forward, eight legs, segmented tail arched high over its back ending in a black sting, dusty, neutral standing pose facing forward, realistic PBR, game-ready.
```

**The Stone Seed (relic)** · `stone_seed.glb` · 2k · glows green

```text
Hero relic: a fist-sized seed 9 cm long carved from polished deep green stone, almond shaped with fine vein-like grooves and a short stone stem, a faint warm green glow inside the grooves, realistic PBR, high detail.
```

### Chamber VI · The Bronze Forge

**Bazûr, the bronze founder** · `bazur.glb` · 16k · A-pose, humanoid auto-rig

```text
Massive ancient bronze automaton about 3 m tall, heavy cast bronze plates with rivets and hinges, broad shoulders, thick arms ending in huge blunt hands, blackened with soot and oil, bright worn bronze on the edges, a furnace core glowing orange behind a grille in the chest, two narrow glowing eye slits in a helmet-like head, A-pose with arms away from the body, realistic PBR, game-ready.
```

**Workshop automaton** · `automaton.glb` · 8k · A-pose, humanoid auto-rig

```text
Ancient workshop automaton of cast bronze about 2.2 m tall, lean body of overlapping plates, a heavy forging mallet in its right hand, soot-darkened, an orange furnace glow behind narrow slits in its face and chest, A-pose with arms away from the body, realistic PBR, game-ready.
```

**Crucible** · `crucible.glb` · 2.5k · its pouring lip faces forward

```text
Large ancient bronze crucible tipped forward on a stone bracket, 1.3 m wide and 1.2 m tall, thick-walled bowl with a pouring lip at the front, crusted with dark slag and thin glowing cracks of cooling bronze near the lip, soot, bracket of rough stacked stone, realistic PBR, game prop.
```

**Bellows** · `bellows.glb` · 3k · pushed like a block: it must fill a 2 m cube

```text
Huge ancient forge bellows filling a 2 m cube, two heavy wooden boards bound with bronze bands, pleated dark leather between them, a long bronze nozzle sticking out of one side, worn handles, soot, realistic PBR, game prop.
```

**Forge hearth** · `forge.glb` · 3k · the coals glow

```text
Small ancient forge hearth 1.4 m wide and 1.6 m tall, square hearth of stone and clay with a raised fire bowl full of glowing orange coals, a short chimney hood of corbelled stones, heavy soot, scattered slag, realistic PBR, game prop.
```

**The mould of the seal** · `mould.glb` · 2k

```text
Ancient casting mould, a flat stone block 2 m by 2 m and 0.6 m tall, its top face cut with a deep curved channel shaped like one arc segment of a large nine-part circular seal, a pouring channel leading into it, burnt black edges and drips of bronze, realistic PBR, game prop.
```

**The Ninth Segment (relic)** · `segment.glb` · 2k · the empty ninth place glows

```text
Hero relic: a curved arc of cast bronze 50 cm long, 22 cm wide and 12 cm thick, one ninth of a circular seal, freshly cast bright bronze with a few dark casting marks, eight small engraved signs along it and a smooth empty place for a ninth that glows warm amber, realistic PBR, high detail.
```

### Chamber VII · The Wind Stair

**Rock bird** · `bird.glb` · 4k · no rig

```text
Large rock bird with a 1.4 m wingspan, grey-brown feathers the colour of weathered stone with paler speckles, long narrow wings spread wide in a gliding pose, short fan tail, strong hooked beak, sharp dark eyes, body facing forward, realistic PBR, game-ready.
```

**Wind flute** · `flute.glb` · 2.5k · wall prop

```text
Stone wind flute carved into a cliff: a tall narrow vertical slot 3 m high in a flat stone face 2 m wide, deep parallel grooves running along both sides of the slot, wind-polished edges, a little sand in the grooves, flat back for mounting on a wall, realistic PBR, game prop.
```

**Rope** · `rope.glb` · 400

```text
Short braided rope hanging straight down, 1 m long and 4 cm thick, three-strand natural fibre, worn and dusty, a fat knot at its lower end and a small bronze ring at its top, realistic PBR, small game prop.
```

**Counterweight platform** · `counterweight.glb` · 2k

```text
Square stone counterweight platform 2 m by 2 m and 0.5 m thick, rough-cut grey-brown stone slab bound with bronze straps, a bronze ring at each corner with a short stub of chain rising from it, worn top surface, realistic PBR, game prop.
```

**The Wind Shell (relic)** · `shell.glb` · 3k · the ninth notch glows

```text
Hero relic: a bronze conch shell 30 cm long with a spiral body, eight small notches cut around its lip and the place of a ninth notch that glows pale silver-white, verdigris in the grooves, polished bright bronze where hands touch, realistic PBR, high detail.
```

### Chamber VIII · The Observatory

**Anzur, the one who watches** · `anzur.glb` · 20k · A-pose, humanoid auto-rig (the game seats it and makes it rise)

```text
Giant ancient guardian of night-grey granite, about 5 m tall, massive figure with broad shoulders made to hold up a dome, long arms and heavy hands, smooth stern face, a pale glowing core in its chest and two pale glowing eyes, faint star-like flecks in the stone, cracks with dust, A-pose with arms away from the body, realistic PBR, game-ready.
```

**Dome ring** · `dome_ring.glb` · 4k

```text
Large flat bronze ring 15 m across and 0.4 m tall, a thin band like an armillary ring, nine square sockets spaced around it holding small engraved discs of stars, moon phases and a sun, one bright mark at the front, verdigris with worn gold edges, realistic PBR, game prop.
```

**Oculus** · `oculus.glb` · 2k

```text
Round stone rim of the opening at the top of a dome, 6 m across and 1 m thick, its inner face and top carved with a band of constellations as small drilled stars joined by thin lines, night-grey stone, weathered, realistic PBR, game prop.
```

**The Astrolabe of the Nine (relic)** · `astrolabe.glb` · 4k · the ninth mark glows

```text
Hero relic: a hand-held bronze astrolabe 40 cm tall, three interlocking rings around a clear crystal centre, three small settings holding an amber gem, a pale glass bead and a gold disc, fine engraved scales, a ninth mark glowing pale moonlight white, realistic PBR, high detail.
```

### Chamber IX · The Ninth Chamber

**The eight keepers** · `keeper_1.glb` to `keeper_8.glb` · 8k each · statues, no rig

One prompt for all eight: put each keeper's line from the table in place of `[KEEPER]` and `[RELIC]`. Using the same prompt keeps the eight statues alike in stone, size and pose.

```text
Carved stone statue of [KEEPER], standing on a square stone pedestal 0.6 m high, 3.2 m tall in total, holding [RELIC] against its chest with both hands, the relic glowing softly, pale weathered limestone, sand in the cracks, calm face, facing forward, realistic PBR, game-ready.
```

| File       | [KEEPER]                                                                                                      | [RELIC]                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `keeper_1` | Qarrum, the first keeper, a tall robed figure with a star carved on the brow                                  | the Amber Heart, an amber gem in a thin gold cage                 |
| `keeper_2` | Nahrem, the second keeper, a robed figure with flowing water carved over the shoulders                        | the Tide Glass, a round glass disc carved with phases of the moon |
| `keeper_3` | Ubara, the third keeper, a broad figure of stacked, corbelled stone with a nine-part seal on the chest        | the Sun Disc, a bronze disc with eight cut rays                   |
| `keeper_4` | Tamrit, the fourth keeper, a slender scribe with a reed stylus behind one ear                                 | the Tablet of the Name, a small clay tablet with columns of signs |
| `keeper_5` | Erreth, the fifth keeper, a woman shaped like a tree turned to stone, roots for feet and branches in her hair | the Stone Seed, a fist-sized green stone seed                     |
| `keeper_6` | Bazûr, the sixth keeper, a heavy smith with a leather apron and a hammer at the belt                          | the Ninth Segment, a curved arc of bronze                         |
| `keeper_7` | Suhal, the seventh keeper, a singer with an open mouth and wind-swept robes                                   | the Wind Shell, a bronze conch                                    |
| `keeper_8` | Anzur, the eighth keeper, a watcher with large eyes raised to the sky and stars on the shoulders              | the Astrolabe, a small bronze astrolabe with three rings          |

**The ninth pedestal** · `pedestal_9.glb` · 1.5k

```text
Empty square stone pedestal 1.3 m wide and 0.6 m tall, pale weathered limestone, a short line of carved signs across its front face and a small rough scratched mark below them, worn edges, realistic PBR, game prop.
```

**The great seal** · `great_seal.glb` · 6k · wall prop; the bare ninth segment is lit by the game

```text
Great circular stone seal relief for a wall, 5 m across and 20 cm thick, nine wedge-shaped segments around a raised central boss, eight segments carved with different signs, the ninth segment smooth and bare, pale limestone with fine chisel marks, flat back, facing forward, realistic PBR, game prop.
```

## Modular kit (only if the procedural kit is not enough)

Meshy is weaker at tiling architecture than at props; scanned CC0 textures (Poly Haven, ambientCG) on the procedural kit are the preferred route. If needed:

```text
Modular ancient sandstone wall segment, 2 m wide by 2 m tall by 0.5 m deep, ashlar masonry in four courses with recessed eroded joints, worn bevelled top edge with a pale hand-polished lip, sand drifts at the base, realistic PBR, tileable edges, game-ready.
```
