/**
 * Shadows (spec §11 "Sombras"): the sun's shadow through the skylights, the
 * fire casters' cube shadows, their biases, the debug view and an audit of
 * who casts. GameRenderer owns the lights; this module decides how their
 * shadow maps are framed, filtered and biased.
 *
 * Sun: daylight only ever enters through a sun room's skylight, so its
 * orthographic shadow camera is fitted to the prism below that opening (a
 * few metres across instead of the whole room) and everything outside the
 * frustum counts as under the roof, in shadow. three.js' default treats
 * the outside of a shadow frustum as lit, which let the sun light the
 * neighbouring rooms beyond the old room-sized frustum.
 *
 * Fires: the cube shadows compute their bias per fragment from the texel
 * size at that distance. The old constant bias lived in perspective depth,
 * where a fixed offset grows with the square of the distance (0.2 m at 5 m,
 * 1.1 m at 12 m of peter-panning).
 *
 * Both push the receiver along its geometric normal: three's normalBias uses
 * the normal-mapped normal, which on the rough scans jitters the lookup.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  int,
  mix,
  select,
  abs,
  cross,
  float,
  interleavedGradientNoise,
  lightPosition,
  lightShadowMatrix,
  normalWorldGeometry,
  normalize,
  reference,
  screenCoordinate,
  shadowPositionWorld,
  texture,
  cubeTexture,
  uniform,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
  vogelDiskSample,
} from 'three/tsl';
import {
  DEPTH_TEXELS,
  NORMAL_TEXELS,
  RADIUS_SHARE,
  fitOrtho,
  orthoBias,
  skylightPrism,
  type OrthoFit,
  type SkylightCell,
} from './shadow-math';

/**
 * Layer the view camera and live shadow cameras see Nora on (GameRenderer's
 * CHARACTER_LAYER). Kept here so the shadow cameras' masks are built in one place.
 */
export const CHARACTER_LAYER = 1;
/**
 * An empty layer a shadow camera enables so its mask is never "layer 0
 * only": three's ShadowNode replaces such a mask with the view camera's, so
 * a sun shadow meant to leave Nora out would pick her up again.
 */
const OWN_MASK_LAYER = 2;
/** Distance from the window's centre to the sun's shadow camera (m). */
const SUN_DISTANCE = 60;
/** Width of the sun's penumbra in the window (m): the sun's disc blurs edges over a few centimetres. */
const SUN_SOFTNESS = 0.018;
/** Taps of the sun's filter inside the window (each a hardware 2×2 PCF). */
const SUN_TAPS = 6;
/**
 * Near plane of the fire casters' cube cameras (m). The light hangs 0.4 m
 * above the brazier bowl: with the default 0.5 the bowl was half clipped and
 * printed a broken ring of shadow on the floor. At 0.65 the whole bowl and
 * its coals stay out of their own fire's map (the flames surround them); the
 * legs still cast.
 */
export const FIRE_NEAR = 0.65;
/** Taps of the fire casters' filter. */
const FIRE_TAPS = 5;
/** Debug tint of occluded sunlight and firelight. */
const SUN_TINT = new THREE.Color('#3b6cff');
const FIRE_TINT = new THREE.Color('#ff2bd6');

type ShadowWithNode = THREE.LightShadow & { shadowNode?: THREE.Node };

interface FilterInputs {
  depthTexture: THREE.DepthTexture;
}

/** TSL typings at the library boundary: the world position shadow nodes receive, as a vec3. */
const receiver = shadowPositionWorld as unknown as THREE.Node<'vec3'>;
/** A depth-compare sample is a float at runtime; the typings call it a vec4. */
const asFloat = (n: THREE.Node): THREE.Node<'float'> => n as unknown as THREE.Node<'float'>;

/** Per-pixel rotation of the Vogel-disk taps (interleaved gradient noise), as three's own filters. */
const phi = (): THREE.Node<'float'> => interleavedGradientNoise(screenCoordinate.xy).mul(6.28318530718);

