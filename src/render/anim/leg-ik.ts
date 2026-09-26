/**
 * Leg pass over a clip pose: stretches the stride for speed matching, keeps
 * the soles above the floor (the floor is at the character root's height),
 * pins planted feet to the ground in world space so they neither slide nor
 * spin while the body moves or turns, lowers the hips when a leg can't reach
 * and re-solves thigh and shin with two-bone IK. Feet keep their animated
 * model-space orientation (heel strike, roll, toe-off).
 */
import * as THREE from 'three/webgpu';
import type { AnimPose } from './pose';
import { LEGS, type LegJoints, type ScanSkeleton } from './skeleton';

/** Plant weights above LOCK engage a foot lock; below RELEASE let it go. */
const LOCK = 0.75;
const RELEASE = 0.5;
/** A foot whose plant weight is rising past this locks as soon as its sole touches the floor. */
const TOUCHDOWN = 0.05;
/** A locked foot further than this from its animated place steps back to it (m). */
const MAX_STRETCH = 0.28;
/** ... or when the floor under the body is this much higher or lower than its own (m). */
const MAX_STEP = 0.6;
/** ... or when the body has turned this much over it (rad). */
const MAX_TWIST = 0.6;
/** Duration (s) and lift (m) of the small step that re-plants a stretched foot. */
const STEP_TIME = 0.22;
const STEP_LIFT = 0.06;
/** Time constant (s) of the blend back to the animation after a foot lifts. */
const RELEASE_TAU = 0.06;
/** How far the hips may drop to let the legs reach (m), and how fast they recover (s). */
const MAX_DROP = 0.1;
const DROP_RECOVER = 0.08;
/** Fraction of full leg extension the IK allows. */
const REACH = 0.997;
/** How far a leg that can't reach may roll its foot: heel raise of a trailing foot, toe lift of a leading one (rad). */
const MAX_HEEL_RAISE = 0.5;
const MAX_TOE_LIFT = 0.3;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pivot = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export interface LegInput {
  /** World position of the character root (on the floor). */
  rootPos: THREE.Vector3;
  /** World yaw of the character root. */
  rootYaw: number;
  /** Plant weight of each foot, [left, right]. */
  contact: readonly [number, number];
  /** Stride length scale around the hips. */
  stride: number;
  /** Height scale of a swinging foot. */
  swingLift: number;
  /** 1 when standing, 0 when moving. */
  still: number;
  /** Overall weight of the pass (0..1). */
  weight: number;
}

class Foot {
  locked = false;
  /** World position of the pivot (the part of the sole on the ground). */
  readonly pivot = new THREE.Vector3();
  /** Pivot along the sole: 0 = heel, 1 = ball. */
  u = 0;
  /** Character yaw when the lock engaged. */
  yaw = 0;
  /** Model-space offset from the animated ankle, fading out after a release. */
  readonly offset = new THREE.Vector3();
  /** Yaw offset of the foot, fading out after a release. */
  yawOffset = 0;
  /** Re-plant step progress (0..1), or -1 when not stepping. */
  step = -1;
  /** Plant weight last frame. */
  contact = 0;
  /** World height of the floor the foot was planted on. */
  floor = 0;
  readonly target = new THREE.Vector3();
}

export class LegIK {
  private readonly pos: THREE.Vector3[] = [];
  private readonly feet = [new Foot(), new Foot()];
  private drop = 0;
  private readonly len: { a: number; b: number }[];

  constructor(private readonly sk: ScanSkeleton) {
    this.len = LEGS.map((l) => ({
      a: sk.offset[l.shin]?.length() ?? sk.thighLength,
      b: sk.offset[l.foot]?.length() ?? sk.shinLength,
    }));
  }

  /** Forgets locks, e.g. after a teleport or while another mode drives the legs. */
  reset(): void {
    for (const f of this.feet) {
      f.locked = false;
      f.offset.set(0, 0, 0);
      f.yawOffset = 0;
      f.step = -1;
    }
    this.drop = 0;
  }

