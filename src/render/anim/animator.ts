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
 * - block and push: pushing, one cycle per push; pull: pulling a heavy object;
 * - pickup: picking up, fitted to the pickup time;
 * - dead: dying;
 * - hurt: a hit reaction over the upper body when health drops.
 *
 * The procedural rig (nora.ts) keeps the mode no clip fits (lever) and
 * any clip that failed to load, with short cross-fades between sources.
 *
 * Upper-body hook (aiming): `setProceduralOverride` blends the procedural
 * rig's pose (by default spine, head and arms) over the clips, and `layers`
 * may edit the pose after the clips and before the leg pass.
 */
import * as THREE from 'three/webgpu';
import { tuning } from '../../sim/player/tuning';
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
 * Water clips, ready for the swim and dive modes that arrive with level 2:
 * treading water at the surface, swimming (speed-matched like the gait) and
 * climbing out at an edge (a timed move, like the climb).
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
/** Hit reaction: playback rate and upper-body weight. */
const HIT_RATE = 1.4;
const HIT_WEIGHT = 0.7;
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
const UPPER = UPPER_BODY.map((j) => JOINT_INDEX[j]);

type AirKind = 'stand' | 'run' | 'fall';

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
  private lastHealth = Number.NaN;
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
      if (mode === 'hang' && this.mode !== 'hang') this.hangT = 0;
      this.mode = mode;
      this.modeT = 0;
    }
    this.modeT += dt;
    this.fade = Math.min(1, this.fade + dt / FADE);
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
    } else if (dt > 0) {
      if (mode === 'ground' && Math.abs(rootPos.y - this.lastRoot.y) > STEP_SNAP)
        this.stepOffset -= rootPos.y - this.lastRoot.y;
      const d = this._d.subVectors(rootPos, this.lastRoot).divideScalar(dt).applyAxisAngle(UP, -rootYaw);
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
        clipDriven = this.hang(p, dt);
        break;
      case 'climb':
        clipDriven = this.climb(p, pose.climbT);
        break;
      case 'block':
      case 'push':
        clipDriven = this.push(p, mode === 'push' ? pose.climbT : null);
        break;
      case 'pull':
        // One pulling cycle per pull.
        clipDriven = this.playLoop(p, this.clips.pull, pose.climbT);
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
