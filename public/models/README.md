# Prop models

Game-ready props for The Ninth Chamber, served from `public/` so the game loads them as `models/<name>.glb`.

The prop GLBs listed below are **generated** by [`scripts/blender/build_props.py`](../../scripts/blender/build_props.py). Do not edit them by hand: change the script and rebuild. (Other models in this folder, such as the character, come from their own pipelines.)

## How they are made

- Modelled and textured entirely procedurally in Blender 4.5 (run as the `bpy` Python module). No scans, photos, downloaded textures or third-party meshes are used, so the files are original work and can be treated as CC0 (public domain dedication, see the `asset.copyright` field in each GLB).
- Each prop has a detailed bake source (bevels, voxel remesh, geometry-node displacement for erosion, chips and lumps) and a low-poly game mesh. The low-poly mesh is UV-unwrapped and Cycles bakes the textures from the source onto it:
  - **base color**: sRGB JPEG (4:4:4 chroma).
  - **normal**: tangent space, OpenGL convention (+Y), baked from the high-detail source.
  - **ORM**: occlusion (R), roughness (G), metalness (B) in one image, referenced by both `occlusionTexture` and `metallicRoughnessTexture`.
  - **emissive**: JPEG, only on `coals` and `gem`.
  - Data maps are stored as PNG when that stays small, otherwise as high-quality 4:4:4 JPEG. If a GLB still exceeds 1.45 MB the build steps the quality down (and halves the ORM) until it fits.
  - Texture sizes: 1024 for the large props, 512 for the small ones (idols, relic, medkit, coals, gem).
  - **Shipped as KTX2.** The Blender build writes the maps above; `pnpm textures:ktx2` (`scripts/textures/ktx2.ts`) then rewrites every model in place with `KHR_texture_basisu`: base colour and emissive as sRGB ETC1S, normal maps as ETC1S in normal-map mode, ORM as linear ETC1S, each with full mips. GPUs keep them compressed (ASTC, BC or ETC2), about a quarter of the memory of plain RGBA. Nora (`nora.glb`, from her own pipeline) gets the same treatment, with a UASTC normal map.
- Materials follow the palette and material library in [`docs/art/README.md`](../../docs/art/README.md): sandstone `#b8895a` (rough 0.88), oxidized bronze with verdigris `#5e7b68` worn back to `#a8773c` metal where hands go, gold `#e8b75a`, sand `#c8a77c`. Nothing teal or turquoise. After baking, the stone and sand base colours are calibrated so their mean matches the palette (`#b8895a` for sandstone, a paler `#c2a481` for the pushable block, `#c8a77c` for sand) while keeping all the procedural variation, and non-metal albedo stays inside sRGB 40 to 235.
- The build is deterministic: every noise is a pure function of position and every random choice uses a seeded `random.Random`.

## Conventions

