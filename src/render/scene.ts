/**
 * The game renderer (spec §11 "Render"): builds the level from the grid,
 * lights it with the per-room looks, and draws the world state with render
 * interpolation through the post-processing stack. It only reads the
 * simulation. What it spends on shadows, effects and resolution follows the
 * quality tier (render/quality.ts).
 */
import * as THREE from 'three/webgpu';
import { clamp, length, normalWorld, positionWorld, smoothstep, texture, uniform, uv, vec2 } from 'three/tsl';
import { BLOCK } from '../sim/grid/units';
import type { Vec3 } from '../sim/state';
import type { World } from '../sim/world';
import { CombatView } from './combat';
import { FIRE_GAIN, FIRE_LIGHT_LIFT, FireLightScheduler, type FireSpot } from './fire-lights';
import { MASK_RES, MASK_SIZE, fireMask, maskAtlas, type MaskAtlas } from './light-mask';
import { buildLevelMeshes, type Surface } from './level-mesh';
import { blendLook, cloneLook, getLook, lookFile, type Look } from './looks';
import type { NoraPose } from './nora';
import { NoraRig } from './nora-scan';
import { GuardianView } from './guardian';
import { Props } from './props';
import { loadSurfaces, surfaceParams, type SurfaceName, type SurfaceSet } from './materials';
import { PostStack } from './post';
import { CHARACTER_LAYER, ShadowRig, shadowTierFor, type SkylightWindow } from './shadows';
import { levelReach } from './shadow-math';
import { RoomCulling } from './room-culling';
import {
  QUALITY,
  anisotropyFor,
  pixelRatioFor,
  type QualityProfile,
  type ResolutionMode,
  type TextureFiltering,
} from './quality';
import { TorchView } from './torch';
import { FlareView } from './flares';
import { WaterFx } from './water-fx';
import { WaterView, waterLookOf } from './water';
import type { SimEvent } from '../core/events';
import { TempleView } from './temple';
import { ArchiveView } from './archive';
import { setupKtx2 } from './ktx2';

export interface PlayerPose {
  pos: Vec3;
  yaw: number;
}

/** Seconds between refreshes of a non-live (mobile) sun shadow. */
const STATIC_SHADOW_REFRESH = 1;
/** Groups whose children are culled one by one (the static set dressing). */
const DRESSING: ReadonlySet<string> = new Set(['dressing']);
/** Film grain amplitude on the display image (art bible: subtle; lowered after phone feedback). */
/** Half-width of the mobile contact shadow blob (m). */
const CONTACT_RADIUS = 0.8;
const GRAIN = 0.022;
/** Frames between passes that bring newly loaded textures (prop models) to the filtering level. */
const FILTERING_SWEEP_FRAMES = 90;

/** How the player wants the image finished (Options → Graphics). */
export interface ImageOptions {
  /** Null: the tier's default. */
  filmGrain: boolean | null;
  /** Null: on whenever the image is drawn below the screen's resolution. */
  sharpen: boolean | null;
  textureFiltering: TextureFiltering;
}