/** `lit` (1 lit, 0 shadowed) as a colour: occluded light turns `tint` in the debug view. */
const debugTint = (tint: THREE.Color, lit: THREE.Node<'float'>): THREE.Node<'vec3'> =>
  mix(vec3(tint.r, tint.g, tint.b), vec3(1, 1, 1), lit);

/**
 * The sun's shadow: a window over the skylight with the outside in shadow,
 * a geometric-normal offset and a softer, world-sized filter.
 */
export class SkylightShadowNode extends THREE.ShadowNode {
  /** Shadow value outside the frustum: 0 (under the roof) while a window is fitted. */
  readonly outside = uniform(0);
  /** Receiver offset along its geometric normal (m). */
  readonly normalOffset = uniform(0.01);
  /** Filter radius in shadow-map UV. */
  readonly radiusUv = uniform(1 / 1024);

  constructor(
    private readonly sun: THREE.DirectionalLight,
    private readonly tinted: boolean,
  ) {
    super(sun, null);
  }

  /** Replaces ShadowNode's filter setup (three has no typings for it). */
  setupShadowFilter(builder: THREE.NodeBuilder, inputs: FilterInputs): THREE.Node {
    const self = this as unknown as {
      setupShadowCoord(b: THREE.NodeBuilder, p: THREE.Node): THREE.Node<'vec3'>;
    };
    const world = receiver.add(normalWorldGeometry.mul(this.normalOffset));
    const coord = self.setupShadowCoord(builder, lightShadowMatrix(this.sun).mul(vec4(world, 1)));
    // Inside an Fn: ShadowNode caches this node across materials, and only an
    // Fn call carries its If block into every material that uses it.
    const filter = Fn(() => {
      const inside = coord.x
        .greaterThanEqual(0)
        .and(coord.x.lessThanEqual(1))
        .and(coord.y.greaterThanEqual(0))
        .and(coord.y.lessThanEqual(1))
        .and(coord.z.lessThanEqual(1));
      const lit = float(this.outside).toVar();
      If(inside, () => {
        const a = phi();
        let sum: THREE.Node<'float'> = float(0);
        for (let i = 0; i < SUN_TAPS; i++) {
          const uv = coord.xy.add(vogelDiskSample(int(i), int(SUN_TAPS), a).mul(this.radiusUv));
          sum = sum.add(asFloat(texture(inputs.depthTexture, uv).compare(coord.z)));
        }
        lit.assign(sum.div(SUN_TAPS));
      });
      return lit;
    })();
    return this.tinted ? debugTint(SUN_TINT, filter) : filter;
  }
}

/**
 * A fire caster's cube shadow with a bias that follows the texel size at
 * each fragment's distance: the receiver moves NORMAL_TEXELS (plus the
 * filter's reach) along its geometric normal and DEPTH_TEXELS towards the
 * light, measured in texels of the cube face at that distance.
 */
export class FireShadowNode extends THREE.PointShadowNode {
  constructor(
    private readonly fire: THREE.PointLight,
    private readonly tinted: boolean,
  ) {
    super(fire, null);
  }

