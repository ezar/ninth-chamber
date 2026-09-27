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
import { CLIP_NAMES, NoraAnimator, type ClipLibrary, type ClipName, type PoseLayer } from './anim/animator';
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
  /**
   * Where each visible palm is, in its hand bone's frame: the centroid of the
   * vertices the hand bone mostly moves. The scan's hand joints sit well off
   * the palms (about 13 cm at the wrist's edge), so things held are placed
   * here rather than at the joint.
   */
  private readonly palms: ({ mesh: THREE.SkinnedMesh; bone: THREE.Bone; local: THREE.Vector3 } | null)[] = [
    null,
    null,
  ];

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
        // The scan's material is double-sided; animated, the inside of the shirt's
        // front showed through the back of the jacket as white patches. The scan
        // is a closed surface, so its front faces are all that should render.
        for (const m of mats) m.side = THREE.FrontSide;
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
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) meshes.push(o);
    });
    (['hand_L', 'hand_R'] as const).forEach((name, side) => {
      this.palms[side] = palmAnchor(meshes, name);
    });
  }

  /** World position of a visible palm (0 left, 1 right); false if the scan has no weights for it. */
  palm(side: 0 | 1, out: THREE.Vector3): boolean {
    const a = this.palms[side];
    if (!a) return false;
    a.bone.updateWorldMatrix(true, false);
    a.mesh.updateWorldMatrix(true, false);
    // As the skinning shader does: mesh × bindInverse × bone × (boneInverse × bind × v).
    out.copy(a.local).applyMatrix4(a.bone.matrixWorld).applyMatrix4(a.mesh.bindMatrixInverse);
    out.applyMatrix4(a.mesh.matrixWorld);
    return true;
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

/** The centroid, in the bone's bind frame, of the vertices a bone moves with weight over one half. */
function palmAnchor(
  meshes: readonly THREE.SkinnedMesh[],
  boneName: string,
): { mesh: THREE.SkinnedMesh; bone: THREE.Bone; local: THREE.Vector3 } | null {
  let best: { mesh: THREE.SkinnedMesh; bone: THREE.Bone; local: THREE.Vector3; n: number } | null = null;
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones;
    const bi = bones.findIndex((b) => b.name === boneName);
    const bone = bones[bi];
    const inverse = mesh.skeleton.boneInverses[bi];
    const index = mesh.geometry.getAttribute('skinIndex');
    const weight = mesh.geometry.getAttribute('skinWeight');
    const position = mesh.geometry.getAttribute('position');
    if (!bone || !inverse || !index || !weight || !position) continue;
    const sum = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < position.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (index.getComponent(i, k) === bi) w += weight.getComponent(i, k);
      if (w <= 0.5) continue;
      sum.add(v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(inverse));
      n++;
    }
    if (n > (best?.n ?? 0)) best = { mesh, bone, local: sum.divideScalar(n), n };
  }
  return best && { mesh: best.mesh, bone: best.bone, local: best.local };
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
/**
 * Low ready with the pistols drawn: over the clip's arms, the upper arms lift
 * a little and the elbows bend so the forearms, and the pistols along them,
 * point ahead and about 20° down, muzzles slightly toed in. Rotations are
 * pre-multiplied in model space (rest: facing -Z, arms down, left at -X), so
 * the clip's arm swing survives underneath.
 */
const READY_SHOULDER = 0.22;
const READY_ELBOW = 0.9;
const READY_TOE_IN = 0.14;
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
function lowReady(p: AnimPose, wl: number, wr: number): void {
  for (const [s, sign, w] of [
    ['L', -1, wl],
    ['R', 1, wr],
  ] as const) {
    if (w <= 1e-3) continue;
    _qa.setFromAxisAngle(_axisX, READY_SHOULDER * w);
    p.q(JOINT_INDEX[`upperArm_${s}`]).premultiply(_qa);
    // Toe-in turns the left forearm towards +X and the right one towards -X.
    _qb.setFromAxisAngle(_axisY, sign * READY_TOE_IN * w);
    _qa.setFromAxisAngle(_axisX, (READY_SHOULDER + READY_ELBOW) * w).premultiply(_qb);
    p.q(JOINT_INDEX[`lowerArm_${s}`]).premultiply(_qa);
    p.q(JOINT_INDEX[`hand_${s}`]).premultiply(_qa);
  }
}

/**
 * Holding the torch in the left hand: the upper arm raised forward about 30°
 * and a little out, the elbow bent so the torch stands up ahead of her
 * shoulder, lighting the way without covering her face. Like lowReady, the
 * rotations are pre-multiplied in model space, only for the left arm; most of
 * the clip's arm swing is taken out first so the flame rides steadily over
 * the walk and run clips.
 */
