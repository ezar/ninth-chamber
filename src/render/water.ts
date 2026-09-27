/**
 * Water (spec §11 "Agua": refraction, reflections, edge foam and caustics
 * projected on the walls and floors of the cisterns).
 *
 * - One surface mesh per wet room, covering every cell the room's water can
 *   reach (for a gate-controlled room, up to its high level), raised to the
 *   current level each frame. Cells whose floor is above the water are cut
 *   away in the shader, so a rising level floods them smoothly.
 * - The surface is a TSL node material: animated normals from a sum of
 *   waves, fresnel between the refracted scene and a reflection of the
 *   room's light (the fire and flare lights as sharp glints), depth-based
 *   absorption and tint, and soft foam where the water meets anything. Seen
 *   from below, Snell's window shows the world above and the rest mirrors
 *   the deep.
 * - Caustics: the level materials get an emissive caustic pattern, masked
 *   by the water level of the room each vertex belongs to: under the water
 *   it dances on the floor and the walls, above it a softer reflected
 *   ripple climbs a little way up the walls.
 *
 * Quality tiers (the surface is one draw per wet room in every tier):
 * - high: screen-space refraction (the scene behind, bent by the ripples,
 *   from one copy of the frame), thickness and foam from the depth buffer,
 *   five waves, six glints and caustics;
 * - medium: blended surface with depth-buffer thickness and foam, four
 *   waves, four glints and caustics;
 * - mobile: blended surface with thickness and foam from the grid (no
 *   frame or depth copies), three waves, two glints and no caustics.
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
  clamp,
  cos,
  diffuseColor,
  dot,
  exp,
  float,
  frontFacing,
  length,
  max,
  mix,
  normalize,
  perspectiveDepthToViewZ,
  positionView,
  positionWorld,
  pow,
  reflect,
  screenUV,
  sin,
  smoothstep,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl';
import { waterSurface } from '../sim/actors/water';
import { sectorTop, type Level, type Sector } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';
import type { World } from '../sim/world';
import { lookFile } from './looks';
import type { QualityProfile } from './quality';

/** How many lights glint on the water (the nearest fires and flares). */
export const WATER_GLINTS = 6;
/** Most wet rooms whose level the caustics know about. */
const MAX_ROOMS = 31;

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

/** Colours of the water, per room look (art/looks/*.json `water`). */
export interface WaterLook {
  /** Colour of deep water, lit by the room's ambient light (linear). */
  deep: THREE.Color;
  /** Tint of what is seen through the water. */
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

interface Surface {
  room: string;
  mesh: THREE.Mesh;
  level: THREE.UniformNode<'float', number>;
  /** Static level for rooms no gate controls. */
  fixed: number | null;
}

/** Sum of travelling sine waves: height gradient at a point (analytic derivatives). */
const WAVES: readonly [number, number, number, number, number][] = [
  // dir x, dir z, wavelength (m), amplitude (m), speed (m/s)
  [0.8, 0.6, 1.9, 0.012, 0.55],
  [-0.5, 0.86, 1.3, 0.008, 0.45],
  [0.2, -0.98, 0.83, 0.005, 0.38],
  [-0.93, -0.35, 0.57, 0.0035, 0.3],
  [0.6, -0.8, 0.31, 0.0018, 0.22],
];

/** Waves, glints per tier (see the header). */
const TIER_WAVES = { high: 5, medium: 4, mobile: 3 } as const;
const TIER_GLINTS = { high: WATER_GLINTS, medium: 4, mobile: 2 } as const;

function waveGradient(p: V2, t: F, scale: F, count: number): V2 {
  let gx: F = float(0);
  let gz: F = float(0);
  for (const [dx, dz, len, amp, speed] of WAVES.slice(0, count)) {
    const k = (2 * Math.PI) / len;
    const phase = p.x
      .mul(dx * k)
      .add(p.y.mul(dz * k))
      .add(t.mul(speed * k));
    const c = cos(phase).mul(amp * k);
    gx = gx.add(c.mul(dx));
    gz = gz.add(c.mul(dz));
  }
  return vec2(gx, gz).mul(scale);
}

/** A tileable caustic pattern (after "Tileable Water Caustic" by joltz0r), 0..1. */
const caustic = Fn(([p, t]: [V2, F]) => {
  const TAU = 6.28318530718;
  const q = p.mul(TAU).mod(TAU).sub(250);
  let i: V2 = q;
  let c: F = float(1);
  const inten = 0.005;
  for (let n = 0; n < 4; n++) {
    const tt = t.mul(1 - 3.5 / (n + 1));
    i = q.add(vec2(cos(tt.sub(i.x)).add(sin(tt.add(i.y))), sin(tt.sub(i.y)).add(cos(tt.add(i.x)))));
    c = c.add(
      float(1).div(length(vec2(q.x.div(sin(i.x.add(tt)).div(inten)), q.y.div(cos(i.y.add(tt)).div(inten))))),
    );
  }
  c = c.div(4);
  const v = float(1.17).sub(pow(c, 1.4));
  return clamp(pow(abs(v), 8), 0, 1.5);
});

export class WaterView {
  readonly group = new THREE.Group();
  private surfaces: Surface[] = [];
  private readonly time = uniform(0);
  /** Current room's water look, blended. */
  private readonly look = DEFAULT_WATER_LOOK();
  private readonly uDeep = uniform(new THREE.Color());
  private readonly uTint = uniform(new THREE.Color());
  private readonly uSky = uniform(new THREE.Color());
  private readonly uCaustics = uniform(0.5);
  private readonly glintPos = Array.from({ length: WATER_GLINTS }, () =>
    uniform(new THREE.Vector4(0, -1e4, 0, 0)),
  );
  private readonly glintColor = Array.from({ length: WATER_GLINTS }, () => uniform(new THREE.Color()));
  private readonly roomLevels = uniformArray(new Array<number>(MAX_ROOMS + 1).fill(-1e4), 'float');
  private roomIndex = new Map<string, number>();
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

