/**
 * Chooses what drives Nora's scanned skeleton each frame. Motion clips
 * (public/anim/*.json, Mixamo) drive every mode they fit:
 *
 * - ground: idle / walk / run / walking backwards blended by speed, with foot
 *   IK and planting, and a landing clip after a jump or a fall;
 * - air: standing or running jump take-off, falling loop;
 * - hang: hanging idle and shimmy left / right matched to the sideways speed;
 * - climb: braced hang to crouch, timed to the simulation's climb and its
 *   root motion;
 * - wall (a wall of roots): an idle on the face, blended into climbing up,
 *   down, left or right as she moves, the cadence matched to her speed;
 * - block and push: pushing, one cycle per push; pull: pulling a heavy object;
 * - pickup: picking up, fitted to the pickup time;
 * - dead: dying;
 * - swim and dive: treading water when still, swimming (cadence matched to
 *   her speed) when moving, the body pitched along the dive; surfacing and
 *   diving cross-fade more slowly than land moves;
 * - climbing out of the water: reaching for the edge (Swimming To Edge),
 *   then the climb, timed to the simulation's climb-out;
 * - hurt: a hit reaction over the upper body when health drops.
 *
 * The procedural rig (nora.ts) keeps the modes no clip fits (lever) and
 * any clip that failed to load, with short cross-fades between sources.
 *
 * Upper-body hook (aiming): `setProceduralOverride` blends the procedural
 * rig's pose (by default spine, head and arms) over the clips, and `layers`
 * may edit the pose after the clips and before the leg pass.
 */
import * as THREE from 'three/webgpu';
import { swimming, tuning } from '../../sim/player/tuning';
import type { NoraPose, RetargetJoint } from '../nora';
import { relaxArms, type ArmRelax } from './arms';
import type { Clip } from './clip';
import { LegIK, type LegInput } from './leg-ik';
import { Locomotion } from './locomotion';
import { AnimPose } from './pose';
import { JOINT_INDEX, UPPER_BODY, type ScanSkeleton } from './skeleton';

/** Every clip the animator can use (public/anim/<name>.json). */
export const CLIP_NAMES = [
  'idle',
  'walk',
  'run',
  'walk_back',
  'run_stop',
  'turn_left',
  'turn_right',
  'jump',
  'jump_run',
  'fall',
  'land',
  'hang',
  'shimmy_left',
  'shimmy_right',
  'climb',
  'wall_idle',
  'wall_up',
  'wall_down',
  'wall_left',
  'wall_right',
  'push',
  'pull',
  'pickup',
  'hit',
  'die',
  'pistol_idle',
  'pistol_run',
  'shoot',
  'tread',
  'swim',
  'swim_to_edge',
] as const;
export type ClipName = (typeof CLIP_NAMES)[number];
export type ClipLibrary = Partial<Record<ClipName, Clip>>;

/**
 * Water clips for the swim and dive modes: treading water when still,
 * swimming (cadence matched to her speed) and reaching for an edge before
 * climbing out (a timed move, like the climb).
 */
export const WATER_CLIPS: Readonly<Record<'surface' | 'swim' | 'exit', ClipName>> = {
  surface: 'tread',
  swim: 'swim',
  exit: 'swim_to_edge',
};

export interface PoseLayer {
  /** Edits the canonical pose in place (model-space joint rotations, hips position). */
  apply(pose: AnimPose, dt: number): void;
}

