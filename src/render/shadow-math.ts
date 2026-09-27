/**
 * Shadow geometry that does not need Three.js, so it runs and is tested in
 * Node: where the sun can shine (the skylight window), how its orthographic
 * shadow camera is fitted and snapped to texels, and the depth and normal
 * biases each shadow needs for its texel size.
 *
 * Biases are derived from texel sizes rather than tuned by eye. A shadow map
 * texel covers `texel` metres of the receiver; a surface tilted away from the
 * light spans up to about one texel of depth inside it, and the PCF taps
 * reach `radius` texels sideways. So the receiver is pushed along its
 * geometric normal by about a texel (scaled by the filter reach), and its
 * depth towards the light by about a texel. Every quantity is in world
 * metres; the renderer converts to the shadow map's depth units.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** A skylight cell: centre (x, z) of the 2 m opening and the ceiling height it pierces. */
export interface SkylightCell {
  x: number;
  z: number;
  ceil: number;
}

/** Half the width of a skylight cell (a grid block is 2 m). */
export const SKYLIGHT_HALF = 1;
/**
 * Ceiling rim kept inside the sun's shadow map around the opening (m), so
 * the edge of the sunlit patch is filtered from real geometry instead of
 * being cut by the frustum.
 */
export const WINDOW_RIM = 0.6;
/** Extra depth above the ceiling and below the lowest floor in the sun's frustum (m). */
export const WINDOW_DEPTH_PAD = 1;

/** Normal offset, in texels (before the filter's reach is added). */
export const NORMAL_TEXELS = 1;
/** Depth bias towards the light, in texels. */
export const DEPTH_TEXELS = 1.5;
/** Share of the PCF radius added to the normal offset: taps that far sideways must not self-shadow. */
export const RADIUS_SHARE = 0.5;

/**
 * The world-space corners of everything the sun can light through a room's
 * skylight: the opening (grown by `rim`) at the ceiling, and the same outline
 * carried along the light down to `floor`. Anything outside this prism is
 * under the roof, so the sun's frustum only needs to cover it.
 * `sunDir` points from the scene towards the sun (y > 0).
 */
export function skylightPrism(
  cells: readonly SkylightCell[],
  floor: number,
  sunDir: V3,
  rim = WINDOW_RIM,
  pad = WINDOW_DEPTH_PAD,
): V3[] {
  if (cells.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let ceil = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.x - SKYLIGHT_HALF - rim);
    maxX = Math.max(maxX, c.x + SKYLIGHT_HALF + rim);
    minZ = Math.min(minZ, c.z - SKYLIGHT_HALF - rim);
    maxZ = Math.max(maxZ, c.z + SKYLIGHT_HALF + rim);
    ceil = Math.max(ceil, c.ceil);
  }
  const top = ceil + pad;
  const bottom = floor - pad;
  // Along the light (towards -sunDir) from the top down to the bottom.
  const dy = Math.max(0.05, sunDir.y);
  const run = (top - bottom) / dy;
  const out: V3[] = [];
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      out.push({ x, y: top, z });
      out.push({ x: x - sunDir.x * run, y: bottom, z: z - sunDir.z * run });
    }
  }
  return out;
}

/** An orthographic shadow frustum in light-view space, with its texel size (m). */
export interface OrthoFit {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  /** World metres per shadow-map texel. */
  texel: number;
}

/**
 * Fits a square orthographic frustum around points given in the shadow
 * camera's view space (x right, y up, looking down -z). The square keeps
 * texels square; its centre is snapped to whole texels so a refit with the
 * same light direction lands on the same texel grid (no shimmering edges).
 */
