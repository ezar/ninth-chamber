/**
 * Visuals for the Temple of the Sun's mechanisms and traps (spec §8, §11):
 * stone platforms with bronze fittings, mirror drums with polished bronze
 * discs, sun beams with dust motes and a hot spot where they land, sun discs
 * that flare and glow when lit, the bronze ray and its sun-shaped slot,
 * trapdoor leaves, the rolling boulder and its dust, pendulum blades with a
 * motion smear, fire grates that breathe embers before they burst, and the
 * openings the sun comes through; plus the gilded friezes and painted
 * reliefs rooms ask for in their look (`trim`). Everything reads the
 * simulation and never writes it.
 *
 * Budget (the renderer's performance comes first): static parts are merged
 * into one mesh per material, beams and flames draw from fixed pools built
 * once (nothing is created or disposed while playing), every per-frame
 * update reuses scratch objects, and the few lights the temple adds come
 * from a fixed pool of three that fade between the nearest sources (beam
 * hot spots and burning grates) without ever changing their shadow setup.
 * The mobile tier drops the beams' outer glow, the blade smears and the
 * boulder's dust.
 */
import * as THREE from 'three/webgpu';
import { color, float, normalView, positionViewDirection, uniform } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeStatic } from './merge';
import { PuffPool } from './puffs';
import { sectorTop, type Level } from '../sim/grid/level';
import { BLOCK, DIRS, DIR_VEC, type Dir } from '../sim/grid/units';
import { defsOf, type BladeDef, type FireDef, type MechanismDefs } from '../sim/mechanisms/defs';
import { bladeAngle, bladeAngularSpeed, firePhase } from '../sim/mechanisms/traps';
import type { BladeState, FireState } from '../sim/mechanisms/types';
import { devices, traps } from '../sim/player/tuning';
import type { World } from '../sim/world';
import { lookFile } from './looks';
import { surfaceParams } from './materials';
import type { PropMaterials } from './props';
import type { QualityProfile } from './quality';

const center = (c: number): number => c * BLOCK + BLOCK / 2;
const TAU = Math.PI * 2;
const SUN = new THREE.Color('#ffd89a');
const UP = new THREE.Vector3(0, 1, 0);
/** Shared shimmer of every beam's light (one uniform for the level). */
const BEAM_PULSE = uniform(1);

/** Yaw that turns a model facing +Z towards (x, z). */
const yawOf = (x: number, z: number): number => Math.atan2(x, z);
/** Mirror face normals by facing index (NE, SE, SW, NW). */
const MIRROR_NORMALS: readonly [number, number][] = [
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** Most points a beam polyline can have (source, reflections, end). */
const MAX_POINTS = 8;
/** Dust motes drifting in each beam. */
const BEAM_DUST = 110;
/** Flame cards per fire-grate cell. */
const FLAMES_PER_CELL = 2;
/** Lights the temple adds, shared by beam hot spots and burning grates. */
const LIGHT_POOL = 3;
/** Beyond this distance (m) a source gets no pooled light and its effects stop updating. */
const NEAR = 34;
/** Boulder dust particles. */
const BOULDER_DUST = 64;

// Scratch objects: per-frame code never allocates.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();

/** Deterministic 0..1 hash for dressing. */
function hash(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

// ───────────────────────────────── Textures ─────────────────────────────────

function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round glow for hot spots, flares and halos. */
function glowTexture(): THREE.Texture {
  return canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,240,200,0.85)');
    r.addColorStop(0.45, 'rgba(255,190,110,0.25)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
}

/** A tongue of flame, bright at its root. */
function flameTexture(): THREE.Texture {
  return canvasTexture(64, 128, (g) => {
    const grad = g.createRadialGradient(32, 108, 2, 32, 84, 70);
    grad.addColorStop(0, 'rgba(255,248,220,1)');
    grad.addColorStop(0.22, 'rgba(255,190,80,0.95)');
    grad.addColorStop(0.55, 'rgba(230,90,20,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(32, 0);
    g.bezierCurveTo(60, 50, 62, 124, 32, 126);
    g.bezierCurveTo(2, 124, 4, 50, 32, 0);
    g.fill();
  });
}

/** A bronze floor grate over glowing coals (the glow is the material's emissive). */
function grateTexture(): THREE.Texture {
  const t = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#120804';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#7a5a34';
    for (let i = 0; i < 8; i++) {
      g.fillRect(i * 16, 0, 5, 128);
      g.fillRect(0, i * 16 + 8, 128, 4);
    }
    g.strokeStyle = '#3a2716';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 122, 122);
  });
  return t;
}

/** Emissive mask of a grate: the gaps glow, the bars stay dark. */
function grateGlowTexture(): THREE.Texture {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#000000';
    for (let i = 0; i < 8; i++) {
      g.fillRect(i * 16, 0, 5, 128);
      g.fillRect(0, i * 16 + 8, 128, 4);
    }
    g.fillRect(0, 0, 128, 8);
    g.fillRect(0, 120, 128, 8);
    g.fillRect(0, 0, 8, 128);
    g.fillRect(120, 0, 8, 128);
  });
}

/**
 * A painted relief panel (Qarrum's temple painters): a banded border, a sun
 * of eight rays with the place of a ninth, and processions of stylised
 * figures in ochre, lapis and cinnabar on limestone. Three variants.
 */
function reliefTexture(variant: number): THREE.Texture {
  return canvasTexture(256, 200, (g) => {
    const ochre = '#c98f3f';
    const lapis = '#2f4f7a';
    const red = '#9c3b26';
    const ink = '#3a2618';
    g.fillStyle = '#d8c39c';
    g.fillRect(0, 0, 256, 200);
    // Weathering.
    for (let i = 0; i < 400; i++) {
      const x = hash(i, variant, 3) * 256;
      const y = hash(i, variant, 5) * 200;
      g.fillStyle = `rgba(90,60,30,${0.04 + hash(i, variant, 7) * 0.08})`;
      g.fillRect(x, y, 2 + hash(i, 1, 9) * 6, 1 + hash(i, 2, 9) * 3);
    }
    // Border bands.
    g.fillStyle = lapis;
    g.fillRect(0, 0, 256, 10);
    g.fillRect(0, 190, 256, 10);
    g.fillStyle = ochre;
    for (let x = 0; x < 256; x += 16) {
      g.fillRect(x + 2, 12, 10, 6);
      g.fillRect(x + 2, 182, 10, 6);
    }
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.strokeRect(4, 20, 248, 160);
    if (variant === 0) {
      // The sun: eight rays and an empty ninth.
      const cx = 128;
      const cy = 100;
      g.fillStyle = ochre;
      for (let r = 0; r < 9; r++) {
        const a = -Math.PI / 2 + (r / 9) * TAU;
        g.save();
        g.translate(cx, cy);
        g.rotate(a);
        if (r === 0) {
          g.strokeStyle = ink;
          g.setLineDash([4, 4]);
          g.strokeRect(34, -5, 36, 10);
          g.setLineDash([]);
        } else {
          g.beginPath();
          g.moveTo(32, -8);
          g.lineTo(74, 0);
          g.lineTo(32, 8);
          g.closePath();
          g.fill();
        }
        g.restore();
      }
      g.fillStyle = '#e0a93f';
      g.beginPath();
      g.arc(cx, cy, 30, 0, TAU);
      g.fill();
      g.strokeStyle = red;
      g.lineWidth = 4;
      g.stroke();
      g.fillStyle = red;
      g.beginPath();
      g.arc(cx, cy, 8, 0, TAU);
      g.fill();
    } else {
      // A procession of bearers carrying discs towards the sun.
      for (let k = 0; k < 4; k++) {
        const x = 36 + k * 58 + (variant === 2 ? 20 : 0);
        const col = k % 2 === 0 ? red : lapis;
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, 62, 9, 0, TAU); // head
        g.fill();
        g.fillRect(x - 8, 72, 16, 42); // body
        g.fillRect(x - 12, 112, 8, 44); // legs
        g.fillRect(x + 4, 112, 8, 44);
        g.fillStyle = ochre;
        g.beginPath();
        g.arc(x + 16, 60, 12, 0, TAU); // carried disc
        g.fill();
        g.fillStyle = ink;
        g.fillRect(x + 2, 64, 14, 4); // arm
      }
      g.fillStyle = ink;
      for (let i = 0; i < 18; i++) g.fillRect(12 + i * 13, 164, 6, 10); // glyph band
    }
  });
}

/**
 * A sun-beam shaft material: bright where the cylinder faces the eye and
 * soft at its silhouette (so a mesh reads as a volume of light), additive,
 * scaled by the shared pulse.
 */
