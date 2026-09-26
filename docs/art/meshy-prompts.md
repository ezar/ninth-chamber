# Meshy prompts

Prompts for generating placeholder and candidate assets with [Meshy](https://www.meshy.ai). They follow the art direction in [README.md](README.md) (Claude Design canvas). Meshy works best with English prompts.

## General settings

- **Mode:** Text to 3D (or Image to 3D using a frame from the Claude Design canvas as reference, which usually gives a closer match).
- **Art style:** Realistic. **PBR maps:** on. **Symmetry:** auto (on for characters and props that are symmetric).
- **Topology:** quad for characters (better for rigging), triangle for static props.
- **Target polycount:** characters 30k, enemies 10k, props 2k–5k (see spec §11 "Assets").
- **Export:** GLB. Put files in `assets/models/<name>.glb` and textures stay embedded.
- **Characters:** generate in A-pose, then use Meshy's auto-rigging (humanoid) and export the rigged GLB. Animations come from the list in spec §11; Meshy's animation library can cover idle, walk and run as placeholders.
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

## Modular kit (only if the procedural kit is not enough)

Meshy is weaker at tiling architecture than at props; scanned CC0 textures (Poly Haven, ambientCG) on the procedural kit are the preferred route. If needed:

```text
Modular ancient sandstone wall segment, 2 m wide by 2 m tall by 0.5 m deep, ashlar masonry in four courses with recessed eroded joints, worn bevelled top edge with a pale hand-polished lip, sand drifts at the base, realistic PBR, tileable edges, game-ready.
```
