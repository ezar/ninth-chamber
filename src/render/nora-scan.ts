/**
 * Nora's scanned model (public/models/nora.glb, a Meshy scan rigged by
 * scripts/character/rig_nora.py). On the ground she plays motion clips
 * (public/anim/*.json, see src/render/anim/); in the other modes she follows
 * the procedural animation in nora.ts, whose rig keeps animating hidden and is
 * retargeted onto the scan's skeleton every frame.
 *
 * Both sources meet in the canonical space of anim/skeleton.ts: model-space
 * joint rotations relative to a rest pose with the limbs straight down. The
 * scan is bound in an A-pose (arms ~30° out, legs slightly apart), so each
 * limb gets a fixed correction that rotates its bind direction onto the rest
 * direction: bone rotation = canonical × correction × bind.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { NoraModel, type NoraPose, type RetargetJoint } from './nora';
import { NoraAnimator, type AirClips, type LocomotionClips, type PoseLayer } from './anim/animator';
import { Clip, type ClipFile } from './anim/clip';
import { AnimPose } from './anim/pose';
import {
  JOINTS,
  JOINT_COUNT,
  JOINT_INDEX,
  PARENT_INDEX,
  ScanSkeleton,
  UPPER_BODY,
  type BindJoint,
} from './anim/skeleton';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
/** Joints the procedural aiming layer drives (nora.ts AIM_JOINTS). */
const AIM_JOINTS: readonly RetargetJoint[] = [
  'spine',
  'chest',
  'shoulder_L',
  'upperArm_L',
  'lowerArm_L',
  'hand_L',
  'shoulder_R',
  'upperArm_R',
  'lowerArm_R',
  'hand_R',
];

/** Hands follow their forearm rigidly, in the bind pose's relation. */
const RIGID_HANDS = new Set([JOINT_INDEX.hand_L, JOINT_INDEX.hand_R]);

class ScannedSkin {
  readonly skeleton: ScanSkeleton;
  private readonly bones: THREE.Bone[] = [];
  /** Model-space rotation of the hips bone's parent. */
  private readonly rootParent = new THREE.Quaternion();
  private readonly target: THREE.Quaternion[] = Array.from(
    { length: JOINT_COUNT },
    () => new THREE.Quaternion(),
  );
  private readonly hipsBindLocal = new THREE.Vector3();
  private readonly hipsParentInv = new THREE.Matrix4();
  private readonly materials: THREE.Material[] = [];

  constructor(readonly scene: THREE.Object3D) {
    scene.updateMatrixWorld(true);
    const bones = new Map<string, THREE.Bone>();
    scene.traverse((o) => {
      if (o instanceof THREE.Bone) bones.set(o.name, o);
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        this.materials.push(...mats);
      }
    });
    const bind = {} as Record<RetargetJoint, BindJoint>;
    for (const name of JOINTS) {
      const bone = bones.get(name);
      if (!bone) throw new Error(`nora.glb has no bone '${name}'`);
      this.bones.push(bone);
      const pos = new THREE.Vector3();
      const rot = new THREE.Quaternion();
      bone.matrixWorld.decompose(pos, rot, _v);
      bind[name] = { pos, rot };
    }
    this.skeleton = new ScanSkeleton(bind);
    const hips = this.bones[0];
    if (hips?.parent) {
      hips.parent.matrixWorld.decompose(_v, this.rootParent, new THREE.Vector3());
      this.hipsParentInv.copy(hips.parent.matrixWorld).invert();
    }
    if (hips) this.hipsBindLocal.copy(hips.position);
  }

  apply(pose: AnimPose): void {
    const sk = this.skeleton;
    for (let i = 0; i < JOINT_COUNT; i++) {
      const bone = this.bones[i];
      const corr = sk.correction[i];
      const bind = sk.bind[i];
      const t = this.target[i];
      if (!bone || !corr || !bind || !t) continue;
      const p = PARENT_INDEX[i] ?? -1;
      const foreBind = sk.bind[p];
      const foreTarget = this.target[p];
      if (RIGID_HANDS.has(i) && foreBind && foreTarget) {
        // Hands keep the scan's relaxed wrist relative to the forearm: any
        // wrist flex reads as bent, cupped hands on this model.
        t.copy(foreTarget).multiply(_q.copy(foreBind.rot).invert()).multiply(bind.rot);
      } else t.copy(pose.q(i)).multiply(corr).multiply(bind.rot);
      const parent = p >= 0 ? this.target[p] : this.rootParent;
      bone.quaternion.copy(
        _q
          .copy(parent ?? this.rootParent)
          .invert()
          .multiply(t),
      );
    }
    const hips = this.bones[0];
    if (hips) {
      _v.subVectors(pose.hips, sk.hipsBind);
      const len = _v.length();
      _v.transformDirection(this.hipsParentInv).multiplyScalar(len);
      hips.position.copy(this.hipsBindLocal).add(_v);
    }
  }

  /** The scan's bone for a retargeted joint. */
  bone(name: RetargetJoint): THREE.Bone | null {
    return this.bones[JOINT_INDEX[name]] ?? null;
  }

  setOpacity(a: number): void {
    for (const m of this.materials) {
      const transparent = a < 1;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = a;
    }
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = a > 0.5;
    });
  }
}

async function loadClip(url: string): Promise<Clip> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Clip((await res.json()) as ClipFile);
}