/** Cross-fade time between sources (s). */
const FADE = 0.2;
/** Speed and velocity smoothing time constant (s). */
const SPEED_TAU = 0.05;
/** Root jumps longer than this (m) in one frame are teleports: foot locks are dropped. */
const TELEPORT = 1;
/** Vertical root moves larger than this in one frame are step snaps (m)... */
const STEP_SNAP = 0.05;
/** ... that the hips catch up with over this time constant (s). */
const STEP_TAU = 0.12;
/** Horizontal speed above which a jump is a running jump (m/s). */
const RUN_JUMP_SPEED = 3;
/** Running jump clip playback rate: its 0.5 s flight against the game's ~0.67 s. */
const RUN_JUMP_RATE = 0.75;
/** A jump starts this long before the clip's take-off (the push-off). */
const TAKEOFF_LEAD = 0.08;
/** Landing weight range, from soft to hard landings, and how long the landing plays (s). */
const LAND_MIN = 0.3;
const LAND_MAX = 0.75;
const LAND_TIME = 0.75;
/** Shimmy playback: fastest rate, and the sideways speed (m/s) at which it is fully in. */
const SHIMMY_MAX_RATE = 2.2;
const SHIMMY_FULL = 0.3;
/** Climbing a wall: fastest playback rate, and the speed along the face (m/s) at which a move is fully in. */
const WALL_MAX_RATE = 3.5;
const WALL_FULL = 0.3;
/** Fade time of the climbing loops (s): long enough to cross-fade a change of direction. */
const WALL_FADE_TAU = 0.12;
const WALL_MOVES = ['wall_up', 'wall_down', 'wall_left', 'wall_right'] as const;
type WallMove = (typeof WALL_MOVES)[number];
/** Hit reaction: playback rate and upper-body weight. */
const HIT_RATE = 1.4;
const HIT_WEIGHT = 0.7;
/** Cross-fade time between water modes and into or out of the water (s): surfacing, diving, splashing in. */
const WATER_FADE = 0.45;
/**
 * Hips height over the root in the water (m). At the surface the root sits
 * `surfaceSink` under the water: treading keeps the head out, and swimming
 * lies along the surface. Under water the body is centred on the collision
 * cylinder.
 */
const TREAD_HIPS = swimming.surfaceSink - 0.45;
const SWIM_HIPS = swimming.surfaceSink - 0.14;
const DIVE_HIPS = tuning.height / 2;
/** Swim cadence: clip playback rate at rest and at full swimming speed. */
const SWIM_RATE_MIN = 0.55;
const SWIM_RATE_MAX = 1.25;
/** Speed (m/s) over which treading gives way to swimming. */
const SWIM_BLEND: [number, number] = [0.25, 1.1];
/** Swimming To Edge: the reach for the edge and the pull (s into the clip), played over the climb's start. */
const EDGE_REACH: [number, number] = [2.0, 3.3];
/** Share of the climb-out spent reaching; the climb clip takes over from there. */
const EDGE_SHARE = 0.3;
/** Arms: the Mixamo clips are natural already; only a touch of relaxing. */
const ARMS: ArmRelax = { elbow: 0.85, wrist: 0.5, abduction: 0.85 };

const smoother = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
const ease = (u: number): number => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};
const UP = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const WATER_MODES: ReadonlySet<NoraPose['mode']> = new Set(['swim', 'dive']);
const UPPER = UPPER_BODY.map((j) => JOINT_INDEX[j]);

type AirKind = 'stand' | 'run' | 'fall';

/** A still pose in the water, for a climb-out whose climb clip is missing. */
const NO_POSE: NoraPose = {
  mode: 'swim',
  modeTime: 0,
  speed: 0,
  vy: 0,
  climbT: 0,
  health: 100,
  weapons: 0,
  aiming: 0,
  aimYaw: 0,
  aimPitch: 0,
};

export class NoraAnimator {
  /** Extra layers applied to clip poses, in order. */
  readonly layers: PoseLayer[] = [];
  private overrideWeight = 0;
  private overrideJoints: number[] = [];

  private readonly loco: Locomotion;
  private readonly ik: LegIK;
  private readonly pose = new AnimPose();
  private readonly tmp = new AnimPose();
  private readonly tmp2 = new AnimPose();
  private readonly from = new AnimPose();
  private fade = 1;
  private readonly contacts: [number, number] = [1, 1];
  private readonly lastRoot = new THREE.Vector3(Number.NaN, 0, 0);
  /** Smoothed root velocity in the character's frame: x = to her right, z = backwards. */
  private readonly vel = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();
  private readonly _carry = new THREE.Vector3();
  private mode: NoraPose['mode'] | null = null;
  private modeT = 0;
  private speed = 0;
  private stepOffset = 0;
  private airKind: AirKind = 'fall';
  private lastAirVy = 0;
  private landT = LAND_TIME;
  private landWeight = 0;
  private hangT = 0;
  private shimmyPhase = 0;
  private shimmyW = 0;
  private shimmyDir = 1;
  /** Vertical root speed (m/s), smoothed: climbing up or down a wall. */
  private velY = 0;
  private wallT = 0;
  private wallPhase = 0;
  /** Weight of each climbing loop over the idle: the one she moves in fades in, the others out. */
  private readonly wallW: Record<WallMove, number> = {
    wall_up: 0,
    wall_down: 0,
    wall_left: 0,
    wall_right: 0,
  };
  private lastHealth = Number.NaN;
  /** Cross-fade time of the current mode change (s). */
  private fadeTime = FADE;
  /** The current climb started in the water. */
  private waterClimb = false;
  private swimPhase = 0;
  private swimW = 0;
  private swimPitch = 0;
  private readonly _pitch = new THREE.Quaternion();
  private hitT = Number.POSITIVE_INFINITY;
  private readonly legInput: LegInput = {
    rootPos: new THREE.Vector3(),
    rootYaw: 0,
    contact: [1, 1],
    stride: 1,
    swingLift: 1,
    still: 1,
    weight: 0,
  };