function beamMaterial(hex: string, strength: number, power: number): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const facing = normalView.dot(positionViewDirection).abs();
  m.colorNode = color(new THREE.Color(hex))
    .mul(facing.pow(power).mul(0.9).add(0.1))
    .mul(BEAM_PULSE)
    .mul(strength);
  m.opacityNode = float(1);
  return m;
}

// ─────────────────────────────────── View ───────────────────────────────────

interface BeamView {
  id: string;
  group: THREE.Group;
  cores: THREE.Mesh[];
  glows: THREE.Mesh[];
  flares: THREE.Sprite[];
  hot: THREE.Sprite;
  splash: THREE.Mesh;
  dust: THREE.Points;
  dustBase: Float32Array;
  /** The polyline last laid out (x, y, z per point) and its point count. */
  pts: Float32Array;
  n: number;
  /** Index of its light source in the pool. */
  source: number;
}

interface FireView {
  def: FireDef;
  state: FireState | null;
  /** First flame instance and how many. */
  first: number;
  count: number;
  embers: THREE.Points;
  emberBase: Float32Array;
  grate: THREE.MeshStandardMaterial;
  glow: number;
  height: number;
  source: number;
  cx: number;
  cz: number;
}

interface BladeView {
  def: BladeDef;
  state: BladeState | null;
  swing: THREE.Object3D;
  smear: THREE.Mesh;
  smearMat: THREE.MeshBasicMaterial;
}

interface LightSource {
  x: number;
  y: number;
  z: number;
  /** Wanted intensity now (0: off). */
  want: number;
  color: THREE.Color;
}

interface LightSlot {
  light: THREE.PointLight;
  owner: number;
  level: number;
}

export class TempleView {
  readonly group = new THREE.Group();
  private readonly defs: MechanismDefs;
  private readonly glow = glowTexture();
  private fancy = true;
  private readonly platforms = new Map<string, THREE.Object3D>();
  private readonly mirrors = new Map<
    string,
    { drum: THREE.Object3D; disc: THREE.MeshStandardMaterial; yaw: number }
  >();
  private readonly receivers = new Map<
    string,
    {
      disc: THREE.MeshStandardMaterial;
      halo: THREE.Sprite;
      corona: THREE.Sprite;
      k: number;
      flash: number;
      was: boolean;
    }
  >();
  private readonly beams = new Map<string, BeamView>();
  private readonly beamGlowMat: THREE.Material;
  private readonly beamCoreMat: THREE.Material;
  private readonly items = new Map<string, THREE.Object3D>();
  private readonly slots = new Map<
    string,
    { ray: THREE.Object3D; face: THREE.MeshStandardMaterial; k: number }
  >();
  private readonly trapdoors = new Map<string, { leaves: { mesh: THREE.Object3D; sign: number }[] }>();
  private readonly boulders = new Map<
    string,
    { mesh: THREE.Object3D; ceil: number; last: THREE.Vector3; start: THREE.Vector3 }
  >();
  private boulderDust: PuffPool | null = null;
  private readonly blades: BladeView[] = [];
  private readonly fires: FireView[] = [];
  private flames: THREE.InstancedMesh | null = null;
  private flameBase: Float32Array = new Float32Array(0);
  private flamePhase: Float32Array = new Float32Array(0);
  private sunDisc: THREE.Group | null = null;
  private sunDiscRay: THREE.MeshBasicMaterial | null = null;
  private readonly sources: LightSource[] = [];
  private readonly slotsPool: LightSlot[] = [];
  private readonly rank = new Int16Array(LIGHT_POOL);
  private readonly rankD = new Float32Array(LIGHT_POOL);

