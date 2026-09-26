# Nora's animation

Nora (the scanned model in `public/models/nora.glb`) has two animation sources:

- **Motion clips** on the ground (idle, walk and run, blended by speed with foot IK) and in the air (take-off, airborne loop, landing) (`src/render/anim/`).
- **The procedural rig** (`src/render/nora.ts`) for the game-specific modes: hang, climb, block, push, pull, lever, pickup and dead.

`src/render/nora-scan.ts` picks between them every frame and cross-fades in 0.2 s when the mode changes.

## Canonical space

Everything meets in one space (`src/render/anim/skeleton.ts`): for each of the 19 joints, a model-space rotation relative to a rest pose that stands upright facing -Z (anatomical left at -X) with arms, hands and legs straight down, palms facing the thighs. The procedural rig's bind pose is that rest pose; the scan (A-pose bind) reaches it through a fixed per-limb correction, so a scan bone's rotation is `canonical × correction × bind`. Clips store canonical rotations, which makes them independent of the scan's bind and lets them blend with the procedural rig joint by joint.

## Source clips

The clips come from the Quaternius **Universal Animation Library** (Standard), CC0 (see `CREDITS.md`). It is game-ready: the loops are clean, `A_TPose` gives a clean rest reference and the `_RM` variant has root motion for measuring speeds.

| Clip         | Source         | Frames (30 fps) | Cycle   | Recorded speed (scaled to Nora) | Contacts (phase)         |
| ------------ | -------------- | --------------- | ------- | ------------------------------- | ------------------------ |
| `idle`       | `Idle_Loop`    | 75              | 2.5 s   | 0                               | both feet always         |
| `walk`       | `Walk_Loop`    | 40              | 1.333 s | 0.95 m/s                        | L 0.00–0.60, R 0.50–0.07 |
| `run`        | `Jog_Fwd_Loop` | 28              | 0.933 s | 5.23 m/s                        | L 0.00–0.14, R 0.50–0.64 |
| `jump_start` | `Jump_Start`   | 41              | 1.367 s | 0                               | (one-shot)               |
| `jump_loop`  | `Jump_Loop`    | 75              | 2.5 s   | 0                               | (airborne)               |
| `jump_land`  | `Jump_Land`    | 39              | 1.3 s   | 0                               | (one-shot)               |

`Jog_Fwd_Loop` runs at 5.36 m/s in the library (5.23 m/s on Nora's shorter legs), almost exactly the game's 5.4 m/s run, so it is played nearly as recorded. `Sprint_Loop` (8.25 m/s) is too fast. The walk is a relaxed 0.98 m/s walk; the game walks at 2.2 m/s (see below).

The CMU Motion Capture Database was the planned fallback; no CMU data is used.

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

1. Download each animation from Mixamo as **FBX, 30 fps, "In Place"** for walk and run (with skin, on Nora's mesh or any Mixamo character: only the skeleton is used).
2. Convert them: `blender -b -P scripts/anim/fbx_to_glb.py -- idle.fbx walk.fbx run.fbx … <folder>`.
3. Edit `scripts/anim/sources/mixamo.json`: file names, `"loop"`, `"gait": true` for walk and run, and each gait clip's recorded ground speed in m/s (`"speed"`; Mixamo shows it only implicitly: stride length × cadence, or export a non-in-place copy and point `"speedFrom"` at it with `"node": "Hips"`). `"rest"` may point at any of the files: without `"anim"` it uses the file's bind pose (Mixamo's T-pose).
4. `pnpm anim:build scripts/anim/sources/mixamo.json <folder>` rewrites `public/anim/*.json`; the runtime needs no change as long as the clip names stay (`idle`, `walk`, `run`, `jump_start`, `jump_loop`, `jump_land`).
5. Check with `pnpm test` (clip integrity, foot sliding) and a look in the game; tune `src/render/anim/locomotion.ts` (speed bands, stride share) and `arms.ts` if the new clips differ in pace or arm style.

A new skeleton only needs a profile in `rigs.ts`.

## Runtime (`src/render/anim/`)

- `clip.ts`: decoding and sampling (nlerp between frames).
- `locomotion.ts`: the speed blend. Idle turns into gait between 0.05 and 0.7 m/s; walk turns into run between 2.5 and 4.6 m/s (the run builds up over the first strides). Walk and run share one gait phase. Speed is matched by playing faster and by lengthening the stride: `stride = ratio^0.3`, `rate = ratio / stride` with `ratio = speed / clip speed`. At 2.2 m/s the walk plays 1.8× faster with 1.29× longer strides (about 160 steps a minute, 0.8 m steps), which is what people do when they walk that fast. The walk's swinging foot is lifted half as high as in the clip.
- `leg-ik.ts`: the leg pass.
  - Stretches the foot path around the hips by the stride scale.
  - Keeps heel and ball above the floor (the floor is at the character root's height).
  - Pins planted feet in world space, pivoting on the heel or the ball (whichever is lower), so they neither slide nor spin; a foot also pins as soon as its sole touches down. Planted feet stay on their own floor when the root snaps up or down a step.
  - If a leg can't reach, it rolls the foot first (a trailing foot rises onto the ball, a leading one lifts its toes), then lowers the hips (at most 10 cm).
  - Two-bone IK for thigh and shin that keeps the knee in its plane; the feet keep their animated orientation (heel strike, roll, toe-off).
  - Standing feet that get twisted or stretched by a turn take a small step back under the body.
- `arms.ts`: relaxes the library's slightly stylised arms: elbows straightened to 45 % of the clip's bend when walking (90 % when running), wrists nearly straight, arms brought towards the sides. The scan's hands follow the forearm rigidly in their bind relation (no cupped hands).
- `animator.ts`: mode selection and cross-fades (0.2 s, from a snapshot of the shown pose), smoothing of step snaps, and the jump: a jump plays `jump_start` from after its crouch (the game takes off at once) at 1.8× into `jump_loop`; a fall goes straight to the loop; landing blends `jump_land` over the ground pose, 25–60 % deep with the fall speed and lighter when landing on the run. The gait keeps running through a jump so a running landing carries on in step. Stopping settles over the last step (0.16 s instead of 0.09 s).

### Upper-body hook

For an aiming layer (the spec's additive `aim_arms`) in clip-driven modes:

- `NoraRig.setProceduralOverride(w, joints?)` shows the procedural rig's pose for `joints` (default: spine, chest, neck, head, shoulders and arms) over the clips with weight `w`, in model space, so an aiming pose built in `nora.ts` keeps its aim direction while the legs run from clips.
- `NoraRig.addLayer({ apply(pose, dt) })` edits the canonical pose after locomotion and before the leg pass.

## Checking it

- `pnpm test` runs `tests/anim.test.ts`: clip decoding, seamless loops, phase alignment, no sliding of planted feet at walk and run speed, soles above the floor, a clean stop, hips and knee limits.
- `tsx scripts/anim/simulate.ts [speed] [seconds] [turnRate]` drives the animator headlessly and prints feet, knees and hips over time.
