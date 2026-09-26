/**
 * Chooses what drives Nora's scanned skeleton each frame: motion clips on the
 * ground (idle/walk/run with foot IK), the procedural rig (nora.ts) for the
 * game-specific modes (air, hang, climb, block, push, pull, lever, pickup,
 * dead), with short cross-fades between them.
 *
 * Upper-body hook (e.g. aiming): in clip-driven modes, `setProceduralOverride`
 * blends the procedural rig's pose (by default spine, head and arms) over the
 * clips, and `layers` may edit the pose after locomotion and before the leg
 * pass.
 */
import * as THREE from 'three/webgpu';
import type { NoraPose, RetargetJoint } from '../nora';
import type { Clip } from './clip';
import { LegIK, type LegInput } from './leg-ik';
import { Locomotion } from './locomotion';
import { relaxArms, type ArmRelax } from './arms';
import { AnimPose } from './pose';
import { JOINT_INDEX, UPPER_BODY, type ScanSkeleton } from './skeleton';

/** Cross-fade time between clips and the procedural rig (s). */
const FADE = 0.2;
/** Speed smoothing time constant (s). */
const SPEED_TAU = 0.05;
/** Root jumps longer than this (m) in one frame are teleports: foot locks are dropped. */
const TELEPORT = 1;
/** Vertical root moves larger than this in one frame are step snaps (m)... */
const STEP_SNAP = 0.05;
/** ... that the hips catch up with over this time constant (s). */
const STEP_TAU = 0.12;

export interface PoseLayer {
  /** Edits the canonical pose in place (model-space joint rotations, hips position). */
  apply(pose: AnimPose, dt: number): void;
}

export interface LocomotionClips {
  idle: Clip;
  walk: Clip;
  run: Clip;
}

export interface AirClips {
  /** Take-off: legs tuck up, arms rise (starts with a crouch the game skips). */
  start: Clip;
  /** Airborne loop. */
  loop: Clip;
  /** Landing: absorbs into a crouch and stands up. */
  land: Clip;
}

/** Air clips play faster than recorded: the game's jumps last about 0.7 s. */
const AIR_RATE = 1.8;
/** Where a fall (no jump) starts: the airborne loop, i.e. after the whole start clip (s at AIR_RATE). */
const AIR_FALL_START = 1.4 / AIR_RATE;
/** The start clip opens with a crouch; the game takes off at once, so it starts here (s). */
const AIR_FROM = 0.08;
/** Landing clip: first frame used (feet touching down), playback rate, end (s) and weight range. */
const LAND_FROM = 0.07;
const LAND_RATE = 1.3;
const LAND_END = 0.85;
const LAND_MIN = 0.25;
const LAND_MAX = 0.6;
/** Arm relaxation at walk and run speed, and in the air (see arms.ts). */
const ARMS_WALK: ArmRelax = { elbow: 0.45, wrist: 0.2, abduction: 0.55 };
const ARMS_RUN: ArmRelax = { elbow: 0.9, wrist: 0.3, abduction: 0.8 };
const ARMS_AIR: ArmRelax = { elbow: 0.7, wrist: 0.3, abduction: 1 };

const smoother = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * u * (u * (u * 6 - 15) + 10);
};

export class NoraAnimator {
  /** Extra layers applied to the clip pose, in order. */
  readonly layers: PoseLayer[] = [];
  private overrideWeight = 0;
  private overrideJoints: number[] = [];

  private readonly loco: Locomotion;
  private readonly ik: LegIK;
  private readonly air: AirClips | null;
  private readonly clipPose = new AnimPose();
  private readonly landPose = new AnimPose();
  /** Snapshot of the shown pose at the last mode change, and the cross-fade progress. */
  private readonly from = new AnimPose();
  private fade = 1;
  private readonly contacts: [number, number] = [1, 1];
  private readonly lastRoot = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly relax: ArmRelax = { ...ARMS_WALK };
  private airT = 0;
  private landT = LAND_END;
  private landWeight = 0;
  private speed = 0;
  private mode: NoraPose['mode'] | null = null;
  private lastAirVy = 0;
  private dipPos = 0;
  private dipVel = 0;
  /** Hips height lag behind a root that just snapped onto a step (m). */
  private stepOffset = 0;
  private readonly legInput: LegInput = {
    rootPos: new THREE.Vector3(),
    rootYaw: 0,
    contact: [1, 1],
    stride: 1,
    swingLift: 1,
    still: 1,
    weight: 0,
  };

  constructor(skeleton: ScanSkeleton, clips: LocomotionClips, air: AirClips | null = null) {
    this.loco = new Locomotion(clips.idle, clips.walk, clips.run);
    this.ik = new LegIK(skeleton);
    this.air = air;
  }