  constructor(
    private readonly level: Level,
    private readonly mats: PropMaterials,
  ) {
    this.defs = defsOf(level);
    this.group.name = 'temple';
    this.beamCoreMat = beamMaterial('#fff4dc', 1.5, 1.2);
    this.beamGlowMat = beamMaterial('#ffb95a', 0.32, 2.6);
    this.buildPlatforms();
    this.buildMirrors();
    this.buildReceivers();
    this.buildOpenings();
    this.buildBeams();
    this.buildItems();
    this.buildSlots();
    this.buildTrapdoors();
    this.buildBoulders();
    this.buildBlades();
    this.buildFires();
    this.buildSunDisc();
    this.buildTrim();
    this.buildLights();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !(o.material as THREE.Material).transparent)
        o.castShadow = o.receiveShadow = true;
    });
  }

  /** Ids of level actors this view draws itself (props.ts hides its own view of them). */
  get replacedActors(): string[] {
    return this.sunDisc ? this.level.entities.filter((e) => e.type === 'relic').map((e) => e.id) : [];
  }

  /** The tier's share of the effects: the mobile tier drops the beams' glow, the smears and the boulder dust. */
  setQuality(profile: QualityProfile): void {
    this.fancy = profile.tier !== 'mobile';
    for (const b of this.beams.values()) for (const g of b.glows) g.userData.allowed = this.fancy;
    for (const b of this.blades) b.smear.visible = this.fancy;
    if (this.boulderDust && !this.fancy) this.boulderDust.mesh.visible = false;
  }

  private stone(tint = '#cdb896'): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ ...surfaceParams(this.mats.block), color: tint });
  }

  private bronze(tint = '#9c7440', roughness = 0.38): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: tint, roughness, metalness: 0.85 });
  }

  private additive(map: THREE.Texture, tint: string, opacity = 1, fog = true): THREE.SpriteMaterial {
    return new THREE.SpriteMaterial({
      map,
      color: tint,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity,
      fog,
    });
  }

  // ─────────────────────────── Moving platforms ───────────────────────────

  private buildPlatforms(): void {
    const slabMat = this.stone('#d8c6a4');
    const bronze = this.bronze('#a67a3e', 0.42);
    const inlayMat = this.bronze('#b8894a', 0.55);
    const chainMat = this.bronze('#6b5234', 0.55);
    for (const def of this.defs.platforms.values()) {
      const g = new THREE.Group();
      const slab = new THREE.Mesh(
        new RoundedBoxGeometry(BLOCK - 0.04, devices.platformThickness, BLOCK - 0.04, 2, 0.05),
        slabMat,
      );
      slab.position.y = -devices.platformThickness / 2;
      g.add(slab);
      // Bronze straps round the edge and caps on the corners.
      for (const [x, z, w, d] of [
        [0, BLOCK / 2 - 0.02, BLOCK - 0.1, 0.05],
        [0, -BLOCK / 2 + 0.02, BLOCK - 0.1, 0.05],
        [BLOCK / 2 - 0.02, 0, 0.05, BLOCK - 0.1],
        [-BLOCK / 2 + 0.02, 0, 0.05, BLOCK - 0.1],
      ] as const) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), bronze);
        band.position.set(x, -0.18, z);
        g.add(band);
      }
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const cap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.54, 0.22), bronze);
          cap.position.set(sx * (BLOCK / 2 - 0.1), -0.25, sz * (BLOCK / 2 - 0.1));
          g.add(cap);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 12), bronze);
          ring.position.set(sx * (BLOCK / 2 - 0.1), 0.02, sz * (BLOCK / 2 - 0.1));
          ring.rotation.x = Math.PI / 2;
          g.add(ring);
        }
      // A carved sun in the middle of the deck (a slight inlay, legible from above), with rays.
      const inlay = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), inlayMat);
      inlay.rotation.x = -Math.PI / 2;
      inlay.position.y = 0.004;
      g.add(inlay);
      for (let r = 0; r < 8; r++) {
        const a = (r / 8) * TAU;
        const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.22), inlayMat);
        ray.rotation.set(-Math.PI / 2, 0, a);
        ray.position.set(Math.sin(a) * 0.48, 0.004, Math.cos(a) * 0.48);
        g.add(ray);
      }
      // Lifts hang from chains up to the ceiling.
      const vertical = def.path.some((p, i) => i > 0 && Math.abs(p.y - (def.path[i - 1]?.y ?? p.y)) > 0.1);
      if (vertical) {
        const first = def.path[0];
        const s = first
          ? this.level.sector(Math.floor(first.x / BLOCK), Math.floor(first.z / BLOCK))
          : undefined;
        const ceil = s?.ceil ?? 12;
        // One mesh for the four chains, stretched as the lift moves.
        const parts: THREE.BufferGeometry[] = [];
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            const c = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).toNonIndexed();
            c.translate(sx * (BLOCK / 2 - 0.1), 0.5, sz * (BLOCK / 2 - 0.1));
            parts.push(c);
          }
        const chains = new THREE.Mesh(mergeGeometries(parts, false) ?? parts[0], chainMat);
        chains.name = 'chains';
        chains.userData.keep = true;
        chains.userData.top = ceil;
        g.add(chains);
      }
      mergeStatic(g);
      this.group.add(g);
      this.platforms.set(def.id, g);
    }
  }

  // ───────────────────────────────── Mirrors ─────────────────────────────────

  private buildMirrors(): void {
    const drumMat = this.stone('#c9b18c');
    const bandMat = this.bronze('#8a6436', 0.5);
    for (const def of this.defs.mirrors.values()) {
      const s = this.level.sector(def.cx, def.cz);
      const floor = s ? sectorTop(s) : 0;
      const beamY = this.beamHeightNear(def.cx, def.cz) ?? floor + 1.5;
      const base = new THREE.Group();
      base.position.set(center(def.cx), 0, center(def.cz));
      // The fixed plinth, from the floor (or the bottom of a chasm) up to the drum.
      const plinthH = Math.max(0.2, beamY - 0.95 - floor);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, plinthH, 20), drumMat);
      plinth.position.y = floor + plinthH / 2;
      base.add(plinth);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.1, 24), bandMat);
      collar.position.y = floor + plinthH;
      base.add(collar);
      // The turning drum with its bronze frame and polished disc.
      const drum = new THREE.Group();
      drum.userData.keep = true;
      drum.position.y = floor + plinthH + 0.05;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.5, 24), drumMat);
      barrel.position.y = 0.25;
      drum.add(barrel);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.1), bandMat);
        rib.position.set(Math.sin(a) * 0.72, 0.25, Math.cos(a) * 0.72);
        rib.rotation.y = a;
        drum.add(rib);
      }
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 8, 32), bandMat);
      frame.position.set(0, beamY - drum.position.y, 0);
      drum.add(frame);
      // Sun rays round the frame, so the drum reads as a sun even edge-on.
      for (let r = 0; r < 12; r++) {
        const a = (r / 12) * TAU;
        const ray = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), bandMat);
        ray.position.set(Math.sin(a) * 0.76, frame.position.y + Math.cos(a) * 0.76, -0.01);
        ray.rotation.z = -a;
        drum.add(ray);
      }
      const discMat = new THREE.MeshStandardMaterial({
        color: '#e0b060',
        metalness: 1,
        roughness: 0.12,
        emissive: '#ffcf80',
        emissiveIntensity: 0.05,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.58, 32), discMat);
      disc.position.copy(frame.position);
      disc.position.z += 0.02;
      drum.add(disc);
      const back = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), bandMat);
      back.position.copy(frame.position);
      back.position.z -= 0.02;
      back.rotation.y = Math.PI;
      drum.add(back);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, beamY - drum.position.y - 0.4, 0.12), bandMat);
        post.position.set(side * 0.66, (beamY - drum.position.y) / 2 + 0.2, 0);
        drum.add(post);
      }
      base.add(drum);
      mergeStatic(base);
      mergeStatic(drum);
      this.group.add(base);
      const [nx, nz] = MIRROR_NORMALS[def.facing] ?? [1, -1];
      const yaw = yawOf(nx, nz);
      drum.rotation.y = yaw;
      this.mirrors.set(def.id, { drum, disc: discMat, yaw });
    }
  }

  /** Height of the beam that passes a cell (from its source), for sizing mirrors. */
  private beamHeightNear(cx: number, cz: number): number | null {
    let best: { d: number; y: number } | null = null;
    for (const s of this.defs.sunbeams.values()) {
      const d = Math.abs(s.cx - cx) + Math.abs(s.cz - cz);
      if (!best || d < best.d) best = { d, y: s.y };
    }
    return best?.y ?? null;
  }

  // ──────────────────────────────── Receivers ────────────────────────────────

  private buildReceivers(): void {
    const rimMat = this.bronze('#7e5a30', 0.5);
    const pedMat = this.stone();
    for (const def of this.defs.receivers.values()) {
      const v = DIR_VEC[def.face];
      const y = this.beamHeightNear(def.cx, def.cz) ?? 1.5;
      const g = new THREE.Group();
      const x = center(def.cx) + (def.inWall ? v.x * (BLOCK / 2) : 0);
      const z = center(def.cz) + (def.inWall ? v.z * (BLOCK / 2) : 0);
      g.position.set(x, y, z);
      g.rotation.y = yawOf(v.x, v.z);
      const mat = new THREE.MeshStandardMaterial({
        color: '#d9a441',
        metalness: 1,
        roughness: 0.3,
        emissive: '#ffb640',
        emissiveIntensity: 0.1,
      });
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.08, 32), mat);
      plate.rotation.x = Math.PI / 2;
      plate.position.z = 0.04;
      g.add(plate);
      // A raised boss and twelve long rays: the disc is a sun.
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 10, 0, TAU, 0, Math.PI / 2), mat);
      boss.rotation.x = Math.PI / 2;
      boss.position.z = 0.08;
      g.add(boss);
      for (let r = 0; r < 12; r++) {
        const a = (r / 12) * TAU;
        const long = r % 2 === 0;
        const ray = new THREE.Mesh(new THREE.ConeGeometry(0.07, long ? 0.36 : 0.24, 4), mat);
        const d = long ? 0.66 : 0.6;
        ray.position.set(Math.sin(a) * d, Math.cos(a) * d, 0.03);
        ray.rotation.z = -a;
        g.add(ray);
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 32), rimMat);
      rim.position.z = 0.06;
      g.add(rim);
      if (!def.inWall) {
        const s = this.level.sector(def.cx, def.cz);
        const floor = s ? sectorTop(s) : 0;
        const ped = new THREE.Mesh(new THREE.BoxGeometry(0.7, y - floor - 0.5, 0.5), pedMat);
        ped.position.set(0, -(y - floor) / 2 - 0.25, -0.1);
        g.add(ped);
      }
      mergeStatic(g);
      const halo = new THREE.Sprite(this.additive(this.glow, '#ffc870', 0));
      halo.scale.setScalar(3);
      halo.position.z = 0.25;
      g.add(halo);
      // A wider, fainter corona that turns slowly once lit.
      const corona = new THREE.Sprite(this.additive(this.glow, '#ff9a3a', 0));
      corona.scale.setScalar(5);
      corona.position.z = 0.3;
      g.add(corona);
      this.group.add(g);
      this.receivers.set(def.id, { disc: mat, halo, corona, k: 0, flash: 0, was: false });
    }
  }

  // ───────────────────────────── Sun openings ─────────────────────────────

  private buildOpenings(): void {
    const g = new THREE.Group();
    const rimMat = this.bronze('#9a7040', 0.5);
    const deflMat = this.bronze('#e0b060', 0.15);
    const standMat = this.bronze();
    const frameMat = this.bronze('#6e4f2c', 0.6);
    const skyMat = new THREE.MeshBasicMaterial({ color: SUN.clone().multiplyScalar(4), fog: false });
    const slitMat = new THREE.MeshBasicMaterial({ color: SUN.clone().multiplyScalar(5), fog: false });
    for (const def of this.defs.sunbeams.values()) {
      const x = center(def.cx);
      const z = center(def.cz);
      if (def.from === 'sky') {
        const s = this.level.sector(def.cx, def.cz);
        const ceil = s?.ceil ?? def.y + 4;
        const oculus = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), skyMat);
        oculus.rotation.x = Math.PI / 2;
        oculus.position.set(x, ceil - 0.01, z);
        g.add(oculus);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 8, 32), rimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.set(x, ceil - 0.05, z);
        g.add(rim);
        // The bronze deflector that turns the shaft level.
        const v = DIR_VEC[def.dir];
        const defl = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), deflMat);
        defl.position.set(x, def.y, z);
        defl.lookAt(x + v.x, def.y + 1, z + v.z);
        g.add(defl);
        const stand = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.08, def.y - (s ? sectorTop(s) : 0), 8),
          standMat,
        );
        stand.position.set(x, (def.y + (s ? sectorTop(s) : 0)) / 2, z);
        g.add(stand);
      } else {
        const v = DIR_VEC[def.dir];
        const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.9), slitMat);
        slit.position.set(x - v.x * (BLOCK / 2 - 0.01), def.y, z - v.z * (BLOCK / 2 - 0.01));
        slit.rotation.y = yawOf(v.x, v.z);
        g.add(slit);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.08), frameMat);
        frame.position.copy(slit.position).add(new THREE.Vector3(-v.x * 0.02, 0, -v.z * 0.02));
        frame.rotation.y = slit.rotation.y;
        g.add(frame);
        const flare = new THREE.Sprite(this.additive(this.glow, '#ffe0a8', 1, false));
        flare.position.copy(slit.position).add(new THREE.Vector3(v.x * 0.1, 0, v.z * 0.1));
        flare.scale.setScalar(1.6);
        g.add(flare);
      }
    }
    mergeStatic(g);
    this.group.add(g);
  }

  // ────────────────────────────────── Beams ──────────────────────────────────

  /**
   * One fixed set of meshes per sun beam, built once: a bright core and a
   * soft glow per segment (a shared unit cylinder, scaled and turned when a
   * mirror sends the light elsewhere), flares where it strikes a mirror, a
   * hot spot and a splash of light where it lands, and dust drifting in it.
   */
  private buildBeams(): void {
    const unit = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    const splashGeo = new THREE.CircleGeometry(0.9, 24);
    const splashMat = new THREE.MeshBasicMaterial({
      map: this.glow,
      color: '#ffd9a0',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const flareMat = this.additive(this.glow, '#fff0c8', 1, false);
    const hotMat = this.additive(this.glow, '#ffd89a', 1, false);
    const dustMat = new THREE.PointsMaterial({
      color: '#ffe6b0',
      size: 0.026,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const def of this.defs.sunbeams.values()) {
      const group = new THREE.Group();
      group.visible = false;
      const cores: THREE.Mesh[] = [];
      const glows: THREE.Mesh[] = [];
      const flares: THREE.Sprite[] = [];
      for (let i = 0; i < MAX_POINTS - 1; i++) {
        const core = new THREE.Mesh(unit, this.beamCoreMat);
        const glow = new THREE.Mesh(unit, this.beamGlowMat);
        core.visible = glow.visible = false;
        core.frustumCulled = glow.frustumCulled = false;
        glow.userData.allowed = true;
        group.add(core, glow);
        cores.push(core);
        glows.push(glow);
        const flare = new THREE.Sprite(flareMat);
        flare.visible = false;
        flare.scale.setScalar(1.3);
        group.add(flare);
        flares.push(flare);
      }
      const hot = new THREE.Sprite(hotMat);
      hot.scale.setScalar(1.8);
      const splash = new THREE.Mesh(splashGeo, splashMat);
      group.add(hot, splash);
      const dustBase = new Float32Array(BEAM_DUST * 3);
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BEAM_DUST * 3), 3));
      const dust = new THREE.Points(dg, dustMat);
      dust.frustumCulled = false;
      group.add(dust);
      this.group.add(group);
      const source = this.sources.length;
      this.sources.push({ x: 0, y: -1e4, z: 0, want: 0, color: new THREE.Color('#ffcf8a') });
      this.beams.set(def.id, {
        id: def.id,
        group,
        cores,
        glows,
        flares,
        hot,
        splash,
        dust,
        dustBase,
        pts: new Float32Array(MAX_POINTS * 3),
        n: 0,
        source,
      });
    }
  }

  /** Lays a beam's meshes along a new polyline (only when a mirror turns or the light changes). */
  private layoutBeam(b: BeamView, points: readonly { x: number; y: number; z: number }[]): void {
    const n = Math.min(points.length, MAX_POINTS);
    b.n = n;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      b.pts[i * 3] = p?.x ?? 0;
      b.pts[i * 3 + 1] = p?.y ?? 0;
      b.pts[i * 3 + 2] = p?.z ?? 0;
    }
    for (let i = 0; i < MAX_POINTS - 1; i++) {
      const core = b.cores[i];
      const glow = b.glows[i];
      const flare = b.flares[i];
      if (!core || !glow || !flare) continue;
      const on = i < n - 1;
      core.visible = on;
      glow.visible = on && glow.userData.allowed === true;
      flare.visible = on && i < n - 2;
      if (!on) continue;
      _a.fromArray(b.pts, i * 3);
      _b.fromArray(b.pts, i * 3 + 3);
      const len = _a.distanceTo(_b);
      total += len;
      _c.subVectors(_b, _a).normalize();
      // A vertical shaft from an oculus is wider and softer.
      const wide = Math.abs(_c.y) > 0.9 ? 2.2 : 1;
      _q.setFromUnitVectors(UP, _c);
      _d.addVectors(_a, _b).multiplyScalar(0.5);
      core.position.copy(_d);
      core.quaternion.copy(_q);
      core.scale.set(0.085 * wide, Math.max(0.01, len), 0.085 * wide);
      glow.position.copy(_d);
      glow.quaternion.copy(_q);
      glow.scale.set(0.34 * wide, Math.max(0.01, len), 0.34 * wide);
      flare.position.copy(_b);
    }
    // The hot spot and the splash where it lands, facing back along the last segment.
    if (n >= 2) {
      _a.fromArray(b.pts, (n - 2) * 3);
      _b.fromArray(b.pts, (n - 1) * 3);
      _c.subVectors(_a, _b).normalize();
      b.hot.position.copy(_b).addScaledVector(_c, 0.08);
      b.splash.position.copy(_b).addScaledVector(_c, 0.03);
      _d.copy(b.splash.position).add(_c);
      b.splash.lookAt(_d);
      const src = this.sources[b.source];
      if (src) {
        src.x = _b.x + _c.x * 0.7;
        src.y = _b.y + _c.y * 0.7;
        src.z = _b.z + _c.z * 0.7;
      }
    }
    // Dust scattered along the whole path, denser where the beam is long.
    let seg = 0;
    let acc = 0;
    for (let k = 0; k < BEAM_DUST; k++) {
      const t = ((k + hash(k, n, 3)) / BEAM_DUST) * total;
      while (seg < n - 2) {
        _a.fromArray(b.pts, seg * 3);
        _b.fromArray(b.pts, seg * 3 + 3);
        const l = _a.distanceTo(_b);
        if (t <= acc + l) break;
        acc += l;
        seg++;
      }
      _a.fromArray(b.pts, seg * 3);
      _b.fromArray(b.pts, seg * 3 + 3);
      const l = Math.max(1e-3, _a.distanceTo(_b));
      _c.subVectors(_b, _a).normalize();
      const wide = Math.abs(_c.y) > 0.9 ? 2.2 : 1;
      _q.setFromUnitVectors(UP, _c);
      const ang = hash(k, 7, 13) * TAU;
      const rad = Math.sqrt(hash(k, 11, 17)) * 0.32 * wide;
      _d.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad).applyQuaternion(_q);
      _a.lerp(_b, Math.min(1, Math.max(0, (t - acc) / l))).add(_d);
      b.dustBase[k * 3] = _a.x;
      b.dustBase[k * 3 + 1] = _a.y;
      b.dustBase[k * 3 + 2] = _a.z;
    }
  }

  private updateBeam(
    b: BeamView,
    points: readonly { x: number; y: number; z: number }[],
    time: number,
    eye: { x: number; y: number; z: number },
  ): void {
    const src = this.sources[b.source];
    const on = points.length > 1;
    b.group.visible = on;
    if (!on) {
      if (src) src.want = 0;
      return;
    }
    // Relayout only when the path moved.
    let changed = Math.min(points.length, MAX_POINTS) !== b.n;
    for (let i = 0; i < b.n && !changed; i++) {
      const p = points[i];
      if (!p) break;
      changed =
        Math.abs(p.x - (b.pts[i * 3] ?? 0)) > 1e-4 ||
        Math.abs(p.y - (b.pts[i * 3 + 1] ?? 0)) > 1e-4 ||
        Math.abs(p.z - (b.pts[i * 3 + 2] ?? 0)) > 1e-4;
    }
    if (changed) this.layoutBeam(b, points);
    const pulse = 0.92 + Math.sin(time * 2.3) * 0.05 + Math.sin(time * 7.1) * 0.03;
    b.hot.material.opacity = pulse;
    b.hot.scale.setScalar(1.6 + pulse * 0.4);
    (b.splash.material as THREE.MeshBasicMaterial).opacity = pulse;
    if (src) src.want = 13 * pulse;
    // Dust drifts only when someone is near enough to see it.
    const near = src ? Math.hypot(src.x - eye.x, src.z - eye.z) < NEAR + 10 : true;
    b.dust.visible = near;
    if (!near) return;
    const attr = b.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < BEAM_DUST; i++) {
      const ph = i * 1.37;
      arr[i * 3] = (b.dustBase[i * 3] ?? 0) + Math.sin(time * 0.21 + ph) * 0.07;
      arr[i * 3 + 1] = (b.dustBase[i * 3 + 1] ?? 0) + Math.sin(time * 0.13 + ph * 0.7) * 0.09;
      arr[i * 3 + 2] = (b.dustBase[i * 3 + 2] ?? 0) + Math.cos(time * 0.17 + ph) * 0.07;
    }
    attr.needsUpdate = true;
  }

  // ───────────────────────────── Items and slots ─────────────────────────────

  /** The bronze ray: a long, faceted blade of a sun's ray. */
  private rayGeometry(length = 0.62): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.09, 0.08);
    shape.lineTo(0.035, length);
    shape.lineTo(0, length + 0.04);
    shape.lineTo(-0.035, length);
    shape.lineTo(-0.09, 0.08);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.025,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.01,
      bevelSegments: 1,
    });
    geo.translate(0, 0, -0.0125);
    return geo;
  }

  private buildItems(): void {
    const gold = new THREE.MeshStandardMaterial({
      color: '#d9a042',
      metalness: 1,
      roughness: 0.22,
      emissive: '#6b3d0c',
      emissiveIntensity: 0.4,
    });
    const pedMat = this.stone('#d4c19f');
    const topMat = this.bronze('#8f6a3a', 0.5);
    for (const def of this.defs.items.values()) {
      const s = this.level.sector(def.cx, def.cz);
      const floor = s ? sectorTop(s) : 0;
      const g = new THREE.Group();
      g.position.set(center(def.cx), floor, center(def.cz));
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.72, 16), pedMat);
      ped.position.y = 0.36;
      g.add(ped);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16), topMat);
      top.position.y = 0.75;
      g.add(top);
      const holder = new THREE.Group();
      holder.name = 'ray';
      holder.position.y = 0.95;
      const ray = new THREE.Mesh(this.rayGeometry(), gold);
      ray.position.y = -0.3;
      holder.add(ray);
      const halo = new THREE.Sprite(this.additive(this.glow, '#ffc060', 0.6));
      halo.scale.setScalar(1.1);
      holder.add(halo);
      g.add(holder);
      this.group.add(g);
      this.items.set(def.id, holder);
    }
  }

  private buildSlots(): void {
    const gold = new THREE.MeshStandardMaterial({
      color: '#d9a042',
      metalness: 1,
      roughness: 0.25,
      emissive: '#ffb640',
      emissiveIntensity: 0.05,
    });
    const roundelMat = this.stone('#cbb48e');
    const socketMat = new THREE.MeshStandardMaterial({ color: '#1a120a', roughness: 1 });
    for (const def of this.defs.slots.values()) {
      const v = DIR_VEC[def.wall];
      const s = this.level.sector(def.cx, def.cz);
      const floor = s ? sectorTop(s) : 0;
      const g = new THREE.Group();
      g.position.set(
        center(def.cx) + v.x * (BLOCK / 2 - 0.02),
        floor + 1.55,
        center(def.cz) + v.z * (BLOCK / 2 - 0.02),
      );
      g.rotation.y = yawOf(-v.x, -v.z);
      const roundel = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1, 0.12, 40), roundelMat);
      roundel.rotation.x = Math.PI / 2;
      g.add(roundel);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 12, 0, TAU, 0, Math.PI / 2), gold);
      boss.rotation.x = Math.PI / 2;
      boss.position.z = 0.06;
      g.add(boss);
      const rayGeo = this.rayGeometry(0.46);
      let missing: THREE.Object3D | null = null;
      for (let r = 0; r < 8; r++) {
        const a = (r / 8) * TAU;
        const ray = new THREE.Mesh(rayGeo, gold);
        ray.position.set(Math.sin(a) * 0.3, Math.cos(a) * 0.3, 0.08);
        ray.rotation.z = -a;
        g.add(ray);
        if (r === 0) {
          missing = ray;
          ray.userData.keep = true;
        }
      }
      // The empty socket where the eighth ray goes.
      const socket = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.5), socketMat);
      socket.position.set(0, 0.55, 0.065);
      g.add(socket);
      mergeStatic(g);
      this.group.add(g);
      if (missing) this.slots.set(def.id, { ray: missing, face: gold, k: 0 });
    }
  }

  // ──────────────────────────────── Trapdoors ────────────────────────────────

  private buildTrapdoors(): void {
    const mat = this.stone('#bfa782');
    const hinge = this.bronze('#6e5232', 0.55);
    for (const def of this.defs.trapdoors.values()) {
      const leaves: { mesh: THREE.Object3D; sign: number }[] = [];
      for (let x = def.minX; x < def.maxX; x++)
        for (let z = def.minZ; z < def.maxZ; z++) {
          for (const sign of [-1, 1]) {
            const pivot = new THREE.Group();
            pivot.position.set(center(x) + sign * (BLOCK / 2 - 0.01), def.y, center(z));
            const leaf = new THREE.Mesh(
              new RoundedBoxGeometry(BLOCK / 2 - 0.03, 0.22, BLOCK - 0.04, 1, 0.02),
              mat,
            );
            leaf.position.set(-sign * (BLOCK / 4), -0.11, 0);
            pivot.add(leaf);
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, BLOCK - 0.1, 8), hinge);
            bar.rotation.x = Math.PI / 2;
            bar.position.set(-sign * 0.05, -0.05, 0);
            pivot.add(bar);
            this.group.add(pivot);
            leaves.push({ mesh: pivot, sign });
          }
        }
      this.trapdoors.set(def.id, { leaves });
    }
  }

  // ──────────────────────────────── Boulders ────────────────────────────────

  /**
   * A carved stone ball: lumpy granite with a band of worn sun reliefs round
   * its girth (so its roll reads), dropped from a dark niche in the ceiling.
   */
  private buildBoulders(): void {
    const R = traps.boulder.radius;
    const rock = new THREE.MeshStandardMaterial({ ...surfaceParams(this.mats.stone), color: '#9e8566' });
    const band = new THREE.MeshStandardMaterial({ ...surfaceParams(this.mats.stone), color: '#6f5a44' });
    const holeMat = new THREE.MeshBasicMaterial({ color: '#050302' });
    for (const def of this.defs.boulders.values()) {
      const geo = new THREE.IcosahedronGeometry(R, 4);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).normalize();
        const bump =
          Math.sin(v.x * 5.1 + v.y * 3.3) * 0.04 +
          Math.sin(v.z * 7.7 - v.x * 4.1) * 0.03 +
          Math.sin(v.y * 13 + v.z * 11) * 0.012 +
          Math.sin(v.x * 23 + v.z * 19) * 0.006;
        // Flattened a touch where the band is carved.
        const girth = Math.abs(v.y) < 0.14 ? -0.025 : 0;
        v.multiplyScalar(R * (1 + bump + girth));
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const ball = new THREE.Group();
      ball.add(new THREE.Mesh(geo, rock));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.985, 0.05, 6, 48), band);
      ring.rotation.x = Math.PI / 2;
      ball.add(ring);
      // Sun bosses round the band.
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.08, 10), band);
        boss.position.set(Math.cos(a) * R * 0.99, 0, Math.sin(a) * R * 0.99);
        boss.lookAt(Math.cos(a) * 3, 0, Math.sin(a) * 3);
        boss.rotateX(Math.PI / 2);
        ball.add(boss);
      }
      mergeStatic(ball);
      const start = def.path[0] ?? { x: 0, z: 0 };
      const s = this.level.sector(Math.floor(start.x / BLOCK), Math.floor(start.z / BLOCK));
      const ceil = s?.ceil ?? 6;
      // The dark hole in the ceiling it drops from.
      const hole = new THREE.Mesh(new THREE.CircleGeometry(1.05, 24), holeMat);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(start.x, ceil - 0.02, start.z);
      this.group.add(hole, ball);
      this.boulders.set(def.id, {
        mesh: ball,
        ceil,
        last: new THREE.Vector3(start.x, 0, start.z),
        start: new THREE.Vector3(start.x, 0, start.z),
      });
    }
    if (this.boulders.size) {
      this.boulderDust = new PuffPool(BOULDER_DUST, '#7d6a54', 1.4, 1.5);
      this.group.add(this.boulderDust.mesh);
    }
  }

  private emitDust(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    heavy: boolean,
  ): void {
    this.boulderDust?.spawn(x, y, z, vx, vy, vz, heavy);
  }

  // ───────────────────────────────── Blades ─────────────────────────────────

  private buildBlades(): void {
    const steel = new THREE.MeshStandardMaterial({ color: '#8d8a84', metalness: 0.9, roughness: 0.28 });
    const edge = new THREE.MeshStandardMaterial({ color: '#e8e2d6', metalness: 1, roughness: 0.12 });
    const arm = this.bronze('#5b4128', 0.6);
    const slotMat = new THREE.MeshBasicMaterial({ color: '#070504' });
    const slots = new THREE.Group();
    for (const def of this.defs.blades.values()) {
      const reach = def.reach;
      const pivot = new THREE.Group();
      pivot.position.set(center(def.cx), def.pivot, center(def.cz));
      // The swing plane holds the blade's axis: local +X is the world axis it swings along.
      pivot.rotation.y = def.axis === 'x' ? 0 : -Math.PI / 2;
      const swing = new THREE.Group();
      swing.userData.keep = true;
      pivot.add(swing);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(0.09, reach - 0.62, 0.09), arm);
      rod.position.y = -(reach - 0.62) / 2;
      swing.add(rod);
      // A crescent blade, its edge towards the bottom of the swing.
      const shape = new THREE.Shape();
      const hw = traps.blade.halfWidth + 0.1;
      shape.moveTo(-hw, 0.35);
      shape.quadraticCurveTo(0, -0.95, hw, 0.35);
      shape.quadraticCurveTo(0, -0.35, -hw, 0.35);
      const blade = new THREE.Mesh(
        new THREE.ExtrudeGeometry(shape, {
          depth: 0.04,
          bevelEnabled: true,
          bevelSize: 0.015,
          bevelThickness: 0.01,
        }),
        steel,
      );
      // Its lowest point is the simulation's (pivot − reach).
      blade.position.set(0, -reach + 0.3, -0.02);
      swing.add(blade);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(hw * 0.98, 0.012, 4, 24, Math.PI * 0.8), edge);
      lip.rotation.z = Math.PI * 1.1;
      lip.position.set(0, -reach + 0.28, 0);
      swing.add(lip);
      mergeStatic(swing);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 12), arm);
      hub.rotation.x = Math.PI / 2;
      pivot.add(hub);
      // The motion smear: a fan of faint steel trailing the blade, brighter
      // towards the blade and as fast as it swings (a whoosh you can see).
      const trail = 0.55;
      const fan = new THREE.RingGeometry(reach - 1.0, reach + 0.05, 18, 1, -Math.PI / 2 - trail, trail);
      const colors = new Float32Array(fan.getAttribute('position').count * 3);
      const fp = fan.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < fp.count; i++) {
        const a = Math.atan2(fp.getY(i), fp.getX(i));
        const k = Math.max(0, Math.min(1, (a + Math.PI / 2 + trail) / trail));
        const r = Math.hypot(fp.getX(i), fp.getY(i));
        const edgeK = Math.max(0.25, Math.min(1, (r - (reach - 1.0)) / 0.8));
        const c = k * k * edgeK;
        colors[i * 3] = c;
        colors[i * 3 + 1] = c;
        colors[i * 3 + 2] = c;
      }
      fan.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const smearMat = new THREE.MeshBasicMaterial({
        color: '#d9d4c8',
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const smear = new THREE.Mesh(fan, smearMat);
      smear.userData.keep = true;
      pivot.add(smear);
      this.group.add(pivot);
      this.blades.push({ def, state: null, swing, smear, smearMat });
      // Dark slots in the side walls the blade swings into.
      for (const side of [-1, 1]) {
        const slot = new THREE.Mesh(
          new THREE.PlaneGeometry(0.22, Math.max(1, def.pivot - def.floor - 1)),
          slotMat,
        );
        const ox = def.axis === 'x' ? side * (BLOCK / 2 - 0.01) : 0;
        const oz = def.axis === 'z' ? side * (BLOCK / 2 - 0.01) : 0;
        slot.position.set(center(def.cx) + ox, (def.pivot + def.floor + 1) / 2 + 0.3, center(def.cz) + oz);
        slot.rotation.y = def.axis === 'x' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0;
        slots.add(slot);
      }
    }
    mergeStatic(slots);
    this.group.add(slots);
  }

  // ─────────────────────────────── Fire floors ───────────────────────────────

  /**
   * Bronze grates over coals. The warning is readable: the gaps brighten
   * and breathe faster, low licks of flame and rising embers, then the
   * burst. All flames are one instanced mesh of camera-facing cards.
   */
  private buildFires(): void {
    const grateMap = grateTexture();
    const grateGlow = grateGlowTexture();
    const flameBase: number[] = [];
    const flamePhase: number[] = [];
    const flameTint: THREE.Color[] = [];
    const bright = new THREE.Color('#ffe2a8');
    const warm = new THREE.Color('#ff8a3a');
    for (const def of this.defs.fires.values()) {
      const grate = new THREE.MeshStandardMaterial({
        map: grateMap,
        emissiveMap: grateGlow,
        emissive: '#ff5a10',
        emissiveIntensity: 0.2,
        roughness: 0.7,
        metalness: 0.4,
      });
      const plates = new THREE.Group();
      const first = flameBase.length / 3;
      const emberPos: number[] = [];
      let floor0 = 0;
      for (let x = def.minX; x < def.maxX; x++)
        for (let z = def.minZ; z < def.maxZ; z++) {
          const s = this.level.sector(x, z);
          const floor = s ? sectorTop(s) : 0;
          floor0 = floor;
          const plate = new THREE.Mesh(new THREE.PlaneGeometry(BLOCK - 0.08, BLOCK - 0.08), grate);
          plate.rotation.x = -Math.PI / 2;
          plate.position.set(center(x), floor + 0.015, center(z));
          plates.add(plate);
          for (let k = 0; k < FLAMES_PER_CELL; k++) {
            flameBase.push(
              center(x) + (hash(x, z, k) - 0.5) * 1.1,
              floor,
              center(z) + (hash(z, x, k + 3) - 0.5) * 1.1,
            );
            flamePhase.push(hash(x, z, k + 7) * TAU);
            flameTint.push(k === 0 ? bright : warm);
          }
          for (let i = 0; i < 8; i++)
            emberPos.push(
              center(x) + (hash(x, i, 1) - 0.5) * 1.8,
              floor,
              center(z) + (hash(i, z, 3) - 0.5) * 1.8,
            );
        }
      mergeStatic(plates);
      this.group.add(plates);
      const eg = new THREE.BufferGeometry();
      const base = new Float32Array(emberPos);
      eg.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
      const embers = new THREE.Points(
        eg,
        new THREE.PointsMaterial({
          color: '#ffb060',
          size: 0.05,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      embers.frustumCulled = false;
      this.group.add(embers);
      const source = this.sources.length;
      this.sources.push({
        x: ((def.minX + def.maxX) / 2) * BLOCK,
        y: floor0 + 1.4,
        z: ((def.minZ + def.maxZ) / 2) * BLOCK,
        want: 0,
        color: new THREE.Color('#ff7a2a'),
      });
      this.fires.push({
        def,
        state: null,
        first,
        count: flameBase.length / 3 - first,
        embers,
        emberBase: base,
        grate,
        glow: 0,
        height: 0,
        source,
        cx: ((def.minX + def.maxX) / 2) * BLOCK,
        cz: ((def.minZ + def.maxZ) / 2) * BLOCK,
      });
    }
    const count = flameBase.length / 3;
    if (!count) return;
    const card = new THREE.PlaneGeometry(1, 1);
    card.translate(0, 0.5, 0);
    const flames = new THREE.InstancedMesh(
      card,
      new THREE.MeshBasicMaterial({
        map: flameTexture(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      count,
    );
    flames.frustumCulled = false;
    flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) {
      flames.setMatrixAt(i, _m);
      flames.setColorAt(i, flameTint[i] ?? bright);
    }
    this.group.add(flames);
    this.flames = flames;
    this.flameBase = new Float32Array(flameBase);
    this.flamePhase = new Float32Array(flamePhase);
  }

  private updateFire(
    f: FireView,
    time: number,
    dt: number,
    eye: { x: number; y: number; z: number },
  ): boolean {
    const st = f.state;
    const src = this.sources[f.source];
    if (!st || !src) return false;
    const def = f.def;
    const phase = st.on ? firePhase(def, st.time) : 'idle';
    const u = (((st.time + def.offset) % def.period) + def.period) % def.period;
    let height = 0;
    let glow = 0.15;
    let embers = 0;
    let light = 0;
    if (phase === 'burn') {
      const k = Math.min(1, u / 0.15) * Math.min(1, (def.burn - u) / 0.2 + 0.3);
      height = 2.4 * k;
      glow = 3.2;
      embers = 0.9;
      light = 70 * (0.85 + Math.sin(time * 23) * 0.15);
    } else if (phase === 'warn') {
      // The tell: the coals brighten and breathe faster and faster, licks rise.
      const k = 1 - (def.period - u) / traps.fire.warning;
      height = 0.2 + k * 0.4;
      glow = (0.9 + k * 1.8) * (0.8 + 0.2 * Math.sin(time * (10 + k * 18)));
      embers = 0.8;
      light = 6 + k * 12;
    }
    f.glow += (glow - f.glow) * Math.min(1, dt * 8);
    f.height = height;
    f.grate.emissiveIntensity = f.glow * (0.9 + Math.sin(time * 17) * 0.1);
    src.want = light;
    const near = Math.hypot(f.cx - eye.x, f.cz - eye.z) < NEAR + 10;
    f.embers.visible = near;
    if (!near) return false;
    const attr = f.embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < attr.count; i++) {
      const rise = ((time * (0.5 + hash(i, 3, 5) * 0.6) + hash(i, 7, 9)) % 1) * 2.4;
      arr[i * 3] = (f.emberBase[i * 3] ?? 0) + Math.sin(time * 2 + i) * 0.08;
      arr[i * 3 + 1] = (f.emberBase[i * 3 + 1] ?? 0) + rise;
      arr[i * 3 + 2] = f.emberBase[i * 3 + 2] ?? 0;
    }
    attr.needsUpdate = true;
    const em = f.embers.material as THREE.PointsMaterial;
    em.opacity += (embers - em.opacity) * Math.min(1, dt * 5);
    return true;
  }

  /** Flame cards: all fires' flames in one instanced draw, turned to face the eye. */
  private updateFlames(time: number, eye: { x: number; y: number; z: number }): void {
    const flames = this.flames;
    if (!flames) return;
    let any = false;
    for (const f of this.fires) {
      const near = f.embers.visible;
      for (let n = 0; n < f.count; n++) {
        const i = f.first + n;
        const bx = this.flameBase[i * 3] ?? 0;
        const by = this.flameBase[i * 3 + 1] ?? 0;
        const bz = this.flameBase[i * 3 + 2] ?? 0;
        const ph = this.flamePhase[i] ?? 0;
        const noise = Math.sin(time * 11 + ph) * 0.5 + Math.sin(time * 19.3 + ph * 2) * 0.3;
        const h = near && f.height > 0.05 ? f.height * (1 + noise * 0.2) : 0;
        if (h > 0) any = true;
        _q.setFromAxisAngle(UP, Math.atan2(eye.x - bx, eye.z - bz));
        _a.set(bx + Math.sin(time * 4 + ph) * 0.03, by, bz);
        _s.set(h > 0 ? 0.55 + h * 0.2 : 0, h, h > 0 ? 1 : 0);
        _m.compose(_a, _q, _s);
        flames.setMatrixAt(i, _m);
      }
    }
    flames.visible = any;
    if (any || flames.userData.shown) flames.instanceMatrix.needsUpdate = true;
    flames.userData.shown = any;
  }

  // ───────────────────────────────── Sun Disc ─────────────────────────────────

  /** The Sun Disc relic: nine rays, eight cut, and a ninth that is a line of light. */
  private buildSunDisc(): void {
    if (this.level.id !== 'sun_temple') return;
    const gold = new THREE.MeshPhysicalMaterial({
      color: '#f0bf55',
      metalness: 1,
      roughness: 0.18,
      clearcoat: 0.6,
      emissive: '#ff9a2a',
      emissiveIntensity: 0.6,
    });
    const g = new THREE.Group();
    const body = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 48), gold);
    disc.rotation.x = Math.PI / 2;
    body.add(disc);
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 12), gold);
    boss.scale.z = 0.4;
    body.add(boss);
    const rayGeo = this.rayGeometry(0.26);
    for (let r = 1; r < 9; r++) {
      const a = (r / 9) * TAU;
      const ray = new THREE.Mesh(rayGeo, gold);
      ray.position.set(Math.sin(a) * 0.26, Math.cos(a) * 0.26, 0);
      ray.rotation.z = -a;
      body.add(ray);
    }
    mergeStatic(body);
    g.add(body);
    const lightRay = new THREE.MeshBasicMaterial({
      color: '#fff3d0',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.42), lightRay);
    beam.position.set(0, 0.48, 0.03);
    g.add(beam);
    this.sunDiscRay = lightRay;
    const halo = new THREE.Sprite(this.additive(this.glow, '#ffc870', 0.8));
    halo.scale.setScalar(2.2);
    g.add(halo);
    this.group.add(g);
    this.sunDisc = g;
  }

  // ───────────────────────────── Gilded dressing ─────────────────────────────

  /**
   * Rooms whose look has `trim` get a gilded frieze round their walls and
   * painted relief panels at eye height (spec §11: gold leaf, painted
   * reliefs), instanced so they cost a few draw calls per level.
   */
  private buildTrim(): void {
    const busy = new Set<string>();
    for (const e of this.level.entities) busy.add(`${e.at[0]},${e.at[1]}`);
    const friezes: THREE.Matrix4[] = [];
    const panels: THREE.Matrix4[][] = [[], [], []];
    const q = new THREE.Quaternion();
    for (const room of this.level.rooms) {
      const trim = lookFile(room.look)?.trim;
      if (!trim) continue;
      for (let cx = room.minX; cx < room.maxX; cx++)
        for (let cz = room.minZ; cz < room.maxZ; cz++) {
          const s = this.level.sector(cx, cz);
          if (!s || s.wall || s.pit || s.room !== room.id) continue;
          const floor = sectorTop(s);
          for (const d of DIRS) {
            const v = DIR_VEC[d];
            const n = this.level.sector(cx + v.x, cz + v.z);
            if (n && !n.wall) continue;
            const x = center(cx) + v.x * (BLOCK / 2 - 0.02);
            const z = center(cz) + v.z * (BLOCK / 2 - 0.02);
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawOf(-v.x, -v.z));
            const fy = floor + (trim.friezeHeight ?? 3.2);
            if (fy < s.ceil - 0.6) {
              friezes.push(
                new THREE.Matrix4().compose(new THREE.Vector3(x, fy, z), q, new THREE.Vector3(1, 1, 1)),
              );
            }
            if (
              trim.reliefs &&
              !busy.has(`${cx},${cz}`) &&
              s.ceil - floor > 3 &&
              hash(cx, cz, dirSalt(d)) < 0.34
            ) {
              const variant = Math.floor(hash(cz, cx, 17) * 3);
              panels[variant]?.push(
                new THREE.Matrix4().compose(
                  new THREE.Vector3(x - v.x * 0.01, floor + 1.75, z - v.z * 0.01),
                  q,
                  new THREE.Vector3(1, 1, 1),
                ),
              );
            }
          }
        }
    }
    if (friezes.length) {
      const gold = new THREE.MeshStandardMaterial({
        color: '#d7a548',
        metalness: 1,
        roughness: 0.3,
        emissive: '#3a2206',
        emissiveIntensity: 0.4,
      });
      const geo = new THREE.BoxGeometry(BLOCK, 0.16, 0.05);
      const mesh = new THREE.InstancedMesh(geo, gold, friezes.length);
      friezes.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const lower = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK, 0.05, 0.04), gold, friezes.length);
      const shift = new THREE.Matrix4().makeTranslation(0, -0.2, 0);
      friezes.forEach((m, i) => lower.setMatrixAt(i, m.clone().multiply(shift)));
      this.group.add(lower);
    }
    panels.forEach((list, variant) => {
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({
        map: reliefTexture(variant),
        color: '#b9a88c',
        roughness: 0.9,
      });
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.17), mat, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }
  // ─────────────────────────────── Light pool ───────────────────────────────

  private buildLights(): void {
    if (!this.sources.length) return;
    for (let i = 0; i < LIGHT_POOL; i++) {
      // Plain lights, fixed for the level: they only move once faded out.
      const light = new THREE.PointLight('#ffcf8a', 0, 14, 2);
      light.castShadow = false;
      this.group.add(light);
      this.slotsPool.push({ light, owner: -1, level: 0 });
    }
  }

  /** Gives the pooled lights to the nearest lit sources, fading them in and out. */
  private updateLights(eye: { x: number; y: number; z: number }, dt: number): void {
    const rank = this.rank;
    const rankD = this.rankD;
    rank.fill(-1);
    rankD.fill(Infinity);
    for (let s = 0; s < this.sources.length; s++) {
      const src = this.sources[s];
      if (!src || src.want <= 0) continue;
      const d = Math.hypot(src.x - eye.x, src.y - eye.y, src.z - eye.z);
      if (d > NEAR) continue;
      for (let r = 0; r < LIGHT_POOL; r++) {
        if (d >= (rankD[r] ?? Infinity)) continue;
        for (let k = LIGHT_POOL - 1; k > r; k--) {
          rank[k] = rank[k - 1] ?? -1;
          rankD[k] = rankD[k - 1] ?? Infinity;
        }
        rank[r] = s;
        rankD[r] = d;
        break;
      }
    }
    const step = dt / 0.5;
    for (const slot of this.slotsPool) {
      if (slot.owner === -1) continue;
      const wanted = rank.includes(slot.owner);
      slot.level = approach(slot.level, wanted ? 1 : 0, step);
      if (!wanted && slot.level === 0) slot.owner = -1;
    }
    for (let r = 0; r < LIGHT_POOL; r++) {
      const s = rank[r] ?? -1;
      if (s === -1) continue;
      let owned = false;
      for (const slot of this.slotsPool) if (slot.owner === s) owned = true;
      if (owned) continue;
      for (const slot of this.slotsPool) {
        if (slot.owner !== -1) continue;
        slot.owner = s;
        slot.level = 0;
        break;
      }
    }
    for (const slot of this.slotsPool) {
      const src = slot.owner === -1 ? undefined : this.sources[slot.owner];
      if (!src) {
        slot.light.intensity = 0;
        continue;
      }
      slot.light.position.set(src.x, src.y, src.z);
      slot.light.color.copy(src.color);
      slot.light.intensity = src.want * slot.level;
    }
  }

  // ─────────────────────────────────── Update ───────────────────────────────────

  update(world: World, time: number, dt: number, eye: { x: number; y: number; z: number }): void {
    const m = world.state.mechanisms;
    for (const p of m.platforms) {
      const g = this.platforms.get(p.id);
      if (!g) continue;
      g.position.set(p.pos.x, p.pos.y, p.pos.z);
      const chains = g.getObjectByName('chains');
      if (chains) chains.scale.y = Math.max(0.01, (chains.userData.top as number) - p.pos.y);
    }

    for (const mi of m.mirrors) {
      const v = this.mirrors.get(mi.id);
      if (!v) continue;
      const [nx, nz] = MIRROR_NORMALS[mi.facing] ?? [1, -1];
      let target = yawOf(nx, nz);
      // Turn clockwise (seen from above) towards the new facing.
      while (target > v.yaw + 1e-3) target -= TAU;
      while (target < v.yaw - TAU + 1e-3) target += TAU;
      v.yaw += Math.max(target - v.yaw, -dt * 2.4);
      v.drum.rotation.y = v.yaw;
      let lit = false;
      for (const b of m.beams) if (b.hits.includes(mi.id)) lit = true;
      v.disc.emissiveIntensity += ((lit ? 1.1 : 0.05) - v.disc.emissiveIntensity) * Math.min(1, dt * 6);
    }

    for (const r of m.receivers) {
      const v = this.receivers.get(r.id);
      if (!v) continue;
      if (r.lit && !v.was) v.flash = 1;
      v.was = r.lit;
      v.flash = Math.max(0, v.flash - dt * 1.4);
      v.k += ((r.lit ? 1 : 0) - v.k) * Math.min(1, dt * 3);
      const breathe = 0.9 + Math.sin(time * 3) * 0.1;
      v.disc.emissiveIntensity = 0.1 + v.k * 3.4 * breathe + v.flash * 4;
      v.halo.material.opacity = v.k * 0.9 + v.flash * 0.6;
      v.halo.scale.setScalar(3 + v.flash * 3);
      v.corona.material.opacity = v.k * 0.35 * breathe + v.flash * 0.4;
      v.corona.material.rotation = time * 0.2;
    }

    for (const b of m.beams) {
      const v = this.beams.get(b.id);
      if (v) this.updateBeam(v, b.points, time, eye);
    }
    BEAM_PULSE.value = 0.94 + Math.sin(time * 2.3) * 0.04 + Math.sin(time * 7.1) * 0.02;

    for (const it of m.items) {
      const v = this.items.get(it.id);
      if (!v) continue;
      v.visible = !it.taken;
      v.rotation.y = time * 0.8;
      v.position.y = 0.95 + Math.sin(time * 1.6) * 0.04;
    }

    for (const s of m.slots) {
      const v = this.slots.get(s.id);
      if (!v) continue;
      v.ray.visible = s.filled;
      v.k += ((s.filled ? 1 : 0) - v.k) * Math.min(1, dt * 1.5);
      v.face.emissiveIntensity = 0.05 + v.k * 1.4;
    }

    for (const t of m.trapdoors) {
      const v = this.trapdoors.get(t.id);
      if (!v) continue;
      for (const leaf of v.leaves) leaf.mesh.rotation.z = leaf.sign * t.open * (Math.PI * 0.48);
    }

    for (const b of m.boulders) this.updateBoulder(b.id, b.mode, b.time, b.pos, b.speed, world, dt);
    if (this.boulderDust && this.fancy) this.boulderDust.update(dt, eye);

    for (const v of this.blades) {
      if (!v.state || v.state.id !== v.def.id) {
        v.state = null;
        for (const st of m.blades) if (st.id === v.def.id) v.state = st;
      }
      if (!v.state) continue;
      const angle = bladeAngle(v.def, v.state);
      const rate = v.state.on ? bladeAngularSpeed(v.def, v.state) : 0;
      v.swing.rotation.z = angle;
      v.smear.rotation.z = angle;
      // Trail behind the swing: mirror the fan when it swings the other way.
      v.smear.scale.x = rate >= 0 ? -1 : 1;
      const max = (traps.blade.amplitude * TAU) / traps.blade.period;
      v.smearMat.opacity = Math.max(0, Math.abs(rate) / max - 0.35) * 0.55;
      v.smear.visible = this.fancy && v.smearMat.opacity > 0.001;
    }

    for (const f of this.fires) {
      if (!f.state || f.state.id !== f.def.id) {
        f.state = null;
        for (const st of m.fires) if (st.id === f.def.id) f.state = st;
      }
      this.updateFire(f, time, dt, eye);
    }
    this.updateFlames(time, eye);

    if (this.sunDisc) {
      for (const a of world.state.actors) {
        if (a.kind !== 'relic') continue;
        const floor = world.level.floorAt(center(a.cx), center(a.cz));
        this.sunDisc.visible = !a.taken;
        this.sunDisc.position.set(center(a.cx), floor + 1.15 + Math.sin(time * 1.3) * 0.05, center(a.cz));
        this.sunDisc.rotation.y = time * 0.4;
      }
      if (this.sunDiscRay) this.sunDiscRay.opacity = 0.7 + Math.sin(time * 4) * 0.3;
    }

    this.updateLights(eye, dt);
  }

  private updateBoulder(
    id: string,
    mode: string,
    t: number,
    pos: { x: number; y: number; z: number },
    speed: number,
    world: World,
    dt: number,
  ): void {
    const v = this.boulders.get(id);
    if (!v) return;
    const R = traps.boulder.radius;
    const start = v.start;
    if (mode === 'idle') {
      // Hidden in its niche above the ceiling.
      v.mesh.position.set(start.x, v.ceil + R + 0.1, start.z);
      v.last.set(start.x, 0, start.z);
      return;
    }
    if (mode === 'warning') {
      // It shakes loose and drops out of the ceiling; grit rains from the niche first.
      const floor = world.level.floorAt(start.x, start.z) + R;
      const k = Math.min(1, t / traps.boulder.warning);
      const fall = Math.max(0, (k - 0.55) / 0.45);
      const y = v.ceil + R * 0.2 - (v.ceil + R * 0.2 - floor) * fall * fall;
      v.mesh.position.set(start.x + Math.sin(t * 60) * 0.03 * (1 - fall), y, start.z);
      if (this.fancy && hash(Math.floor(t * 40), 5, 1) < 0.5)
        this.emitDust(
          start.x + (hash(Math.floor(t * 40), 1, 2) - 0.5) * 1.6,
          v.ceil - 0.1,
          start.z + (hash(Math.floor(t * 40), 2, 3) - 0.5) * 1.6,
          0,
          -2,
          0,
          true,
        );
      return;
    }
    v.mesh.position.set(pos.x, pos.y, pos.z);
    const dx = pos.x - v.last.x;
    const dz = pos.z - v.last.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-5) {
      _a.set(dz, 0, -dx).normalize();
      _q.setFromAxisAngle(_a, d / R);
      v.mesh.quaternion.premultiply(_q);
      // Dust kicked up behind it as it rolls.
      if (this.fancy && mode === 'rolling' && speed > 1) {
        const n = Math.min(3, Math.ceil(dt * speed * 4));
        for (let i = 0; i < n; i++) {
          const h = hash(Math.floor(t * 97) + i, 3, 7);
          this.emitDust(
            pos.x - (dx / d) * R * 0.8 + (h - 0.5) * 1.4,
            pos.y - R + 0.2,
            pos.z - (dz / d) * R * 0.8 + (hash(i, Math.floor(t * 97), 9) - 0.5) * 1.4,
            (h - 0.5) * 1.5,
            0.6 + h,
            (hash(i, 4, Math.floor(t * 31)) - 0.5) * 1.5,
            false,
          );
        }
      }
    }
    if (mode === 'done' && v.mesh.userData.crashed !== true) {
      v.mesh.userData.crashed = true;
      if (this.fancy)
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU;
          this.emitDust(
            pos.x,
            pos.y - R + 0.3,
            pos.z,
            Math.cos(a) * 3,
            0.8 + hash(i, 1, 1),
            Math.sin(a) * 3,
            false,
          );
        }
    } else if (mode !== 'done') v.mesh.userData.crashed = false;
    v.last.set(pos.x, 0, pos.z);
  }
}

function dirSalt(d: Dir): number {
  return d === 'N' ? 1 : d === 'E' ? 2 : d === 'S' ? 3 : 4;
}