  /** Adjusts the legs of a canonical pose in place. */
  solve(pose: AnimPose, input: LegInput, dt: number): void {
    const { rootPos, rootYaw, contact, stride, still, weight } = input;
    const sk = this.sk;
    const pos = this.pos;
    sk.positions(pose.rot, pose.hips, pos);
    const hipZ = ((pos[LEGS[0].thigh]?.z ?? 0) + (pos[LEGS[1].thigh]?.z ?? 0)) / 2;

    let drop = 0;
    for (let s = 0; s < 2; s++) {
      const leg = LEGS[s] ?? LEGS[0];
      const f = this.feet[s] ?? new Foot();
      const qf = pose.q(leg.foot);
      const T = f.target.copy(pos[leg.foot] ?? _a);
      const c = contact[s] ?? 0;
      // Longer or shorter strides around the hips; lower or higher swings.
      T.z = hipZ + (T.z - hipZ) * stride;
      // Only the heel kick behind the body: a lower foot in front would land early.
      const swing = (1 - c) * (1 - c) * Math.min(1, Math.max(0, (T.z - hipZ + 0.15) / 0.2));
      T.y = sk.ankleHeight + (T.y - sk.ankleHeight) * (1 + (input.swingLift - 1) * swing);
      // Keep heel and ball above the floor.
      const heelY = T.y + _a.copy(sk.heel).applyQuaternion(qf).y;
      const ballY = T.y + _b.copy(sk.ball).applyQuaternion(qf).y;
      T.y += Math.max(0, -Math.min(heelY, ballY));
      // Pivot on whichever end of the sole is lower.
      const u = THREE.MathUtils.smoothstep(heelY - ballY, -0.01, 0.01);
      const pivot = _pivot.lerpVectors(sk.heel, sk.ball, u).applyQuaternion(qf).add(T);

      const rising = c > f.contact;
      f.contact = c;
      // Lock once planted, or as soon as the sole touches down on its way to being planted.
      const touchdown = rising && c > TOUCHDOWN && Math.min(heelY, ballY) < 0.01;
      if (!f.locked && f.step < 0 && (c >= LOCK || touchdown) && weight > 0.5) {
        f.locked = true;
        this.toWorld(pivot, rootPos, rootYaw, f.pivot);
        f.floor = rootPos.y;
        f.u = u;
        f.yaw = rootYaw + f.yawOffset;
        f.offset.set(0, 0, 0);
      }
      if (f.locked) {
        // Re-anchor when the pivot moves along the sole, so the ankle doesn't jump.
        if (u !== f.u) {
          _a.subVectors(sk.ball, sk.heel)
            .multiplyScalar(u - f.u)
            .applyQuaternion(qf)
            .applyAxisAngle(UP, rootYaw);
          f.pivot.x += _a.x;
          f.pivot.z += _a.z;
          f.u = u;
        }
        this.toModel(f.pivot, rootPos, rootYaw, _b);
        // Standing feet keep their heading while the body turns; moving ones pivot with it.
        if (still < 0.5) f.yaw = rootYaw;
        const twist = wrap(f.yaw - rootYaw);
        const lx = _b.x + (T.x - pivot.x);
        const lz = _b.z + (T.z - pivot.z);
        const stretch = Math.hypot(lx - T.x, lz - T.z);
        // A planted foot stays on its own floor when the root steps up or down.
        const dy = f.floor - rootPos.y;
        const lifting = c < RELEASE && !rising;
        const strained = stretch > MAX_STRETCH || Math.abs(dy) > MAX_STEP || Math.abs(twist) > MAX_TWIST;
        if (lifting || c < TOUCHDOWN || strained || weight <= 0.5) {
          f.locked = false;
          f.offset.set(lx - T.x, dy, lz - T.z);
          f.yawOffset = twist;
          // Still meant to be planted: take a small step back under the body,
          // standing on the other foot.
          const other = this.feet[1 - s];
          if (c >= RELEASE && weight > 0.5 && other?.locked) f.step = 0;
        } else {
          f.yawOffset = twist;
          T.x = lx;
          T.y += dy;
          T.z = lz;
        }
      }
      if (!f.locked) {
        if (f.step >= 0) {
          f.step = Math.min(1, f.step + dt / STEP_TIME);
          const k = 1 - THREE.MathUtils.smootherstep(f.step, 0, 1);
          T.addScaledVector(f.offset, k);
          T.y += STEP_LIFT * Math.sin(Math.PI * f.step);
          if (f.step >= 1) {
            f.step = -1;
            f.offset.set(0, 0, 0);
            f.yawOffset = 0;
          } else f.yawOffset *= 1 - Math.min(1, dt / (STEP_TIME * (1 - f.step) + 1e-3));
        } else {
          const k = Math.exp(-dt / RELEASE_TAU);
          f.offset.multiplyScalar(k);
          f.yawOffset *= k;
          T.add(f.offset);
        }
      }
      // Turn the foot back to where it was planted.
      if (f.yawOffset !== 0) qf.premultiply(_q.setFromAxisAngle(UP, f.yawOffset * weight));

      // Blend with the animation, then see how far the hips must come down.
      T.lerpVectors(pos[leg.foot] ?? T, T, weight);
      const H = pos[leg.thigh] ?? _a;
      const { a, b } = this.len[s] ?? { a: sk.thighLength, b: sk.shinLength };
      const reach = (a + b) * REACH;
      if (T.distanceTo(H) > reach) this.rollFoot(qf, T, H, reach, weight);
      const h2 = (T.x - H.x) ** 2 + (T.z - H.z) ** 2;
      const need = H.y - T.y - Math.sqrt(Math.max(0, reach * reach - h2));
      drop = Math.max(drop, need);
    }
    drop = Math.min(MAX_DROP, Math.max(0, drop)) * weight;
    this.drop = Math.max(drop, this.drop * Math.exp(-dt / DROP_RECOVER));
    pose.hips.y -= this.drop;
    for (const p of pos) p.y -= this.drop;

    for (let s = 0; s < 2; s++) {
      const leg = LEGS[s] ?? LEGS[0];
      const f = this.feet[s] ?? new Foot();
      const { a, b } = this.len[s] ?? { a: sk.thighLength, b: sk.shinLength };
      this.twoBone(pose, leg, pos, f.target, a, b);
    }
  }