const HOLD_LIFT = 0.52;
const HOLD_OUT = 0.22;
const HOLD_ELBOW = 1.3;
/** Share of the clip's own left-arm motion removed while holding the torch. */
const HOLD_STEADY = 0.75;
const _axisZ = new THREE.Vector3(0, 0, 1);
const _rest = new THREE.Quaternion();
function holdTorch(p: AnimPose, w: number): void {
  // Out to her left: the left arm hangs at -X, so a negative turn about Z.
  _qb.setFromAxisAngle(_axisZ, -HOLD_OUT * w);
  const upper = p.q(JOINT_INDEX.upperArm_L).slerp(_rest, HOLD_STEADY * w);
  _qa.setFromAxisAngle(_axisX, HOLD_LIFT * w).premultiply(_qb);
  upper.premultiply(_qa);
  _qa.setFromAxisAngle(_axisX, (HOLD_LIFT + HOLD_ELBOW) * w).premultiply(_qb);
  p.q(JOINT_INDEX.lowerArm_L)
    .slerp(_rest, HOLD_STEADY * w)
    .premultiply(_qa);
  p.q(JOINT_INDEX.hand_L)
    .slerp(_rest, HOLD_STEADY * w)
    .premultiply(_qa);
}

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
      const [gltf, loaded] = await Promise.all([
        loader.loadAsync(url),
        // Each clip is optional: a mode whose clip is missing stays procedural.
        Promise.all(
          CLIP_NAMES.map((name) =>
            loadClip(`${clipDir}${name}.json`).then(
              (clip): [ClipName, Clip] => [name, clip],
              (err: unknown): null => {
                console.warn(`Nora clip '${name}' not loaded.`, err);
                return null;
              },
            ),
          ),
        ),
      ]);
      const clips: ClipLibrary = {};
      for (const entry of loaded) if (entry) clips[entry[0]] = entry[1];
      this.skin = new ScannedSkin(gltf.scene);
      const { idle, walk, run } = clips;
      if (idle && walk && run) {
        const animator = new NoraAnimator(this.skin.skeleton, { ...clips, idle, walk, run });
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
      // Aiming (a locked target or a recent shot): the procedural aiming layer
      // (nora.ts) drives the torso and arms over the clips while the legs keep
      // running from them. Holding the pistols without a target, the clips keep
      // the arms and a low-ready layer bends the elbows so the pistols point
      // ahead and down instead of hanging.
      const upright = pose.mode === 'ground' || pose.mode === 'air';
      const armed = upright ? pose.weapons * pose.aiming : 0;
      const ready = upright ? pose.weapons * (1 - pose.aiming) : 0;
      this.readyW += (ready - this.readyW) * (1 - Math.exp(-Math.max(0, dt) * 10));
      this.torchW += (pose.torch - this.torchW) * (1 - Math.exp(-Math.max(0, dt) * 9));
      this.aimW += (armed - this.aimW) * (1 - Math.exp(-Math.max(0, dt) * 14));
      if (this.aimW > 1e-3)
        this.animator.setProceduralOverride(Math.max(this.aimW, this.override.weight), AIM_JOINTS);
      else this.animator.setProceduralOverride(this.override.weight, this.override.joints);
      const root = this.driver.root;
      this.rootPos.copy(root.position);
      this.animator.update(pose, dt, this.procPose, this.rootPos, root.rotation.y, this.shown);
      // With the torch in her left hand only the right arm holds a pistol at low ready.
      if (this.readyW > 1e-3) lowReady(this.shown, this.readyW * (1 - this.torchW), this.readyW);
      if (this.torchW > 1e-3) holdTorch(this.shown, this.torchW);
      skin.apply(this.shown);
    } else skin.apply(this.procPose);
  }

  /** Weight of the low-ready arms layer (pistols drawn, no target). */
  private readyW = 0;
  /** Weight of the hold-torch left-arm layer. */
  private torchW = 0;

  /** Last opacity set (the camera fades her when it closes in), for things she holds. */
  opacity = 1;

  setOpacity(a: number): void {
    this.opacity = a;
    if (this.skin) this.skin.setOpacity(a);
    else this.driver.setOpacity(a);
  }

  /**
   * World frame of a hand (0 = left, 1 = right) for things held in it: the
   * position of the visible wrist and the procedural hand's orientation
   * (fingers along -Y, palm facing -Z). Call after update().
   */
  /**
   * Frame for something gripped in a visible hand (0 = left, 1 = right): the
   * palm position and the direction the forearm points (hands stay rigid
   * with the forearm, so a held pistol's barrel follows it). False until the
   * scanned model has loaded.
   */
  gripFrame(side: 0 | 1, pos: THREE.Vector3, dir: THREE.Vector3): boolean {
    const hand = this.skin?.bone(side === 0 ? 'hand_L' : 'hand_R');
    const fore = this.skin?.bone(side === 0 ? 'lowerArm_L' : 'lowerArm_R');
    if (!hand || !fore) return false;
    hand.updateWorldMatrix(true, false);
    pos.setFromMatrixPosition(hand.matrixWorld);
    dir.setFromMatrixPosition(fore.matrixWorld);
    dir.subVectors(pos, dir).normalize();
    this.skin?.palm(side, pos);
    return true;
  }

  /** World position of a joint of the visible (scanned) body; false until it has loaded. */
  jointPosition(name: RetargetJoint, out: THREE.Vector3): boolean {
    const bone = this.skin?.bone(name);
    if (!bone) return false;
    bone.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(bone.matrixWorld);
    return true;
  }

  /** The horizontal direction she faces. */
  facing(out: THREE.Vector3): THREE.Vector3 {
    const yaw = this.driver.root.rotation.y;
    return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

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
