/**
 * Water (spec §11 "Agua": refraction, reflections, edge foam and caustics
 * projected on the walls and floors of the cisterns).
 *
 * - One surface mesh per wet room, covering every cell the room's water can
 *   reach (for a gate-controlled room, up to its high level), raised to the
 *   current level each frame. Cells whose floor is above the water are cut
 *   away in the shader, so a rising level floods them smoothly. Each surface
 *   lives in its room's group, so room culling hides it with the room.
 * - The surface is a TSL node material:
 *   - normals from a slow swell of analytic waves plus two or three layers
 *     of a procedural ripple texture (render/water-maths.ts) at unrelated
 *     scales, angles and drifts, so no tiling shows; the texture holds
 *     slopes, so its mipmaps flatten distant water instead of shimmering;
 *   - a Schlick fresnel between the reflection and what lies under the
 *     surface. The reflection is the room's darkness, the walls lit around
 *     each fire and flare (a broad lobe), their sharp glints (sharper up
 *     close, wider and dimmer far away, so they do not sparkle) and the sky
 *     through the skylight, traced to the opening in the ceiling;
 *   - per-channel absorption from the room's tint (clear shallows, tinted
 *     deep water, the sunk floor visible) and light scattered in the water,
 *     warmer near the fires;
 *   - a soft shoreline: every cell knows the tops of its eight neighbours,
 *     so the distance to the nearest wall, pillar or step is exact on every
 *     tier; the rich tiers add the depth buffer (Nora, props, slopes). Foam
 *     breaks up along it and a thin bright meniscus hugs the stone;
 *   - flow: while a gate raises or drains a room, the ripples drift towards
 *     (or away from) the gate, roughen and foam near it.
 *   Seen from below, Snell's window shows the world above with a bright rim
 *   and the rest mirrors the deep.
 * - Caustics: an overlay per wet room made of the level's own triangles near
 *   and under the water (position and normal only, lifted 1 cm along the
 *   normal), drawn right after the opaque level with a modulate-2x blend, so
 *   it brightens and darkens whatever lighting the level already has (map,
 *   normal map, lightmap, shadows and fog untouched: the level materials are
 *   never replaced). Under the water the caustic texture dances on the floor
 *   and walls, fading with depth; above it, light reflected by the ripples
 *   climbs a little way up the walls.
 *
 * Quality tiers (one surface draw and one caustic draw per visible wet room
 * in every tier):
 * - high: screen-space refraction (the scene behind, bent by the ripples,
 *   from one copy of the frame, never taking what is in front of the water),
 *   thickness and foam from the depth buffer, three ripple layers, three
 *   swell waves, six lights, caustics with a touch of dispersion;
 * - medium: blended surface with depth-buffer thickness and foam, three
 *   ripple layers, two swell waves, four lights, caustics;
 * - mobile: blended surface with thickness from the grid (no frame or depth
 *   copies), two ripple layers, one swell wave, two lights and the cheap
 *   caustics (two texture reads).
 */
import * as THREE from 'three/webgpu';
import {
  Discard,
  Fn,
  If,
  abs,
  attribute,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  exp,
  float,
  frontFacing,
  getScreenPosition,
  length,
  max,
  min,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  positionView,
  positionWorld,
  pow,
  reflect,
  screenUV,
  smoothstep,
  sqrt,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportTexture,
} from 'three/tsl';
import { waterSurface } from '../sim/actors/water';
import { sectorTop, type Level, type Sector } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';
import type { World } from '../sim/world';
import { lookFile } from './looks';
import type { QualityProfile, QualityTier } from './quality';
import {
  SHORE_NEIGHBOURS,
  SHORE_WALL,
  absorption,
  causticTexture,
  causticTriangles,
  flowSign,
  rippleTexture,
  skylightOpenings,
} from './water-maths';

/** How many lights glint on the water (the nearest fires and flares). */
export const WATER_GLINTS = 6;

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

/** Colours of the water, per room look (art/looks/*.json `water`). */
export interface WaterLook {
  /** Colour of deep water, lit by the room's ambient light (linear). */
  deep: THREE.Color;
  /** Tint of what is seen through the water; also sets how fast each colour is absorbed. */
  tint: THREE.Color;
  /** Colour reflected at grazing angles (the room's darkness or daylight). */
  sky: THREE.Color;
  /** Caustic strength on floors and walls (0 off). */
  caustics: number;
  /** Underwater fog colour and density (FogExp2). */
  fogColor: THREE.Color;
  fogDensity: number;
}

const waterLooks = new Map<string | null, WaterLook>();

/** The water look of a room look (art/looks/<id>.json `water`), or the default. */
export function waterLookOf(id: string | null): WaterLook {
  const cached = waterLooks.get(id);
  if (cached) return cached;
  const w = lookFile(id)?.water;
  const look = w
    ? {
        deep: new THREE.Color(w.deep),
        tint: new THREE.Color(w.tint),
        sky: new THREE.Color(w.sky),
        caustics: w.caustics,
        fogColor: new THREE.Color(w.fog.color),
        fogDensity: w.fog.density,
      }
    : DEFAULT_WATER_LOOK();
  waterLooks.set(id, look);
  return look;
}