  /** Replaces PointShadowNode's filter setup (three has no typings for it). */
  setupShadowFilter(builder: THREE.NodeBuilder, inputs: FilterInputs): THREE.Node {
    const shadow = this.fire.shadow;
    const near = reference('near', 'float', shadow.camera);
    const far = reference('far', 'float', shadow.camera);
    const size = reference('mapSize', 'vec2', shadow).x;
    const radius = reference('radius', 'float', shadow);
    const reversed = builder.renderer.reversedDepthBuffer === true;
    const maxAxis = (v: THREE.Node<'vec3'>): THREE.Node<'float'> => {
      const a = abs(v);
      return a.x.max(a.y).max(a.z);
    };
    // Inside an Fn, as the sun's filter (the If must reach every material).
    const filter = Fn(() => {
      const toFrag = receiver.sub(lightPosition(this.fire)).toConst();
      const dist = maxAxis(toFrag);
      const lit = float(1).toVar();
      If(dist.greaterThanEqual(near).and(dist.lessThanEqual(far)), () => {
        // One cube texel at this distance (face centre: the widest).
        const texel = dist.mul(2).div(size);
        const offset = texel.mul(radius.mul(RADIUS_SHARE).add(NORMAL_TEXELS));
        const p = toFrag.add(normalWorldGeometry.mul(offset)).toConst();
        const z = maxAxis(p).sub(texel.mul(DEPTH_TEXELS)).max(near);
        const depth = viewZToPerspectiveDepth(z.negate(), near, far);
        const dp = reversed ? depth.oneMinus() : depth;
        const dir = normalize(p).toConst();
        const ad = abs(dir);
        const side = select(ad.x.greaterThan(ad.z), vec3(0, 1, 0), vec3(1, 0, 0));
        const tangent = normalize(cross(dir, side));
        const bitangent = cross(dir, tangent);
        // A texel spans 2/size of the unit direction's face coordinates.
        const reach = radius.mul(2).div(size);
        const a = phi();
        let sum: THREE.Node<'float'> = float(0);
        for (let i = 0; i < FIRE_TAPS; i++) {
          const s = vogelDiskSample(int(i), int(FIRE_TAPS), a);
          const d = dir.add(tangent.mul(s.x).add(bitangent.mul(s.y)).mul(reach));
          sum = sum.add(
            asFloat(cubeTexture(inputs.depthTexture as unknown as THREE.CubeTexture, d).compare(dp)),
          );
        }
        lit.assign(sum.div(FIRE_TAPS));
      });
      return lit;
    })();
    return this.tinted ? debugTint(FIRE_TINT, filter) : filter;
  }
}

/** A sun room's skylight cells and the lowest floor under them. */
export interface SkylightWindow {
  cells: SkylightCell[];
  floor: number;
}

/** How the shadows are set up on a tier (from QualityProfile). */
export interface ShadowTier {
  sunSize: number;
  /** Sun map re-rendered every frame with Nora in it; otherwise refreshed now and then without her. */
  sunLive: boolean;
  /** PCF radius of the fire casters (texels). */
  fireRadius: number;
}

const _v = new THREE.Vector3();

/**
 * Frames the sun's shadow on the current (or last) sun room's skylight and
 * sets up the fire casters' shadows. Call `update` every frame after the
 * room look is applied.
 */
export class ShadowRig {
  readonly sunNode: SkylightShadowNode;
  private windows = new Map<string, SkylightWindow>();
  /** Room whose skylight the sun's frustum frames. */
  private source: string | null = null;
  private readonly fittedDir = new THREE.Vector3(0, 0, 0);
  private fittedSource: string | null = null;
  fit: OrthoFit | null = null;
  private tier: ShadowTier;
  private helpers: THREE.Object3D[] = [];
  private sunHelper: THREE.CameraHelper | null = null;
  private fireMarkers: THREE.Mesh[] = [];

  constructor(
    private readonly sun: THREE.DirectionalLight,
    private readonly casters: readonly THREE.PointLight[],
    tier: ShadowTier,
    private readonly debug: boolean,
  ) {
    this.tier = tier;
    this.sunNode = new SkylightShadowNode(sun, debug);
    const sunShadow = sun.shadow as ShadowWithNode;
    sunShadow.shadowNode = this.sunNode;
    // The filter applies its own geometric-normal offset.
    sun.shadow.normalBias = 0;
    // A near-vertical sun is almost parallel to the default up vector.
    sun.shadow.camera.up.set(0, 0, -1);
    sun.shadow.camera.layers.enable(OWN_MASK_LAYER);
    for (const l of casters) {
      (l.shadow as ShadowWithNode).shadowNode = new FireShadowNode(l, debug);
      l.shadow.bias = 0;
      l.shadow.normalBias = 0;
      l.shadow.camera.near = FIRE_NEAR;
      l.shadow.camera.updateProjectionMatrix();
      l.shadow.camera.layers.enable(CHARACTER_LAYER);
      l.shadow.camera.layers.enable(OWN_MASK_LAYER);
    }
    this.applyTier(tier);
  }

