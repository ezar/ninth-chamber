/**
 * The torch Nora carries (owner's request): a wooden shaft wrapped in
 * pitch-soaked cloth, its fire (flame sprites, embers and smoke in the style
 * of the braziers in props.ts) and its own warm, flickering light. It reads
 * the simulation every frame and never writes to it.
 *
 * It sits in her visible left hand (NoraRig.gripFrame), raised by the
 * hold-torch arm layer in nora-scan.ts, or hangs on her left hip while
 * stowed, with a smaller flame.
 *
 * Budget (the owner's): one light, created once with its castShadow fixed
 * for the session (flipping it later disposes a shadow map WebGPU still
 * binds); on tiers without torch shadows the shadow fades out through
 * shadow.intensity and stops updating. 4 flames + 14 embers + 6 smoke puffs
 * (24 particles), and nothing allocated per frame. Nothing pops: the flame,
 * the light and the shadow fade in and out.
 */
import * as THREE from 'three/webgpu';
import { BLOCK } from '../sim/grid/units';
import { torchInHand } from '../sim/player/torch';
import type { World } from '../sim/world';
import type { NoraRig } from './nora-scan';
import type { QualityProfile } from './quality';
import { flameTexture } from './props';

/** Light: warm, short range, a little less than a brazier (FIRE_GAIN × look in scene.ts). */
const LIGHT_COLOR = '#ff9a4c';
const LIGHT_CANDELA = 26;
const LIGHT_RANGE = 12;
/** On her belt the flame is smaller and dimmer. */
const BELT_FLAME = 0.55;
/** Shadow cube map size (px): the tier that casts torch shadows (high) only. */
const SHADOW_SIZE = 256;
/** Fade rates (per second): the flame lighting or dying, and hand ↔ belt. */
const FLAME_RATE = 2.2;
const HOLD_RATE = 7;
const SHADOW_RATE = 2;

const FLAMES = 4;
const EMBERS = 14;
const SMOKE = 6;

/** From the grip (the model's origin) up the shaft to the base of the flame (m). */
const FIRE_AT = 0.43;

const UP = new THREE.Vector3(0, 1, 0);
const _grip = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _face = new THREE.Vector3();
const _left = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * The torch model: origin at the grip, +Y up the shaft. A charred wooden
 * shaft and a head of dark cloth bound with cord, its top glowing while lit.
 */
export function torchModel(): { group: THREE.Group; ember: THREE.MeshStandardMaterial } {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#5b3b20', roughness: 0.88, metalness: 0 });
  const cloth = new THREE.MeshStandardMaterial({ color: '#2b1f16', roughness: 0.96, metalness: 0 });
  const cord = new THREE.MeshStandardMaterial({ color: '#17100b', roughness: 0.9, metalness: 0 });
  const ember = new THREE.MeshStandardMaterial({
    color: '#1a0d06',
    roughness: 1,
    metalness: 0,
    emissive: '#ff5a1a',
    emissiveIntensity: 0,
  });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.022, 0.62, 8), wood);
  shaft.position.y = 0.05;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.03, 0.15, 10), cloth);
  head.position.y = 0.34;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.037, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), ember);
  top.position.y = 0.415;
  g.add(shaft, head, top);
  for (const y of [0.285, 0.34, 0.395]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.037, 0.005, 4, 14), cord);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  return { group: g, ember };
}

function smokeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.2)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

export class TorchView {
  readonly group = new THREE.Group();
  /** The torch's own light (never taken from the brazier pool). */
  readonly light: THREE.PointLight;
  private readonly model: THREE.Group;
  private readonly emberGlow: THREE.MeshStandardMaterial;
  private readonly flames: THREE.Sprite[] = [];
  private readonly embers: THREE.Points;
  private readonly emberPos: Float32Array;
  /** Per ember: age 0..1, speed and a fixed drift. */
  private readonly emberAge = new Float32Array(EMBERS);
  private readonly emberDrift = new Float32Array(EMBERS * 2);
  private readonly smoke: THREE.Sprite[] = [];
  private readonly smokeAge = new Float32Array(SMOKE);
  /** Where the fire burns now, and where it burned last frame (embers and smoke trail behind). */
  private readonly fire = new THREE.Vector3();
  /** Smoothed: flame 0..1 (lit), and 1 in her hand … 0 on her belt. */
  private flame = 0;
  private hand = 1;
  private shadowLevel = 0;
  private shadows = false;
  private particles = 1;
  private placed = false;

