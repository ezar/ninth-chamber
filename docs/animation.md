# Nora's animation

Nora (the scanned model in `public/models/nora.glb`) has two animation sources:

- **Motion clips** (`src/render/anim/`, Mixamo animations made on Nora's own mesh) for every mode they fit: ground (idle, walk, run, walking backwards, with foot IK and planting, and a landing clip), air (standing and running jump take-offs, falling), hang (idle and shimmy left/right), climb, block, push and pull, pickup, death, and a hit reaction over the upper body.
- **The procedural rig** (`src/render/nora.ts`) for the lever (no clip fits), the aiming layer while the pistols are drawn, and as the fallback for any clip that fails to load.

`src/render/nora-scan.ts` picks between them every frame and cross-fades in 0.2 s when the mode changes.

## Canonical space

Everything meets in one space (`src/render/anim/skeleton.ts`): for each of the 19 joints, a model-space rotation relative to a rest pose that stands upright facing -Z (anatomical left at -X) with arms, hands and legs straight down, palms facing the thighs. The procedural rig's bind pose is that rest pose; the scan (A-pose bind) reaches it through a fixed per-limb correction, so a scan bone's rotation is `canonical × correction × bind`. Clips store canonical rotations, which makes them independent of the scan's bind and lets them blend with the procedural rig joint by joint.

## Source clips

The clips are the owner's **Mixamo** set (Adobe; free to use in games), made on Nora's own mesh (the Meshy scan, auto-rigged in Mixamo): FBX, 30 fps, 41 `mixamorig` bones. The FBX files stay outside the repo; `scripts/anim/sources/mixamo.json` lists them.

| Clip                                  | Mixamo animation                           | Used for                     | Notes                                                  |
| ------------------------------------- | ------------------------------------------ | ---------------------------- | ------------------------------------------------------ |
| `idle`                                | Breathing Idle                             | standing                     | 9.9 s loop                                             |
| `walk`                                | Walking                                    | walking (2.2 m/s)            | in place; 1.67 m/s measured from the planted feet      |
| `run`                                 | Running                                    | running (5.4 m/s)            | in place; 4.08 m/s measured                            |
| `walk_back`                           | Walking Backwards                          | backing up (walk + action)   | travel removed, -1.08 m/s                              |
| `jump`                                | Jump                                       | standing jump take-off       | take-off 0.83 s, touch-down 1.4 s                      |
| `jump_run`                            | Running Jump                               | running jump take-off        | travel removed; played at 0.75×                        |
| `fall`                                | Falling Idle                               | airborne loop, falls         |                                                        |
| `land`                                | Falling To Landing                         | landing, from its touch-down | weight 30–75 % with the fall speed                     |
| `hang`                                | Hanging Idle                               | hanging                      | hands anchored on the grip                             |
| `shimmy_left`, `shimmy_right`         | Braced Hang Shimmy (and mirror)            | shimmying                    | 0.48 m/s, played up to 2.2×                            |
| `climb`                               | Braced Hang To Crouch                      | climbing up                  | keeps its travel (ends 2.04 m up, like the game's 2 m) |
| `push`                                | Pushing                                    | block, push                  | one cycle per push                                     |
| `pull`                                | Pull Heavy Object                          | pull                         | one cycle per pull                                     |
| `pickup`                              | Picking Up                                 | pickup                       | cropped 0.7–4.6 s, fitted to the 0.8 s pickup          |
| `hit`                                 | Hit Reaction                               | hurt, upper body             | cropped 0.3–2.0 s                                      |
| `die`                                 | Dying                                      | dead                         | cropped 1.8–4.6 s                                      |
| `run_stop`, `turn_left`, `turn_right` | Run To Stop, Left/Right Turn 90            | baked, not used yet          | see below                                              |
| `pistol_idle`, `pistol_run`, `shoot`  | Pistol Idle, Pistol Run, Shooting          | baked, not used yet          | see below                                              |
| `tread`, `swim`, `swim_to_edge`       | Treading Water, Swimming, Swimming To Edge | registered for level 2       | `WATER_CLIPS` in `animator.ts`                         |

Not used yet, and why:

- **Turns in place:** the simulation turns at 12 rad/s (90° in 0.13 s), much faster than the 1 s clips; standing feet re-plant with a small step instead.
- **Run To Stop:** the simulation stops in about 0.3 s; the clip slides 0.8 m to a halt. Stops blend into idle over the last step.
- **Pistol clips:** the pistols are placed in the procedural hand (`NoraRig.handFrame`), so the procedural aiming layer keeps driving the arms while the pistols are drawn; the clips are ready for when the pistols follow the scan's hands.

The earlier clips from the Quaternius Universal Animation Library (CC0) can still be rebuilt with `scripts/anim/sources/ual.json`.

### Character: the retargeted scan, not the Mixamo mesh

`Breathing Idle.fbx` also holds Nora's mesh skinned by Mixamo's auto-rigger. The game keeps `public/models/nora.glb` (the same scan, rigged by `scripts/character/rig_nora.py`) and retargets the clips onto it:

- Mixamo's rig was fitted to the same mesh, so the proportions match and the retarget (by direction, per limb) loses nothing visible.
- `nora.glb` is already optimised (1.2 MB, meshopt and WebP); the Mixamo file is a 36 MB set with FBX-embedded textures, and there is no Blender or glTF-Transform in the build environment to re-optimise it.
- Foot IK, the aiming layer, the pistols' hand frames and the procedural fallback all work in the canonical space of `nora.glb`.

Switching later only needs the Mixamo mesh exported as a GLB with the 19 joint names (or a joint map in `nora-scan.ts`); the clips would not change.

## Offline pipeline (`scripts/anim/`)

```sh
pnpm anim:build <manifest.json> <source folder> [outDir]
pnpm anim:build scripts/anim/sources/ual.json "<Universal Animation Library[Standard]/Unreal-Godot>"
```

`build-clips.ts` is source-agnostic. A **manifest** (`scripts/anim/sources/*.json`) names the source skeleton, the reference T-pose and the clips to bake; file names are relative to the source folder, which stays outside the repo. A **rig profile** (`scripts/anim/rigs.ts`: `ual` and `mixamo` so far) maps the source's bone names to Nora's 19 joints. Sources are read as glTF binaries with a small GLB reader (`gltf.ts`). Steps:

1. **Joint map** (from the rig profile). UAL: pelvis → hips, spine_01/02 (averaged) → spine, spine_03 → chest, neck_01, Head, clavicle → shoulder, upperarm, lowerarm, hand, thigh, calf → shin, foot. Mixamo: Hips, Spine/Spine1 → spine, Spine2 → chest, Neck, Head, Shoulder, Arm, ForeArm, Hand, UpLeg → thigh, Leg → shin, Foot.
2. **Facing** is found from the reference pose (the left hip goes to -X, forward to -Z).
3. **Retarget by direction.** Every source joint's model-space rotation is taken relative to the reference T-pose and re-applied on top of the canonical rotation that points Nora's limb along the T-pose limb. Each limb therefore points exactly where the source limb points (the hand along the hand-to-middle-finger line), and hips, spine, chest, head and feet carry the source's orientation and twist.
4. **Hips.** The hip-joint centre keeps its vertical bob and its sway, scaled by the leg-length ratio (0.977 for UAL); forward travel is dropped (clips play in place).
5. **Loops.** The mismatch between the last and first frame is spread over the clip, and the last frame is dropped.
6. **Foot contacts** are found kinematically on Nora's proportions: a foot is planted while its heel or ball is on the floor and moving backwards with the ground at the clip's speed. Gait clips (`"gait": true`) are rotated so phase 0 is the left heel strike, which keeps walk and run in step when they blend.
7. **Speed** is the clip's ground speed as recorded, scaled to Nora: given in the manifest (`"speed"`, for in-place clips) or measured from a root-motion copy (`"speedFrom"`, e.g. UAL's `_RM` file).
8. **Encoding.** Rotations as int16 quaternions (×32767), hips positions as int16 millimetres, both base64 in JSON (`src/render/anim/clip.ts`, format `nora-clip@1`), 6–16 kB per clip.

### Dropping in new clips (e.g. Mixamo)

1. Download each animation from Mixamo as **FBX, 30 fps**; "In Place" or not, either works (travel is taken out and measured). Only the skeleton is used.
2. Add a line to `scripts/anim/sources/mixamo.json`: output `name`, `file` (the download's name), `"loop"`, `"gait": true` for walk/run-like cycles, and optionally `"from"`/`"to"` (crop, s), `"rootMotion": "keep"` (moves the runtime lines up with the simulation, like the climb) or `"anchor": "hands"` (hanging clips). Speeds come from the baked travel or, for in-place gaits, from the planted feet; `"speed"` overrides.
3. `pnpm anim:build scripts/anim/sources/mixamo.json <folder with the FBX files>` rewrites `public/anim/*.json`. FBX is read directly (three's FBXLoader in Node); `scripts/anim/fbx_to_glb.py` is only needed for other formats.
4. A new clip name goes into `CLIP_NAMES` and the mode mapping in `src/render/anim/animator.ts`; replacing an existing clip needs no code change.
5. Check with `pnpm test` (clip integrity, foot sliding, metadata) and a look in the game; tune `locomotion.ts` (speed bands, stride share) if the new clips differ in pace.

A new skeleton only needs a profile in `rigs.ts`.

## Runtime (`src/render/anim/`)

- `clip.ts`: decoding and sampling (nlerp between frames).
- `locomotion.ts`: the speed blend. Idle turns into gait between 0.05 and 0.7 m/s; walk turns into run between 2.5 and 4.6 m/s (the run builds up over the first strides). Walk and run share one gait phase. Speed is matched by playing faster and by lengthening the stride: `stride = ratio^0.3`, `rate = ratio / stride` with `ratio = speed / clip speed`. With the Mixamo clips (walk 1.67 m/s, run 4.08 m/s) the game's 2.2 and 5.4 m/s are both a 1.32× speed-up: 1.09× longer strides and 1.21× faster steps.
- `leg-ik.ts`: the leg pass.
  - Stretches the foot path around the hips by the stride scale.
  - Keeps heel and ball above the floor (the floor is at the character root's height).
  - Pins planted feet in world space, pivoting on the heel or the ball (whichever is lower), so they neither slide nor spin; a foot also pins as soon as its sole touches down. Planted feet stay on their own floor when the root snaps up or down a step.
  - If a leg can't reach, it rolls the foot first (a trailing foot rises onto the ball, a leading one lifts its toes), then lowers the hips (at most 10 cm).
  - Two-bone IK for thigh and shin that keeps the knee in its plane; the feet keep their animated orientation (heel strike, roll, toe-off).
  - Standing feet that get twisted or stretched by a turn take a small step back under the body.
- `arms.ts`: relaxes the library's slightly stylised arms: elbows straightened to 45 % of the clip's bend when walking (90 % when running), wrists nearly straight, arms brought towards the sides. The scan's hands follow the forearm rigidly in their bind relation (no cupped hands).
- `animator.ts`: the mode → clip mapping (see above; `CLIP_NAMES`, `WATER_CLIPS`), then mode selection and cross-fades (0.2 s, from a snapshot of the shown pose), smoothing of step snaps, and the jump: a jump plays `jump_start` from after its crouch (the game takes off at once) at 1.8× into `jump_loop`; a fall goes straight to the loop; landing blends `jump_land` over the ground pose, 25–60 % deep with the fall speed and lighter when landing on the run. The gait keeps running through a jump so a running landing carries on in step. Stopping settles over the last step (0.16 s instead of 0.09 s).

### Upper-body hook

For an aiming layer (the spec's additive `aim_arms`) in clip-driven modes:

- `NoraRig.setProceduralOverride(w, joints?)` shows the procedural rig's pose for `joints` (default: spine, chest, neck, head, shoulders and arms) over the clips with weight `w`, in model space, so an aiming pose built in `nora.ts` keeps its aim direction while the legs run from clips.
- `NoraRig.addLayer({ apply(pose, dt) })` edits the canonical pose after locomotion and before the leg pass.

## Checking it

- `pnpm test` runs `tests/anim.test.ts`: clip decoding, seamless loops, phase alignment, no sliding of planted feet at walk and run speed, soles above the floor, a clean stop, hips and knee limits.
- `tsx scripts/anim/simulate.ts [speed] [seconds] [turnRate]` drives the animator headlessly and prints feet, knees and hips over time.