  constructor(
    skeleton: ScanSkeleton,
    private readonly clips: ClipLibrary & { idle: Clip; walk: Clip; run: Clip },
  ) {
    this.loco = new Locomotion(clips.idle, clips.walk, clips.run, clips.walk_back ?? null);
    this.ik = new LegIK(skeleton);
  }

  /**
   * In clip-driven modes, shows the procedural rig's pose for `joints` with
   * weight 0..1 over the clips (model-space rotations, so an aim direction
   * built in nora.ts is kept while the legs play clips).
   */
  setProceduralOverride(weight: number, joints: readonly RetargetJoint[] = UPPER_BODY): void {
    this.overrideWeight = Math.min(1, Math.max(0, weight));
    this.overrideJoints = joints.map((j) => JOINT_INDEX[j]);
  }

  /**
   * @param procedural the procedural rig's pose this frame (canonical space)
   * @param rootPos world position of the character root (on the floor)
   * @param rootYaw world yaw of the character root
   * @param out the pose to show
   */
  update(
    pose: NoraPose,
    dt: number,
    procedural: AnimPose,
    rootPos: THREE.Vector3,
    rootYaw: number,
    out: AnimPose,
  ): void {
    dt = Math.min(0.1, Math.max(0, dt));
    const c = this.clips;
    const mode = pose.mode;
    // Taking hold of a wall moves the root onto the face in one frame: not climbing speed.
    const takesHold = mode === 'wall' && this.mode !== 'wall';
    if (takesHold) {
      this.velY = 0;
      this.vel.set(0, 0, 0);
    }
    if (mode !== this.mode) {
      this.from.copy(out);
      this.fade = this.mode === null ? 1 : 0;
      if (this.mode === 'air' && mode === 'ground') {
        this.landT = 0;
        const fall = Math.abs(Math.min(0, this.lastAirVy));
        this.landWeight = Math.min(LAND_MAX, Math.max(LAND_MIN, (fall - 4) / 10));
      }
      if (mode === 'air')
        this.airKind = pose.vy > 1 ? (pose.speed > RUN_JUMP_SPEED && c.jump_run ? 'run' : 'stand') : 'fall';
      if ((mode === 'hang' || mode === 'rope') && this.mode !== mode) this.hangT = 0;
      const wasWet = this.mode !== null && WATER_MODES.has(this.mode);
      if (mode === 'climb') this.waterClimb = wasWet;
      this.fadeTime = wasWet || WATER_MODES.has(mode) ? WATER_FADE : FADE;
      this.mode = mode;
      this.modeT = 0;
    }
    this.modeT += dt;
    this.fade = Math.min(1, this.fade + dt / this.fadeTime);
    if (mode === 'air') this.lastAirVy = pose.vy;
    if (pose.health < this.lastHealth - 0.5 && mode !== 'dead' && c.hit) this.hitT = 0;
    this.lastHealth = pose.health;
    this.hitT += dt;

    // Root velocity in the character's frame, for backing up and shimmying.
    const jump = rootPos.distanceTo(this.lastRoot);
    if (!(jump < TELEPORT)) {
      this.ik.reset();
      this.stepOffset = 0;
      this.vel.set(0, 0, 0);
    } else if (dt > 0 && !takesHold) {
      // Riding still: the root's motion is the platform's.
      if (pose.riding && pose.speed < 0.3) this.ik.carry(this._carry.subVectors(rootPos, this.lastRoot));
      else if (mode === 'ground' && Math.abs(rootPos.y - this.lastRoot.y) > STEP_SNAP)
        this.stepOffset -= rootPos.y - this.lastRoot.y;
      const d = this._d.subVectors(rootPos, this.lastRoot).divideScalar(dt).applyAxisAngle(UP, -rootYaw);
      this.velY += (d.y - this.velY) * (1 - Math.exp(-dt / SPEED_TAU));
      d.y = 0;
      this.vel.lerp(d, 1 - Math.exp(-dt / SPEED_TAU));
    }
    this.lastRoot.copy(rootPos);
    this.stepOffset = mode === 'ground' ? this.stepOffset * Math.exp(-dt / STEP_TAU) : 0;
    this.speed += (pose.speed - this.speed) * (1 - Math.exp(-dt / SPEED_TAU));

    const p = this.pose;
    const ground = mode === 'ground';
    // The gait keeps running through a jump so a running landing carries on in step.
    const backwards = this.speed > 0.2 ? Math.max(0, this.vel.z) / Math.max(0.2, this.speed) : 0;
    this.loco.update(ground || mode === 'air' ? this.speed : 0, dt, ground ? backwards : 0);
    let clipDriven = true;
    switch (mode) {
      case 'ground':
        this.loco.sample(p);
        this.land(p, dt);
        p.hips.y += this.stepOffset;
        break;
      case 'air':
        clipDriven = this.air(p);
        break;
      case 'hang':
      case 'rope':
        clipDriven = this.hang(p, dt);
        break;
      case 'climb':
        clipDriven = this.waterClimb ? this.climbOut(p, pose.climbT) : this.climb(p, pose.climbT);
        break;
      case 'wall':
        clipDriven = this.wall(p, dt);
        break;
      case 'swim':
      case 'dive':
        clipDriven = this.swim(p, dt, pose, mode === 'dive');
        break;
      case 'block':
      case 'push':
        clipDriven = this.push(p, mode === 'push' ? pose.climbT : null);
        break;
      case 'pull':
        // One pulling cycle per pull.
        clipDriven = this.playLoop(p, this.clips.pull, pose.climbT);
        break;
      case 'lever':
        // Mirror drums and wall slots are shoved round or pressed in: one push cycle per use.
        clipDriven = pose.use ? this.push(p, Math.min(0.999, this.modeT / tuning.leverTime)) : false;
        break;
      case 'pickup':
        clipDriven = this.playFitted(p, c.pickup, this.modeT / tuning.pickupTime);
        break;
      case 'dead':
        clipDriven = this.playFitted(p, c.die, this.modeT / (c.die?.duration ?? 1));
        break;
      default:
        clipDriven = false;
    }
    if (!clipDriven) {
      this.ik.reset();
      this.show(procedural, out);
      return;
    }
    relaxArms(p, ARMS);
    this.hurt(p);
    if (this.overrideWeight > 0) p.blendJoints(procedural, this.overrideJoints, this.overrideWeight);
    for (const layer of this.layers) layer.apply(p, dt);
    if (ground) {
      const loco = this.loco;
      const input = this.legInput;
      input.rootPos = rootPos;
      input.rootYaw = rootYaw;
      input.contact = loco.contacts(this.contacts);
      input.stride = loco.stride;
      input.swingLift = loco.swingLift;
      input.still = 1 - loco.move;
      input.weight = 1;
      this.ik.solve(p, input, dt);
    } else this.ik.reset();
    this.show(p, out);
  }

