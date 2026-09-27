/**
 * Pure maths behind the water (render/water.ts): the procedural ripple and
 * caustic textures, the shoreline distance each surface cell knows from its
 * neighbours, light absorption from a room's water tint, and the triangles
 * of the level that take caustics.
 *
 * No Three.js and no DOM, so it runs (and is tested) in Node. The shader
 * functions in water.ts mirror `shoreDistance` and `absorption`.
 */

/** A small seeded generator (mulberry32): the textures are the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HeightField {
  size: number;
  /** Height per texel, row major. */
  h: Float32Array;
  /** Slope along u and v per texel (height units per texture period). */
  du: Float32Array;
  dv: Float32Array;
}

/**
 * A tileable height field: a sum of `waves` travelling waves whose wave
 * vectors are whole numbers of periods across the texture (so it wraps with
 * no seam), directions spread all round, wavelengths between 1/kMax and
 * 1/kMin of the texture and amplitude falling as k^-falloff (a ripple
 * spectrum rather than a regular pattern).
 *
 * The phase of each wave is separable (cos(a + b) from per-row and
 * per-column tables), so a 256² field of 64 waves costs a few million
 * multiplies rather than as many cosines.
 */
export function rippleField(
  size: number,
  seed: number,
  waves = 48,
  kMin = 1.5,
  kMax = 12,
  falloff = 2,
): HeightField {
  const rnd = seeded(seed);
  const n = size * size;
  const h = new Float32Array(n);
  const du = new Float32Array(n);
  const dv = new Float32Array(n);
  const cu = new Float32Array(size);
  const su = new Float32Array(size);
  const cv = new Float32Array(size);
  const sv = new Float32Array(size);
  const used = new Set<string>();
  for (let w = 0; w < waves; w++) {
    let kx = 0;
    let ky = 0;
    for (let tries = 0; tries < 32; tries++) {
      const k = kMin + (kMax - kMin) * Math.pow(rnd(), 1.5);
      const a = rnd() * Math.PI * 2;
      kx = Math.round(Math.cos(a) * k);
      ky = Math.round(Math.sin(a) * k);
      if ((kx !== 0 || ky !== 0) && !used.has(`${kx},${ky}`)) break;
    }
    used.add(`${kx},${ky}`);
    const k = Math.hypot(kx, ky);
    const amp = Math.pow(k, -falloff);
    const phase = rnd() * Math.PI * 2;
    for (let i = 0; i < size; i++) {
      const pu = (2 * Math.PI * kx * i) / size + phase;
      const pv = (2 * Math.PI * ky * i) / size;
      cu[i] = Math.cos(pu);
      su[i] = Math.sin(pu);
      cv[i] = Math.cos(pv);
      sv[i] = Math.sin(pv);
    }
    const gx = -amp * 2 * Math.PI * kx;
    const gy = -amp * 2 * Math.PI * ky;
    for (let y = 0; y < size; y++) {
      const cy = cv[y] ?? 0;
      const sy = sv[y] ?? 0;
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const cx = cu[x] ?? 0;
        const sx = su[x] ?? 0;
        const c = cx * cy - sx * sy;
        const s = sx * cy + cx * sy;
        const i = row + x;
        h[i] = (h[i] ?? 0) + amp * c;
        du[i] = (du[i] ?? 0) + gx * s;
        dv[i] = (dv[i] ?? 0) + gy * s;
      }
    }
  }
  return { size, h, du, dv };
}

const maxAbs = (a: Float32Array): number => {
  let m = 1e-9;
  for (const v of a) m = Math.max(m, Math.abs(v));
  return m;
};

/**
 * The ripple texture: RG hold the slope (0.5 flat; the shader scales it by
 * `slopeScale`), B the height (0..1, for foam breakup), A is opaque.
 * Slopes rather than normals, so bilinear filtering and mipmaps average
 * them correctly and distant water flattens instead of shimmering.
 */
export function rippleTexture(size = 256, seed = 7): { data: Uint8Array; size: number; slopeScale: number } {
  const f = rippleField(size, seed);
  const slopeScale = Math.max(maxAbs(f.du), maxAbs(f.dv));
  const hMax = maxAbs(f.h);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(((f.du[i] ?? 0) / slopeScale) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round(((f.dv[i] ?? 0) / slopeScale) * 127.5 + 127.5);
    data[i * 4 + 2] = Math.round(((f.h[i] ?? 0) / hMax) * 127.5 + 127.5);
    data[i * 4 + 3] = 255;
  }
  return { data, size, slopeScale };
}