/**
 * Nora as the renderer sees her: the procedural model until the scan loads,
 * then the scan driven by motion clips and the procedural animation.
 */
export class NoraRig {
  private readonly driver = new NoraModel();
  private skin: ScannedSkin | null = null;
  private animator: NoraAnimator | null = null;
  private readonly procMap = new Map<RetargetJoint, THREE.Quaternion>();
  private readonly procOffset = new THREE.Vector3();
  private readonly procPose = new AnimPose();
  private readonly shown = new AnimPose();
  private readonly rootPos = new THREE.Vector3();
  private override: { weight: number; joints: readonly RetargetJoint[] } = { weight: 0, joints: UPPER_BODY };
  private readonly layers: PoseLayer[] = [];
  /** Smoothed weight of the procedural aiming layer. */
  private aimW = 0;

  get root(): THREE.Group {
    return this.driver.root;
  }

  /**
   * Upper-body hook for clip-driven modes (e.g. aiming while running): shows
   * the procedural rig's pose for `joints` (default: spine, head and arms)
   * over the clips with weight 0..1.
   */
  setProceduralOverride(weight: number, joints: readonly RetargetJoint[] = UPPER_BODY): void {
    this.override = { weight, joints };
    this.animator?.setProceduralOverride(weight, joints);
  }

  /** Adds a layer that edits the clip pose before the leg pass (e.g. aim offsets). */
  addLayer(layer: PoseLayer): void {
    this.layers.push(layer);
    this.animator?.layers.push(layer);
  }

  /**
   * Loads the scanned model and the ground clips from `clipDir`; keeps the
   * procedural model if the scan is missing, and the procedural animation if
   * the clips are.
   */
  async loadScan(url: string, clipDir: string): Promise<boolean> {
    try {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const [gltf, clips, air] = await Promise.all([
        loader.loadAsync(url),
        Promise.all([
          loadClip(`${clipDir}idle.json`),
          loadClip(`${clipDir}walk.json`),
          loadClip(`${clipDir}run.json`),
        ]).then(
          ([idle, walk, run]): LocomotionClips => ({ idle, walk, run }),
          (err: unknown) => {
            console.warn('Nora clips not loaded, using the procedural animation.', err);
            return null;
          },
        ),
        Promise.all([
          loadClip(`${clipDir}jump_start.json`),
          loadClip(`${clipDir}jump_loop.json`),
          loadClip(`${clipDir}jump_land.json`),
        ]).then(
          ([start, loop, land]): AirClips => ({ start, loop, land }),
          (err: unknown) => {
            console.warn('Nora jump clips not loaded, using the procedural jump.', err);
            return null;
          },
        ),
      ]);
      this.skin = new ScannedSkin(gltf.scene);
      if (clips) {
        const animator = new NoraAnimator(this.skin.skeleton, clips, air);
        animator.setProceduralOverride(this.override.weight, this.override.joints);
        animator.layers.push(...this.layers);
        this.animator = animator;
      }
      // Hide the procedural body first: setVisible walks the whole root.
      this.driver.setVisible(false);
      this.driver.root.add(gltf.scene);
      return true;
    } catch (err) {
      console.warn('Nora scan not loaded, using the procedural model.', err);
      return false;
    }
  }

  update(pose: NoraPose, dt: number): void {
    this.driver.update(pose, dt);
    const skin = this.skin;
    if (!skin) return;
    this.driver.modelPose(this.procMap, this.procOffset);
    JOINTS.forEach((j, i) => {
      const q = this.procMap.get(j);
      if (q) this.procPose.q(i).copy(q);
    });
    this.procPose.hips.copy(skin.skeleton.hipsBind).add(this.procOffset);
    if (this.animator) {
      // Pistols drawn: the procedural aiming layer (nora.ts) drives the torso and
      // arms over the clips while the legs keep running from them.
      const armed = pose.mode === 'ground' || pose.mode === 'air' ? pose.weapons : 0;
      this.aimW += (armed - this.aimW) * (1 - Math.exp(-Math.max(0, dt) * 14));
      if (this.aimW > 1e-3)
        this.animator.setProceduralOverride(Math.max(this.aimW, this.override.weight), AIM_JOINTS);
      else this.animator.setProceduralOverride(this.override.weight, this.override.joints);
      const root = this.driver.root;
      this.rootPos.copy(root.position);
      this.animator.update(pose, dt, this.procPose, this.rootPos, root.rotation.y, this.shown);
      skin.apply(this.shown);
    } else skin.apply(this.procPose);
  }

  setOpacity(a: number): void {
    if (this.skin) this.skin.setOpacity(a);
    else this.driver.setOpacity(a);
  }

  /**
   * World frame of a hand (0 = left, 1 = right) for things held in it: the
   * position of the visible wrist and the procedural hand's orientation
   * (fingers along -Y, palm facing -Z). Call after update().
   */
  handFrame(side: 0 | 1, pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const hand = this.driver.hand(side);
    hand.getWorldQuaternion(quat);
    const bone = this.skin?.bone(side === 0 ? 'hand_L' : 'hand_R');
    if (bone) {
      bone.updateWorldMatrix(true, false);
      pos.setFromMatrixPosition(bone.matrixWorld);
    } else {
      hand.getWorldPosition(pos);
    }
  }
}
