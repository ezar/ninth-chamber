/**
 * The game renderer (spec §11 "Render"): builds the level from the grid,
 * lights it with the per-room looks, and draws the world state with render
 * interpolation through the post-processing stack. It only reads the
 * simulation. What it spends on shadows, effects and resolution follows the
 * quality tier (render/quality.ts).
 */
import * as THREE from 'three/webgpu';
import { length, smoothstep, uniform, uv } from 'three/tsl';
import { BLOCK } from '../sim/grid/units';
import type { Vec3 } from '../sim/state';
import type { World } from '../sim/world';
import { buildLevelMeshes } from './level-mesh';
import { blendLook, cloneLook, getLook, lookFile, type Look } from './looks';
import type { NoraPose } from './nora';
import { NoraRig } from './nora-scan';
import { Props } from './props';
import { loadSurfaces, surfaceParams, type SurfaceName, type SurfaceSet } from './materials';
import { PostStack } from './post';
import { QUALITY, type QualityProfile } from './quality';

export interface PlayerPose {
  pos: Vec3;
  yaw: number;
}

const FIRE_SLOTS = 4;
/**
 * Nora's meshes live on this layer only, so a shadow camera can leave her out
 * (the mobile tier's occasionally refreshed sun shadow) while the view camera
 * and the live shadows include her.
 */
const CHARACTER_LAYER = 1;
/** Seconds between refreshes of a non-live (mobile) sun shadow. */
const STATIC_SHADOW_REFRESH = 1;
/** Film grain amplitude on the display image (art bible: subtle). */
const GRAIN = 0.035;