export const DEFAULT_WATER_LOOK = (): WaterLook => ({
  deep: new THREE.Color('#06151a'),
  tint: new THREE.Color('#5f9e97'),
  sky: new THREE.Color('#1c2a2e'),
  caustics: 0.5,
  fogColor: new THREE.Color('#0b2a2d'),
  fogDensity: 0.16,
});

/** A sky opening in a ceiling, as the water reflects it. */
export interface SkylightCell {
  x: number;
  z: number;
  ceil: number;
}

interface Surface {
  room: string;
  mesh: THREE.Mesh;
  /** The caustic overlay on the room's walls and floors, if it has any faces near the water. */
  caustics: THREE.Mesh | null;
  level: THREE.UniformNode<'float', number>;
  /** Ripple drift (m), integrated from the flow. */
  drift: THREE.UniformNode<'vec2', THREE.Vector2>;
  /** 0 still … 1 while a gate moves the water. */
  flow: THREE.UniformNode<'float', number>;
  /** Where the water leaves or enters (x, z), for the foam of a moving gate. */
  gate: THREE.UniformNode<'vec2', THREE.Vector2>;
  /** Unit direction of the drift while the water drains (reversed while it rises). */
  towardGate: THREE.Vector2;
  /** Static level for rooms no gate controls. */
  fixed: number | null;
  /** What the caustic overlay is cut from: the room's level meshes and its highest and lowest water. */
  source: { meshes: THREE.Mesh[]; top: number; bottom: number };
}

/** Large, slow swell: travelling sine waves with analytic slopes (the ripple texture adds the detail). */
const SWELL: readonly [number, number, number, number, number][] = [
  // dir x, dir z, wavelength (m), amplitude (m), speed (m/s)
  [0.8, 0.6, 4.3, 0.014, 0.7],
  [-0.45, 0.89, 2.9, 0.009, 0.55],
  [0.24, -0.97, 1.7, 0.005, 0.42],
];

/** Per tier: swell waves, ripple layers, glinting lights. */
const TIER: Record<QualityTier, { swell: number; layers: number; glints: number }> = {
  high: { swell: 3, layers: 3, glints: WATER_GLINTS },
  medium: { swell: 2, layers: 3, glints: 4 },
  mobile: { swell: 1, layers: 2, glints: 2 },
};

/** Ripple layers: tile size (m), angle (rad), drift (m/s), slope strength. Unrelated sizes and angles hide the tiling. */
const LAYERS: readonly { size: number; angle: number; drift: [number, number]; strength: number }[] = [
  { size: 3.7, angle: 0.3, drift: [0.045, 0.028], strength: 0.09 },
  { size: 1.63, angle: 2.1, drift: [-0.034, 0.05], strength: 0.055 },
  { size: 0.71, angle: 4.0, drift: [0.03, -0.041], strength: 0.03 },
];

/** Screen-space reflection (high tier): march steps, first step (m), step growth, bisection steps. */
const SSR_STEPS = 14;
const SSR_FIRST = 0.25;
const SSR_GROWTH = 1.3;
const SSR_REFINE = 4;

/** Width of the foam along the shore (m). */
const FOAM_WIDTH = 0.42;
/**
 * Caustic overlays per tier: how far reflected light climbs the walls above
 * the water (m), and how far below the lowest water floors and walls still
 * take caustics (m). Mobile keeps a narrower band: less overdraw.
 */
const CAUSTIC_REACH: Record<QualityTier, { band: number; depth: number }> = {
  high: { band: 1.6, depth: 12 },
  medium: { band: 1.6, depth: 12 },
  mobile: { band: 0.9, depth: 4 },
};
/** How fast the flow eases in and out (1/s). */
const FLOW_EASE = 0.8;
/** Ripple drift while the water moves (m/s). */
const FLOW_SPEED = 0.55;

function swellSlope(p: V2, t: F, count: number): V2 {
  let gx: F = float(0);
  let gz: F = float(0);
  for (const [dx, dz, len, amp, speed] of SWELL.slice(0, count)) {
    const k = (2 * Math.PI) / len;
    const phase = p.x
      .mul(dx * k)
      .add(p.y.mul(dz * k))
      .add(t.mul(speed * k));
    const c = cos(phase).mul(amp * k);
    gx = gx.add(c.mul(dx));
    gz = gz.add(c.mul(dz));
  }
  return vec2(gx, gz);
}

/** Rotates a 2D vector by a constant angle. */
const rotate = (p: V2, a: number): V2 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
};

/** The shared procedural textures (built on first use: a few hundred ms on a phone, behind the loading screen). */
let textures: { ripple: THREE.DataTexture; caustic: THREE.DataTexture; peak: number } | null = null;