- glTF +Y up, metres, origin at the bottom centre of the prop.
- Free-standing props face **-Z** (the game's yaw 0). Wall props (`lever`, `sand_drift`) have their back on the wall plane at z = 0 and extend towards **+Z**.
- Materials are single-sided (`doubleSided: false`); hidden faces (bottoms that sit on the floor, backs against walls, the inside of the column dressings) are left out.
- Vertex tangents are exported (MikkTSpace, matching the bake).

## Models

| Model                | Size x × y × z (m) | Triangles | File    | Meshes                           | Notes                                                                                                                  |
| -------------------- | ------------------ | --------- | ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `brazier.glb`        | 0.92 × 1.15 × 0.95 | 2888      | 1.09 MB | `brazier` (2748), `coals` (140)  | Oxidized bronze tripod brazier, rim at 1.15 m, bowl 0.92 m across; sooted bowl, bright wear on rim, collars and feet.  |
| `column_base.glb`    | 2.30 × 0.50 × 2.30 | 224       | 0.67 MB | `column_base` (224)              | Stacked sandstone plinth wrapping a 2 x 2 m pillar (open inside and underneath), sand in the joints.                   |
| `column_capital.glb` | 2.30 × 0.60 × 2.30 | 328       | 0.65 MB | `column_capital` (328)           | Corbelled capital in three stepped courses, soot towards the ceiling.                                                  |
| `door.glb`           | 2.00 × 5.00 × 0.46 | 874       | 1.14 MB | `door` (106), `seal_amber` (768) | Trapezoid sandstone slab (2.0 m at the base, 1.84 m at the top), nine-segment seal at 2.6 m on both faces.             |
| `lever.glb`          | 0.40 × 0.50 × 0.61 | 1436      | 0.91 MB | `lever` (504), `handle` (932)    | Bronze wall plate with slotted housing and rivets, plus the pivoting handle with a worn knob.                          |
| `block.glb`          | 2.00 × 2.00 × 2.00 | 596       | 0.82 MB | `block` (596)                    | Pushable dressed monolith, paler stone, 6 cm bevels, grip notches at 1.2 m, glyph band, drag grooves.                  |
| `idol_jade.glb`      | 0.16 × 0.30 × 0.16 | 2600      | 0.50 MB | `idol_jade` (2600)               | Seated votive figure on a round plinth, polished jade.                                                                 |
| `idol_gold.glb`      | 0.16 × 0.30 × 0.16 | 2600      | 0.52 MB | `idol_gold` (2600)               | Same figure in worn gold (metalness 1, matte recesses).                                                                |
| `idol_stone.glb`     | 0.16 × 0.30 × 0.16 | 2600      | 0.58 MB | `idol_stone` (2600)              | Same figure in weathered grey stone.                                                                                   |
| `relic.glb`          | 0.13 × 0.22 × 0.13 | 2182      | 0.71 MB | `relic` (2092), `gem` (90)       | The Amber Heart: nine-facet amber gem in a thin worn gold cage with foot and top loop.                                 |
| `altar.glb`          | 2.00 × 1.00 × 2.00 | 1222      | 0.92 MB | `altar` (1222)                   | Stepped altar dressing for a 1 m grid step, top exactly at 1.0 m, recessed glyph frieze, seal carved on top.           |
| `medkit.glb`         | 0.31 × 0.13 × 0.21 | 640       | 0.32 MB | `medkit` (640)                   | Leather field pouch, buckled flap, canvas gussets, stitched green leaf (no red cross).                                 |
| `rubble_a.glb`       | 1.26 × 0.49 × 0.90 | 898       | 1.12 MB | `rubble_a` (898)                 | One large broken block (0.8 m) and two small chunks.                                                                   |
| `rubble_b.glb`       | 1.12 × 0.32 × 0.81 | 830       | 1.09 MB | `rubble_b` (830)                 | Three medium chunks (0.3 to 0.5 m).                                                                                    |
| `rubble_c.glb`       | 0.88 × 0.20 × 0.73 | 950       | 1.28 MB | `rubble_c` (950)                 | Five small chunks (0.2 to 0.3 m).                                                                                      |
| `pot_broken.glb`     | 0.79 × 0.32 × 0.75 | 1772      | 1.07 MB | `pot_broken` (1772)              | Broken amphora: body lying on its side, neck with handles, three shards.                                               |
| `sand_drift.glb`     | 2.00 × 0.35 × 0.60 | 538       | 0.55 MB | `sand_drift` (538)               | Sand drift wedge against a wall: 2 m along X, 0.6 m out along +Z, 0.35 m high at the wall; ends match so drifts chain. |

## Hooks for the game

- **`brazier.glb`**: `brazier` (bowl, tripod and ring brace) and `coals`, a separate mesh with its own material (`coals`) whose `emissiveTexture` holds the glowing cracks at `emissiveFactor` 1. Scale `material.emissiveIntensity` to animate the glow. The coal bed sits at about y = 1.13 m, just under the rim (y = 1.15 m): put the flames and the fire light there.
- **`door.glb`**: `door` and `seal_amber`, the raised amber inlay that outlines the ninth (top) segment of the seal on both faces. `seal_amber` has its own untextured material (base and emissive `#f2a93b`, emissive at half strength), so it can glow or pulse without touching the stone.
- **`lever.glb`**: `lever` (the wall plate) and `handle`. The `handle` node's origin is the pivot at the plate centre, (0, 0.25, 0.055). The handle points straight out along +Z (0.55 m to the tip of the knob). Rotate `handle.rotation.x` to throw it: positive angles swing the knob down, negative up. The slot allows about ±60°.
- **`relic.glb`**: `relic` (the worn gold cage, foot and top loop) and `gem`, the nine-facet Amber Heart with its own material (`gem`: low roughness, `emissiveTexture` with a warm inner glow at `emissiveFactor` 1) so the game can make it glow and pulse.
- The idols, `block`, `column_base`, `column_capital`, `altar`, the rubble, `pot_broken` and `sand_drift` are single meshes named after the file.

## Rebuilding

```sh
pip install bpy==4.5.* pillow   # Python 3.11
python scripts/blender/build_props.py                   # every prop and a contact sheet
python scripts/blender/build_props.py --only door,lever # just some
python scripts/blender/build_props.py --quick           # half-size bakes for quick iteration
pnpm textures:ktx2 --only models door lever             # then compress the rebuilt models' textures
```

The contact sheet (all props re-imported from the GLBs and rendered with a warm key and a cool fill) is written to `$TMPDIR/ninth-chamber-props/contact.png` unless `--contact` says otherwise.