  /** Shows `pose`, cross-faded from the snapshot taken at the last mode change. */
  private show(pose: AnimPose, out: AnimPose): void {
    if (this.fade >= 1) out.copy(pose);
    else out.blend(this.from, pose, smoother(this.fade));
  }

  /** Plays a loop at phase u (0..1). */
  private playLoop(p: AnimPose, clip: Clip | undefined, u: number): boolean {
    if (!clip) return false;
    clip.samplePhase(Math.min(0.999, Math.max(0, u)), p.rot, p.hips);
    return true;
  }

  /** Plays a one-shot clip at normalised progress u (0..1), holding its last frame. */
  private playFitted(p: AnimPose, clip: Clip | undefined, u: number): boolean {
    if (!clip) return false;
    clip.samplePhase(Math.min(1, Math.max(0, u)), p.rot, p.hips);
    return true;
  }

  /** Landing clip over the ground pose after a jump or a fall, lighter when landing on the run. */
  private land(p: AnimPose, dt: number): void {
    const clip = this.clips.land;
    if (!clip || this.landT >= LAND_TIME) return;
    this.landT += dt;
    const t = (clip.events.touchdown ?? 0) + this.landT;
    clip.sample(t, this.tmp.rot, this.tmp.hips);
    const moving = 1 - 0.75 * this.loco.move;
    const w = this.landWeight * moving * (1 - smoother((this.landT - LAND_TIME + 0.3) / 0.3));
    p.blend(p, this.tmp, w);
  }