/**
 * A tileable caustic pattern: light falling through a rippled surface onto
 * a floor below, traced as a grid of photons bent by the surface slope and
 * gathered (with wrap-around, so it tiles) where they land. The result has
 * the bright, curved lines of real caustics rather than a cell pattern.
 * Returns one byte per texel: sqrt(intensity / `peak`), mean intensity 1.
 */
export function causticTexture(
  size = 256,
  seed = 11,
  bend = 0.09,
): { data: Uint8Array; size: number; peak: number } {
  const f = rippleField(size, seed, 40, 1.5, 7, 2);
  const slope = Math.max(maxAbs(f.du), maxAbs(f.dv));
  const acc = new Float32Array(size * size);
  const photons = size * 2;
  const step = size / photons;
  for (let j = 0; j < photons; j++) {
    for (let i = 0; i < photons; i++) {
      const x = (i + 0.5) * step;
      const y = (j + 0.5) * step;
      const t = Math.floor(y) * size + Math.floor(x);
      // Light bends down the slope; the landing point shifts by the slope (in texels).
      const lx = x - ((f.du[t] ?? 0) / slope) * bend * size;
      const ly = y - ((f.dv[t] ?? 0) / slope) * bend * size;
      const x0 = Math.floor(lx - 0.5);
      const y0 = Math.floor(ly - 0.5);
      const fx = lx - 0.5 - x0;
      const fy = ly - 0.5 - y0;
      const wrap = (v: number): number => ((v % size) + size) % size;
      const a = wrap(x0);
      const b = wrap(x0 + 1);
      const c = wrap(y0) * size;
      const d = wrap(y0 + 1) * size;
      acc[c + a] = (acc[c + a] ?? 0) + (1 - fx) * (1 - fy);
      acc[c + b] = (acc[c + b] ?? 0) + fx * (1 - fy);
      acc[d + a] = (acc[d + a] ?? 0) + (1 - fx) * fy;
      acc[d + b] = (acc[d + b] ?? 0) + fx * fy;
    }
  }
  // A light 3 × 3 blur hides the photon grid, then normalise to a mean of 1.
  const out = new Float32Array(size * size);
  let sum = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          v += (acc[((y + dy + size) % size) * size + ((x + dx + size) % size)] ?? 0) * w;
        }
      }
      out[y * size + x] = v / 16;
      sum += v / 16;
    }
  }
  const mean = sum / (size * size);
  const peak = 6;
  const data = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const v = (out[i] ?? 0) / mean;
    data[i] = Math.round(Math.sqrt(Math.min(1, v / peak)) * 255);
  }
  return { data, size, peak };
}

/**
 * Neighbour order for the shoreline: the four edges (−z, +x, +z, −x) then
 * the four corners (−x−z, +x−z, +x+z, −x+z), as offsets in cells.
 */
export const SHORE_NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Height standing in for a wall (or anything outside the level): always above the water. */
export const SHORE_WALL = 1e3;

/**
 * Distance (m) from a point inside a surface cell to the nearest shore: an
 * edge whose neighbour's top (`tops[0..3]`) is above the water, or a corner
 * whose diagonal neighbour's top (`tops[4..7]`) is (the corner of a pillar).
 * `lx`, `lz` are the point's position inside the cell (0..cell). Returns
 * `far` when nothing near is dry. The water shader computes the same.
 */
export function shoreDistance(
  lx: number,
  lz: number,
  tops: readonly number[],
  level: number,
  cell: number,
  far = 10,
): number {
  const dry = (i: number): boolean => (tops[i] ?? SHORE_WALL) > level - 0.02;
  let d = far;
  if (dry(0)) d = Math.min(d, lz);
  if (dry(1)) d = Math.min(d, cell - lx);
  if (dry(2)) d = Math.min(d, cell - lz);
  if (dry(3)) d = Math.min(d, lx);
  const corners: [number, number][] = [
    [0, 0],
    [cell, 0],
    [cell, cell],
    [0, cell],
  ];
  corners.forEach(([cx, cz], k) => {
    if (dry(4 + k)) d = Math.min(d, Math.hypot(lx - cx, lz - cz));
  });
  return d;
}

/** Depth (m) at which light through the water keeps the room's tint: sets how fast colour is absorbed. */
export const TINT_DEPTH = 2.4;

/**
 * Absorption coefficients (1/m) per channel from the water's tint (linear
 * RGB): light crossing TINT_DEPTH metres of water is multiplied by the
 * tint, so shallows stay clear and deep water takes its colour (red goes
 * first). Channels are clamped so no colour is absorbed completely at once.
 */
