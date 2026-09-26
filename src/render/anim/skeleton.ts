/**
 * Nora's 19-joint skeleton in the "canonical" retarget space shared by the
 * procedural rig (nora.ts) and the motion clips (public/anim/*.json).
 *
 * A canonical pose gives every joint a model-space rotation W relative to a
 * rest pose that stands upright facing -Z (anatomical left at -X) with the
 * arms and legs straight down. The scanned model (rig_nora.py, A-pose bind)
 * reaches the rest pose through a fixed per-limb correction, so the scan's
 * bone rotation is W × correction × bind (see nora-scan.ts).
 */
import * as THREE from 'three/webgpu';
import type { RetargetJoint } from '../nora';

/** Joints in parent-before-child order. */
export const JOINTS: readonly RetargetJoint[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder_L',
  'upperArm_L',
  'lowerArm_L',
  'hand_L',
  'shoulder_R',
  'upperArm_R',
  'lowerArm_R',
  'hand_R',
  'thigh_L',
  'shin_L',
  'foot_L',
  'thigh_R',
  'shin_R',
  'foot_R',
];

export const JOINT_COUNT = JOINTS.length;

export const PARENT: Readonly<Partial<Record<RetargetJoint, RetargetJoint>>> = {
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  shoulder_L: 'chest',
  upperArm_L: 'shoulder_L',
  lowerArm_L: 'upperArm_L',
  hand_L: 'lowerArm_L',
  shoulder_R: 'chest',
  upperArm_R: 'shoulder_R',
  lowerArm_R: 'upperArm_R',
  hand_R: 'lowerArm_R',
  thigh_L: 'hips',
  shin_L: 'thigh_L',
  foot_L: 'shin_L',
  thigh_R: 'hips',
  shin_R: 'thigh_R',
  foot_R: 'shin_R',
};

/**
 * Limbs whose rest direction is straight down, with the joint that marks their
 * far end. The hands are straight down too, along their own bone.
 */
export const LIMB_END: Readonly<Partial<Record<RetargetJoint, RetargetJoint>>> = {
  upperArm_L: 'lowerArm_L',
  lowerArm_L: 'hand_L',
  upperArm_R: 'lowerArm_R',
  lowerArm_R: 'hand_R',
  thigh_L: 'shin_L',
  shin_L: 'foot_L',
  thigh_R: 'shin_R',
  shin_R: 'foot_R',
};

export const JOINT_INDEX = Object.fromEntries(JOINTS.map((j, i) => [j, i])) as Record<RetargetJoint, number>;

/** Parent index of every joint (-1 for the hips). */
export const PARENT_INDEX: readonly number[] = JOINTS.map((j) => {
  const p = PARENT[j];
  return p ? JOINT_INDEX[p] : -1;
});

/** Joints above the hips that an upper-body layer (e.g. aiming) may override. */
export const UPPER_BODY: readonly RetargetJoint[] = [
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder_L',
  'upperArm_L',
  'lowerArm_L',
  'hand_L',
  'shoulder_R',
  'upperArm_R',
  'lowerArm_R',
  'hand_R',
];

export interface LegJoints {
  thigh: number;
  shin: number;
  foot: number;
}

export const LEGS: readonly [LegJoints, LegJoints] = [
  { thigh: JOINT_INDEX.thigh_L, shin: JOINT_INDEX.shin_L, foot: JOINT_INDEX.foot_L },
  { thigh: JOINT_INDEX.thigh_R, shin: JOINT_INDEX.shin_R, foot: JOINT_INDEX.foot_R },
];

/**
 * Points on the sole relative to the ankle, in the foot's canonical rest frame
 * (foot flat, toes towards -Z); y is filled in with the ankle height.
 */
export const FOOT_HEEL = new THREE.Vector3(0, 0, 0.055);
export const FOOT_BALL = new THREE.Vector3(0, 0, -0.145);

const DOWN = new THREE.Vector3(0, -1, 0);

/** Model-space bind transform of one joint. */
export interface BindJoint {
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
}

/**
 * The scan's skeleton seen from the canonical space: rest corrections and
 * joint offsets, enough for forward kinematics of a canonical pose.
 */
export class ScanSkeleton {
  readonly bind: readonly BindJoint[];
  /** Rotates each joint's bind direction onto the canonical rest direction. */
  readonly correction: readonly THREE.Quaternion[];
  /** Offset from the parent joint in the parent's canonical rest frame. */
  readonly offset: readonly THREE.Vector3[];
  /** Hips bind position (model space). */
  readonly hipsBind: THREE.Vector3;
  /** Hip joint (thigh) centre relative to the hips joint, in the canonical rest frame. */
  readonly hipCentre: THREE.Vector3;
  readonly thighLength: number;
  readonly shinLength: number;
  /** Ankle height above the floor in the bind pose. */
  readonly ankleHeight: number;
  /** Heel and ball of the foot relative to the ankle, canonical rest frame. */
  readonly heel: THREE.Vector3;
  readonly ball: THREE.Vector3;

  constructor(bind: Record<RetargetJoint, BindJoint>) {
    this.bind = JOINTS.map((j) => bind[j]);
    this.correction = JOINTS.map((j) => {
      const q = new THREE.Quaternion();
      const end = LIMB_END[j];
      if (end) q.setFromUnitVectors(bind[end].pos.clone().sub(bind[j].pos).normalize(), DOWN);
      return q;
    });
    // Hands hang straight too: their bone (+Y) runs from the wrist towards the fingers.
    for (const s of ['L', 'R'] as const) {
      const hand = this.correction[JOINT_INDEX[`hand_${s}`]];
      const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(bind[`hand_${s}`].rot);
      hand?.setFromUnitVectors(dir, DOWN);
    }
    this.offset = JOINTS.map((j, i) => {
      const p = PARENT_INDEX[i] ?? -1;
      const parent = p >= 0 ? this.bind[p] : undefined;
      const corr = this.correction[p];
      if (!parent || !corr) return new THREE.Vector3();
      return bind[j].pos.clone().sub(parent.pos).applyQuaternion(corr);
    });
    this.hipsBind = bind.hips.pos.clone();
    this.hipCentre = bind.thigh_L.pos.clone().add(bind.thigh_R.pos).multiplyScalar(0.5).sub(bind.hips.pos);
    this.thighLength = bind.shin_L.pos.distanceTo(bind.thigh_L.pos);
    this.shinLength = bind.foot_L.pos.distanceTo(bind.shin_L.pos);
    this.ankleHeight = (bind.foot_L.pos.y + bind.foot_R.pos.y) / 2;
    this.heel = FOOT_HEEL.clone().setY(-this.ankleHeight);
    this.ball = FOOT_BALL.clone().setY(-this.ankleHeight);
  }

  /**
   * Forward kinematics of a canonical pose: model-space position of every
   * joint for canonical rotations `rot` and hips position `hips`.
   */
  positions(rot: readonly THREE.Quaternion[], hips: THREE.Vector3, out: THREE.Vector3[]): void {
    for (let i = 0; i < JOINT_COUNT; i++) {
      const o = out[i] ?? (out[i] = new THREE.Vector3());
      const p = PARENT_INDEX[i] ?? -1;
      if (p < 0) {
        o.copy(hips);
        continue;
      }
      const q = rot[p];
      const pp = out[p];
      const off = this.offset[i];
      if (!q || !pp || !off) continue;
      o.copy(off).applyQuaternion(q).add(pp);
    }
  }
}