  /** Air: the take-off of a standing or running jump, then the falling loop. */
  private air(p: AnimPose): boolean {
    const c = this.clips;
    const fall = c.fall;
    const clip = this.airKind === 'run' ? c.jump_run : this.airKind === 'stand' ? c.jump : undefined;
    if (!clip && !fall) return false;
    const t = this.modeT;
    if (clip) {
      const rate = this.airKind === 'run' ? RUN_JUMP_RATE : 1;
      const start = Math.max(0, (clip.events.takeoff ?? 0) - TAKEOFF_LEAD);
      const end = (clip.events.touchdown ?? clip.duration) - 0.05;
      const tc = start + t * rate;
      clip.sample(Math.min(tc, end), p.rot, p.hips);
      if (fall && tc > end) {
        fall.sample(t, this.tmp.rot, this.tmp.hips);
        p.blend(p, this.tmp, smoother((tc - end) / 0.25));
      }
    } else if (fall) fall.sample(t, p.rot, p.hips);
    return true;
  }

  /** Hanging: idle, blended into a shimmy to the side she is moving, its pace matched to hers. */
  private hang(p: AnimPose, dt: number): boolean {
    const c = this.clips;
    if (!c.hang) return false;
    this.hangT += dt;
    c.hang.sample(this.hangT, p.rot, p.hips);
    const side = this.vel.x;
    const target = Math.min(1, Math.abs(side) / SHIMMY_FULL);
    if (Math.abs(side) > 0.05) this.shimmyDir = side > 0 ? 1 : -1;
    this.shimmyW += (target - this.shimmyW) * (1 - Math.exp(-dt / 0.08));
    const shimmy = this.shimmyDir > 0 ? c.shimmy_right : c.shimmy_left;
    if (shimmy && this.shimmyW > 0.001) {
      const rate = Math.min(SHIMMY_MAX_RATE, Math.abs(side) / Math.max(0.05, Math.abs(shimmy.speed)));
      this.shimmyPhase = (this.shimmyPhase + (dt * rate) / shimmy.duration) % 1;
      shimmy.samplePhase(this.shimmyPhase, this.tmp.rot, this.tmp.hips);
      p.blend(p, this.tmp, this.shimmyW);
    }
    return true;
  }

  /**
   * On a wall of roots: the idle on the face, blended into the climbing loop of the way she is
   * moving (up, down, left or right, whichever is fastest), its cadence matched to her speed.
   */
  private wall(p: AnimPose, dt: number): boolean {
    const c = this.clips;
    if (!c.wall_idle) return false;
    this.wallT += dt;
    c.wall_idle.sample(this.wallT, p.rot, p.hips);
    const up = this.velY;
    const side = this.vel.x;
    const speed = Math.max(Math.abs(up), Math.abs(side));
    const moving: WallMove =
      Math.abs(up) >= Math.abs(side)
        ? up > 0
          ? 'wall_up'
          : 'wall_down'
        : side > 0
          ? 'wall_right'
          : 'wall_left';
    const k = 1 - Math.exp(-dt / WALL_FADE_TAU);
    let rate = 0;
    for (const m of WALL_MOVES) {
      const clip = c[m];
      // A loop that did not load keeps no weight: that way she fades to the idle.
      const target = clip && speed > 0.05 && m === moving ? Math.min(1, speed / WALL_FULL) : 0;
      this.wallW[m] += (target - this.wallW[m]) * k;
      if (m === moving && clip) rate = Math.min(WALL_MAX_RATE, speed / Math.max(0.05, Math.abs(clip.speed)));
    }
    // One phase for all four loops, at the cadence of the way she moves now.
    const lead = c[moving];
    if (lead) this.wallPhase = (this.wallPhase + (dt * rate) / lead.duration) % 1;
    // A weighted mix of the idle and each loop: blending each in by its share of the weight so far.
    let sum = Math.max(0, 1 - WALL_MOVES.reduce((s, m) => s + this.wallW[m], 0));
    for (const m of WALL_MOVES) {
      const w = this.wallW[m];
      const clip = c[m];
      if (!clip || w < 0.001) continue;
      sum += w;
      clip.samplePhase(this.wallPhase, this.tmp.rot, this.tmp.hips);
      p.blend(p, this.tmp, w / sum);
    }
    return true;
  }

