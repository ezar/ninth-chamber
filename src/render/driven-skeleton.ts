/**
 * Drives a skinned model (a Meshy guardian, docs/art/meshy-prompts.md) from a
 * procedural joint hierarchy: the hidden "driver" groups a stand-in view
 * already animates (Tamrit's legs, arms, torso and head in clay.ts).
 *
 * The drivers rest with no rotation, facing -Z; the model's bones rest in
 * whatever orientation the rigger gave them. So each driver's rotation is
 * taken in the model's own frame and laid on top of its bones' rest pose:
 * a bone's new rotation (relative to the model) is the driver's rotation
 * times the bone's rest rotation, and its local rotation follows from its
 * parent's. Bones with no driver of their own (spine segments, hands, feet)
 * follow the nearest driven bone above them.
 *
 * Riggers leave the arms out in an A or T pose while the drivers' arms hang:
 * a `hang` entry turns a bone (and everything below it) at rest so that it
 * points along a given direction, before any driver moves it.
 */
import * as THREE from 'three/webgpu';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ktx2 } from './ktx2';

interface DrivenBone {
  bone: THREE.Bone;
  /** The driver whose rotation the bone takes, or null to follow its parent's. */
  driver: THREE.Object3D | null;
  /** The parent bone's entry, or null for a root bone. */
  parent: DrivenBone | null;
  /** Rest rotation relative to the model. */
  rest: THREE.Quaternion;
  /** For root bones: the (fixed) rotation of what holds them, relative to the model. */
  holder: THREE.Quaternion;
  /** This frame: the driver rotation in use, and the bone's new rotation relative to the model. */
  drive: THREE.Quaternion;
  world: THREE.Quaternion;
}

/** Turns `bone` at rest so the line from it to `toward` points along `dir` (model frame: +Z forward, +X left). */
export interface HangRest {
  bone: string;
  toward: string;
  dir: THREE.Vector3;
}

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class DrivenSkeleton {
  private readonly bones: DrivenBone[] = [];
  private readonly frame = new THREE.Quaternion();
  private readonly frameInv = new THREE.Quaternion();

  /**
   * @param model the skinned model, already scaled and turned to face -Z under `body`
   * @param body the procedural view's body group the drivers hang from
   * @param drivers bone name → driver group (a missing bone is skipped)
   * @param hang rest corrections, one per limb (a missing bone is skipped)
   */
  constructor(
    model: THREE.Object3D,
    private readonly body: THREE.Object3D,
    drivers: Record<string, THREE.Object3D>,
    hang: readonly HangRest[] = [],
  ) {
    model.updateMatrixWorld(true);
    const modelInv = model.getWorldQuaternion(new THREE.Quaternion()).invert();
    // The model's frame as seen from the body (its turn to face -Z).
    this.frame.copy(model.quaternion);
    this.frameInv.copy(this.frame).invert();
    const entries = new Map<THREE.Bone, DrivenBone>();
    model.traverse((o) => {
      if (!(o instanceof THREE.Bone)) return;
      const parent = o.parent instanceof THREE.Bone ? (entries.get(o.parent) ?? null) : null;
      const rest = modelInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
      const holder = o.parent
        ? modelInv.clone().multiply(o.parent.getWorldQuaternion(new THREE.Quaternion()))
        : new THREE.Quaternion();
      const entry: DrivenBone = {
        bone: o,
        driver: drivers[o.name] ?? null,
        parent,
        rest,
        holder,
        drive: new THREE.Quaternion(),
        world: new THREE.Quaternion(),
      };
      entries.set(o, entry);
      this.bones.push(entry);
    });
    for (const h of hang) this.hang(model, h);
  }

  private hang(model: THREE.Object3D, h: HangRest): void {
    const top = this.bones.find((b) => b.bone.name === h.bone);
    const end = this.bones.find((b) => b.bone.name === h.toward);
    if (!top || !end) return;
    // Read off the bind pose (hangs on separate limbs do not move each other's bones).
    model.worldToLocal(top.bone.getWorldPosition(_a));
    model.worldToLocal(end.bone.getWorldPosition(_b));
    const turn = new THREE.Quaternion().setFromUnitVectors(
      _b.sub(_a).normalize(),
      _a.copy(h.dir).normalize(),
    );
    // The bone and its descendants (entries list parents before children).
    const turned = new Set<DrivenBone>([top]);
    for (const b of this.bones) {
      if (b !== top && !(b.parent && turned.has(b.parent))) continue;
      turned.add(b);
      b.rest.premultiply(turn);
    }
  }

  /** Whether every named driver found its bone. */
  static missing(model: THREE.Object3D, names: readonly string[]): string[] {
    const found = new Set<string>();
    model.traverse((o) => {
      if (o instanceof THREE.Bone) found.add(o.name);
    });
    return names.filter((n) => !found.has(n));
  }

  /** Poses the bones from the drivers' current rotations (call after animating them). */
  apply(): void {
    for (const b of this.bones) {
      if (b.driver) {
        // The driver's rotation relative to the body (its parents' rotations only: the body
        // may squash, and a scaled matrix would skew it), then in the model's frame.
        b.drive.identity();
        for (let o: THREE.Object3D | null = b.driver; o && o !== this.body; o = o.parent)
          b.drive.premultiply(o.quaternion);
        b.drive.premultiply(this.frameInv).multiply(this.frame);
      } else if (b.parent) b.drive.copy(b.parent.drive);
      else b.drive.identity();
      b.world.copy(b.drive).multiply(b.rest);
      const parentWorld = b.parent ? b.parent.world : b.holder;
      b.bone.quaternion.copy(_q.copy(parentWorld).invert().multiply(b.world));
    }
  }
}

export interface SkinnedAsset {
  scene: THREE.Object3D;
  /** Height of the model as loaded (m). */
  height: number;
}

/** Loads a skinned model (meshopt geometry, KTX2 textures); null when missing or unusable. */
export async function loadSkinnedAsset(url: string): Promise<SkinnedAsset | null> {
  try {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const k = ktx2();
    if (k) loader.setKTX2Loader(k);
    const gltf = await loader.loadAsync(url);
    let skinned = false;
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) skinned = true;
    });
    if (!skinned) throw new Error(`${url} has no skinned mesh`);
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    return { scene: gltf.scene, height: box.max.y - box.min.y };
  } catch (err) {
    console.info(`No skinned model at ${url}; using the stand-in.`, err);
    return null;
  }
}

/** A fresh copy of a skinned asset, casting and receiving shadows (geometry and materials stay shared). */
export function cloneSkinned(asset: SkinnedAsset): THREE.Object3D {
  const model = SkeletonUtils.clone(asset.scene);
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  return model;
}