  /**
   * A leg that can't reach its ankle target rolls the foot the way people do:
   * a trailing foot rises further onto the ball, a leading one lifts its toes
   * on the heel. Both bring the ankle closer to the hip. Moves `ankle` and
   * turns `qf` (model space) in place.
   */
  private rollFoot(
    qf: THREE.Quaternion,
    ankle: THREE.Vector3,
    hip: THREE.Vector3,
    reach: number,
    weight: number,
  ): void {
    const behind = ankle.z > hip.z;
    const pivot = _c
      .copy(behind ? this.sk.ball : this.sk.heel)
      .applyQuaternion(qf)
      .add(ankle);
    const axis = _d.set(1, 0, 0).applyQuaternion(qf);
    const arm = _e1.subVectors(ankle, pivot);
    const maxAngle = behind ? MAX_HEEL_RAISE : MAX_TOE_LIFT;
    // Heel up (trailing) and toes up (leading) turn the foot in opposite senses about its lateral axis.
    const sign = behind ? -1 : 1;
    const at = (angle: number, out: THREE.Vector3): THREE.Vector3 =>
      out
        .copy(arm)
        .applyAxisAngle(axis, sign * angle)
        .add(pivot);
    let lo = 0;
    let hi = maxAngle;
    if (at(hi, _e2).distanceTo(hip) > reach) lo = hi;
    else
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid, _e2).distanceTo(hip) > reach) lo = mid;
        else hi = mid;
      }
    const angle = lo * weight;
    at(angle, ankle);
    qf.premultiply(_q.setFromAxisAngle(axis, sign * angle));
  }

  /** Rotates thigh and shin so the ankle reaches `target`, keeping the knee in its current plane. */
  private twoBone(
    pose: AnimPose,
    leg: LegJoints,
    pos: readonly THREE.Vector3[],
    target: THREE.Vector3,
    a: number,
    b: number,
  ): void {
    const { thigh, shin } = leg;
    const H = pos[thigh];
    const K = pos[shin];
    const A = pos[leg.foot];
    if (!H || !K || !A) return;
    const toT = _c.subVectors(target, H);
    let d = toT.length();
    if (d < 1e-5) return;
    const e1 = _e1.copy(toT).divideScalar(d);
    d = Math.min((a + b) * 0.9995, Math.max(Math.abs(a - b) + 1e-3, d));
    // Bend plane from the current knee; fall back to the thigh's forward axis.
    const e2 = _e2.subVectors(K, H);
    e2.addScaledVector(e1, -e2.dot(e1));
    if (e2.lengthSq() < 1e-8) {
      e2.copy(FORWARD).applyQuaternion(pose.q(thigh));
      e2.addScaledVector(e1, -e2.dot(e1));
    }
    e2.normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const knee = _d
      .copy(H)
      .addScaledVector(e1, a * cosA)
      .addScaledVector(e2, a * sinA);
    // Thigh: swing the old thigh direction onto the new one.
    _a.subVectors(K, H).normalize();
    _b.subVectors(knee, H).normalize();
    _q.setFromUnitVectors(_a, _b);
    pose.q(thigh).premultiply(_q);
    // Shin: after the thigh swing, swing the shin onto the knee-to-target line.
    _a.subVectors(A, K).normalize().applyQuaternion(_q);
    _b.copy(H).addScaledVector(e1, d).sub(knee).normalize();
    _q2.setFromUnitVectors(_a, _b).multiply(_q);
    pose.q(shin).premultiply(_q2);
  }

  private toWorld(v: THREE.Vector3, rootPos: THREE.Vector3, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(v).applyAxisAngle(UP, yaw).add(rootPos);
  }

  private toModel(v: THREE.Vector3, rootPos: THREE.Vector3, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(v).sub(rootPos).applyAxisAngle(UP, -yaw);
  }
}
