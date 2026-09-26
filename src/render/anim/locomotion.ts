/**
 * Ground locomotion from motion clips: a 1D blend by speed between idle, walk
 * and run. Walk and run share one normalised gait phase (both clips start at
 * the left heel strike), so their feet stay in step while they blend.
 *
 * The game walks at 2.2 m/s, more than twice the walk clip's own pace, so
 * speed is matched partly by playing faster and partly by lengthening the
 * stride (the leg IK stretches the foot path by `stride`), the way people
 * speed up: cadence and step length both grow.
 */
import { tuning } from '../../sim/player/tuning';
import { contactWeight, type Clip } from './clip';
import { AnimPose } from './pose';

/** How much of a speed-up comes from longer strides (0 = all cadence, 1 = all stride). */
const STRIDE_SHARE = 0.3;
const STRIDE_MIN = 0.75;
const STRIDE_MAX = 1.4;
/** Speeds (m/s) over which idle turns into walk, and walk into run. */
const MOVE_FROM = 0.05;
const MOVE_TO = 0.7;
const RUN_FROM = tuning.walkSpeed * 1.15;
const RUN_TO = tuning.runSpeed * 0.85;
/** Weight smoothing time constants (s); the run builds up over the first strides. */
const MOVE_TAU = 0.09;
const MOVE_TAU_STOP = 0.16;
const RUN_TAU_UP = 0.18;
const RUN_TAU_DOWN = 0.08;
/** How high the walk clip's swinging foot is lifted (its heel kick is a little theatrical). */
const WALK_SWING_LIFT = 0.5;
/** Gait phase to start from when setting off from standing: left foot planted ahead, right about to swing. */
const START_PHASE = 0.04;
/** Contact ramps, in phase units, so foot locks engage and release smoothly. */
const CONTACT_RAMP = 0.08;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Locomotion {
  /** Walk/run gait phase, 0..1 from the left heel strike. */
  phase = START_PHASE;
  /** 0 = idle, 1 = moving. */
  move = 0;
  /** 0 = walk, 1 = run. */
  run = 0;
  /** Stride length scale for the leg IK. */
  stride = 1;
  /** Height scale of the swinging foot for the leg IK. */
  swingLift = 1;
  private idleTime = 0;
  private readonly idlePose = new AnimPose();
  private readonly walkPose = new AnimPose();
  private readonly runPose = new AnimPose();
  private readonly gait = new AnimPose();

  constructor(
    private readonly idle: Clip,
    private readonly walk: Clip,
    private readonly runClip: Clip,
  ) {}

  update(speed: number, dt: number): void {
    const moveTarget = smoothstep(MOVE_FROM, MOVE_TO, speed);
    if (this.move < 0.02 && moveTarget > 0) this.phase = START_PHASE;
    // Stopping settles a little slower than starting: the last step finishes.
    const moveTau = moveTarget < this.move ? MOVE_TAU_STOP : MOVE_TAU;
    this.move += (moveTarget - this.move) * (1 - Math.exp(-dt / moveTau));
    const runTarget = smoothstep(RUN_FROM, RUN_TO, speed);
    const runTau = runTarget > this.run ? RUN_TAU_UP : RUN_TAU_DOWN;
    this.run += (runTarget - this.run) * (1 - Math.exp(-dt / runTau));
    this.swingLift = WALK_SWING_LIFT + (1 - WALK_SWING_LIFT) * this.run;

    // Blended clip pace, then split the speed ratio between cadence and stride.
    const r = this.run;
    const clipSpeed = this.walk.speed + (this.runClip.speed - this.walk.speed) * r;
    const cycle = this.walk.duration + (this.runClip.duration - this.walk.duration) * r;
    const ratio = Math.max(speed, 0.3) / clipSpeed;
    this.stride = Math.min(STRIDE_MAX, Math.max(STRIDE_MIN, Math.pow(ratio, STRIDE_SHARE)));
    const rate = ratio / this.stride;
    this.phase = (this.phase + (dt * rate) / cycle) % 1;
    this.idleTime += dt;
  }

  sample(out: AnimPose): void {
    this.idle.sample(this.idleTime, this.idlePose.rot, this.idlePose.hips);
    if (this.move <= 0.001) {
      out.copy(this.idlePose);
      return;
    }
    this.walk.samplePhase(this.phase, this.walkPose.rot, this.walkPose.hips);
    this.runClip.samplePhase(this.phase, this.runPose.rot, this.runPose.hips);
    this.gait.blend(this.walkPose, this.runPose, this.run);
    out.blend(this.idlePose, this.gait, this.move);
  }

  /** How firmly each foot is planted (0..1), [left, right]. */
  contacts(out: [number, number]): [number, number] {
    const sides = ['L', 'R'] as const;
    for (let s = 0; s < 2; s++) {
      const side = sides[s] ?? 'L';
      const w = contactWeight(this.walk.contacts[side], this.phase, CONTACT_RAMP);
      const r = contactWeight(this.runClip.contacts[side], this.phase, CONTACT_RAMP);
      const gait = w + (r - w) * this.run;
      out[s] = 1 + (gait - 1) * this.move;
    }
    return out;
  }
}
