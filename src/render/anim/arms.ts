/**
 * Relaxes the arms of a clip pose: straighter elbows, straight wrists and arms
 * closer to the body. The library's clips hold the arms a little stylised
 * (elbows bent, hands cupped, arms out from the sides); scaling those angles
 * gives the loose, hanging swing of a person walking.
 */
import * as THREE from 'three/webgpu';
import type { AnimPose } from './pose';
import { JOINT_INDEX } from './skeleton';

export interface ArmRelax {
  /** Scale of the elbow bend (1 = as animated, 0 = straight). */
  elbow: number;
  /** Scale of the wrist bend (1 = as animated, 0 = in line with the forearm). */
  wrist: number;
  /** Scale of the angle between the upper arm and the body's side. */
  abduction: number;
}

const ARMS = [
  { s: -1, upper: JOINT_INDEX.upperArm_L, fore: JOINT_INDEX.lowerArm_L, hand: JOINT_INDEX.hand_L },
  { s: 1, upper: JOINT_INDEX.upperArm_R, fore: JOINT_INDEX.lowerArm_R, hand: JOINT_INDEX.hand_R },
] as const;

/** Arms keep at least this angle from the sides so the hands clear the hips (rad). */
const MIN_ABDUCTION = 0.1;

const ID = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _d = new THREE.Vector3();
const _rel = new THREE.Quaternion();
const _hand = new THREE.Quaternion();
const _s = new THREE.Quaternion();
const _q = new THREE.Quaternion();

export function relaxArms(pose: AnimPose, r: ArmRelax): void {
  for (const a of ARMS) {
    const u = pose.q(a.upper);
    const f = pose.q(a.fore);
    const h = pose.q(a.hand);
    // Wrist relative to the forearm, before the forearm changes.
    _hand.copy(f).invert().multiply(h);
    _hand.copy(_s.copy(ID).slerp(_hand, r.wrist));
    // Elbow relative to the upper arm.
    _rel.copy(u).invert().multiply(f);
    _rel.copy(_s.copy(ID).slerp(_rel, r.elbow));
    f.copy(u).multiply(_rel);
    h.copy(f).multiply(_hand);
    // Bring the whole arm towards the body's side: turn the upper arm towards
    // its projection on the sagittal plane, whichever way it swings.
    _d.set(0, -1, 0).applyQuaternion(u);
    const out = Math.asin(Math.min(1, Math.max(-1, a.s * _d.x)));
    _p.set(0, _d.y, _d.z);
    if (out > MIN_ABDUCTION && _p.lengthSq() > 1e-4) {
      const target = MIN_ABDUCTION + (out - MIN_ABDUCTION) * r.abduction;
      _axis.crossVectors(_d, _p.normalize()).normalize();
      _q.setFromAxisAngle(_axis, out - target);
      u.premultiply(_q);
      f.premultiply(_q);
      h.premultiply(_q);
    }
  }
}
