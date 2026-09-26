/**
 * A pose in the canonical retarget space (skeleton.ts): one model-space
 * rotation per joint and the hips position in the scanned model's space.
 */
import * as THREE from 'three/webgpu';
import { JOINT_COUNT } from './skeleton';

export class AnimPose {
  readonly rot: THREE.Quaternion[] = Array.from({ length: JOINT_COUNT }, () => new THREE.Quaternion());
  readonly hips = new THREE.Vector3();

  copy(o: AnimPose): this {
    for (let i = 0; i < JOINT_COUNT; i++) this.q(i).copy(o.q(i));
    this.hips.copy(o.hips);
    return this;
  }

  /** this = a·(1-t) + b·t, joint by joint. */
  blend(a: AnimPose, b: AnimPose, t: number): this {
    if (t <= 0) return this.copy(a);
    if (t >= 1) return this.copy(b);
    for (let i = 0; i < JOINT_COUNT; i++) this.q(i).slerpQuaternions(a.q(i), b.q(i), t);
    this.hips.lerpVectors(a.hips, b.hips, t);
    return this;
  }

  /** Moves the given joints towards `o` by weight t. */
  blendJoints(o: AnimPose, joints: readonly number[], t: number): this {
    if (t <= 0) return this;
    for (const i of joints) this.q(i).slerp(o.q(i), Math.min(1, t));
    return this;
  }

  q(i: number): THREE.Quaternion {
    const q = this.rot[i];
    if (!q) throw new Error(`pose: no joint ${i}`);
    return q;
  }
}