function waterTextures(): NonNullable<typeof textures> {
  if (textures) return textures;
  const r = rippleTexture();
  const ripple = new THREE.DataTexture(r.data, r.size, r.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  const c = causticTexture();
  // One channel as RGBA as well: every backend filters and mipmaps it the same.
  const rgba = new Uint8Array(c.size * c.size * 4);
  for (let i = 0; i < c.size * c.size; i++) {
    const v = c.data[i] ?? 0;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  const caustic = new THREE.DataTexture(rgba, c.size, c.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [ripple, caustic]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
  }
  textures = { ripple, caustic, peak: c.peak };
  return textures;
}

/**
 * The copies of the frame's depth and colour the surfaces read. Every
 * viewport texture node copies the frame once per render and keeps its own
 * copy per render target, so all reads go through one node of each
 * (`.sample()` shares its copy): one depth and one colour copy per frame, however many
 * surfaces and reflection steps read them.
 */
let depthNode: THREE.TextureNode | null = null;
let colorNode: THREE.TextureNode | null = null;
const sceneDepth = (): THREE.TextureNode => (depthNode ??= viewportDepthTexture());
function sceneColor(): THREE.TextureNode {
  if (!colorNode) {
    colorNode = viewportTexture();
    // No mipmaps are made for this copy: sample its base level only.
    colorNode.value.minFilter = THREE.LinearFilter;
  }
  return colorNode;
}

export class WaterView {
  readonly group = new THREE.Group();
  private surfaces: Surface[] = [];
  private readonly time = uniform(0);
  /** Current room's water look, blended. */
  private readonly look = DEFAULT_WATER_LOOK();
  private readonly uDeep = uniform(new THREE.Color());
  private readonly uTint = uniform(new THREE.Color());
  private readonly uSky = uniform(new THREE.Color());
  /** Absorption per channel (1/m), from the tint. */
  private readonly uSigma = uniform(new THREE.Vector3(0.9, 0.45, 0.5));
  private readonly uCaustics = uniform(0.5);
  private readonly uFogColor = uniform(new THREE.Color());
  private readonly uFogDensity = uniform(0);
  private readonly glintPos = Array.from({ length: WATER_GLINTS }, () =>
    uniform(new THREE.Vector4(0, -1e4, 0, 0)),
  );
  private readonly glintColor = Array.from({ length: WATER_GLINTS }, () => uniform(new THREE.Color()));
  /** The nearest sky opening: min x, min z, max x, max z (an empty box when none). */
  private readonly skyBox = uniform(new THREE.Vector4(1e4, 1e4, 1e4, 1e4));
  private readonly skyCeil = uniform(0);
  private readonly skyColor = uniform(new THREE.Color());
  private openings: ReturnType<typeof skylightOpenings> = [];
  private level: Level | null = null;
  private world: World | null = null;
  private profile: QualityProfile;
  /** True while the camera is under a water surface. */
  underwater = false;
  /** Surface over the camera (m) when underwater, for fog and sound. */
  depthUnder = 0;

  constructor(profile: QualityProfile) {
    this.profile = profile;
    this.group.name = 'water';
  }

  /** Rebuilds the surface and caustic materials for another tier. */
  setQuality(profile: QualityProfile): void {
    const changed = profile.tier !== this.profile.tier;
    this.profile = profile;
    if (!changed || !this.level) return;
    for (const s of this.surfaces) {
      (s.mesh.material as THREE.Material).dispose();
      s.mesh.material = this.surfaceMaterial(s);
      if (s.caustics) {
        // Each tier reaches its own distance above and below the water.
        const geo = causticGeometry(
          s.source.meshes,
          s.source.top,
          s.source.bottom,
          CAUSTIC_REACH[profile.tier],
        );
        if (geo) {
          s.caustics.geometry.dispose();
          s.caustics.geometry = geo;
        }
        (s.caustics.material as THREE.Material).dispose();
        s.caustics.material = this.causticMaterial(s);
      }
    }
  }

  get rich(): boolean {
    return this.profile.tier !== 'mobile';
  }

  /** A new World on the same level (a restart): its water is what the surfaces follow. */
  setWorld(world: World): void {
    if (this.world && this.world.level === world.level) this.world = world;
  }

  /**
   * Builds the surfaces and caustic overlays for a level. `levelMeshes` are
   * the level's merged meshes, each with `userData.room` (their triangles
   * are copied, their materials left alone); `place` puts an object in its
   * room's group for culling (the water's own group otherwise).
   */
  build(
    world: World,
    levelMeshes: readonly THREE.Mesh[],
    opts: { place?: (o: THREE.Object3D, room: string) => void; skylights?: readonly SkylightCell[] } = {},
  ): void {
    this.dispose();
    this.world = world;
    const level = world.level;
    this.level = level;
    this.openings = skylightOpenings(opts.skylights ?? [], BLOCK);

    // Rooms with water: a static level (per sector) or a gate that controls them.
    const gateRooms = new Map<string, { low: number; high: number; x: number; z: number }>();
    for (const a of world.state.actors) {
      if (a.kind !== 'watergate') continue;
      for (const r of a.rooms)
        gateRooms.set(r, { low: a.low, high: a.high, x: (a.cx + 0.5) * BLOCK, z: (a.cz + 0.5) * BLOCK });
    }
    const byRoom = new Map<string, Sector[]>();
    for (const s of level.allSectors()) {
      if (s.wall) continue;
      const list = byRoom.get(s.room) ?? [];
      list.push(s);
      byRoom.set(s.room, list);
    }
    for (const [room, sectors] of byRoom) {
      const gate = gateRooms.get(room);
      const fixed = gate ? null : (sectors.find((s) => s.water !== null)?.water ?? null);
      if (!gate && fixed === null) continue;
      const top = gate ? gate.high : (fixed ?? 0);
      const bottom = gate ? gate.low : (fixed ?? 0);
      const cells = sectors.filter((s) => sectorTop(s) < top - 1e-3 && s.ceil > bottom + 0.05);
      if (!cells.length) continue;
      let cx = 0;
      let cz = 0;
      for (const c of cells) {
        cx += (c.cx + 0.5) * BLOCK;
        cz += (c.cz + 0.5) * BLOCK;
      }
      cx /= cells.length;
      cz /= cells.length;
      const gx = gate?.x ?? cx;
      const gz = gate?.z ?? cz;
      const toward = new THREE.Vector2(gx - cx, gz - cz);
      if (toward.lengthSq() < 1e-6) toward.set(1, 0);
      toward.normalize();
      const surface: Surface = {
        room,
        mesh: null as unknown as THREE.Mesh,
        caustics: null,
        level: uniform(top),
        drift: uniform(new THREE.Vector2()),
        flow: uniform(0),
        gate: uniform(new THREE.Vector2(gx, gz)),
        towardGate: toward,
        fixed,
        source: { meshes: levelMeshes.filter((m) => m.userData.room === room), top, bottom },
      };
      const mesh = new THREE.Mesh(surfaceGeometry(level, cells, top), this.surfaceMaterial(surface));
      mesh.name = `water:${room}`;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      surface.mesh = mesh;

      // Caustics on the room's own floors and walls near and under the water.
      const geo = causticGeometry(surface.source.meshes, top, bottom, CAUSTIC_REACH[this.profile.tier]);
      if (geo) {
        const overlay = new THREE.Mesh(geo, this.causticMaterial(surface));
        overlay.name = `caustics:${room}`;
        // Right after the opaque level (render order 0) and before anything transparent.
        overlay.renderOrder = 1;
        overlay.castShadow = false;
        overlay.receiveShadow = false;
        surface.caustics = overlay;
      }
      for (const o of [mesh, surface.caustics]) {
        if (!o) continue;
        if (opts.place) opts.place(o, room);
        if (!o.parent) this.group.add(o);
      }
      this.surfaces.push(surface);
    }
    this.update(0, new THREE.Vector3());
  }

  /** Water surface over a world point (m), or null (from the simulation's water). */
  surfaceAt(x: number, z: number): number | null {
    const w = this.world;
    if (!w) return null;
    const cx = Math.floor(x / BLOCK);
    const cz = Math.floor(z / BLOCK);
    const s = waterSurface(w, cx, cz);
    if (s === null) return null;
    return w.grid.cellFloor(cx, cz) < s ? s : null;
  }

  /**
   * Per frame: water levels and flow, the room's water look, the glinting
   * lights, the sky opening and whether the camera is under the water.
   * `lights` are the scene's point lights that should glint (nearest
   * first); `sky` the colour of the daylight through the skylights (black
   * for none); `fog` the scene's fog, which the water fades into.
   */
  update(
    dt: number,
    eye: THREE.Vector3,
    look?: WaterLook,
    lights: readonly THREE.PointLight[] = [],
    sky?: THREE.Color,
    fog?: THREE.FogExp2 | null,
  ): void {
    this.time.value += dt;
    const w = this.world;
    if (!w) return;
    for (const s of this.surfaces) {
      const dyn = w.state.water[s.room];
      s.level.value = dyn ? dyn.y : (s.fixed ?? 0);
      s.mesh.position.y = s.level.value;
      const sign = dyn ? flowSign(dyn.y, dyn.target) : 0;
      const k = Math.min(1, dt * FLOW_EASE);
      s.flow.value += (Math.abs(sign) - s.flow.value) * k;
      // Draining pulls the ripples towards the gate; rising pushes them out of it.
      const dir = sign === 0 ? (s.drift.value.lengthSq() > 0 ? 1 : 0) : -sign;
      s.drift.value.addScaledVector(s.towardGate, dir * s.flow.value * FLOW_SPEED * dt);
    }
    if (look) {
      const k = Math.min(1, dt * 1.5);
      this.look.deep.lerp(look.deep, k);
      this.look.tint.lerp(look.tint, k);
      this.look.sky.lerp(look.sky, k);
      this.look.caustics += (look.caustics - this.look.caustics) * k;
      this.look.fogColor.lerp(look.fogColor, k);
      this.look.fogDensity += (look.fogDensity - this.look.fogDensity) * k;
    }
    this.uDeep.value.copy(this.look.deep);
    this.uTint.value.copy(this.look.tint);
    this.uSky.value.copy(this.look.sky);
    const sigma = absorption([this.look.tint.r, this.look.tint.g, this.look.tint.b]);
    this.uSigma.value.set(sigma[0], sigma[1], sigma[2]);
    this.uCaustics.value = this.look.caustics;
    if (fog) {
      this.uFogColor.value.copy(fog.color);
      this.uFogDensity.value = fog.density;
    }
    this.glintPos.forEach((u, i) => {
      const l = lights[i];
      if (l && l.visible && l.intensity > 0) {
        u.value.set(l.position.x, l.position.y, l.position.z, l.intensity);
        this.glintColor[i]?.value.copy(l.color);
      } else {
        u.value.set(0, -1e4, 0, 0);
      }
    });
    // The sky opening nearest the eye (the one over this room's water, if any).
    let best: (typeof this.openings)[number] | null = null;
    let bestD = Infinity;
    for (const o of this.openings) {
      const d = Math.hypot((o.minX + o.maxX) / 2 - eye.x, (o.minZ + o.maxZ) / 2 - eye.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (best && sky) {
      this.skyBox.value.set(best.minX, best.minZ, best.maxX, best.maxZ);
      this.skyCeil.value = best.ceil;
      this.skyColor.value.copy(sky);
    } else {
      this.skyBox.value.set(1e4, 1e4, 1e4, 1e4);
      this.skyColor.value.setRGB(0, 0, 0);
    }
    const surface = this.surfaceAt(eye.x, eye.z);
    this.underwater = surface !== null && eye.y < surface;
    this.depthUnder = this.underwater && surface !== null ? surface - eye.y : 0;
  }

  /** Underwater fog for the scene while the camera is under the surface. */
  get fog(): { color: THREE.Color; density: number } {
    return { color: this.look.fogColor, density: this.look.fogDensity };
  }

  /** Keeps the camera off the water plane, where the screen would split. */
  clearEye(eye: { x: number; y: number; z: number }): void {
    const s = this.surfaceAt(eye.x, eye.z);
    if (s === null) return;
    const gap = 0.14;
    if (Math.abs(eye.y - s) < gap) eye.y = eye.y >= s ? s + gap : s - gap;
  }

  // ───────────────────────────── Materials ─────────────────────────────

  /** Fraction of the view lost to the scene's fog at a distance (FogExp2). */
  private fogFactor(dist: F): F {
    const d = this.uFogDensity.mul(dist);
    return float(1).sub(exp(d.mul(d).negate()));
  }

  private surfaceMaterial(s: Surface): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
    });
    // Premultiplied colour: what the water adds, over what shows through it scaled by (1 − alpha).
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    // Fog is applied here, in premultiplied form.
    m.fog = false;
    const t = this.time;
    const tier = this.profile.tier;
    const cfg = TIER[tier];
    const rich = this.rich;
    const refract = tier === 'high';
    const tex = waterTextures();
    const level = s.level;
    const floorY = attribute<'float'>('floorY', 'float');
    const origin = attribute<'vec2'>('cellOrigin', 'vec2');
    const edges = attribute<'vec4'>('shoreEdges', 'vec4');
    const corners = attribute<'vec4'>('shoreCorners', 'vec4');

    const shade = Fn(() => {
      // Dry cells at this level are cut away.
      If(floorY.greaterThan(level.sub(0.005)), () => {
        Discard();
      });
      const wp = positionWorld;
      const toEye = cameraPosition.sub(wp);
      const V = normalize(toEye);
      const dist = length(toEye);
      const flow = s.flow;
      const p = wp.xz.add(s.drift);

      // Normal: the swell plus ripple layers, calmer with distance (the mipmaps flatten them too).
      const detail = float(1).div(dist.mul(0.045).add(1)).mul(flow.mul(0.9).add(1));
      let slope: V2 = swellSlope(wp.xz, t, cfg.swell).mul(flow.mul(0.6).add(1));
      let foamNoise: F = float(0);
      LAYERS.slice(0, cfg.layers).forEach((l, i) => {
        const uv = rotate(p, l.angle).div(l.size).add(vec2(l.drift[0], l.drift[1]).mul(t).div(l.size));
        const r = texture(tex.ripple, uv);
        // Slopes come out in the layer's rotated frame: turn them back to the world's.
        const local = r.xy.mul(2).sub(1);
        slope = slope.add(
          rotate(local, -l.angle)
            .mul(l.strength * 1.5)
            .mul(detail),
        );
        if (i < 2) foamNoise = foamNoise.add(r.z.mul(i === 0 ? 0.6 : 0.4));
      });
      const n = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
      const cosV = max(dot(n, V), 0);
      const fresnel = float(0.02).add(pow(float(1).sub(cosV), 5).mul(0.98));
      const R = reflect(V.negate(), n);

      // The lights: sharp glints, the walls they light seen in the reflection, and light in the water.
      const sharpness = mix(float(1400), float(160), smoothstep(3, 28, dist));
      let glint: V3 = vec3(0, 0, 0);
      let halo: V3 = vec3(0, 0, 0);
      let lit: V3 = vec3(0, 0, 0);
      for (let i = 0; i < cfg.glints; i++) {
        const lp = this.glintPos[i];
        const lc = this.glintColor[i];
        if (!lp || !lc) continue;
        const L = lp.xyz.sub(wp);
        const d2 = dot(L, L);
        const d = sqrt(d2);
        const c = max(dot(R, L.div(d)), 0);
        const power = lc.mul(lp.w);
        glint = glint.add(power.mul(pow(c, sharpness).mul(sharpness.div(1400)).div(d2.add(1))));
        halo = halo.add(power.mul(pow(c, 7).mul(0.0035).div(d.add(1.5))));
        lit = lit.add(power.div(d2.add(2)));
      }

      // The sky through the opening in the vault: trace the reflected ray up to the ceiling.
      const up = max(R.y, 0.02);
      const hit = wp.xz.add(R.xz.mul(this.skyCeil.sub(wp.y).div(up)));
      const box = this.skyBox;
      const soft = float(0.35);
      const inside = smoothstep(box.x.sub(soft), box.x.add(soft), hit.x)
        .mul(smoothstep(box.z.add(soft), box.z.sub(soft), hit.x))
        .mul(smoothstep(box.y.sub(soft), box.y.add(soft), hit.y))
        .mul(smoothstep(box.w.add(soft), box.w.sub(soft), hit.y))
        .mul(smoothstep(0.05, 0.25, R.y));
      const skyRefl = this.skyColor.mul(inside);

      // Reflection: the dark vault, a little brighter near the horizon where it meets the walls.
      const env = this.uSky
        .mul(mix(float(1.5), float(0.7), smoothstep(0, 0.6, R.y)))
        .add(halo)
        .add(skyRefl);

      // Thickness of water along the view ray and vertical depth over what lies behind.
      const vertical = max(level.sub(floorY), 0);
      let thick: F = clamp(vertical.div(abs(V.y).add(0.12)), 0, 30);
      let edgeDepth: F = float(10);
      let behind: V3 | null = null;
      if (rich) {
        let uvSeen: V2 = screenUV;
        if (refract) {
          // Bend less in the shallows and far away; never take what stands in front of the water.
          const bend = slope
            .mul(0.2)
            .mul(smoothstep(0, 0.8, vertical))
            .div(dist.mul(0.1).add(1));
          const bent = screenUV.add(bend);
          const bentZ = perspectiveDepthToViewZ(
            sceneDepth().sample(bent),
            cameraNear,
            cameraFar,
          ) as unknown as F;
          uvSeen = bentZ.lessThan(positionView.z).select(bent, screenUV);
        }
        const sceneZ = perspectiveDepthToViewZ(
          sceneDepth().sample(uvSeen),
          cameraNear,
          cameraFar,
        ) as unknown as F;
        thick = max(positionView.z.sub(sceneZ), 0);
        edgeDepth = thick.mul(abs(V.y));
        if (refract) behind = sceneColor().sample(uvSeen).rgb;
      }
      const T = exp(this.uSigma.mul(thick).negate());
      // Light scattered back by the water: the room's ambient, warmer near the fires.
      const scatter = lit.mul(this.uTint).mul(0.012).add(this.uDeep).mul(T.oneMinus());

      // Shoreline: exact distance to walls, pillars and steps from the cell's neighbours.
      const l = wp.xz.sub(origin);
      const dry = (top: F, d: F): F => top.greaterThan(level.sub(0.02)).select(d, float(10));
      let shore: F = min(
        min(dry(edges.x, l.y), dry(edges.y, float(BLOCK).sub(l.x))),
        min(dry(edges.z, float(BLOCK).sub(l.y)), dry(edges.w, l.x)),
      );
      shore = min(
        shore,
        min(
          min(dry(corners.x, length(l)), dry(corners.y, length(l.sub(vec2(BLOCK, 0))))),
          min(
            dry(corners.z, length(l.sub(vec2(BLOCK, BLOCK)))),
            dry(corners.w, length(l.sub(vec2(0, BLOCK)))),
          ),
        ),
      );
      if (rich) shore = min(shore, edgeDepth.mul(1.6));
      // Near a moving gate the water churns.
      const churn = flow.mul(smoothstep(5, 0.5, length(wp.xz.sub(s.gate))));
      const broken = shore.add(foamNoise.sub(0.5).mul(0.35));
      const band = float(1).sub(smoothstep(0, FOAM_WIDTH, broken));
      const foam = clamp(
        band
          .mul(
            smoothstep(0.45, 0.8, foamNoise.add(band.mul(0.2)))
              .mul(0.6)
              .add(0.03),
          )
          .add(churn.mul(foamNoise)),
        0,
        1,
      );
      const meniscus = float(1)
        .sub(smoothstep(0, 0.05, shore))
        .mul(0.35);
      const foamColor = this.uSky.mul(1.1).add(this.uTint.mul(0.02)).add(lit.mul(0.02)).add(halo.mul(0.3));

      // Above: fresnel between the reflection and what lies under the surface, then foam.
      let colorAbove: V3;
      let alphaAbove: F;
      const reflected = env.mul(fresnel).add(glint);
      if (behind) {
        const under = behind.mul(T).add(scatter);
        const mirror = this.screenReflection(R, env);
        colorAbove = mix(under, mirror, fresnel).add(glint);
        colorAbove = mix(colorAbove, foamColor, foam.mul(0.85)).add(foamColor.mul(meniscus));
        alphaAbove = float(1);
      } else {
        const through = dot(T, vec3(0.2126, 0.7152, 0.0722));
        const a = float(1).sub(float(1).sub(fresnel).mul(through));
        const premul = reflected.add(scatter.mul(float(1).sub(fresnel)));
        alphaAbove = clamp(mix(a, float(1), foam.mul(0.85)), 0, 1);
        colorAbove = mix(premul, foamColor, foam.mul(0.85)).add(foamColor.mul(meniscus));
      }

      // Below, looking up: Snell's window lets the world above through, with a bright rim; outside it, the deep mirrored.
      const cosUp = abs(dot(n, V));
      const window = smoothstep(0.62, 0.7, cosUp);
      const rim = smoothstep(0.5, 0.66, cosUp).mul(float(1).sub(window));
      const alphaBelow = mix(float(0.96), float(0.2), window);
      // The ripples catch the light from above: brighter crests inside the window and along its rim.
      const crest = foamNoise.mul(1.4).add(0.3);
      const colorBelow = this.uDeep
        .mul(0.8)
        .add(this.uTint.mul(rim.mul(0.12).mul(crest)))
        .add(lit.mul(this.uTint).mul(0.004))
        .mul(alphaBelow)
        .add(this.uTint.mul(window.mul(0.05).mul(crest)))
        .add(glint.mul(0.25));

      const color = frontFacing.select(colorAbove, colorBelow);
      const alpha = frontFacing.select(alphaAbove, alphaBelow);
      // Fog over the water, premultiplied.
      const f = this.fogFactor(dist);
      return vec4(mix(color, this.uFogColor.mul(alpha), f), alpha);
    });
    const out = shade();
    m.colorNode = out.rgb;
    m.opacityNode = out.a;
    return m;
  }

  /**
   * High tier: the reflection traced through the depth buffer and read from
   * the frame copy (walls, pillars, fires and Nora mirrored in the water).
   * The reflected ray is marched in view space with growing steps, the first
   * crossing behind the depth buffer is refined by bisection, and the result
   * fades out near the screen's edges and wherever nothing was hit (the
   * analytic `env` stands in there). Unrolled, with no branches, so every
   * backend accepts it.
   */
  private screenReflection(R: V3, env: V3): V3 {
    const dir = cameraViewMatrix.mul(vec4(R, 0)).xyz;
    const start = positionView;
    const viewZ = (uv: V2): F =>
      perspectiveDepthToViewZ(sceneDepth().sample(uv), cameraNear, cameraFar) as unknown as F;
    const onScreen = (uv: V2): THREE.Node<'bool'> =>
      uv.x.greaterThan(0).and(uv.x.lessThan(1)).and(uv.y.greaterThan(0)).and(uv.y.lessThan(1));
    let found: F = float(0);
    let near: F = float(0);
    let far: F = float(0);
    let prev = 0;
    let step = SSR_FIRST;
    for (let i = 0; i < SSR_STEPS; i++) {
      const at = prev + step;
      const q = start.add(dir.mul(at));
      const uv = getScreenPosition(q, cameraProjectionMatrix) as unknown as V2;
      const gap = viewZ(uv).sub(q.z);
      // Behind the surface in the depth buffer, but not so far that the ray passed behind an object.
      const hit = gap
        .greaterThan(0)
        .and(gap.lessThan(step * 1.5 + 0.3))
        .and(onScreen(uv))
        .and(found.lessThan(0.5));
      near = hit.select(float(prev), near);
      far = hit.select(float(at), far);
      found = hit.select(float(1), found);
      prev = at;
      step *= SSR_GROWTH;
    }
    for (let i = 0; i < SSR_REFINE; i++) {
      const mid = near.add(far).mul(0.5);
      const q = start.add(dir.mul(mid));
      const uv = getScreenPosition(q, cameraProjectionMatrix) as unknown as V2;
      const behind = viewZ(uv).greaterThan(q.z);
      far = behind.select(mid, far);
      near = behind.select(near, mid);
    }
    const q = start.add(dir.mul(far));
    const uv = getScreenPosition(q, cameraProjectionMatrix) as unknown as V2;
    const edge = min(min(uv.x, uv.x.oneMinus()), min(uv.y, uv.y.oneMinus()));
    const fade = found
      .mul(smoothstep(0, 0.08, edge))
      // Rays turning back towards the camera meet the backs of things the frame never saw.
      .mul(smoothstep(0.35, 0.05, dir.z));
    const seen = sceneColor().sample(clamp(uv, vec2(0.001, 0.001), vec2(0.999, 0.999))).rgb;
    return mix(env, seen, fade);
  }

  /**
   * The caustic overlay's material: a modulate-2x blend (result = 2 × this ×
   * what is there), so 0.5 leaves the level as it is, brighter values light
   * it up and darker ones shade it.
   */
  private causticMaterial(s: Surface): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: false, depthWrite: false });
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.SrcColorFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    m.fog = false;
    m.toneMapped = false;
    const tier = this.profile.tier;
    const tex = waterTextures();
    const t = this.time;
    const level = s.level;
    const peak = tex.peak;

    const shade = Fn(() => {
      const wp = positionWorld;
      const nrm = attribute<'vec3'>('normal', 'vec3');
      const flat = smoothstep(0.5, 0.8, abs(nrm.y));
      const d = level.sub(wp.y);
      const drift = s.drift;
      // World-space projection: floors from above, walls from the side (no uv).
      const across = wp.x.add(wp.z);
      const p = mix(vec2(across, wp.y.mul(0.9)), wp.xz, flat).add(drift);
      const intensity = (uv: V2, blur = 0): F => {
        const v = (blur ? texture(tex.caustic, uv).bias(float(blur)) : texture(tex.caustic, uv)).x;
        return v.mul(v).mul(peak);
      };
      const layer = (q: V2, shift: V2): F => {
        const a = intensity(rotate(q, 0.4).div(2.6).add(vec2(0.021, 0.013).mul(t)).add(shift));
        const b = intensity(rotate(q, 2.3).div(1.9).add(vec2(-0.017, 0.024).mul(t)).add(shift));
        // The classic trick: the lesser of two drifting patterns reads as moving caustics.
        return min(a, b);
      };
      let under: V3;
      if (tier === 'high') {
        // A little dispersion: red and blue land a hair apart.
        const o = vec2(0.004, 0.003);
        under = vec3(layer(p, o), layer(p, vec2(0, 0)), layer(p, o.negate()));
      } else {
        under = vec3(layer(p, vec2(0, 0)));
      }
      // Under the water: stronger just below the surface, fading with depth.
      const below = smoothstep(0, 0.15, d).mul(exp(d.mul(-0.16)));
      // Above it (walls only): light the ripples reflect, stretched along the wall.
      const q = vec2(across.div(1.7), wp.y.div(0.45)).add(drift);
      // Softer than the caustics under water: the ripples that reflect it are out of focus.
      const reflected = intensity(rotate(q, 0.15).div(2.2).add(vec2(0.03, 0.05).mul(t)), 1.5);
      const above = smoothstep(-CAUSTIC_REACH[tier].band, -0.05, d)
        .mul(float(1).sub(smoothstep(-0.05, 0.02, d)))
        .mul(float(1).sub(flat))
        .mul(0.55);
      // Mean intensity of the min of two patterns is below 1: centre it so the room keeps its brightness.
      const strength = this.uCaustics.mul(0.5);
      const k = under
        .sub(0.55)
        .mul(below)
        .add(vec3(reflected.sub(0.45).max(-0.3)).mul(above))
        .mul(strength);
      const toEye = length(cameraPosition.sub(wp));
      const src = clamp(k.mul(float(1).sub(this.fogFactor(toEye))).add(0.5), 0, 1);
      return vec4(src, 1);
    });
    const out = shade();
    m.colorNode = out.rgb;
    m.opacityNode = out.a;
    return m;
  }

  dispose(): void {
    for (const s of this.surfaces) {
      for (const o of [s.mesh, s.caustics]) {
        if (!o) continue;
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
        o.removeFromParent();
      }
    }
    this.surfaces = [];
  }
}

