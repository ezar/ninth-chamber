/**
 * Procedural PBR textures (albedo, normal, roughness) generated on a canvas at
 * startup, so the game has believable surfaces before scanned CC0 textures
 * (Poly Haven, ambientCG) are added under assets/textures/.
 *
 * Each texture covers one 2 × 2 m block and tiles seamlessly.
 */
import * as THREE from 'three/webgpu';
import { Rng } from '../core/rng';

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

type Rgb = [number, number, number];

/** Tileable value noise on a square lattice. */
class Noise {
  private readonly values: Float32Array;
  constructor(
    private readonly size: number,
    seed: number,
  ) {
    const rng = new Rng(seed);
    this.values = new Float32Array(size * size);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rng.next();
  }
  private at(x: number, y: number): number {
    const s = this.size;
    return this.values[(((y % s) + s) % s) * s + (((x % s) + s) % s)] ?? 0;
  }
  /** u, v in [0, 1); `freq` lattice cells across the tile (must divide size). */
  sample(u: number, v: number, freq: number): number {
    const x = u * freq;
    const y = v * freq;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const step = this.size / freq;
    const a = this.at(x0 * step, y0 * step);
    const b = this.at((x0 + 1) * step, y0 * step);
    const c = this.at(x0 * step, (y0 + 1) * step);
    const d = this.at((x0 + 1) * step, (y0 + 1) * step);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(u: number, v: number, base: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let f = base;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.sample(u, v, f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

interface Field {
  height: Float32Array;
  albedo: Float32Array;
  rough: Float32Array;
}

function field(size: number): Field {
  return {
    height: new Float32Array(size * size),
    albedo: new Float32Array(size * size * 3),
    rough: new Float32Array(size * size),
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const hex = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function toTextures(f: Field, size: number, normalStrength: number, name: string): PbrSet {
  const albedo = new ImageData(size, size);
  const normal = new ImageData(size, size);
  const rough = new ImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = (xx: number, yy: number): number =>
        f.height[((yy + size) % size) * size + ((xx + size) % size)] ?? 0;
      const dx = (h(x + 1, y) - h(x - 1, y)) * normalStrength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * normalStrength;
      const len = Math.hypot(dx, dy, 1);
      const o = i * 4;
      normal.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      normal.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      normal.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal.data[o + 3] = 255;
      for (let c = 0; c < 3; c++) albedo.data[o + c] = clamp01(f.albedo[i * 3 + c] ?? 0) ** (1 / 2.2) * 255;
      albedo.data[o + 3] = 255;
      const r = clamp01(f.rough[i] ?? 0.8) * 255;
      rough.data[o] = r;
      rough.data[o + 1] = r;
      rough.data[o + 2] = r;
      rough.data[o + 3] = 255;
    }
  }
  const make = (img: ImageData, srgb: boolean): THREE.Texture => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d')?.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.name = name;
    return t;
  };
  return { map: make(albedo, true), normalMap: make(normal, false), roughnessMap: make(rough, false) };
}

/** Ashlar masonry: courses of dressed blocks with recessed, eroded joints. */
export function ashlar(opts: {
  size?: number;
  seed?: number;
  base: string;
  courses: number;
  tint?: number;
}): PbrSet {
  const size = opts.size ?? 512;
  const f = field(size);
  const n = new Noise(256, opts.seed ?? 11);
  const rng = new Rng((opts.seed ?? 11) * 7 + 3);
  const base = hex(opts.base);
  const courses = opts.courses;
  // Block layout per course: 1–3 blocks with random joints, offset per course.
  const joints: number[][] = [];
  const tints: number[][] = [];
  for (let c = 0; c < courses; c++) {
    const count = rng.int(2, 3);
    const cuts = [0];
    for (let k = 1; k < count; k++) cuts.push((k + rng.range(-0.25, 0.25)) / count);
    const shift = rng.next();
    joints.push(cuts.map((u) => (u + shift) % 1).sort((a, b) => a - b));
    tints.push(Array.from({ length: count }, () => rng.range(-0.08, 0.08)));
  }
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const course = Math.min(courses - 1, Math.floor(v * courses));
    const cv = v * courses - course;
    const row = joints[course] ?? [0];
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let block = 0;
      let du = 1;
      for (let k = 0; k < row.length; k++) {
        const j = row[k] ?? 0;
        const d = Math.min(Math.abs(u - j), 1 - Math.abs(u - j));
        du = Math.min(du, d);
        if (u >= j) block = k;
      }
      if (u < (row[0] ?? 0)) block = row.length - 1;
      const edgeV = Math.min(cv, 1 - cv) / courses;
      const edge = Math.min(du, edgeV);
      const wobble = (n.fbm(u, v, 16, 3) - 0.5) * 0.012;
      const joint = 1 - clamp01((edge + wobble - 0.004) / 0.012);
      const grain = n.fbm(u, v, 32, 5);
      const pits = clamp01((n.fbm(u + 0.37, v + 0.11, 64, 2) - 0.68) * 4);
      const erosion = n.fbm(u, v, 4, 3);
      const i = y * size + x;
      f.height[i] = (1 - joint) * (0.8 + grain * 0.2) - pits * 0.25 - joint * 0.3 + erosion * 0.1;
      const t = (tints[course]?.[block] ?? 0) + (opts.tint ?? 0);
      const shade = 0.82 + grain * 0.3 + t - joint * 0.35 - pits * 0.15 + (erosion - 0.5) * 0.12;
      f.albedo[i * 3] = base[0] * shade;
      f.albedo[i * 3 + 1] = base[1] * shade;
      f.albedo[i * 3 + 2] = base[2] * shade * 0.97;
      f.rough[i] = 0.78 + joint * 0.18 + grain * 0.06;
    }
  }
  return toTextures(f, size, 3, 'ashlar');
}

/** Worn flagstone floor: large irregular slabs with dust in the joints. */
export function flagstones(opts: { size?: number; seed?: number; base: string; slabs: number }): PbrSet {
  const size = opts.size ?? 512;
  const f = field(size);
  const n = new Noise(256, opts.seed ?? 5);
  const rng = new Rng((opts.seed ?? 5) * 13 + 1);
  const base = hex(opts.base);
  // Voronoi cells jittered on a grid give irregular slabs; tileable by wrapping.
  const g = opts.slabs;
  const pts: { x: number; y: number; t: number }[] = [];
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) {
      pts.push({
        x: (i + 0.5 + rng.range(-0.3, 0.3)) / g,
        y: (j + 0.5 + rng.range(-0.3, 0.3)) / g,
        t: rng.range(-0.1, 0.1),
      });
    }
  }
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let d1 = 9;
      let d2 = 9;
      let tint = 0;
      for (const p of pts) {
        let dx = Math.abs(u - p.x);
        let dy = Math.abs(v - p.y);
        dx = Math.min(dx, 1 - dx);
        dy = Math.min(dy, 1 - dy);
        const d = Math.max(dx, dy) * 0.88 + Math.hypot(dx, dy) * 0.12;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tint = p.t;
        } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1;
      const joint = 1 - clamp01((edge - 0.002) / 0.012);
      const grain = n.fbm(u, v, 32, 5);
      const wear = n.fbm(u, v, 4, 3);
      const cracks = clamp01(1 - Math.abs(n.fbm(u * 1.0, v, 8, 4) - 0.5) * 90) * 0.25;
      const i = y * size + x;
      f.height[i] = 1 - joint * 0.45 - cracks * 0.15 + grain * 0.12 + wear * 0.1;
      const shade = 0.86 + grain * 0.22 + tint - joint * 0.2 - cracks * 0.15 + (wear - 0.5) * 0.2;
      // Dust settles in joints: lighter and warmer.
      const dust = joint * 0.5;
      f.albedo[i * 3] = base[0] * shade + dust * 0.12;
      f.albedo[i * 3 + 1] = base[1] * shade + dust * 0.1;
      f.albedo[i * 3 + 2] = base[2] * shade + dust * 0.06;
      f.rough[i] = 0.7 + joint * 0.25 - (1 - wear) * 0.1;
    }
  }
  return toTextures(f, size, 2.5, 'flagstones');
}