  /**
   * Another shadow-casting point light (Nora's torch) gets the fire casters'
   * texel-sized bias instead of three's constant one; its own near plane,
   * map size and layers (the view camera's: Nora included) are kept.
   */
  adoptPointLight(light: THREE.PointLight): void {
    if (!light.castShadow) return;
    (light.shadow as ShadowWithNode).shadowNode = new FireShadowNode(light, this.debug);
    light.shadow.bias = 0;
    light.shadow.normalBias = 0;
  }

  /** Tier changes: Nora in the sun's shadow or not, the fire filter. Map sizes stay fixed for the session. */
  applyTier(tier: ShadowTier): void {
    this.tier = tier;
    const layers = this.sun.shadow.camera.layers;
    if (tier.sunLive) layers.enable(CHARACTER_LAYER);
    else layers.disable(CHARACTER_LAYER);
    this.sun.shadow.autoUpdate = tier.sunLive;
    for (const l of this.casters) l.shadow.radius = tier.fireRadius;
    this.fittedSource = null;
  }

  /** The level's skylights, per sun room. */
  setWindows(windows: Map<string, SkylightWindow>): void {
    this.windows = windows;
    this.source = null;
    this.fittedSource = null;
  }

  /**
   * Keeps the sun's frustum on the current sun room's skylight, or on the
   * last one while its light fades after leaving. Returns true when the
   * frustum moved (a static sun map must then be refreshed).
   */
  update(room: string | null, sunDir: THREE.Vector3): boolean {
    if (room && this.windows.has(room)) this.source = room;
    const win = this.source ? this.windows.get(this.source) : undefined;
    if (!win) {
      // No sun room seen yet: the sun is dark anyway; keep everything outside lit-free.
      this.sunNode.outside.value = 0;
      return false;
    }
    // A static (mobile) map refits only on larger turns, so a blending look does not refresh it every frame.
    const turn = this.tier.sunLive ? 1e-6 : 3e-4;
    if (this.fittedSource === this.source && 1 - this.fittedDir.dot(sunDir) < turn) {
      this.placeSun(sunDir);
      return false;
    }
    this.fitWindow(win, sunDir);
    this.fittedSource = this.source;
    this.fittedDir.copy(sunDir);
    return true;
  }

  /** Keeps the light on its fitted axis (the look moves the light every frame). */
  private placeSun(sunDir: THREE.Vector3): void {
    const t = this.sun.target.position;
    this.sun.position
      .copy(t)
      .addScaledVector(this.fittedDir.lengthSq() > 0 ? this.fittedDir : sunDir, SUN_DISTANCE);
  }

  private fitWindow(win: SkylightWindow, sunDir: THREE.Vector3): void {
    const prism = skylightPrism(win.cells, win.floor, sunDir);
    const centre = new THREE.Vector3();
    for (const p of prism) centre.add(_v.set(p.x, p.y, p.z));
    centre.divideScalar(Math.max(1, prism.length));
    const sun = this.sun;
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(sunDir, SUN_DISTANCE);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    // Mirror LightShadow.updateMatrices to get the camera's view space.
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    const view = prism.map((p) => {
      _v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
      return { x: _v.x, y: _v.y, z: _v.z };
    });
    const fit = fitOrtho(view, this.tier.sunSize);
    cam.left = fit.left;
    cam.right = fit.right;
    cam.top = fit.top;
    cam.bottom = fit.bottom;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
    const softness = Math.max(SUN_SOFTNESS, fit.texel * 1.5);
    const { bias, normalBias } = orthoBias(fit, softness / fit.texel);
    sun.shadow.bias = bias;
    this.sunNode.normalOffset.value = normalBias;
    this.sunNode.radiusUv.value = softness / (fit.right - fit.left);
    this.sunNode.outside.value = 0;
    this.fit = fit;
    this.sunHelper?.update();
  }