/**
 * A flat grid of quads over the given cells at y = 0. Per vertex: the
 * cell's floor, its origin and the tops of its eight neighbours (a wall, or
 * a ceiling under the water, counts as always dry) for the shoreline.
 */
function surfaceGeometry(level: Level, cells: readonly Sector[], top: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const floor: number[] = [];
  const origin: number[] = [];
  const edges: number[] = [];
  const corners: number[] = [];
  const idx: number[] = [];
  const N = 2;
  for (const s of cells) {
    const x0 = s.cx * BLOCK;
    const z0 = s.cz * BLOCK;
    const f = sectorTop(s);
    const tops = SHORE_NEIGHBOURS.map(([dx, dz]) => {
      const n = level.sector(s.cx + dx, s.cz + dz);
      if (!n || n.wall || n.ceil < top) return SHORE_WALL;
      return sectorTop(n);
    });
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        pos.push(x0 + (i / N) * BLOCK, 0, z0 + (j / N) * BLOCK);
        floor.push(f);
        origin.push(x0, z0);
        edges.push(
          tops[0] ?? SHORE_WALL,
          tops[1] ?? SHORE_WALL,
          tops[2] ?? SHORE_WALL,
          tops[3] ?? SHORE_WALL,
        );
        corners.push(
          tops[4] ?? SHORE_WALL,
          tops[5] ?? SHORE_WALL,
          tops[6] ?? SHORE_WALL,
          tops[7] ?? SHORE_WALL,
        );
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      new Array<number>(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  g.setAttribute('floorY', new THREE.Float32BufferAttribute(floor, 1));
  g.setAttribute('cellOrigin', new THREE.Float32BufferAttribute(origin, 2));
  g.setAttribute('shoreEdges', new THREE.Float32BufferAttribute(edges, 4));
  g.setAttribute('shoreCorners', new THREE.Float32BufferAttribute(corners, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * The caustic overlay's geometry for one wet room: the room's floor
 * triangles under its highest water and its wall triangles up to the band
 * of reflected light above it (ceilings never). Null when there are none.
 */
function causticGeometry(
  meshes: readonly THREE.Mesh[],
  top: number,
  bottom: number,
  reach: { band: number; depth: number },
): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    if (!p || !n || mesh.userData.surface === 'ceiling') continue;
    const walls = mesh.userData.surface === 'wall' || mesh.userData.surface === 'lip';
    const out = causticTriangles(
      p.array,
      n.array,
      g.index ? g.index.array : null,
      walls ? top + reach.band : top + 0.01,
      bottom - reach.depth,
    );
    pos.push(...out.position);
    nor.push(...out.normal);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}