export class GameRenderer {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 250);
  private readonly post: PostStack;
  private profile: QualityProfile;
  private readonly hemi = new THREE.HemisphereLight('#6f7f8f', '#2a1f17', 0.4);
  private readonly sun = new THREE.DirectionalLight('#ffffff', 0);
  private readonly fireLights: THREE.PointLight[] = [];
  private readonly characterFill = new THREE.PointLight('#ffe2c4', 1.6, 4.5, 2);
  private readonly nora = new NoraRig();
  private props: Props | null = null;
  private world: World | null = null;
  private look: Look = cloneLook(getLook(null));
  private currentRoom: string | null = null;
  private readonly shafts: { mesh: THREE.Group; dust: THREE.Points; room: string }[] = [];
  private readonly bounces: { light: THREE.PointLight; room: string; strength: number }[] = [];
  private readonly levelMeshes: THREE.Mesh[] = [];
  private time = 0;
  private surfaces: Record<SurfaceName, SurfaceSet> | null = null;
  private reducedMotion = false;
  private sunShadowAge = Infinity;
  private readonly contactShadow: THREE.Mesh;
  private readonly contactStrength: THREE.UniformNode<'float', number>;
  private focus: { at: THREE.Vector3; amount: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    profile: QualityProfile = QUALITY.high,
  ) {
    // No MSAA on the canvas: the scene is drawn into the post pipeline's own target.
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
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
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    for (let i = 0; i < FIRE_SLOTS; i++) {
      const l = new THREE.PointLight('#ff8a3d', 0, 18, 2);
      // Point shadows: a small bias against acne on rough stone, a normal bias for grazing walls.
      l.shadow.bias = -0.004;
      l.shadow.normalBias = 0.05;
      l.shadow.camera.layers.enable(CHARACTER_LAYER);
      this.fireLights.push(l);
      this.scene.add(l);
    }
    this.scene.add(this.nora.root);
    // A soft fill that follows Nora so she reads against backlight (a common
    // character-lighting cheat); short range, so it barely touches the set.
    this.characterFill.position.set(0.6, 2.2, 1.6);
    this.nora.root.add(this.characterFill);
    const contact = makeContactShadow();
    this.contactShadow = contact.mesh;
    this.contactStrength = contact.strength;
    this.scene.add(this.contactShadow);
    this.applyProfile(false);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    [this.surfaces] = await Promise.all([
      loadSurfaces(),
      this.nora.loadScan(`${import.meta.env.BASE_URL}models/nora.glb`),
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

  private applyProfile(anisotropyChanged: boolean): void {
    const p = this.profile;
    // Sun: a live shadow sees Nora; the static (mobile) one leaves her to the contact blob.
    const sun = this.sun.shadow;
    sun.mapSize.set(p.sun.size, p.sun.size);
    sun.radius = p.sun.radius;
    if (p.sun.live) sun.camera.layers.enable(CHARACTER_LAYER);
    else sun.camera.layers.disable(CHARACTER_LAYER);
    sun.autoUpdate = p.sun.live;
    this.sunShadowAge = Infinity;
    this.fireLights.forEach((l, i) => {
      l.castShadow = i < p.fireShadows;
      l.shadow.mapSize.set(p.fireShadowSize, p.fireShadowSize);
    });
    this.contactShadow.visible = p.contactShadow;

    this.post.configure({
      ambientOcclusion: p.ambientOcclusion,
      antialias: p.antialias,
      bloom: p.bloom,
      depthOfField: p.depthOfField,
      godrays: p.godrays,
    });
    // Volumetric shafts replace the modelled cones; the dust stays.
    for (const s of this.shafts) s.mesh.visible = !p.godrays;
    this.applyParticleBudget();
    if (anisotropyChanged) this.applyAnisotropy();
    this.resize();
  }

  /** Anisotropic filtering on the scanned surfaces, capped by the GPU. */
  private applyAnisotropy(): void {
    if (!this.surfaces) return;
    const level = Math.min(this.profile.anisotropy, Math.max(1, this.renderer.getMaxAnisotropy()));
    for (const set of Object.values(this.surfaces)) {
      for (const t of [set.map, set.normalMap, set.roughnessMap, set.armMap]) {
        if (!t || t.anisotropy === level) continue;
        t.anisotropy = level;
        t.needsUpdate = true;
      }
    }
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
    this.post.setRenderScale(scale);
  }

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
    // Every shadow map gets created now rather than on entering its room.
    for (const l of [this.sun, ...this.fireLights]) if (l.castShadow) l.shadow.needsUpdate = true;
    this.post.dofAmount.value = this.post.hasDepthOfField ? 0.5 : 0;
    this.post.raysStrength.value = Math.max(this.post.raysStrength.value, 0.01);
    // Twice: god rays join the pipeline once the first frame has made the sun's shadow map.
    this.post.render(0);
    this.post.render(0);
    this.post.dofAmount.value = 0;
  }

  /**
   * Builds all level geometry and props. A new World on the same level (a
   * restart) only swaps the state the renderer reads.
   */
  setWorld(world: World): void {
    const sameLevel = this.world?.level === world.level;
    this.world = world;
    this.currentRoom = null;
    if (sameLevel) return;
    const level = world.level;

    const sunRooms = new Set(level.rooms.filter((r) => lookFile(r.look)?.sun).map((r) => r.id));
    const meshes = buildLevelMeshes(level, { skylightRooms: sunRooms });

    const surf = this.surfaces;
    if (!surf) throw new Error('GameRenderer.init() must finish before setWorld()');
    const mat = (
      set: SurfaceSet,
      extra: THREE.MeshStandardMaterialParameters = {},
    ): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ ...surfaceParams(set), vertexColors: true, ...extra });
    const add = (geo: THREE.BufferGeometry, material: THREE.Material, cast = true): void => {
      const m = new THREE.Mesh(geo, material);
      m.castShadow = cast;
      m.receiveShadow = true;
      this.scene.add(m);
      this.levelMeshes.push(m);
    };
    add(meshes.surfaces.wall, mat(surf.wall));
    add(meshes.surfaces.floorStone, mat(surf.floor, { color: '#d9c6a8' }), false);
    add(meshes.surfaces.floorSand, mat(surf.sand), false);
    add(meshes.surfaces.ceiling, mat(surf.ceiling, { side: THREE.DoubleSide }));
    add(meshes.surfaces.lip, mat(surf.floor, { color: '#fff4e0' }));

    const bronze = new THREE.MeshStandardMaterial({ color: '#5e7b68', roughness: 0.65, metalness: 0.35 });
    this.props = new Props(level, {
      stone: surf.wall,
      floor: surf.floor,
      block: surf.block,
      bronze,
      darkMetal: new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.5, metalness: 0.7 }),
      gold: new THREE.MeshStandardMaterial({ color: '#e8b75a', roughness: 0.25, metalness: 1 }),
    });
    this.scene.add(this.props.group);

    this.buildShafts(meshes.skylights, sunRooms);
    void this.loadLightmap(level.id);
    this.applyParticleBudget();
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
      this.hasLightmap = true;
    } catch {
      this.hasLightmap = false;
    }
  }

  /** Artistic gain on the baked bounce light. */
  static LIGHTMAP_GAIN = 1;
  private hasLightmap = false;

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
      const bounce = new THREE.PointLight('#e0b27a', 0, 22, 1.6);
      bounce.position.set(hit.x, floor + 1.2, hit.z);
      this.scene.add(bounce);
      this.bounces.push({ light: bounce, room: roomId, strength: look.sunIntensity });

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
      this.shafts.push({ mesh, dust, room: roomId });
      mesh.visible = !this.profile.godrays;
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.profile.pixelRatioCap));
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
    this.nora.update(pose, dt);
    this.nora.setOpacity(Math.min(1, Math.max(0.15, (cameraDistance - 0.6) / 0.8)));

    // Room look.
    const room = world.level.roomAt(Math.floor(px / BLOCK), Math.floor(pz / BLOCK));
    if (room && room.id !== this.currentRoom) {
      const first = this.currentRoom === null;
      this.currentRoom = room.id;
      if (first) this.look = cloneLook(getLook(room.look));
      this.fitSun(room.minX, room.minZ, room.maxX, room.maxZ);
    }
    const target = getLook(room?.look ?? null);
    blendLook(this.look, target, Math.min(1, dt * 1.2));
    this.applyLook();

    this.props?.update(world, this.time, dt);
    this.updateFireLights(eye);
    this.updateShafts(dt);
    this.updateContactShadow(world, px, py, pz);

    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    this.updateShadowBudget(dt);
    this.updateFocus();
    this.post.grain.value = this.reducedMotion ? 0 : GRAIN;
    this.post.render(dt);
  }

  private fitSun(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const cx = ((minX + maxX) / 2) * BLOCK;
    const cz = ((minZ + maxZ) / 2) * BLOCK;
    const half = (Math.max(maxX - minX, maxZ - minZ) * BLOCK) / 2 + 4;
    const s = this.sun.shadow.camera;
    s.left = -half;
    s.right = half;
    s.top = half;
    s.bottom = -half;
    s.near = 1;
    s.far = 120;
    s.updateProjectionMatrix();
    this.sun.target.position.set(cx, 0, cz);
    this.sunShadowAge = Infinity;
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
    this.fireLights.forEach((l, i) => {
      if (i >= p.fireShadows) return;
      const near = l.position.distanceTo(this.camera.position) < l.distance + 4;
      l.shadow.autoUpdate = l.intensity > 0 && near && !(p.singleShadow && sunOn);
    });
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
    blob.scale.setScalar(1 - Math.min(0.45, h * 0.15));
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

  /** The fire light pool follows the nearest braziers. */
  private updateFireLights(eye: Vec3): void {
    const fires = this.props?.fires ?? [];
    const sorted = [...fires].sort(
      (a, b) =>
        (a.pos.x - eye.x) ** 2 + (a.pos.z - eye.z) ** 2 - ((b.pos.x - eye.x) ** 2 + (b.pos.z - eye.z) ** 2),
    );
    this.fireLights.forEach((light, i) => {
      const f = sorted[i];
      if (!f) {
        light.intensity = 0;
        return;
      }
      const t = this.time;
      const flick =
        1 - this.look.flicker * (0.5 + 0.5 * Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 1.7));
      light.position.set(f.pos.x, f.pos.y + 0.3, f.pos.z);
      light.color.copy(this.look.fireColor);
      // Look values are per-brazier candela; the pool lights stand in for several fires, so they run hotter.
      light.intensity = Math.max(this.look.fireIntensity, 20) * 2.5 * flick;
    });
  }

  private updateShafts(dt: number): void {
    for (const b of this.bounces) {
      const target = this.currentRoom === b.room ? b.strength * 9 : 0;
      b.light.intensity += (target - b.light.intensity) * Math.min(1, dt * 1.5);
    }
    for (const s of this.shafts) {
      const on = this.currentRoom === s.room ? 1 : 0.35;
      for (const child of s.mesh.children) {
        const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity += (on - m.opacity) * Math.min(1, dt * 2);
      }
      const attr = s.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = s.dust.geometry.userData.base as Float32Array;
      for (let i = 0; i < attr.count; i++) {
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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.visible = false;
  return { mesh, strength };
}