/** Wind-rippled sand. */
export function sand(opts: { size?: number; seed?: number; base: string }): PbrSet {
  const size = opts.size ?? 512;
  const f = field(size);
  const n = new Noise(256, opts.seed ?? 3);
  const base = hex(opts.base);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const warp = n.fbm(u, v, 4, 3) * 0.6;
      const ripple = Math.sin((u * 0.3 + v + warp) * Math.PI * 2 * 8) * 0.5 + 0.5;
      const grain = n.fbm(u, v, 128, 2);
      const i = y * size + x;
      f.height[i] = ripple * 0.5 + grain * 0.2;
      const shade = 0.9 + ripple * 0.08 + (grain - 0.5) * 0.18 + (n.fbm(u, v, 8, 3) - 0.5) * 0.15;
      f.albedo[i * 3] = base[0] * shade;
      f.albedo[i * 3 + 1] = base[1] * shade;
      f.albedo[i * 3 + 2] = base[2] * shade;
      f.rough[i] = 0.92 - grain * 0.06;
    }
  }
  return toTextures(f, size, 3, 'sand');
}

/** Rough, chisel-marked rock for ceilings and pit walls. */
export function rock(opts: { size?: number; seed?: number; base: string }): PbrSet {
  const size = opts.size ?? 512;
  const f = field(size);
  const n = new Noise(256, opts.seed ?? 9);
  const base = hex(opts.base);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const big = n.fbm(u, v, 4, 4);
      const chisel = Math.abs(Math.sin((u + v * 0.3 + big * 0.2) * Math.PI * 2 * 24)) ** 4 * 0.2;
      const grain = n.fbm(u, v, 64, 3);
      const i = y * size + x;
      f.height[i] = big * 0.8 + grain * 0.2 - chisel;
      const shade = 0.7 + big * 0.4 + (grain - 0.5) * 0.2 - chisel * 0.5;
      f.albedo[i * 3] = base[0] * shade;
      f.albedo[i * 3 + 1] = base[1] * shade;
      f.albedo[i * 3 + 2] = base[2] * shade;
      f.rough[i] = 0.85 + grain * 0.1;
    }
  }
  return toTextures(f, size, 6, 'rock');
}

/** Hairline crack pattern over a flagstone, for tiles that are about to give way. */
export function cracked(src: PbrSet, seed = 21): THREE.Texture {
  const img = src.map.image as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  if (!g) return src.map;
  g.drawImage(img, 0, 0);
  const rng = new Rng(seed);
  g.strokeStyle = 'rgba(25, 16, 8, 0.85)';
  g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    let x = c.width * rng.range(0.3, 0.7);
    let y = c.height * rng.range(0.3, 0.7);
    let a = rng.range(0, Math.PI * 2);
    g.lineWidth = rng.range(1.2, 2.6);
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      a += rng.range(-0.6, 0.6);
      x += Math.cos(a) * c.width * 0.035;
      y += Math.sin(a) * c.height * 0.035;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