export function absorption(tint: readonly [number, number, number]): [number, number, number] {
  const k = (c: number): number => -Math.log(Math.min(0.98, Math.max(0.02, c))) / TINT_DEPTH;
  return [k(tint[0]), k(tint[1]), k(tint[2])];
}

/** Light left after crossing `d` metres of water with absorption `sigma`. */
export function transmittance(sigma: readonly [number, number, number], d: number): [number, number, number] {
  return [Math.exp(-sigma[0] * d), Math.exp(-sigma[1] * d), Math.exp(-sigma[2] * d)];
}

/**
 * How a gated room's water moves: +1 while it rises, −1 while it drains,
 * 0 when still (drives the drift of the ripples and foam at the gate).
 */
export function flowSign(y: number, target: number): -1 | 0 | 1 {
  if (Math.abs(target - y) < 1e-6) return 0;
  return target > y ? 1 : -1;
}

/**
 * The triangles of a mesh that take caustics: those reaching below `top`
 * (the highest water plus the band of reflected light above it) and above
 * `bottom` (deep floors are too dark to matter), copied with each vertex
 * pushed `lift` metres along its normal so the copy never fights the level
 * for depth. Position and normal only: the pattern is in world space.
 */
export function causticTriangles(
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  index: ArrayLike<number> | null,
  top: number,
  bottom: number,
  lift = 0.01,
  keep: (x: number, z: number, nx: number, nz: number) => boolean = () => true,
): { position: number[]; normal: number[] } {
  const pos: number[] = [];
  const nor: number[] = [];
  const count = index ? index.length : position.length / 3;
  const at = (k: number): number => (index ? (index[k] ?? 0) : k);
  for (let t = 0; t + 2 < count; t += 3) {
    const a = at(t);
    const b = at(t + 1);
    const c = at(t + 2);
    const ya = position[a * 3 + 1] ?? 0;
    const yb = position[b * 3 + 1] ?? 0;
    const yc = position[c * 3 + 1] ?? 0;
    if (Math.min(ya, yb, yc) >= top || Math.max(ya, yb, yc) <= bottom) continue;
    const mx = ((position[a * 3] ?? 0) + (position[b * 3] ?? 0) + (position[c * 3] ?? 0)) / 3;
    const mz = ((position[a * 3 + 2] ?? 0) + (position[b * 3 + 2] ?? 0) + (position[c * 3 + 2] ?? 0)) / 3;
    const nx = normal[a * 3] ?? 0;
    const nz = normal[a * 3 + 2] ?? 0;
    if (!keep(mx, mz, nx, nz)) continue;
    for (const v of [a, b, c]) {
      const x = normal[v * 3] ?? 0;
      const y = normal[v * 3 + 1] ?? 0;
      const z = normal[v * 3 + 2] ?? 0;
      pos.push(
        (position[v * 3] ?? 0) + x * lift,
        (position[v * 3 + 1] ?? 0) + y * lift,
        (position[v * 3 + 2] ?? 0) + z * lift,
      );
      nor.push(x, y, z);
    }
  }
  return { position: pos, normal: nor };
}

/**
 * Openings in the ceiling (skylight cells, centres in metres) grouped into
 * rectangles: cells closer than `join` metres belong to one opening.
 */
export function skylightOpenings(
  cells: readonly { x: number; z: number; ceil: number }[],
  cell: number,
  join = 2.5,
): { minX: number; minZ: number; maxX: number; maxZ: number; ceil: number }[] {
  const out: { minX: number; minZ: number; maxX: number; maxZ: number; ceil: number }[] = [];
  const h = cell / 2;
  for (const c of cells) {
    const hit = out.find(
      (o) =>
        Math.abs(o.ceil - c.ceil) < 1e-3 &&
        c.x - h <= o.maxX + join - cell &&
        c.x + h >= o.minX - join + cell &&
        c.z - h <= o.maxZ + join - cell &&
        c.z + h >= o.minZ - join + cell,
    );
    if (hit) {
      hit.minX = Math.min(hit.minX, c.x - h);
      hit.minZ = Math.min(hit.minZ, c.z - h);
      hit.maxX = Math.max(hit.maxX, c.x + h);
      hit.maxZ = Math.max(hit.maxZ, c.z + h);
    } else {
      out.push({ minX: c.x - h, minZ: c.z - h, maxX: c.x + h, maxZ: c.z + h, ceil: c.ceil });
    }
  }
  return out;
}