  /**
   * In clip-driven modes, shows the procedural rig's pose for `joints` with
   * weight 0..1 over the clips (model-space rotations, so an aim direction
   * built in nora.ts is kept while the legs run from clips).
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
    const ground = pose.mode === 'ground';
    const air = pose.mode === 'air' && this.air !== null;
    if (pose.mode !== this.mode) {
      // Cross-fade from whatever was shown.
      this.from.copy(out);
      this.fade = this.mode === null ? 1 : 0;
      if (this.mode === 'air' && ground) {
        const fall = Math.abs(Math.min(0, this.lastAirVy));
        if (this.air) {
          // Landing clip, deeper for harder landings.
          this.landT = 0;
          this.landWeight = Math.min(LAND_MAX, Math.max(LAND_MIN, (fall - 3) / 12));
        } else this.dipVel = -Math.min(2.4, fall * 0.22);
      }
      if (pose.mode === 'air') {
        // A jump takes off with the start clip; a fall goes straight to the airborne loop.
        this.airT = pose.vy > 1 ? 0 : AIR_FALL_START;
      }
      this.mode = pose.mode;
    }
    if (pose.mode === 'air') this.lastAirVy = pose.vy;
    this.updateDip(dt);
    this.fade = Math.min(1, this.fade + dt / FADE);

    const jump = rootPos.distanceTo(this.lastRoot);
    if (!(jump < TELEPORT)) {
      this.ik.reset();
      this.stepOffset = 0;
    } else if (ground && Math.abs(rootPos.y - this.lastRoot.y) > STEP_SNAP) {
      // The simulation snaps the root onto steps: let the body follow smoothly.
      this.stepOffset -= rootPos.y - this.lastRoot.y;
    }
    this.lastRoot.copy(rootPos);
    this.stepOffset = ground ? this.stepOffset * Math.exp(-dt / STEP_TAU) : 0;

    this.speed += (pose.speed - this.speed) * (1 - Math.exp(-dt / SPEED_TAU));
    const clip = this.clipPose;
    const loco = this.loco;
    // The gait keeps running through jumps so a running landing carries on in step.
    loco.update(ground || air ? this.speed : 0, dt);
    if (ground) {
      loco.sample(clip);
      this.land(clip, dt);
      clip.hips.y += this.dipPos + this.stepOffset;
      const r = loco.run;
      this.relax.elbow = ARMS_WALK.elbow + (ARMS_RUN.elbow - ARMS_WALK.elbow) * r;
      this.relax.wrist = ARMS_WALK.wrist + (ARMS_RUN.wrist - ARMS_WALK.wrist) * r;
      this.relax.abduction = ARMS_WALK.abduction + (ARMS_RUN.abduction - ARMS_WALK.abduction) * r;
      relaxArms(clip, this.relax);
    } else if (air && this.air) {
      this.airT += dt;
      const a = this.air;
      const t = AIR_FROM + this.airT * AIR_RATE;
      if (t < a.start.duration) a.start.sample(t, clip.rot, clip.hips);
      else a.loop.sample(t - a.start.duration, clip.rot, clip.hips);
      relaxArms(clip, ARMS_AIR);
    } else {
      this.ik.reset();
      this.show(procedural, out);
      return;
    }
    if (this.overrideWeight > 0) clip.blendJoints(procedural, this.overrideJoints, this.overrideWeight);
    for (const layer of this.layers) layer.apply(clip, dt);
    const input = this.legInput;
    input.rootPos = rootPos;
    input.rootYaw = rootYaw;
    input.contact = loco.contacts(this.contacts);
    input.stride = loco.stride;
    input.swingLift = loco.swingLift;
    input.still = 1 - loco.move;
    input.weight = ground ? 1 : 0;
    if (ground) this.ik.solve(clip, input, dt);
    else this.ik.reset();
    this.show(clip, out);
  }

  /** Shows `pose`, cross-faded from the snapshot taken at the last mode change. */
  private show(pose: AnimPose, out: AnimPose): void {
    if (this.fade >= 1) out.copy(pose);
    else out.blend(this.from, pose, smoother(this.fade));
  }

  /** Blends the landing clip over the ground pose after a jump or a fall. */
  private land(pose: AnimPose, dt: number): void {
    const a = this.air;
    if (!a || this.landT >= LAND_END) return;
    this.landT += dt * LAND_RATE;
    const t = LAND_FROM + this.landT;
    a.land.sample(t, this.landPose.rot, this.landPose.hips);
    // Moving on keeps most of the stride; fade out as the clip stands up.
    const moving = 1 - 0.7 * this.loco.move;
    const w = this.landWeight * moving * (1 - smoother((this.landT - LAND_END + 0.3) / 0.3));
    pose.blend(pose, this.landPose, w);
  }

  private updateDip(dt: number): void {
    const k = 140;
    const c = 2 * Math.sqrt(k) * 0.75;
    const steps = Math.ceil(dt * 120);
    const h = dt / Math.max(1, steps);
    for (let i = 0; i < steps; i++) {
      this.dipVel += (-k * this.dipPos - c * this.dipVel) * h;
      this.dipPos = Math.min(0.05, Math.max(-0.16, this.dipPos + this.dipVel * h));
    }
  }
}