  constructor(castShadow: boolean) {
    const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_RANGE, 2);
    // Fixed for the session (see the header); tiers without torch shadows fade it via shadow.intensity.
    light.castShadow = castShadow;
    if (castShadow) {
      light.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
      light.shadow.bias = -0.004;
      light.shadow.normalBias = 0.05;
      light.shadow.camera.near = 0.15;
      light.shadow.intensity = 0;
      light.shadow.autoUpdate = false;
    }
    this.light = light;
    this.group.add(light);

    const { group, ember } = torchModel();
    this.model = group;
    this.emberGlow = ember;
    this.model.visible = false;
    this.group.add(this.model);

    const flameTex = flameTexture();
    for (let k = 0; k < FLAMES; k++) {
      const m = new THREE.SpriteMaterial({
        map: flameTex,
        color: k === 0 ? '#ffe0a8' : '#ff8a3a',
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
        fog: false,
      });
      const s = new THREE.Sprite(m);
      s.visible = false;
      this.flames.push(s);
      this.group.add(s);
    }

    this.emberPos = new Float32Array(EMBERS * 3);
    for (let i = 0; i < EMBERS; i++) {
      this.emberAge[i] = (i * 0.37) % 1;
      this.emberDrift[i * 2] = ((i * 17) % 11) / 11 - 0.5;
      this.emberDrift[i * 2 + 1] = ((i * 29) % 13) / 13 - 0.5;
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    this.embers = new THREE.Points(
      eg,
      new THREE.PointsMaterial({
        color: '#ffb060',
        size: 0.03,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.embers.frustumCulled = false;
    this.embers.visible = false;
    this.group.add(this.embers);

    const smokeTex = smokeTexture();
    for (let i = 0; i < SMOKE; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: smokeTex,
          color: '#3a3430',
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      s.visible = false;
      this.smokeAge[i] = i / SMOKE;
      this.smoke.push(s);
      this.group.add(s);
    }
  }

  /** Quality tier: torch shadows on 'high' only (if the light was built casting), and the particle share. */
  setQuality(profile: QualityProfile): void {
    this.shadows = this.light.castShadow && profile.tier === 'high';
    this.particles = profile.particles;
  }

  update(world: World, nora: NoraRig, time: number, dt: number): void {
    const p = world.state.player;
    const t = p.torch;
    const inHand = torchInHand(p);
    this.hand = approach(this.hand, inHand ? 1 : 0, HOLD_RATE * dt);
    this.flame = approach(this.flame, t.has && t.lit ? 1 : 0, FLAME_RATE * dt);

    // Where the torch is: her left hand, her left hip, or (a lit one) on the floor.
    let shown = t.has && this.placeOnNora(nora);
    this.model.visible = shown && nora.opacity > 0.2;
    if (!t.has) shown = this.placeOnFloor(world);
    if (!shown) this.flame = 0;

    const size = this.flame * (BELT_FLAME + (1 - BELT_FLAME) * this.hand);
    this.emberGlow.emissiveIntensity = 2.5 * this.flame;
    this.updateFlames(size, time);
    this.updateEmbers(size, dt);
    this.updateSmoke(size, dt);
    this.updateLight(size, time, dt);
    this.placed = shown;
  }

  /** Places the model in her hand or on her hip; false while she has no body to hold it. */
  private placeOnNora(nora: NoraRig): boolean {
    const face = nora.facing(_face);
    _left.set(face.z, 0, -face.x);
    // gripFrame gives the visible palm; without the scan, the procedural hand.
    if (!nora.gripFrame(0, _grip, _dir)) nora.handFrame(0, _grip, _q);
    // In her hand: up, leaning a little ahead and out to her left, clear of her face.
    _axis.copy(UP).addScaledVector(face, 0.22).addScaledVector(_left, 0.18).normalize();
    const hx = _grip.x;
    const hy = _grip.y;
    const hz = _grip.z;
    // On her belt: at the left hip, the head up and back, clear of her arm.
    if (!nora.jointPosition('thigh_L', _tip)) _tip.copy(nora.root.position).setY(nora.root.position.y + 0.95);
    _tip.addScaledVector(_left, 0.15).addScaledVector(face, -0.04).addScaledVector(UP, 0.06);
    _dir.copy(UP).addScaledVector(face, -0.55).addScaledVector(_left, 0.3).normalize();
    const k = this.hand;
    this.model.position.set(
      _tip.x + (hx - _tip.x) * k,
      _tip.y + (hy - _tip.y) * k,
      _tip.z + (hz - _tip.z) * k,
    );
    _axis.lerp(_dir, 1 - k).normalize();
    this.model.quaternion.setFromUnitVectors(UP, _axis);
    this.fire.copy(this.model.position).addScaledVector(_axis, FIRE_AT);
    return true;
  }

  /** A lit torch lying where the level placed it burns there until picked up. */
  private placeOnFloor(world: World): boolean {
    for (const a of world.state.actors) {
      if (a.kind !== 'torch' || a.taken || a.variant !== 'lit') continue;
      const x = a.cx * BLOCK + BLOCK / 2;
      const z = a.cz * BLOCK + BLOCK / 2;
      // The head of the torch lying in props.ts (along +X, raised on its binding).
      this.fire.set(x + 0.3, world.level.floorAt(x, z) + 0.1, z);
      this.flame = Math.max(this.flame, 0.6);
      return true;
    }
    return false;
  }

  private updateFlames(size: number, time: number): void {
    const on = size > 0.01;
    for (let k = 0; k < FLAMES; k++) {
      const s = this.flames[k];
      if (!s) continue;
      s.visible = on;
      if (!on) continue;
      const ph = k * 2.1;
      const n = Math.sin(time * 11 + ph) * 0.5 + Math.sin(time * 17.3 + ph * 2) * 0.3;
      const scale = (k === 0 ? 0.26 : 0.34 - k * 0.04) * size;
      s.position.set(
        this.fire.x + ((k % 2) - 0.5) * 0.03 * size + Math.sin(time * 4 + ph) * 0.012,
        this.fire.y + (0.06 + k * 0.02 + n * 0.02) * size,
        this.fire.z + ((k * 7) % 3) * 0.01 - 0.01,
      );
      s.scale.set(scale * (0.6 + n * 0.08), scale * (1 + n * 0.2), 1);
      s.material.opacity = (0.85 + n * 0.15) * Math.min(1, size * 1.5);
    }
  }

  private updateEmbers(size: number, dt: number): void {
    const count = Math.max(0, Math.round(EMBERS * this.particles * Math.min(1, size * 1.4)));
    this.embers.visible = count > 0;
    if (!this.embers.visible) return;
    this.embers.geometry.setDrawRange(0, count);
    const pos = this.emberPos;
    for (let i = 0; i < count; i++) {
      let age = (this.emberAge[i] ?? 0) + dt * (0.55 + (i % 5) * 0.09);
      const i3 = i * 3;
      if (age >= 1 || !this.placed) {
        // Reborn at the flame: from here on it drifts in the air, so it trails behind a moving torch.
        age %= 1;
        pos[i3] = this.fire.x;
        pos[i3 + 1] = this.fire.y + 0.05;
        pos[i3 + 2] = this.fire.z;
      }
      this.emberAge[i] = age;
      pos[i3] = (pos[i3] ?? 0) + (this.emberDrift[i * 2] ?? 0) * 0.35 * dt;
      pos[i3 + 1] = (pos[i3 + 1] ?? 0) + (0.7 + (i % 3) * 0.2) * dt;
      pos[i3 + 2] = (pos[i3 + 2] ?? 0) + (this.emberDrift[i * 2 + 1] ?? 0) * 0.35 * dt;
    }
    (this.embers.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateSmoke(size: number, dt: number): void {
    const count = Math.round(SMOKE * Math.max(0.5, this.particles));
    for (let i = 0; i < SMOKE; i++) {
      const s = this.smoke[i];
      if (!s) continue;
      const active = i < count && size > 0.01;
      s.visible = active;
      if (!active) continue;
      let age = (this.smokeAge[i] ?? 0) + dt * 0.45;
      if (age >= 1 || !this.placed) {
        age %= 1;
        s.position.copy(this.fire).y += 0.2;
      }
      this.smokeAge[i] = age;
      s.position.y += dt * 0.55;
      const r = (0.12 + age * 0.45) * size;
      s.scale.set(r, r, 1);
      // In from nothing, out to nothing: a thin dark wisp over the flame.
      s.material.opacity = 0.32 * size * Math.sin(Math.PI * age);
    }
  }

  private updateLight(size: number, time: number, dt: number): void {
    const l = this.light;
    const flick =
      0.82 + 0.1 * Math.sin(time * 13.1) * Math.sin(time * 7.7 + 1.3) + 0.08 * Math.sin(time * 23.3 + 0.4);
    l.intensity = LIGHT_CANDELA * size * flick;
    // A hair above and ahead of the flame, so the shaft never shadows its own light.
    l.position.copy(this.fire).y += 0.12;
    if (!l.castShadow) return;
    this.shadowLevel = approach(this.shadowLevel, this.shadows && l.intensity > 0 ? 1 : 0, SHADOW_RATE * dt);
    l.shadow.intensity = this.shadowLevel;
    l.shadow.autoUpdate = this.shadowLevel > 0 && l.intensity > 0;
  }
}