export class GameRenderer {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 250);
  private readonly post: PostStack;
  private profile: QualityProfile;
  private readonly hemi = new THREE.HemisphereLight('#6f7f8f', '#2a1f17', 0.4);
  private readonly sun = new THREE.DirectionalLight('#ffffff', 0);
  /**
   * Two fixed pools created once: plain fire lights and shadow casters. Their
   * castShadow flags and shadow map sizes never change afterwards (disposing
   * a shadow map a render still binds floods WebGPU with validation errors);
   * the scheduler moves them between braziers with fades instead.
   */
  private readonly fireLights: THREE.PointLight[] = [];
  /**
   * Per plain fire light: its colour times intensity, and which brazier's
   * mask it reads (the mask's world corner and its texel offset in the atlas).
   * The light's colorNode multiplies the two, so it stops at walls (light-mask.ts).
   */
  private readonly fireMaskUniforms: {
    tint: THREE.UniformNode<'color', THREE.Color>;
    tile: THREE.UniformNode<'vec4', THREE.Vector4>;
  }[] = [];
  private readonly maskTexture = texture(placeholderMask());
  private readonly maskAtlasSize = uniform(new THREE.Vector2(1, 1));
  private maskTiles: MaskAtlas['tiles'] = [];
  private readonly fireCasters: THREE.PointLight[] = [];
  private readonly fireSchedule: FireLightScheduler;
  /** Sun window, fire shadow filters and biases, the debug view (shadows.ts). */
  private readonly shadows: ShadowRig;
  private fireSpots: FireSpot[] = [];
  /** Rooms touching each room (their braziers rank with the current room's). */
  private neighbours = new Map<string, Set<string>>();
  private readonly characterFill = new THREE.PointLight('#ffe2c4', 1.6, 4.5, 2);
  private readonly nora = new NoraRig();
  /**
   * Jackals, pistols, muzzle flashes and the target marker. No jackal model is
   * shipped yet, so the jackals are built in code; pass
   * `${import.meta.env.BASE_URL}models/jackal.glb` once public/models has one.
   */
  readonly combat = new CombatView(null);
  /** The torch Nora carries, with its own light (not one of the fire pool's). */
  private readonly torch: TorchView;
  private props: Props | null = null;
  /** The Temple of the Sun's mechanisms and its guardian (empty for levels without them). */
  private temple: TempleView | null = null;
  private archive: ArchiveView | null = null;
  private guardians: GuardianView | null = null;
  private world: World | null = null;
  private look: Look = cloneLook(getLook(null));
  private currentRoom: string | null = null;
  private readonly shafts: { mesh: THREE.Group; dust: THREE.Points; sky: THREE.Mesh; room: string }[] = [];
  /** Where each sunlit room's floor bounce sits, and how strong it is. */
  private readonly bounces: { at: THREE.Vector3; room: string; strength: number }[] = [];
  /**
   * Two bounce lights serve every sunlit room: the current room's, and the
   * previous one's fading out. Every light costs every lit pixel, so one per
   * room (ten) was the largest per-pixel cost on phones.
   */
  private readonly bounceLights = [0, 1].map(() => ({
    light: new THREE.PointLight('#e0b27a', 0, 22, 1.6),
    room: null as string | null,
    strength: 0,
  }));
  private readonly levelMeshes: THREE.Mesh[] = [];
  /** Hides the rooms the camera cannot see (render/room-culling.ts). */
  culling: RoomCulling | null = null;
  private time = 0;
  private surfaces: Record<SurfaceName, SurfaceSet> | null = null;
  private reducedMotion = false;
  private sunShadowAge = Infinity;
  private readonly contactShadow: THREE.Mesh;
  private readonly contactStrength: THREE.UniformNode<'float', number>;
  private focus: { at: THREE.Vector3; amount: number } | null = null;
  /** Water surfaces and caustics, flares, splashes and drips (level 2, the Cisterns). */
  readonly water: WaterView;
  private readonly flares = new FlareView();
  private readonly waterFx: WaterFx;
  private underwaterMix = 0;
  private readonly waterSky = new THREE.Color();
  /** 0 in the air … 1 with the camera under water (fog, grade, muffled sound). */
  get underwater(): number {
    return this.underwaterMix;
  }
  private resolution: ResolutionMode = 'auto';
  /** Pixel ratio cap in the automatic mode; null uses the tier's. */
  private autoCap: number | null = null;
  private image: ImageOptions = { filmGrain: null, sharpen: null, textureFiltering: 'auto' };
  private filteringSweep = 0;

  /**
   * `forceWebGL` picks the WebGL 2 backend (Options → Renderer); otherwise
   * three.js uses WebGPU where the browser has it and falls back to WebGL 2.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    profile: QualityProfile = QUALITY.high,
    forceWebGL = false,
  ) {
    // No MSAA on the canvas: the scene is drawn into the post pipeline's own target.
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera.layers.enable(CHARACTER_LAYER);
    const view = import.meta.env.DEV ? new URLSearchParams(location.search).get('view') : null;
    this.post = new PostStack(this.renderer, this.scene, this.camera, this.sun, view);
    this.profile = profile;

    this.scene.fog = new THREE.FogExp2('#2a1f17', 0.03);
    this.scene.background = new THREE.Color('#0e0c0a');
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    // Fixed for the session, like the fire casters' maps (see fireLights).
    this.sun.shadow.mapSize.set(profile.sun.size, profile.sun.size);
    for (let i = 0; i < profile.fireLights.pool; i++) {
      const l = new THREE.PointLight('#ff8a3d', 0, 18, 2);
      const tint = uniform(new THREE.Color(0, 0, 0));
      const tile = uniform(new THREE.Vector4(0, 0, 0, 0));
      // three reads a light's colorNode when it builds the light (not in the typings).
      (l as THREE.PointLight & { colorNode?: THREE.Node }).colorNode = tint.mul(this.fireMaskAt(tile));
      this.fireMaskUniforms.push({ tint, tile });
      this.fireLights.push(l);
      this.scene.add(l);
    }
    for (let i = 0; i < profile.fireShadows; i++) {
      const l = new THREE.PointLight('#ff8a3d', 0, 18, 2);
      l.castShadow = true;
      l.shadow.mapSize.set(profile.fireShadowSize, profile.fireShadowSize);
      this.fireCasters.push(l);
      this.scene.add(l);
    }
    // Biases, filters, layers and the sun's framing (shadows.ts).
    const debugShadows = new URLSearchParams(location.search).get('debug') === 'shadows';
    this.shadows = new ShadowRig(this.sun, this.fireCasters, shadowTierFor(profile), debugShadows);
    this.shadows.addHelpers(this.scene);
    this.fireSchedule = new FireLightScheduler({
      plain: this.fireLights.length,
      casters: this.fireCasters.length,
    });
    this.scene.add(this.nora.root, this.combat.group);
    // Torch shadows on the high tier only; castShadow is fixed from the tier the session starts on.
    this.torch = new TorchView(profile.tier === 'high');
    this.shadows.adoptPointLight(this.torch.light);
    this.scene.add(this.torch.group);
    for (const b of this.bounceLights) this.scene.add(b.light);
    // A soft fill that follows Nora so she reads against backlight (a common
    // character-lighting cheat); short range, so it barely touches the set. Only
    // 0.3 m to the side, so in a two-metre corridor it leaves no hot spot on the wall.
    this.characterFill.position.set(0.3, 2.3, 1.6);
    this.nora.root.add(this.characterFill);
    const contact = makeContactShadow();
    this.contactShadow = contact.mesh;
    this.contactStrength = contact.strength;
    this.scene.add(this.contactShadow);
    this.water = new WaterView(profile);
    this.waterFx = new WaterFx((x, z) => this.water.surfaceAt(x, z));
    this.scene.add(this.water.group, this.flares.group, this.waterFx.root);
    this.applyProfile(false);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    // KTX2 textures transcode for this GPU (level surfaces, prop models, Nora).
    setupKtx2(this.renderer);
    [this.surfaces] = await Promise.all([
      loadSurfaces(),
      this.nora.loadScan(`${import.meta.env.BASE_URL}models/nora.glb`, `${import.meta.env.BASE_URL}anim/`),
      this.post.load(),
    ]);
    this.nora.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.layers.set(CHARACTER_LAYER);
    });
    this.applyAnisotropy();
  }

  /** 'WebGPU' or 'WebGL2', depending on the backend Three.js picked. */
  get backendName(): string {
    const backend = (this.renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    return backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  }

  get quality(): QualityProfile {
    return this.profile;
  }

  /** Applies a quality tier (spec §11): resolution, shadows, post effects, filtering and particles. */
  setQuality(profile: QualityProfile): void {
    const anisotropyChanged = profile.anisotropy !== this.profile.anisotropy;
    this.profile = profile;
    this.applyProfile(anisotropyChanged);
  }

  /**
   * Options → Resolution. `autoCap` bounds the automatic mode (the phone's
   * measured pixel ratio); null uses the tier's cap.
   */
  setResolution(mode: ResolutionMode, autoCap: number | null = null): void {
    this.resolution = mode;
    this.autoCap = autoCap;
    this.resize();
    this.configurePost();
  }

  /** Options → film grain, sharpen and texture filtering. */
  setImageOptions(options: ImageOptions): void {
    const filteringChanged = options.textureFiltering !== this.image.textureFiltering;
    this.image = { ...options };
    this.configurePost();
    if (filteringChanged) this.applyAnisotropy();
  }

  /** The pixel ratio the canvas renders at now. */
  get pixelRatio(): number {
    return pixelRatioFor(
      this.resolution,
      window.devicePixelRatio || 1,
      this.autoCap ?? this.profile.pixelRatioCap,
    );
  }

  /** Whether the sharpen pass runs (the option, or automatically when the image is upscaled). */
  get sharpening(): boolean {
    return this.image.sharpen ?? this.pixelRatio < (window.devicePixelRatio || 1) - 0.01;
  }

  private get grainOn(): boolean {
    return !this.reducedMotion && (this.image.filmGrain ?? this.profile.filmGrain);
  }

  /** The anisotropy the surfaces use: the option, or the tier's; capped by the GPU. */
  private get anisotropy(): number {
    return Math.min(
      anisotropyFor(this.image.textureFiltering, this.profile),
      Math.max(1, this.renderer.getMaxAnisotropy()),
    );
  }

  private configurePost(): void {
    const p = this.profile;
    this.post.configure({
      ambientOcclusion: p.ambientOcclusion,
      antialias: p.antialias,
      bloom: p.bloom,
      depthOfField: p.depthOfField,
      godrays: p.godrays,
      sharpen: this.sharpening,
    });
  }

  private applyProfile(anisotropyChanged: boolean): void {
    const p = this.profile;
    // Sun: a live shadow sees Nora; the static (mobile) one leaves her to the contact blob.
    this.shadows.applyTier(shadowTierFor(p));
    this.sunShadowAge = Infinity;
    this.contactShadow.visible = p.contactShadow;
    this.torch.setQuality(p);
    this.water?.setQuality(p);
    if (this.waterFx) this.waterFx.budget = p.particles;

    this.configurePost();
    // Volumetric shafts replace the modelled cones; the dust stays.
    for (const s of this.shafts) s.mesh.visible = !p.godrays;
    this.temple?.setQuality(p);
    this.applyParticleBudget();
    if (anisotropyChanged) this.applyAnisotropy();
    this.resize();
  }

  /**
   * Texture filtering everywhere in the scene (level surfaces, prop models,
   * characters): trilinear mipmaps and the anisotropy level. Prop models load
   * later, so this also runs as a periodic sweep; only textures that change
   * are re-uploaded.
   */
  private applyAnisotropy(): void {
    const level = this.anisotropy;
    const fix = (t: THREE.Texture | null | undefined): void => {
      if (!t || t.isRenderTargetTexture || !t.image) return;
      let changed = false;
      // Compressed textures bring their own mips (and cannot generate them).
      if (
        !('isCompressedTexture' in t) &&
        (t.minFilter === THREE.LinearFilter || t.minFilter === THREE.NearestFilter)
      ) {
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        changed = true;
      }
      if (t.minFilter === THREE.LinearMipmapLinearFilter && t.anisotropy !== level) {
        t.anisotropy = level;
        changed = true;
      }
      if (changed) t.needsUpdate = true;
    };
    for (const set of Object.values(this.surfaces ?? {})) {
      for (const t of [set.map, set.normalMap, set.roughnessMap, set.armMap]) fix(t);
    }
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial)) continue;
        fix(m.map);
        fix(m.normalMap);
        fix(m.roughnessMap);
        fix(m.metalnessMap);
        fix(m.aoMap);
        fix(m.emissiveMap);
      }
    });
  }

  /** Draws only the tier's share of every particle system (sun-shaft dust, brazier embers). */
  private applyParticleBudget(): void {
    const k = this.profile.particles;
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Points)) return;
      const count = o.geometry.getAttribute('position')?.count ?? 0;
      o.geometry.setDrawRange(0, Math.max(1, Math.round(count * k)));
    });
  }

  /** Scene render scale from dynamic resolution (spec §14); post effects keep the output size. */
  setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.post.setRenderScale(scale);
  }

  private renderScale = 1;

  /** Reduced motion (spec §13): no film grain. */
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  /**
   * Depth of field for camera focus shots: keeps `at` sharp and blurs the
   * rest by `amount` (0..1). Optional: tiers without it ignore the call.
   */
  setFocus(at: Vec3 | null, amount: number): void {
    if (!at || amount <= 0) {
      this.focus = null;
      return;
    }
    this.focus ??= { at: new THREE.Vector3(), amount: 0 };
    this.focus.at.set(at.x, at.y, at.z);
    this.focus.amount = Math.min(1, amount);
  }

  /**
   * Renders the current view once with every effect on (depth of field
   * included), so shaders compile behind the loading screen rather than on
   * the first frames of play.
   */
  warmup(): void {
    this.warmAll();
    // Behind the loading screen the whole level is drawn only to compile it: at a
    // tenth of the resolution its fill cost is negligible (pipelines do not depend on size).
    this.post.setRenderScale(0.1);
    // Every shadow map gets created now rather than on entering its room.
    // Culling is off here, so every caster is drawn into them and each shadow-depth
    // variant compiles too (the torch's included, on tiers where it casts).
    for (const l of [this.sun, ...this.fireCasters, this.torch.light])
      if (l.castShadow) l.shadow.needsUpdate = true;
    this.post.dofAmount.value = this.post.hasDepthOfField ? 0.5 : 0;
    this.post.raysStrength.value = Math.max(this.post.raysStrength.value, 0.01);
    // Twice: god rays join the pipeline once the first frame has made the sun's shadow map.
    this.post.render(0);
    this.post.render(0);
    this.post.dofAmount.value = 0;
    this.post.setRenderScale(this.renderScale);
    this.warmAll(false);
  }

  /**
   * Draws every room, in or out of view, while `on` (restoring culling after):
   * a frame drawn like this compiles the materials of rooms not yet seen, so
   * entering them never stalls on a shader.
   */
  private warmAll(on = true): void {
    this.culling?.setEnabled(!on);
    this.scene.traverse((o) => {
      if (on && o.frustumCulled) {
        o.frustumCulled = false;
        o.userData.warmCulled = true;
      } else if (!on && o.userData.warmCulled) {
        o.frustumCulled = true;
        delete o.userData.warmCulled;
      }
    });
  }

  /** Set when late assets (the baked props) arrive: the next frame is drawn whole, for warm-up. */
  private warmNext = false;

  /**
   * Builds all level geometry and props. A new World on the same level (a
   * restart) only swaps the state the renderer reads.
   */
  setWorld(world: World): void {
    const sameLevel = this.world?.level === world.level;
    this.world = world;
    this.currentRoom = null;
    this.water.setWorld(world);
    if (sameLevel) return;
    const level = world.level;

    const sunRooms = new Set(level.rooms.filter((r) => lookFile(r.look)?.sun).map((r) => r.id));
    const meshes = buildLevelMeshes(level, { skylightRooms: sunRooms });
    this.shadows.setWindows(skylightWindows(world, meshes.skylights));

    const surf = this.surfaces;
    if (!surf) throw new Error('GameRenderer.init() must finish before setWorld()');
    const mat = (
      set: SurfaceSet,
      extra: THREE.MeshStandardMaterialParameters = {},
    ): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ ...surfaceParams(set), vertexColors: true, ...extra });
    // One material per surface, shared by every room's mesh of it.
    const materials: Record<Surface, THREE.MeshStandardMaterial> = {
      wall: mat(surf.wall),
      floorStone: mat(surf.floor, { color: '#d9c6a8' }),
      floorSand: mat(surf.sand),
      // Walls and floors face into the room and shadow maps draw faces turned
      // away from the light, so a light inside never self-shadows them. The
      // double-sided ceiling needs the same: only its sky side (what blocks
      // the sun) goes into shadow maps, not the side the fires light.
      ceiling: mat(surf.ceiling, { side: THREE.DoubleSide, shadowSide: THREE.BackSide }),
      lip: mat(surf.floor, { color: '#fff4e0' }),
    };
    const culling = new RoomCulling(level, this.scene);
    this.culling = culling;
    for (const part of meshes.parts) {
      const m = new THREE.Mesh(part.geometry, materials[part.surface]);
      m.castShadow = part.surface !== 'floorStone' && part.surface !== 'floorSand';
      m.receiveShadow = true;
      m.name = `level:${part.room}:${part.surface}`;
      m.userData.room = part.room;
      m.userData.surface = part.surface;
      culling.group(part.room)?.add(m);
      this.levelMeshes.push(m);
    }
    // Water surfaces and their caustic overlays follow their rooms' culling.
    this.water.build(world, this.levelMeshes, {
      place: (o, room) => culling.group(room)?.add(o),
      skylights: meshes.skylights,
    });
    this.waterFx.build(level, world);

    const bronze = new THREE.MeshStandardMaterial({ color: '#5e7b68', roughness: 0.65, metalness: 0.35 });
    const propMats = {
      stone: surf.wall,
      floor: surf.floor,
      block: surf.block,
      bronze,
      darkMetal: new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.5, metalness: 0.7 }),
      gold: new THREE.MeshStandardMaterial({ color: '#e8b75a', roughness: 0.25, metalness: 1 }),
    };
    this.props = new Props(level, propMats);
    this.scene.add(this.props.group);
    void this.props.modelsLoaded.then(() => (this.warmNext = true));
    this.temple = new TempleView(level, propMats);
    this.temple.setQuality(this.profile);
    for (const id of this.temple.replacedActors) this.props.hidden.add(id);
    this.guardians = new GuardianView(world, surf.wall);
    this.scene.add(this.temple.group, this.guardians.group);
    this.archive?.dispose();
    this.archive = new ArchiveView(level, new THREE.MeshStandardMaterial(surfaceParams(surf.wall)));
    this.scene.add(this.archive.group);
    this.indexFires();

    this.buildShafts(meshes.skylights, sunRooms);
    this.adoptRoomObjects();
    void this.loadLightmap(level.id);
    this.applyParticleBudget();
  }

  /**
   * Draws a fresh World of the level already built (restart, back to the
   * title) without rebuilding the geometry; another level goes through setWorld.
   */
  resetWorld(world: World): void {
    if (world.level === this.world?.level) this.world = world;
    else this.setWorld(world);
  }

  /**
   * Baked indirect light (scripts/bake): applied as the level materials'
   * lightMap on the second UV set. Direct light stays dynamic. Without a bake
   * the hemisphere light stands in for bounce light.
   */
  private async loadLightmap(levelId: string): Promise<void> {
    const base = `${import.meta.env.BASE_URL}levels/${levelId}.lightmap`;
    try {
      const meta = (await (await fetch(`${base}.json`)).json()) as { scale: number };
      const tex = await new THREE.TextureLoader().loadAsync(`${base}.png`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.channel = 1;
      tex.flipY = true;
      // The bake stores irradiance / π normalised by `scale`; three.js expects irradiance.
      const intensity = meta.scale * Math.PI * GameRenderer.LIGHTMAP_GAIN;
      for (const m of this.levelMeshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.lightMap = tex;
        mat.lightMapIntensity = intensity;
        mat.needsUpdate = true;
      }
      this.lightmapIntensity = intensity;
      this.lightmapScale = 1;
      this.hasLightmap = true;
    } catch {
      this.hasLightmap = false;
    }
  }

  /** Artistic gain on the baked bounce light. */
  static LIGHTMAP_GAIN = 1;
  private hasLightmap = false;
  private lightmapIntensity = 0;
  /** The look's scale on the baked light last applied (dark rooms dim what was baked with their fires). */
  private lightmapScale = 1;

  /** A soft volumetric-looking beam and dust under each skylight. */
  private buildShafts(skylights: { x: number; z: number; ceil: number }[], rooms: Set<string>): void {
    const world = this.world;
    if (!world) return;
    const gradient = document.createElement('canvas');
    gradient.width = 64;
    gradient.height = 256;
    const g = gradient.getContext('2d');
    if (g) {
      const lin = g.createLinearGradient(0, 0, 0, 256);
      lin.addColorStop(0, 'rgba(255,255,255,0.9)');
      lin.addColorStop(0.7, 'rgba(255,255,255,0.35)');
      lin.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lin;
      g.fillRect(0, 0, 64, 256);
    }
    const tex = new THREE.CanvasTexture(gradient);
    for (const roomId of rooms) {
      const cells = skylights.filter(
        (s) => world.level.roomAt(Math.floor(s.x / BLOCK), Math.floor(s.z / BLOCK))?.id === roomId,
      );
      if (!cells.length) continue;
      const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length;
      const cz = cells.reduce((a, c) => a + c.z, 0) / cells.length;
      const ceil = cells[0]?.ceil ?? 10;
      const floor = world.level.floorAt(cx, cz);
      const look = getLook(world.level.rooms.find((r) => r.id === roomId)?.look ?? null);
      const dir = look.sunDir.clone();
      const length = (ceil - floor) / Math.max(0.2, dir.y) + 0.5;
      // Nested cones fake a soft volumetric edge.
      const beam = new THREE.Group();
      beam.position.set(cx, ceil, cz);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().negate());
      for (const [r0, r1, o] of [
        [1.1, 1.3, 0.09],
        [1.6, 1.85, 0.06],
        [2.05, 2.35, 0.035],
      ] as const) {
        const geo = new THREE.CylinderGeometry(r0, r1, length, 16, 1, true);
        geo.translate(0, -length / 2, 0);
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          color: look.sunColor.clone().multiplyScalar(o * 1.6),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        });
        beam.add(new THREE.Mesh(geo, mat));
      }
      this.scene.add(beam);
      const mesh = beam;

      // Bright sky seen through the opening.
      const sky = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 8),
        new THREE.MeshBasicMaterial({ color: look.sunColor.clone().multiplyScalar(3), fog: false }),
      );
      sky.rotation.x = Math.PI / 2;
      sky.position.set(cx, ceil + 0.5, cz);
      this.scene.add(sky);

      // Warm bounce from the sunlit floor (cheap stand-in for global illumination).
      const hit = new THREE.Vector3(cx, floor, cz).add(
        dir
          .clone()
          .multiplyScalar(-(ceil - floor) / Math.max(0.2, dir.y))
          .setY(0),
      );
      this.bounces.push({
        at: new THREE.Vector3(hit.x, floor + 1.2, hit.z),
        room: roomId,
        strength: look.sunIntensity,
      });

      const n = 260;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const t = ((i * 0.618) % 1) * length;
        const a = i * 2.39996;
        const r = Math.sqrt((i * 0.377) % 1) * 1.8;
        const p = new THREE.Vector3(Math.cos(a) * r, -t, Math.sin(a) * r).applyQuaternion(mesh.quaternion);
        pos[i * 3] = cx + p.x;
        pos[i * 3 + 1] = ceil + p.y;
        pos[i * 3 + 2] = cz + p.z;
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      dg.userData.base = pos.slice();
      const dust = new THREE.Points(
        dg,
        new THREE.PointsMaterial({
          color: look.sunColor,
          size: 0.02,
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.scene.add(dust);
      this.shafts.push({ mesh, dust, sky, room: roomId });
      mesh.visible = !this.profile.godrays;
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
  }

  /** World position of an entity, for camera focus shots. */
  entityPosition(id: string): Vec3 | null {
    const e = this.world?.level.entities.find((x) => x.id === id);
    if (!e || !this.world) return null;
    const x = e.at[0] * BLOCK + BLOCK / 2;
    const z = e.at[1] * BLOCK + BLOCK / 2;
    return { x, y: this.world.level.floorAt(x, z) + 1.5, z };
  }

  render(
    prev: PlayerPose,
    curr: PlayerPose,
    alpha: number,
    pose: NoraPose,
    eye: Vec3,
    lookAt: Vec3,
    cameraDistance: number,
    dt: number,
  ): void {
    const world = this.world;
    if (!world) return;
    this.time += dt;

    // Player.
    const lerp = (a: number, b: number): number => a + (b - a) * alpha;
    const px = lerp(prev.pos.x, curr.pos.x);
    const py = lerp(prev.pos.y, curr.pos.y);
    const pz = lerp(prev.pos.z, curr.pos.z);
    this.nora.root.position.set(px, py, pz);
    let dy = curr.yaw - prev.yaw;
    if (dy > Math.PI) dy -= 2 * Math.PI;
    if (dy < -Math.PI) dy += 2 * Math.PI;
    this.nora.root.rotation.y = prev.yaw + dy * alpha;
    // Swimming and diving: the body pitches with the simulation's swim direction.
    this.nora.update({ ...pose, pitch: world.state.player.swim.pitch }, dt);
    this.combat.update(world, this.nora, alpha, dt);
    this.torch.update(world, this.nora, this.time, dt);
    this.nora.setOpacity(Math.min(1, Math.max(0.15, (cameraDistance - 0.6) / 0.8)));

    // Room look.
    const room = world.level.roomAt(Math.floor(px / BLOCK), Math.floor(pz / BLOCK));
    if (room && room.id !== this.currentRoom) {
      const first = this.currentRoom === null;
      this.currentRoom = room.id;
      if (first) this.look = cloneLook(getLook(room.look));
    }
    const target = getLook(room?.look ?? null);
    blendLook(this.look, target, Math.min(1, dt * 1.2));
    this.applyLook();
    // The sun's frustum frames the skylight it shines through; a static map is redrawn when it moves.
    if (this.shadows.update(this.currentRoom, this.look.sunDir)) this.sunShadowAge = Infinity;
    this.shadows.updateHelpers();

    this.props?.update(world, this.time, dt);
    this.adoptRoomObjects();
    this.temple?.update(world, this.time, dt, eye);
    this.archive?.update(world, dt);
    this.guardians?.update(world, this.time, dt, eye);
    this.updateFireLights(eye, dt);
    this.updateShafts(dt);
    this.updateContactShadow(world, px, py, pz);
    const view = this.updateWater(world, room?.look ?? null, eye, dt);

    this.camera.position.copy(view);
    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    if (this.culling) {
      this.culling.update(this.camera, this.nora.root.position);
      this.combat.cullEnemies(this.culling.shows);
    }
    this.updateShadowBudget(dt);
    this.updateFocus();
    this.post.grain.value = this.grainOn ? GRAIN : 0;
    if (++this.filteringSweep >= FILTERING_SWEEP_FRAMES) {
      this.filteringSweep = 0;
      this.applyAnisotropy();
    }
    const warm = this.warmNext;
    if (warm) {
      this.warmNext = false;
      this.warmAll();
    }
    this.post.render(dt);
    if (warm) this.warmAll(false);
  }

  /**
   * Sorts props (views appear lazily, baked models arrive late) and the sun
   * shafts into their rooms' groups for culling. Lights and the shared ember
   * system stay where they are.
   */
  private adoptRoomObjects(): void {
    const culling = this.culling;
    if (!culling) return;
    if (this.props) {
      const embers = this.props.embers;
      culling.adopt(this.props.group, (o) => o instanceof THREE.Light || o === embers, DRESSING);
    }
    for (const s of this.shafts) {
      if (s.mesh.parent === this.scene) culling.place(s.mesh, s.room);
      if (s.dust.parent === this.scene) culling.place(s.dust, s.room);
      if (s.sky.parent === this.scene) culling.place(s.sky, s.room);
    }
  }

  /**
   * Water, flares and splashes for this frame; returns the camera position,
   * kept off the water plane. Under the surface the fog turns to water.
   */
  private updateWater(world: World, look: string | null, eye: Vec3, dt: number): THREE.Vector3 {
    const view = new THREE.Vector3(eye.x, eye.y, eye.z);
    this.water.clearEye(view);
    const wet = (x: number, y: number, z: number): boolean => {
      const s = this.water.surfaceAt(x, z);
      return s !== null && y < s;
    };
    let hand: THREE.Vector3 | null = null;
    if (world.state.flares.some((f) => f.held)) {
      hand = new THREE.Vector3();
      this.nora.handFrame(0, hand, new THREE.Quaternion());
    }
    this.flares.update(world, dt, hand, view, wet);
    // The daylight through a skylight, as bright as its sky plane (buildShafts); none in dark rooms.
    this.waterSky.copy(this.look.sunColor).multiplyScalar(3 * Math.min(1, this.look.sunIntensity / 2));
    this.water.update(
      dt,
      view,
      waterLookOf(look),
      [...this.flares.lights, ...this.fireCasters, ...this.fireLights],
      this.waterSky,
      this.scene.fog as THREE.FogExp2 | null,
    );
    this.waterFx.update(dt, world, view);
    const target = this.water.underwater ? 1 : 0;
    this.underwaterMix += (target - this.underwaterMix) * Math.min(1, dt * 14);
    if (this.underwaterMix > 0.001) {
      const fog = this.scene.fog as THREE.FogExp2;
      const w = this.water.fog;
      fog.color.lerp(w.color, this.underwaterMix);
      fog.density += (w.density - fog.density) * this.underwaterMix;
      (this.scene.background as THREE.Color).lerp(w.color, this.underwaterMix);
    }
    this.post.underwater.value = this.underwaterMix;
    const tint = this.post.waterTint.value.copy(this.water.fog.color);
    tint.multiplyScalar(1 / Math.max(1e-4, tint.r, tint.g, tint.b));
    return view;
  }

  /** Splashes and rings from the simulation's water events. */
  onEvent(e: SimEvent): void {
    this.archive?.onEvent(e);
    const n = (k: string, d = 0): number => (typeof e[k] === 'number' ? (e[k] as number) : d);
    const p = this.world?.state.player;
    if (!p) return;
    switch (e.type) {
      case 'player.splash':
        this.waterFx.splash(n('x', p.pos.x), n('y', p.pos.y), n('z', p.pos.z), n('speed', 3));
        break;
      case 'player.stroke': {
        const s = this.water.surfaceAt(p.pos.x, p.pos.z);
        if (s !== null && e.under !== true) this.waterFx.ring(p.pos.x, s, p.pos.z, 0.9, 1.4, 0.35);
        else if (s !== null) this.waterFx.bubble(p.pos.x, p.pos.y + 1.5, p.pos.z, 2);
        break;
      }
      case 'player.surfaced':
      case 'player.dived': {
        const s = this.water.surfaceAt(p.pos.x, p.pos.z);
        if (s !== null) this.waterFx.splash(p.pos.x, s, p.pos.z, e.type === 'player.dived' ? 2.5 : 1.5);
        break;
      }
      case 'player.climbing':
        if (e.water === true) {
          const s = this.water.surfaceAt(p.pos.x, p.pos.z);
          if (s !== null) this.waterFx.ring(p.pos.x, s, p.pos.z, 1.2, 1.2, 0.4);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Shadow maps are the costliest part of a frame, so only those that matter
   * are re-rendered: the sun where it shines, fires that are lit and near
   * the camera, and on single-shadow tiers only one of the two kinds.
   */
  private updateShadowBudget(dt: number): void {
    const p = this.profile;
    const sunOn = this.sun.intensity > 0.05;
    const sun = this.sun.shadow;
    if (p.sun.live) {
      sun.autoUpdate = sunOn;
    } else {
      this.sunShadowAge += dt;
      if (sunOn && this.sunShadowAge >= STATIC_SHADOW_REFRESH) {
        sun.needsUpdate = true;
        this.sunShadowAge = 0;
      }
    }
    // Casters that are dark keep their last map (the scheduler moves them only while dark).
    for (const l of this.fireCasters) l.shadow.autoUpdate = l.intensity > 0;
  }

  /** The shadows' current framing, biases and casters (debug console, audit). */
  shadowAudit(): Record<string, unknown> {
    return this.shadows.audit(this.scene);
  }

  /** Depth of field follows the camera's focus shot. */
  private updateFocus(): void {
    const f = this.focus;
    if (!f || !this.post.hasDepthOfField) {
      this.post.dofAmount.value = 0;
      return;
    }
    const d = this.camera.position.distanceTo(f.at);
    this.post.focusDistance.value = d;
    // A wider sharp band for far targets, as a real lens at a fixed aperture gives.
    this.post.focusRange.value = 2 + d * 0.35;
    this.post.dofAmount.value = f.amount;
  }

  /** A soft dark blob under Nora on tiers without her dynamic shadow. */
  private updateContactShadow(world: World, x: number, y: number, z: number): void {
    const blob = this.contactShadow;
    if (!blob.visible) return;
    const floor = world.grid.floorAt(x, z);
    if (!Number.isFinite(floor)) {
      blob.scale.setScalar(0.001);
      return;
    }
    const h = Math.max(0, y - floor);
    blob.position.set(x, floor + 0.015, z);
    // Shrinks at a ledge rather than hanging in the air past it.
    const reach = levelReach((px, pz) => world.grid.floorAt(px, pz), x, z, floor, CONTACT_RADIUS);
    blob.scale.setScalar(Math.min(1 - Math.min(0.45, h * 0.15), reach / CONTACT_RADIUS));
    this.contactStrength.value = 0.75 * Math.max(0, 1 - h / 3);
  }

  private applyLook(): void {
    const l = this.look;
    (this.scene.background as THREE.Color).copy(l.background);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(l.fogColor);
    fog.density = l.fogDensity;
    this.renderer.toneMappingExposure = l.exposure;
    this.hemi.color.copy(l.hemiSky);
    this.hemi.groundColor.copy(l.hemiGround);
    this.hemi.intensity = l.hemiIntensity * (this.hasLightmap ? 0.6 : 1);
    // Dark rooms raise the fill (the look's scale): brighter and reaching a little further.
    // Under water it grows threefold, so the drowned tunnels are not swum blind.
    const fill = l.fill * (1 + 2 * this.underwaterMix);
    this.characterFill.intensity = 1.6 * fill;
    this.characterFill.distance = 4.5 * Math.sqrt(fill);
    if (this.hasLightmap && Math.abs(l.lightmap - this.lightmapScale) > 1e-3) {
      this.lightmapScale = l.lightmap;
      for (const m of this.levelMeshes)
        (m.material as THREE.MeshStandardMaterial).lightMapIntensity = this.lightmapIntensity * l.lightmap;
    }
    this.sun.color.copy(l.sunColor);
    this.sun.intensity = l.sunIntensity;
    const t = this.sun.target.position;
    this.sun.position.set(t.x + l.sunDir.x * 60, t.y + l.sunDir.y * 60, t.z + l.sunDir.z * 60);
    const post = this.post;
    post.bloomStrength.value = l.bloomStrength;
    post.bloomRadius.value = l.bloomRadius;
    post.bloomThreshold.value = l.bloomThreshold;
    post.tint.value.copy(l.tint);
    post.saturation.value = l.saturation;
    post.contrast.value = l.contrast;
    post.vignette.value = l.vignette;
    post.raysColor.value.copy(l.sunColor);
    post.raysStrength.value = l.sunIntensity * GameRenderer.RAYS_GAIN;
  }

  /** Brightness of the volumetric sun shafts per unit of sun intensity (art direction knob). */
  static RAYS_GAIN = 0.24;

  /**
   * The brazier mask at the lit point, read from the atlas through a light's
   * `tile` (world corner xy, texel offset zw). The point moves 5 cm off its
   * surface, so a wall face reads the open half metre in front of it.
   */
  private fireMaskAt(tile: THREE.UniformNode<'vec4', THREE.Vector4>) {
    const p = positionWorld.xz.add(normalWorld.xz.mul(0.05));
    // Outside the mask, the clamp lands on its dark border.
    const local = clamp(p.sub(tile.xy).mul(MASK_RES / BLOCK), 0.5, MASK_SIZE - 0.5);
    // sample() keeps a reference to maskTexture, so a new level's atlas reaches every light.
    return this.maskTexture.sample(vec2(tile.zw).add(local).div(this.maskAtlasSize)).r;
  }

  /** Braziers with their rooms, and which rooms touch, for the fire light scheduler. */
  private indexFires(): void {
    const level = this.world?.level;
    if (!level) return;
    // Where each brazier's light may fall (light-mask.ts), packed into one texture.
    const grid = {
      open: (cx: number, cz: number): boolean => {
        const sec = level.sector(cx, cz);
        return sec !== undefined && !sec.wall;
      },
    };
    const atlas = maskAtlas((this.props?.fires ?? []).map((f) => fireMask(grid, f.pos.x, f.pos.z)));
    const rgba = new Uint8Array(atlas.width * atlas.height * 4);
    for (let i = 0; i < atlas.data.length; i++) {
      const v = atlas.data[i] ?? 0;
      rgba[i * 4] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
    // The previous atlas is left to the garbage collector: disposing a texture a
    // compiled binding may still hold floods WebGPU with validation errors.
    this.maskTexture.value = maskDataTexture(rgba, atlas.width, atlas.height);
    this.maskAtlasSize.value.set(atlas.width, atlas.height);
    this.maskTiles = atlas.tiles;
    this.fireSpots = (this.props?.fires ?? []).map((f) => ({
      x: f.pos.x,
      y: f.pos.y,
      z: f.pos.z,
      room: level.roomAt(Math.floor(f.pos.x / BLOCK), Math.floor(f.pos.z / BLOCK))?.id ?? null,
      off: f.level <= 0,
    }));
    this.neighbours = new Map();
    for (const a of level.rooms) {
      const touching = new Set([a.id]);
      for (const b of level.rooms) {
        const overlaps =
          a.minX - 1 <= b.maxX && b.minX <= a.maxX + 1 && a.minZ - 1 <= b.maxZ && b.minZ <= a.maxZ + 1;
        if (overlaps) touching.add(b.id);
      }
      this.neighbours.set(a.id, touching);
    }
  }

  /**
   * Fire lights fade between braziers (fire-lights.ts): the current room's
   * and its neighbours' first, casters handed over by crossfading.
   */
  private updateFireLights(eye: Vec3, dt: number): void {
    const fires = this.props?.fires ?? [];
    if (this.fireSpots.length !== fires.length) this.indexFires();
    // Cold braziers (the Cisterns' dark hall) get a light once a flare lights them.
    this.fireSpots.forEach((spot, i) => (spot.off = (fires[i]?.level ?? 1) <= 0));
    const p = this.profile;
    const preferred = this.neighbours.get(this.currentRoom ?? '') ?? new Set<string>();
    // Single-shadow tiers give the budget to the sun where it shines.
    const casters = p.singleShadow && this.sun.intensity > 0.05 ? 0 : p.fireShadows;
    const levels = this.fireSchedule.update(this.fireSpots, eye, preferred, p.fireLights.active, casters, dt);
    const base = Math.max(this.look.fireIntensity, 20) * FIRE_GAIN;
    const t = this.time;
    const drive = (light: THREE.PointLight, fire: number, level: number): void => {
      const f = fires[fire];
      if (!f || level <= 0) {
        light.intensity = 0;
        return;
      }
      const flick =
        1 - this.look.flicker * (0.5 + 0.5 * Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 1.7));
      light.position.set(f.pos.x, f.pos.y + FIRE_LIGHT_LIFT, f.pos.z);
      light.color.copy(this.look.fireColor);
      light.intensity = base * flick * level;
    };
    levels.plain.forEach((l, i) => {
      const light = this.fireLights[i];
      if (!light) return;
      drive(light, l.fire, l.level);
      // The light's colorNode replaces three's colour × intensity uniform: drive ours.
      const u = this.fireMaskUniforms[i];
      const tile = this.maskTiles[l.fire];
      if (!u) return;
      u.tint.value.copy(light.color).multiplyScalar(light.intensity);
      if (tile) u.tile.value.set(tile.originX, tile.originZ, tile.tileX, tile.tileY);
    });
    levels.casters.forEach((l, i) => {
      const light = this.fireCasters[i];
      if (light) drive(light, l.fire, l.level);
    });
  }

  /** Moves the dimmer bounce light to the current room when that room has a sun and no light yet. */
  private assignBounce(): void {
    const room = this.currentRoom;
    if (this.bounceLights.some((b) => b.room === room)) return;
    const source = this.bounces.find((b) => b.room === room);
    if (!source) return;
    const [a, b] = this.bounceLights;
    if (!a || !b) return;
    const free = a.light.intensity <= b.light.intensity ? a : b;
    free.room = source.room;
    free.strength = source.strength;
    free.light.intensity = 0;
    free.light.position.copy(source.at);
  }

  private updateShafts(dt: number): void {
    this.assignBounce();
    for (const b of this.bounceLights) {
      const target = this.currentRoom === b.room ? b.strength * 9 : 0;
      b.light.intensity += (target - b.light.intensity) * Math.min(1, dt * 1.5);
    }
    for (const s of this.shafts) {
      const on = this.currentRoom === s.room ? 1 : 0.35;
      for (const child of s.mesh.children) {
        const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity += (on - m.opacity) * Math.min(1, dt * 2);
      }
      // Dust in rooms out of sight is not animated (nor uploaded) until it is seen again.
      if (s.dust.parent && !s.dust.parent.visible) continue;
      const attr = s.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = s.dust.geometry.userData.base as Float32Array;
      // Only the tier's share of the particles is drawn (applyParticleBudget), so only that moves.
      const drawn = Math.min(attr.count, s.dust.geometry.drawRange.count);
      for (let i = 0; i < drawn; i++) {
        const ph = i * 1.3;
        attr.setXYZ(
          i,
          (base[i * 3] ?? 0) + Math.sin(this.time * 0.13 + ph) * 0.25,
          (base[i * 3 + 1] ?? 0) + Math.sin(this.time * 0.07 + ph * 0.7) * 0.4,
          (base[i * 3 + 2] ?? 0) + Math.cos(this.time * 0.11 + ph) * 0.25,
        );
      }
      attr.needsUpdate = true;
    }
  }
}

/** Each sun room's skylight cells and the lowest floor in the room, for the sun's shadow window. */
function skylightWindows(
  world: World,
  skylights: readonly { x: number; z: number; ceil: number }[],
): Map<string, SkylightWindow> {
  const level = world.level;
  const out = new Map<string, SkylightWindow>();
  for (const cell of skylights) {
    const room = level.roomAt(Math.floor(cell.x / BLOCK), Math.floor(cell.z / BLOCK));
    if (!room) continue;
    let win = out.get(room.id);
    if (!win) {
      let floor = Infinity;
      for (let cx = room.minX; cx < room.maxX; cx++) {
        for (let cz = room.minZ; cz < room.maxZ; cz++) {
          const s = level.sector(cx, cz);
          if (s && !s.wall) floor = Math.min(floor, ...s.floor);
        }
      }
      win = { cells: [], floor: Number.isFinite(floor) ? floor : 0 };
      out.set(room.id, win);
    }
    win.cells.push(cell);
  }
  return out;
}

/**
 * The mobile tier's contact shadow: a quad lying on the floor whose opacity
 * falls off radially, computed in the shader (textured versions drew nothing
 * on the WebGL2 backend). `strength` fades it as Nora leaves the ground.
 */
function makeContactShadow(): { mesh: THREE.Mesh; strength: THREE.UniformNode<'float', number> } {
  const strength = uniform(0.75);
  const material = new THREE.MeshBasicNodeMaterial({
    color: '#000000',
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const r = length(uv().sub(0.5)).mul(2);
  // A flat core under the feet that fades out towards the rim.
  material.opacityNode = smoothstep(0.15, 1, r).oneMinus().mul(0.85).mul(strength);
  // Fog would lift the black towards the fog colour; the blob sits under Nora's feet anyway.
  material.fog = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CONTACT_RADIUS * 2, CONTACT_RADIUS * 2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return { mesh, strength };
}

/** A brazier mask atlas as a texture: one channel stored as RGBA, filtered alike on every backend. */
function maskDataTexture(rgba: Uint8Array, width: number, height: number): THREE.DataTexture {
  const t = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Until a level's braziers are known: a single lit texel, so the lights behave as before. */
function placeholderMask(): THREE.DataTexture {
  return maskDataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
}
