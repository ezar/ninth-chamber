/**
 * Nora's scanned model (public/models/nora.glb, a Meshy scan rigged by
 * scripts/character/rig_nora.py) driven by the procedural animation in
 * nora.ts. The procedural rig keeps animating hidden; every frame its joint
 * rotations are retargeted onto the scan's skeleton.
 *
 * The scan is bound in an A-pose (arms ~30° out, legs slightly apart) while
 * the procedural rig's bind pose has limbs straight down, so each limb gets a
 * fixed correction that rotates its bind direction onto the procedural one.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { NoraModel, type NoraPose, type RetargetJoint } from './nora';

interface Target {
  bone: THREE.Bone;
  /** Bind rotation in model space. */
  bind: THREE.Quaternion;
  /** Rotates the bind direction onto the procedural rig's rest direction. */
  correction: THREE.Quaternion;
  parent: RetargetJoint | null;
  /** Model-space rotation of the bone's parent when it is not a retargeted joint. */
  staticParent: THREE.Quaternion;
}

/** Limbs whose bind direction differs between the rigs, with the joint that marks their far end. */
const LIMBS: Partial<Record<RetargetJoint, RetargetJoint>> = {
  upperArm_L: 'lowerArm_L',
  lowerArm_L: 'hand_L',
  upperArm_R: 'lowerArm_R',
  lowerArm_R: 'hand_R',
  thigh_L: 'shin_L',
  shin_L: 'foot_L',
  thigh_R: 'shin_R',
  shin_R: 'foot_R',
};

const ORDER: RetargetJoint[] = [
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

const PARENT: Partial<Record<RetargetJoint, RetargetJoint>> = {
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

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

class ScannedSkin {
  private readonly targets = new Map<RetargetJoint, Target>();
  private readonly pose = new Map<RetargetJoint, THREE.Quaternion>();
  private readonly world = new Map<RetargetJoint, THREE.Quaternion>();
  private readonly hipsOffset = new THREE.Vector3();
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
    const modelRot = (o: THREE.Object3D): THREE.Quaternion => {
      const q = new THREE.Quaternion();
      o.matrixWorld.decompose(_v, q, new THREE.Vector3());
      return q;
    };
    const modelPos = (o: THREE.Object3D): THREE.Vector3 =>
      new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

    for (const name of ORDER) {
      const bone = bones.get(name);
      if (!bone) throw new Error(`nora.glb has no bone '${name}'`);
      const bind = modelRot(bone);
      const correction = new THREE.Quaternion();
      const end = LIMBS[name];
      if (end) {
        const endBone = bones.get(end);
        if (endBone) {
          const dir = modelPos(endBone).sub(modelPos(bone)).normalize();
          correction.setFromUnitVectors(dir, DOWN);
        }
      }
      this.targets.set(name, {
        bone,
        bind,
        correction,
        parent: PARENT[name] ?? null,
        staticParent: bone.parent ? modelRot(bone.parent) : new THREE.Quaternion(),
      });
    }
    // Hands follow their forearm's correction so they stay in line with it.
    for (const s of ['L', 'R'] as const) {
      const hand = this.targets.get(`hand_${s}`);
      const fore = this.targets.get(`lowerArm_${s}`);
      if (hand && fore) hand.correction.copy(fore.correction);
    }
    const hips = this.targets.get('hips');
    if (hips) {
      this.hipsBindLocal.copy(hips.bone.position);
      if (hips.bone.parent) this.hipsParentInv.copy(hips.bone.parent.matrixWorld).invert();
    }
  }

  apply(driver: NoraModel): void {
    driver.modelPose(this.pose, this.hipsOffset);
    for (const name of ORDER) {
      const t = this.targets.get(name);
      const w = this.pose.get(name);
      if (!t || !w) continue;
      // Target model-space rotation: procedural delta × rest correction × bind.
      const target = (this.world.get(name) ??
        this.world.set(name, new THREE.Quaternion()).get(name)) as THREE.Quaternion;
      target.copy(w).multiply(t.correction).multiply(t.bind);
      const parent = t.parent ? this.world.get(t.parent) : t.staticParent;
      t.bone.quaternion.copy(
        _q
          .copy(parent ?? t.staticParent)
          .invert()
          .multiply(target),
      );
    }
    const hips = this.targets.get('hips');
    if (hips) {
      _v.copy(this.hipsOffset)
        .transformDirection(this.hipsParentInv)
        .multiplyScalar(this.hipsOffset.length());
      hips.bone.position.copy(this.hipsBindLocal).add(_v);
    }
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

/**
 * Nora as the renderer sees her: the procedural model until the scan loads,
 * then the scan driven by the procedural animation.
 */
export class NoraRig {
  private readonly driver = new NoraModel();
  private skin: ScannedSkin | null = null;

  get root(): THREE.Group {
    return this.driver.root;
  }

  /** Loads the scanned model; keeps the procedural one if it is missing. */
  async loadScan(url: string): Promise<boolean> {
    try {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(url);
      this.skin = new ScannedSkin(gltf.scene);
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
    this.skin?.apply(this.driver);
  }

  setOpacity(a: number): void {
    if (this.skin) this.skin.setOpacity(a);
    else this.driver.setOpacity(a);
  }
}