  /** Rebuilds the surface materials for another tier (caustics follow on the next level build). */
  setQuality(profile: QualityProfile): void {
    const changed = profile.tier !== this.profile.tier;
    this.profile = profile;
    if (changed && this.level) {
      for (const s of this.surfaces) {
        (s.mesh.material as THREE.Material).dispose();
        s.mesh.material = this.surfaceMaterial(s.level);
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

  /** Builds the surfaces for a level and gives its level meshes caustics. */
  build(world: World, levelMeshes: readonly THREE.Mesh[]): void {
    this.dispose();
    this.world = world;
    const level = world.level;
    this.level = level;

    // Rooms with water: a static level (per sector) or a gate that controls them.
    const gateRooms = new Map<string, { low: number; high: number }>();
    for (const a of world.state.actors) {
      if (a.kind !== 'watergate') continue;
      for (const r of a.rooms) gateRooms.set(r, { low: a.low, high: a.high });
    }
    const byRoom = new Map<string, Sector[]>();
    for (const s of level.allSectors()) {
      if (s.wall) continue;
      const list = byRoom.get(s.room) ?? [];
      list.push(s);
      byRoom.set(s.room, list);
    }
    let index = 1;
    for (const [room, sectors] of byRoom) {
      const gate = gateRooms.get(room);
      const fixed = gate ? null : (sectors.find((s) => s.water !== null)?.water ?? null);
      if (!gate && fixed === null) continue;
      const top = gate ? gate.high : (fixed ?? 0);
      const bottom = gate ? gate.low : (fixed ?? 0);
      const cells = sectors.filter((s) => sectorTop(s) < top - 1e-3 && s.ceil > bottom + 0.05);
      if (!cells.length) continue;
      if (index <= MAX_ROOMS) this.roomIndex.set(room, index++);
      const levelU = uniform(top);
      const mesh = new THREE.Mesh(surfaceGeometry(cells), this.surfaceMaterial(levelU));
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.surfaces.push({ room, mesh, level: levelU, fixed });
    }
    if (this.rich) for (const m of levelMeshes) this.decorate(m);
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
   * Per frame: water levels, the room's water look, the glinting lights and
   * whether the camera is under the water. `lights` are the scene's point
   * lights that should glint (nearest first).
   */
  update(dt: number, eye: THREE.Vector3, look?: WaterLook, lights: readonly THREE.PointLight[] = []): void {
    this.time.value += dt;
    const w = this.world;
    if (!w) return;
    for (const s of this.surfaces) {
      const dyn = w.state.water[s.room];
      s.level.value = dyn ? dyn.y : (s.fixed ?? 0);
      s.mesh.position.y = s.level.value;
      const i = this.roomIndex.get(s.room);
      if (i !== undefined) this.roomLevels.array[i] = s.level.value;
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
    this.uCaustics.value = this.look.caustics;
    this.glintPos.forEach((u, i) => {
      const l = lights[i];
      if (l && l.visible && l.intensity > 0) {
        u.value.set(l.position.x, l.position.y, l.position.z, l.intensity);
        this.glintColor[i]?.value.copy(l.color);
      } else {
        u.value.set(0, -1e4, 0, 0);
      }
    });
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

  private surfaceMaterial(level: THREE.UniformNode<'float', number>): THREE.MeshBasicNodeMaterial {
    const m = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
    });
    m.fog = true;
    const t = this.time;
    const rich = this.rich;
    const tier = this.profile.tier;
    const refract = tier === 'high';
    const floorY = attribute<'float'>('floorY', 'float');

    // Everything below is computed once and shared by colour and opacity.
    const shade = Fn(() => {
      // Dry cells at this level are cut away.
      If(floorY.greaterThan(level.sub(0.005)), () => {
        Discard();
      });
      const wp = positionWorld;
      const toEye = cameraPosition.sub(wp);
      const V = normalize(toEye);
      const dist = length(toEye);
      // Ripples calm down with distance so they never alias into noise.
      const g = waveGradient(wp.xz, t, float(1).div(dist.mul(0.08).add(1)), TIER_WAVES[tier]);
      const n = normalize(vec3(g.x.negate(), 1, g.y.negate()));
      const cosV = max(dot(n, V), 0);
      const fresnel = float(0.02).add(pow(float(1).sub(cosV), 5).mul(0.98));
      const R = reflect(V.negate(), n);

      // Glints: the nearest fires and flares mirrored in the surface.
      let glint: V3 = vec3(0, 0, 0);
      for (let i = 0; i < TIER_GLINTS[tier]; i++) {
        const lp = this.glintPos[i];
        const lc = this.glintColor[i];
        if (!lp || !lc) continue;
        const L = lp.xyz.sub(wp);
        const d = length(L);
        const sharp = pow(max(dot(R, L.div(d)), 0), 700)
          .mul(lp.w)
          .div(d.mul(d).add(1));
        // A broad sheen around the sharp glint: the light's path on the ripples.
        const sheen = pow(max(dot(R, L.div(d)), 0), 24)
          .mul(lp.w)
          .mul(0.004)
          .div(d.add(1));
        glint = glint.add(lc.mul(sharp.add(sheen)));
      }

      // Water thickness along the view ray: from the depth buffer when affordable, else from the grid.
      const vertical = max(level.sub(floorY), 0);
      let thick: F = clamp(vertical.div(abs(V.y).add(0.15)), 0, 30);
      let edge: F = vertical;
      if (rich) {
        const sceneZ = perspectiveDepthToViewZ(
          viewportDepthTexture(screenUV),
          cameraNear,
          cameraFar,
        ) as unknown as F;
        thick = max(positionView.z.sub(sceneZ), 0);
        // How deep the water is over whatever is behind it (walls, steps, Nora): soft foam where thin.
        edge = thick.mul(abs(V.y)).mul(1.3);
      }
      const foamNoise = sin(
        wp.x
          .mul(7.3)
          .add(t.mul(0.6))
          .add(sin(wp.z.mul(6.1).sub(t.mul(0.8))).mul(1.4)),
      )
        .mul(0.5)
        .add(0.5);
      const foam = float(1)
        .sub(smoothstep(0.0, 0.3, edge))
        .mul(foamNoise.mul(0.55).add(0.3));

      // Above: light scattered in the water (deep colour) in front of whatever shows through,
      // the room reflected at grazing angles, and the glints.
      const absorb = float(1).sub(exp(thick.mul(-0.42)));
      const body = mix(this.uTint.mul(0.3), this.uDeep, smoothstep(0, 3.5, thick));
      const foamLight = this.uTint.mul(0.28).add(this.uSky.mul(0.8)).add(glint.mul(0.05));
      let colorAbove: V3 = mix(mix(body, this.uSky, fresnel), foamLight, foam.mul(0.8)).add(glint);
      let alphaAbove: F = clamp(max(absorb.mul(0.93).add(0.07), fresnel).add(foam.mul(0.5)), 0, 1);
      if (refract) {
        // The scene behind the surface, bent by the ripples (less with distance), tinted by the
        // water it crosses, then scattered light, the reflection and foam over it: opaque.
        const bend = vec2(g.x, g.y).mul(0.9).div(dist.mul(0.12).add(1));
        const behind = viewportSharedTexture(screenUV.add(bend)).rgb;
        const seen = behind.mul(mix(vec3(1, 1, 1), this.uTint.mul(1.5), clamp(thick.mul(0.3), 0, 1)));
        const water = mix(seen, body, absorb.mul(0.93).add(0.07));
        colorAbove = mix(mix(water, this.uSky, fresnel), foamLight, foam.mul(0.8)).add(glint);
        alphaAbove = float(1);
      }

      // Below, looking up: Snell's window lets the world above through; outside it, the deep mirrored.
      const cosUp = abs(dot(n, V));
      const window = smoothstep(0.6, 0.76, cosUp);
      const colorBelow = mix(this.uDeep.mul(0.8), this.uTint.mul(0.25), window).add(glint.mul(0.25));
      const alphaBelow = mix(float(0.97), float(0.25), window);

      return vec4(frontFacing.select(colorAbove, colorBelow), frontFacing.select(alphaAbove, alphaBelow));
    });
    const out = shade();
    m.colorNode = out.rgb;
    m.opacityNode = out.a;
    return m;
  }

  /** Gives a level mesh caustics under and just above its room's water. */
  private decorate(mesh: THREE.Mesh): void {
    const src = mesh.material as THREE.MeshStandardMaterial;
    const level = this.level;
    if (!level || !(src instanceof THREE.MeshStandardMaterial) || src.userData.water) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const rooms = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      // The cell a face belongs to: a little way along its normal (walls face the open cell).
      const x = pos.getX(i) + nor.getX(i) * 0.3;
      const z = pos.getZ(i) + nor.getZ(i) * 0.3;
      const s = level.sector(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
      rooms[i] = s ? (this.roomIndex.get(s.room) ?? 0) : 0;
    }
    geo.setAttribute('waterRoom', new THREE.BufferAttribute(rooms, 1));

    const m = new THREE.MeshStandardNodeMaterial();
    m.setValues({
      map: src.map,
      normalMap: src.normalMap,
      roughnessMap: src.roughnessMap,
      metalnessMap: src.metalnessMap,
      aoMap: src.aoMap,
      metalness: src.metalness,
      roughness: src.roughness,
      color: src.color,
      vertexColors: src.vertexColors,
      side: src.side,
      lightMap: src.lightMap,
      lightMapIntensity: src.lightMapIntensity,
    });
    m.userData.water = true;
    const room = attribute<'float'>('waterRoom', 'float');
    const t = this.time;
    const strength = this.uCaustics;
    const levels = this.roomLevels;
    m.emissiveNode = Fn(() => {
      const w = levels.element(room.toInt()) as unknown as F;
      const wp = positionWorld;
      const d = w.sub(wp.y);
      // Floors take the pattern from above; walls from the side.
      const nw = attribute<'vec3'>('normal', 'vec3');
      const flat = abs(nw.y);
      const p = mix(vec2(wp.x.add(wp.z), wp.y.mul(1.4)), wp.xz, flat).mul(0.27);
      const c = caustic(p, t.mul(0.55))
        .mul(0.6)
        .add(caustic(p.mul(1.37).add(0.37), t.mul(0.43)).mul(0.4));
      const under = smoothstep(0, 0.15, d).mul(exp(d.mul(-0.3)));
      const above = smoothstep(-1.4, 0, d)
        .mul(float(1).sub(smoothstep(0, 0.15, d)))
        .mul(0.35);
      const mask = under.add(above).mul(w.greaterThan(-1e3).select(float(1), float(0)));
      return diffuseColor.rgb
        .mul(vec3(0.75, 0.95, 1))
        .mul(c)
        .mul(mask)
        .mul(strength);
    })();
    mesh.material = m;
  }

  dispose(): void {
    for (const s of this.surfaces) {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      this.group.remove(s.mesh);
    }
    this.surfaces = [];
    this.roomIndex = new Map();
    this.roomLevels.array.fill(-1e4);
  }
}

/** A flat grid of quads over the given cells at y = 0, with each cell's floor height per vertex. */
function surfaceGeometry(cells: readonly Sector[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const floor: number[] = [];
  const idx: number[] = [];
  const N = 2;
  for (const s of cells) {
    const x0 = s.cx * BLOCK;
    const z0 = s.cz * BLOCK;
    const f = sectorTop(s);
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        pos.push(x0 + (i / N) * BLOCK, 0, z0 + (j / N) * BLOCK);
        floor.push(f);
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
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