export function fitOrtho(points: readonly V3[], mapSize: number, margin = 0): OrthoFit {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  if (!Number.isFinite(minX))
    return { left: -1, right: 1, top: 1, bottom: -1, near: 0.5, far: 10, texel: 2 / mapSize };
  // One texel of slack on each side so snapping never cuts the fitted points.
  const raw = Math.max(maxX - minX, maxY - minY) + 2 * margin;
  const texel = raw / Math.max(1, mapSize - 2);
  const half = (texel * mapSize) / 2;
  const cx = snap((minX + maxX) / 2, texel);
  const cy = snap((minY + maxY) / 2, texel);
  return {
    left: cx - half,
    right: cx + half,
    top: cy + half,
    bottom: cy - half,
    // The camera looks down -z: the nearest point has the largest z.
    near: Math.max(0.01, -maxZ),
    far: Math.max(0.02, -minZ),
    texel,
  };
}

/** `v` rounded to the nearest multiple of `step`. */
export function snap(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

/** World-space biases (m) for a shadow whose texel covers `texel` metres, filtered `radius` texels wide. */
export function texelBias(texel: number, radius: number): { normal: number; depth: number } {
  return {
    normal: texel * (NORMAL_TEXELS + RADIUS_SHARE * Math.max(0, radius)),
    depth: texel * DEPTH_TEXELS,
  };
}

/**
 * An orthographic (sun) shadow's biases in three.js' terms: `bias` in the
 * shadow map's normalised depth (negative: towards the light) and
 * `normalBias` in metres.
 */
export function orthoBias(fit: OrthoFit, radius: number): { bias: number; normalBias: number } {
  const b = texelBias(fit.texel, radius);
  return { bias: -b.depth / Math.max(1e-3, fit.far - fit.near), normalBias: b.normal };
}

/**
 * Width (m) of one texel of a cube shadow map at `distance` from the light
 * (measured along the face axis). A face spans 90°, i.e. 2·distance over
 * `mapSize` texels at its centre; towards the face edges texels shrink, so
 * the centre value is the conservative one.
 */
export function cubeTexel(distance: number, mapSize: number): number {
  return (2 * Math.max(0, distance)) / Math.max(1, mapSize);
}

/**
 * The perspective depth a cube shadow face stores for a point `viewZ`
 * metres along its axis (WebGPU and WebGL 2 both use 0..1 depth in three's
 * node renderer). The shader does the same maths; this is for tests.
 */
export function perspectiveDepth(viewZ: number, near: number, far: number): number {
  return (far * (viewZ - near)) / (viewZ * (far - near));
}

/**
 * World-space distance (m) that a constant bias in perspective depth
 * amounts to at `viewZ`: how far the old fixed point-light bias pulled the
 * compare towards the light. Grows with the square of the distance.
 */
export function perspectiveBiasToWorld(bias: number, viewZ: number, near: number, far: number): number {
  // d(depth)/dz = far·near / (z²·(far − near))
  const slope = (far * near) / (viewZ * viewZ * (far - near));
  return Math.abs(bias) / slope;
}

/** How much lower (m) the floor may be before a contact blob stops at the edge. */
export const LEDGE_DROP = 0.08;

/**
 * Contact blob reach (m, up to `maxR`): how far the floor around (x, z)
 * stays at `floor` before dropping away (a ledge, a pit). The blob shrinks
 * to it so it never hangs in the air past an edge. Higher floors and walls
 * do not limit it: the depth test hides the part that runs into them.
 */
export function levelReach(
  floorAt: (x: number, z: number) => number,
  x: number,
  z: number,
  floor: number,
  maxR: number,
): number {
  let reach = maxR;
  for (let k = 0; k < 8; k++) {
    const dx = Math.cos((k * Math.PI) / 4);
    const dz = Math.sin((k * Math.PI) / 4);
    for (let r = 0.2; r < reach + 1e-6; r += 0.1) {
      const f = floorAt(x + dx * r, z + dz * r);
      if (!Number.isFinite(f) || f < floor - LEDGE_DROP) {
        reach = Math.min(reach, Math.max(0.15, r - 0.1));
        break;
      }
    }
  }
  return reach;
}
