/**
 * Where each brazier's light may fall (roadmap 0.2.5, "per-room light mask").
 *
 * The fire pool's plain lights cast no shadows, so a brazier next to a wall lit
 * the floor of the room on the other side. Braziers never move, so each one
 * gets a small top-down mask of the grid around it, worked out once per level:
 * how much of each half metre can see the flame in plan, with 2D rays through
 * the grid (wall cells and cells outside the level block). The renderer
 * multiplies the light by the mask at each lit point, so light still spills
 * through doorways, with soft edges, but stops at walls.
 *
 * Pure logic with no Three.js, so it runs and is tested in Node.
 */
import { BLOCK } from '../sim/grid/units';

/** Mask texels per grid cell (2 m), so a texel is half a metre. */
export const MASK_RES = 4;
/** Cells from the brazier's cell to the edge of its mask (beyond the lights' 18 m reach). */
export const MASK_RADIUS = 9;
/** Texels along each side of one brazier's mask. */
export const MASK_SIZE = (2 * MASK_RADIUS + 1) * MASK_RES;
/** Points across the flame (m) the rays start from, for soft edges at doorways. */
const SOURCE_SPREAD = 0.35;

/** What the mask needs from a level: whether light passes a cell. */
export interface MaskGrid {
  /** Open (not a wall, inside the level). */
  open(cx: number, cz: number): boolean;
}

export interface FireMask {
  /** World x and z of the mask's corner (its texel 0, 0). */
  originX: number;
  originZ: number;
  /** MASK_SIZE × MASK_SIZE values, 0..255, row by row along +z. */
  data: Uint8Array;
}

/** Whether a straight line in plan from (x0, z0) to (x1, z1) stays in open cells (2D DDA). */
export function clearLine(grid: MaskGrid, x0: number, z0: number, x1: number, z1: number): boolean {
  let cx = Math.floor(x0 / BLOCK);
  let cz = Math.floor(z0 / BLOCK);
  const ex = Math.floor(x1 / BLOCK);
  const ez = Math.floor(z1 / BLOCK);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(BLOCK / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(BLOCK / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? (cx + 1) * BLOCK - x0 : x0 - cx * BLOCK) / Math.abs(dx) : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? (cz + 1) * BLOCK - z0 : z0 - cz * BLOCK) / Math.abs(dz) : Infinity;
  for (let guard = 0; guard < 64; guard++) {
    if (!grid.open(cx, cz)) return false;
    if (cx === ex && cz === ez) return true;
    if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
      // Exactly through a corner: light passes only if one of the two side cells is open.
      if (!grid.open(cx + stepX, cz) && !grid.open(cx, cz + stepZ)) return false;
      cx += stepX;
      cz += stepZ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cz += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
  return true;
}

/** The mask of a brazier whose flame is at (x, z). */
export function fireMask(grid: MaskGrid, x: number, z: number): FireMask {
  const ccx = Math.floor(x / BLOCK);
  const ccz = Math.floor(z / BLOCK);
  const originX = (ccx - MASK_RADIUS) * BLOCK;
  const originZ = (ccz - MASK_RADIUS) * BLOCK;
  const texel = BLOCK / MASK_RES;
  const n = MASK_SIZE;
  const sources = [
    [x, z],
    [x + SOURCE_SPREAD, z],
    [x - SOURCE_SPREAD, z],
    [x, z + SOURCE_SPREAD],
    [x, z - SOURCE_SPREAD],
  ].filter(([sx, sz]) => grid.open(Math.floor((sx ?? 0) / BLOCK), Math.floor((sz ?? 0) / BLOCK)));
  // -1 marks texels inside walls, filled from their open neighbours below.
  const value = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const px = originX + (i + 0.5) * texel;
      const pz = originZ + (j + 0.5) * texel;
      if (!grid.open(Math.floor(px / BLOCK), Math.floor(pz / BLOCK))) {
        value[j * n + i] = -1;
        continue;
      }
      let seen = 0;
      for (const [sx, sz] of sources) if (clearLine(grid, sx ?? x, sz ?? z, px, pz)) seen++;
      value[j * n + i] = sources.length ? seen / sources.length : 0;
    }
  }
  // Wall texels take their open neighbours' light, two texels deep (a wall is four texels thick),
  // so filtering keeps a lit wall face lit and never reaches the far side.
  for (let pass = 0; pass < 2; pass++) {
    const prev = value.slice();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if ((prev[j * n + i] ?? 0) >= 0) continue;
        let sum = 0;
        let count = 0;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= n || b >= n) continue;
          const v = prev[b * n + a] ?? -1;
          if (v >= 0) {
            sum += v;
            count++;
          }
        }
        if (count) value[j * n + i] = sum / count;
      }
    }
  }
  const data = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // The border stays dark, so filtering never reads a neighbouring mask in the atlas.
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      const v = value[j * n + i] ?? 0;
      data[j * n + i] = edge || v < 0 ? 0 : Math.round(v * 255);
    }
  }
  return { originX, originZ, data };
}

export interface MaskAtlas {
  width: number;
  height: number;
  /** R8 texels, row by row. */
  data: Uint8Array;
  /** Per brazier: its mask's world corner and texel offset in the atlas. */
  tiles: { originX: number; originZ: number; tileX: number; tileY: number }[];
}

/** Packs the braziers' masks into one texture, in a near-square grid of tiles. */
export function maskAtlas(masks: readonly FireMask[]): MaskAtlas {
  const cols = Math.max(1, Math.ceil(Math.sqrt(masks.length)));
  const rows = Math.max(1, Math.ceil(masks.length / cols));
  const width = cols * MASK_SIZE;
  const height = rows * MASK_SIZE;
  const data = new Uint8Array(width * height);
  const tiles = masks.map((m, k) => {
    const tileX = (k % cols) * MASK_SIZE;
    const tileY = Math.floor(k / cols) * MASK_SIZE;
    for (let j = 0; j < MASK_SIZE; j++) {
      data.set(m.data.subarray(j * MASK_SIZE, (j + 1) * MASK_SIZE), (tileY + j) * width + tileX);
    }
    return { originX: m.originX, originZ: m.originZ, tileX, tileY };
  });
  return { width, height, data, tiles };
}
