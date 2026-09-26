# Prop models

Game-ready props for The Ninth Chamber, served from `public/` so the game loads them as `models/<name>.glb`.

Every file here is **generated** by [`scripts/blender/build_props.py`](../../scripts/blender/build_props.py). Do not edit the GLBs by hand: change the script and rebuild.

## How they are made

- Modelled and textured entirely procedurally in Blender 4.5 (run as the `bpy` Python module). No scans, photos, downloaded textures or third-party meshes are used, so the files are original work and can be treated as CC0 (public domain dedication, see the `asset.copyright` field in each GLB).
- Each prop has a detailed bake source (bevels, voxel remesh, geometry-node displacement for erosion, chips and lumps) and a low-poly game mesh. The low-poly mesh is UV-unwrapped and Cycles bakes the textures from the source onto it:
  - **base color**: sRGB JPEG (4:4:4).
  - **normal**: tangent space, OpenGL convention (+Y), baked from the high-detail source. JPEG on large rough stone props (to stay under the size budget), PNG elsewhere.
  - **ORM**: occlusion (R), roughness (G), metalness (B) in one PNG, referenced by both `occlusionTexture` and `metallicRoughnessTexture`.
  - **emissive**: JPEG, only on `coals` and `gem`.
- Materials follow the palette and material library in [`docs/art/README.md`](../../docs/art/README.md): sandstone `#b8895a` (rough 0.88), oxidized bronze with verdigris `#5e7b68` worn back to `#a8773c` metal where hands go, gold `#e8b75a`, sand `#c8a77c`. Nothing teal or turquoise.
- The build is deterministic: every noise is a pure function of position and every random choice uses a seeded `random.Random`.

## Conventions

- glTF +Y up, metres, origin at the bottom centre of the prop.
- Free-standing props face **-Z** (the game's yaw 0). Wall props (`lever`, `sand_drift`) have their back on the wall plane at z = 0 and extend towards **+Z**.
- Materials are single-sided (`doubleSided: false`); hidden faces (bottoms that sit on the floor, backs against walls, the inside of the column dressings) are left out.
- Vertex tangents are exported (MikkTSpace, matching the bake).

## Models

MODEL_TABLE

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
```

The contact sheet (all props re-imported from the GLBs and rendered with a warm key and a cool fill) is written to `$TMPDIR/ninth-chamber-props/contact.png` unless `--contact` says otherwise.