  /** Debug view (?debug=shadows): the sun's frustum and the fire casters' cube cameras. */
  addHelpers(scene: THREE.Scene): void {
    if (!this.debug || this.helpers.length) return;
    this.sunHelper = new THREE.CameraHelper(this.sun.shadow.camera);
    this.helpers.push(this.sunHelper);
    for (let i = 0; i < this.casters.length; i++) {
      // A caster's near sphere (what it leaves out of its map) and its position.
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(FIRE_NEAR, 12, 8),
        new THREE.MeshBasicMaterial({ color: FIRE_TINT, wireframe: true, fog: false }),
      );
      this.fireMarkers.push(marker);
      this.helpers.push(marker);
    }
    for (const h of this.helpers) {
      h.traverse((o) => {
        o.castShadow = false;
        o.receiveShadow = false;
      });
      scene.add(h);
    }
  }

  /** Moves the debug helpers with their lights. */
  updateHelpers(): void {
    if (!this.helpers.length) return;
    this.sunHelper?.update();
    this.casters.forEach((l, i) => {
      const m = this.fireMarkers[i];
      if (!m) return;
      m.position.copy(l.position);
      m.visible = l.intensity > 0;
    });
  }

  /**
   * What the shadows look like right now, for the debug console and the
   * audit: the sun's window and texel size, the casters, and every mesh that
   * casts (flagging hidden ones and tiny ones).
   */
  audit(scene: THREE.Scene): Record<string, unknown> {
    const casters: { name: string; kind: string; visible: boolean; layer: number; size: number }[] = [];
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Points) && !(o instanceof THREE.Sprite)) return;
      if (!o.castShadow) return;
      let visible = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) visible &&= p.visible;
      box.setFromObject(o);
      box.getSize(size);
      casters.push({
        name: o.name || o.parent?.name || o.type,
        kind: o.type,
        visible,
        layer: o.layers.mask,
        size: +size.length().toFixed(3),
      });
    });
    const f = this.fit;
    return {
      sun: {
        source: this.source,
        mapSize: this.sun.shadow.mapSize.x,
        live: this.tier.sunLive,
        window: f ? +(f.right - f.left).toFixed(2) : null,
        texelMm: f ? +(f.texel * 1000).toFixed(2) : null,
        near: f ? +f.near.toFixed(2) : null,
        far: f ? +f.far.toFixed(2) : null,
        bias: this.sun.shadow.bias,
        normalOffset: this.sunNode.normalOffset.value,
        layers: this.sun.shadow.camera.layers.mask,
      },
      fire: this.casters.map((l) => ({
        intensity: +l.intensity.toFixed(2),
        at: l.position.toArray().map((v) => +v.toFixed(2)),
        near: l.shadow.camera.near,
        far: l.distance,
        mapSize: l.shadow.mapSize.x,
        radius: l.shadow.radius,
        texelMmAt3m: +(((2 * 3) / l.shadow.mapSize.x) * 1000).toFixed(1),
        layers: l.shadow.camera.layers.mask,
        autoUpdate: l.shadow.autoUpdate,
      })),
      casters: {
        total: casters.length,
        hidden: casters.filter((c) => !c.visible).length,
        tiny: casters.filter((c) => c.visible && c.size < 0.1).map((c) => `${c.name} (${c.size} m)`),
        list: casters,
      },
    };
  }
}

/** The shadow settings of a quality tier. */
export function shadowTierFor(p: { tier: string; sun: { size: number; live: boolean } }): ShadowTier {
  // Bigger cube maps take a wider filter in texels for the same softness.
  return { sunSize: p.sun.size, sunLive: p.sun.live, fireRadius: p.tier === 'high' ? 2 : 1.5 };
}