  /**
   * Climb: braced hang to crouch, timed to the simulation's climb. The clip
   * keeps its travel; the simulation moves the root (lift first, then
   * forward), so the same profile of the clip's own travel is taken out.
   */
  private climb(p: AnimPose, u: number): boolean {
    const clip = this.clips.climb;
    if (!clip) return false;
    clip.samplePhase(u, p.rot, p.hips);
    const end = clip.rootEnd;
    if (end) {
      const lift = ease(u / 0.6);
      const fwd = ease((u - 0.45) / 0.55);
      p.hips.x -= end.x * fwd;
      p.hips.y -= end.y * lift;
      p.hips.z -= end.z * fwd;
    }
    return true;
  }

  /**
   * Swimming and diving: treading water when still, swimming when moving
   * (the cadence follows her speed), lifted to lie along the surface or
   * centred under water, and pitched with the dive (head up rising, down
   * diving).
   */
  private swim(p: AnimPose, dt: number, pose: NoraPose, under: boolean): boolean {
    const c = this.clips;
    const tread = c.tread;
    const swim = c.swim;
    if (!tread && !swim) return false;
    const speed = under ? Math.hypot(pose.speed, pose.vy) : pose.speed;
    const target = swim ? (tread ? ease((speed - SWIM_BLEND[0]) / (SWIM_BLEND[1] - SWIM_BLEND[0])) : 1) : 0;
    this.swimW += (target - this.swimW) * (1 - Math.exp(-dt / 0.2));
    const full = under ? swimming.diveSpeed : swimming.swimSpeed;
    const rate = SWIM_RATE_MIN + (SWIM_RATE_MAX - SWIM_RATE_MIN) * Math.min(1, speed / full);
    if (swim) this.swimPhase = (this.swimPhase + (dt * rate) / swim.duration) % 1;
    const w = this.swimW;
    if (tread) {
      tread.sample(this.modeT, p.rot, p.hips);
      p.hips.y = under ? DIVE_HIPS : TREAD_HIPS;
    }
    if (swim && w > 0.001) {
      const into = tread ? this.tmp : p;
      swim.samplePhase(this.swimPhase, into.rot, into.hips);
      into.hips.y = under ? DIVE_HIPS : SWIM_HIPS;
      if (tread) p.blend(p, this.tmp, w);
    }
    // Pitch along the dive, turning the whole body about the hips (model-space rotations).
    const pitch = under ? (pose.pitch ?? 0) * Math.max(w, 0.35) : 0;
    this.swimPitch += (pitch - this.swimPitch) * (1 - Math.exp(-dt / 0.15));
    if (Math.abs(this.swimPitch) > 1e-3) {
      this._pitch.setFromAxisAngle(AXIS_X, this.swimPitch);
      for (const q of p.rot) q.premultiply(this._pitch);
    }
    return true;
  }

  /**
   * Climbing out of the water: the reach for the edge from Swimming To Edge,
   * then the climb clip for the pull up, timed to the simulation's move.
   */
  private climbOut(p: AnimPose, u: number): boolean {
    const edge = this.clips.swim_to_edge;
    const climb = this.clips.climb;
    if (!climb) return this.swim(p, 0, { ...NO_POSE }, false);
    const k = Math.min(1, Math.max(0, (u - EDGE_SHARE) / (1 - EDGE_SHARE)));
    this.climb(p, k * 0.999);
    if (edge) {
      const reach = smoother(u / EDGE_SHARE);
      edge.sample(EDGE_REACH[0] + (EDGE_REACH[1] - EDGE_REACH[0]) * reach, this.tmp.rot, this.tmp.hips);
      // The climb clip's own start: hands on the edge, hips under it.
      this.tmp.hips.set(p.hips.x, TREAD_HIPS, p.hips.z);
      p.blend(this.tmp, p, smoother((u - EDGE_SHARE * 0.6) / (EDGE_SHARE * 0.8)));
    }
    return true;
  }

  /** Block and push: one pushing cycle per push, holding its first pose while gripping the block. */
  private push(p: AnimPose, u: number | null): boolean {
    const clip = this.clips.push;
    if (!clip) return false;
    clip.samplePhase(u ?? 0, p.rot, p.hips);
    return true;
  }

  /** Hit reaction over the upper body after losing health. */
  private hurt(p: AnimPose): void {
    const clip = this.clips.hit;
    if (!clip) return;
    const t = this.hitT * HIT_RATE;
    if (t >= clip.duration) return;
    clip.sample(t, this.tmp2.rot, this.tmp2.hips);
    const w = HIT_WEIGHT * smoother(t / 0.1) * (1 - smoother((t - clip.duration + 0.5) / 0.5));
    p.blendJoints(this.tmp2, UPPER, w);
  }
}
