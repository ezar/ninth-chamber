/**
 * Visuals for level entities and mechanisms. They read the simulation state
 * every frame and never write to it.
 */
import * as THREE from 'three/webgpu';
import { bellowsBlock } from './forge';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { glyphRows } from '../core/glyphs';
import type { NoteStyle } from '../sim/grid/schema';
import type { Level } from '../sim/grid/level';
import { BLOCK, DIR_VEC, DIR_YAW } from '../sim/grid/units';
import { mechanics } from '../sim/player/tuning';
import type { Actor } from '../sim/state';
import type { World } from '../sim/world';
import { surfaceParams, type SurfaceSet } from './materials';
import { FIRE_BASE } from './fire-lights';
import { DOOR_MODEL_HEIGHT, dressLevel, PropLibrary, type PropModel } from './prop-models';
import { crackMask } from './textures';
import { materialColor, texture, uv, vec2 } from 'three/tsl';
import { torchModel } from './torch';

const center = (c: number): number => c * BLOCK + BLOCK / 2;

/**
 * Each chamber's relic in its own light (the art bible: the relic is always
 * the brightest point of its chamber). The Antechamber's Amber Heart keeps
 * the model's amber; the Cisterns' Tide Glass is a cold sea-green glass.
 */
const RELIC_TINTS: Readonly<Record<string, { color: string; emissive: string; light: string }>> = {
  cisterns: { color: '#bfeee6', emissive: '#46d0c4', light: '#7ee6dc' },
  clay_archive: { color: '#b4683e', emissive: '#ff6a2a', light: '#ff9a5a' },
};

/** Chambers whose relic is a tablet of fired clay rather than a gem in a cage. */
const TABLET_RELICS: ReadonlySet<string> = new Set(['clay_archive']);

/** Tints a relic gem material for its chamber (in place). */
function tintRelic(m: THREE.MeshStandardMaterial, levelId: string): void {
  const t = RELIC_TINTS[levelId];
  if (!t) return;
  m.color.set(t.color);
  m.emissive.set(t.emissive);
}

export interface FireSource {
  pos: THREE.Vector3;
  phase: number;
  /** Brazier entity id. */
  id: string;
  /** Starts cold, waiting for a flare (the Cisterns' dark hall). */
  cold: boolean;
  /** How much it burns now, 0..1: a lit cold brazier flares up over a second. */
  level: number;
}

export interface PropMaterials {
  stone: SurfaceSet;
  floor: SurfaceSet;
  block: SurfaceSet;
  bronze: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
}

export class Props {
  readonly group = new THREE.Group();
  readonly fires: FireSource[] = [];
  readonly relicLight: THREE.PointLight;
  private readonly actorViews = new Map<string, THREE.Object3D>();
  /** Actors another view draws instead (e.g. a level's own relic model). */
  readonly hidden = new Set<string>();
  private readonly actors = new Map<string, Actor>();
  private readonly tileViews = new Map<string, THREE.Mesh>();
  private readonly flames: {
    sprite: THREE.Sprite;
    base: THREE.Vector3;
    phase: number;
    scale: number;
    fire: number;
  }[] = [];
  /** Four flame layers shared by every lit brazier; a cold brazier's sprites get their own, to fade in. */
  private readonly flameMaterials: THREE.SpriteMaterial[];
  /** Embers of every fire in one particle system (drawn wherever the rooms are). */
  readonly embers: THREE.Points;
  private readonly emberData: {
    origin: THREE.Vector3;
    t: number;
    speed: number;
    drift: THREE.Vector2;
    fire: number;
  }[] = [];
  private relicMesh: THREE.Mesh | null = null;
  /** Pushable blocks are drawn as shelves of tablets (the Clay Archive, spec §19). */
  private get shelves(): boolean {
    return this.level.rooms.some((r) => r.look?.startsWith('archive_'));
  }
  /** Emissive gain of the current relic view (the baked gem needs more than the stand-in). */
  private relicGain = 1;
  private relicBase = new THREE.Vector3();
  private glintTexture: THREE.Texture | null = null;
  /** Baked models once loaded (see prop-models.ts); null while the stand-ins show. */
  private lib: PropLibrary | null = null;
  private readonly brazierViews: THREE.Group[] = [];
  private coals: THREE.MeshStandardMaterial | null = null;
  /** Coals of each cold brazier (their own material, dark until lit), by fire index. */
  private readonly coldCoals = new Map<number, THREE.MeshStandardMaterial>();
  /** Settles once the baked models have replaced the stand-ins. */
  readonly modelsLoaded: Promise<void>;

  constructor(
    private readonly level: Level,
    private readonly mats: PropMaterials,
  ) {
    this.relicLight = new THREE.PointLight(RELIC_TINTS[level.id]?.light ?? '#ffab3d', 0, 14, 2);
    this.group.add(this.relicLight);

    const flameTex = flameTexture();
    // Four flame layers, one material each shared by every brazier (not one per sprite).
    this.flameMaterials = [0, 1, 2, 3].map(
      (k) =>
        new THREE.SpriteMaterial({
          map: flameTex,
          color: k === 0 ? '#ffd9a0' : '#ff8a3a',
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          fog: false,
        }),
    );
    for (const e of level.entities) {
      if (e.type !== 'brazier') continue;
      const [cx, cz] = e.at;
      const y = level.floorAt(center(cx), center(cz));
      const b = new THREE.Group();
      b.add(brazier(mats));
      b.position.set(center(cx), y, center(cz));
      this.group.add(b);
      this.brazierViews.push(b);
      const firePos = new THREE.Vector3(center(cx), y + FIRE_BASE, center(cz));
      const cold = !e.lit;
      this.fires.push({ pos: firePos, phase: this.fires.length * 1.7, id: e.id, cold, level: cold ? 0 : 1 });
      for (let k = 0; k < 4; k++) {
        const shared = this.flameMaterials[k];
        const s = new THREE.Sprite(cold ? shared?.clone() : shared);
        const scale = k === 0 ? 0.55 : 0.8 - k * 0.1;
        s.scale.set(scale * 0.7, scale, 1);
        const base = firePos
          .clone()
          .add(new THREE.Vector3((k - 1.5) * 0.08, 0.15 + k * 0.03, ((k * 7) % 3) * 0.05 - 0.05));
        s.position.copy(base);
        s.visible = !cold;
        this.flames.push({
          sprite: s,
          base,
          phase: k * 2.1 + this.fires.length,
          scale,
          fire: this.fires.length - 1,
        });
        this.group.add(s);
      }
    }

    // Embers rising from every fire.
    const count = Math.max(1, this.fires.length) * 24;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const f = this.fires[i % Math.max(1, this.fires.length)];
      this.emberData.push({
        origin: f ? f.pos.clone() : new THREE.Vector3(0, -100, 0),
        t: (i * 0.37) % 1,
        speed: 0.6 + ((i * 13) % 7) * 0.12,
        drift: new THREE.Vector2(((i * 17) % 11) / 11 - 0.5, ((i * 29) % 13) / 13 - 0.5),
        fire: i % Math.max(1, this.fires.length),
      });
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(
      eg,
      new THREE.PointsMaterial({
        color: '#ffb060',
        size: 0.035,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.group.add(this.embers);

    this.buildSpikes();
    this.buildCrumbleTiles();
    this.modelsLoaded = PropLibrary.load(import.meta.env.BASE_URL).then((lib) => this.useModels(lib));
  }

  /** Swaps the procedural stand-ins for the baked models and dresses the rooms. */
  private useModels(lib: PropLibrary): void {
    this.lib = lib;
    this.coals = lib.material('brazier', 'coals');
    this.brazierViews.forEach((b, i) => {
      const m = lib.instance('brazier');
      if (!m) return;
      b.clear();
      b.add(m);
      // A cold brazier's coals get their own material, dark until a flare lights them.
      const coals = this.coals;
      if (!this.fires[i]?.cold || !coals) return;
      const own = coals.clone();
      own.emissiveIntensity = 0;
      this.coldCoals.set(i, own);
      m.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material === coals) o.material = own;
      });
    });
    for (const [id, holder] of this.actorViews) {
      const a = this.actors.get(id);
      if (a) this.upgrade(holder, a);
    }
    const busy = new Set<string>();
    for (const e of this.level.entities) busy.add(`${e.at[0]},${e.at[1]}`);
    for (const a of this.actors.values()) busy.add(`${a.cx},${a.cz}`);
    this.group.add(dressLevel(this.level, lib, busy));
  }

  /** Replaces an actor's stand-in with its baked model, when there is one. */
  private upgrade(holder: THREE.Object3D, a: Actor): void {
    const lib = this.lib;
    if (!lib || holder.userData.model) return;
    let m: THREE.Object3D | null = null;
    switch (a.kind) {
      case 'block':
        // The Archive's shelves and the Forge's bellows keep their own look (no baked model yet).
        if (this.shelves) break;
        if (this.level.entities.some((e) => e.id === a.id && e.type === 'block' && e.look === 'bellows'))
          break;
        m = lib.instance('block');
        m?.scale.set((BLOCK - 0.03) / BLOCK, 1, (BLOCK - 0.03) / BLOCK);
        break;
      case 'door':
        m = lib.instance('door');
        if (m) {
          m.rotation.y = this.doorYaw(a.cx, a.cz);
          // Keep the seal round: shorter doors sink into the floor, taller ones stretch.
          if (a.height >= DOOR_MODEL_HEIGHT) m.scale.y = a.height / DOOR_MODEL_HEIGHT;
          else m.position.y = a.height - DOOR_MODEL_HEIGHT;
        }
        break;
      case 'lever':
        m = lib.instance('lever');
        // The baked handle points out along +Z: negative tilts the knob up.
        if (m) holder.userData.swing = [-0.7, 0.7];
        break;
      case 'secret': {
        const name = `idol_${a.variant}` as PropModel;
        m = lib.has(name) ? lib.instance(name) : null;
        break;
      }
      case 'relic': {
        if (TABLET_RELICS.has(this.level.id)) break;
        m = lib.instance('relic');
        const gem = m?.getObjectByName('gem');
        if (m && gem instanceof THREE.Mesh && gem.material instanceof THREE.MeshStandardMaterial) {
          m.position.y = -0.11; // the view is placed at the relic's centre
          gem.material = gem.material.clone();
          tintRelic(gem.material, this.level.id);
          this.relicMesh = gem;
          this.relicGain = 2.4;
        }
        break;
      }
      case 'medkit':
        m = lib.instance('medkit');
        break;
      default:
        break;
    }
    if (!m) return;
    holder.clear();
    holder.add(m);
    holder.userData.model = true;
  }

  private buildSpikes(): void {
    const spots: THREE.Vector3[] = [];
    for (const s of this.level.allSectors()) {
      if (!s.flags.has('death')) continue;
      const y = Math.max(...s.floor);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          spots.push(new THREE.Vector3(s.cx * BLOCK + 0.25 + i * 0.5, y, s.cz * BLOCK + 0.25 + j * 0.5));
        }
      }
    }
    if (!spots.length) return;
    const geo = new THREE.ConeGeometry(0.07, 0.9, 6);
    geo.translate(0, 0.45, 0);
    const mesh = new THREE.InstancedMesh(geo, this.mats.darkMetal, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach((p, i) => {
      const tilt = new THREE.Euler(((i * 7) % 5) * 0.03 - 0.06, 0, ((i * 11) % 5) * 0.03 - 0.06);
      q.setFromEuler(tilt);
      m.compose(p, q, new THREE.Vector3(1, 0.8 + ((i * 13) % 5) * 0.08, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    this.group.add(mesh);
  }

  private buildCrumbleTiles(): void {
    const floor = this.mats.floor;
    const mat = new THREE.MeshStandardNodeMaterial({ ...surfaceParams(floor), color: '#d9c6a8' });
    // The floor's albedo times the crack mask, both tiled as the floor is.
    const r = floor.map.repeat;
    const tiled = uv().mul(vec2(r.x, r.y));
    mat.colorNode = materialColor.mul(texture(floor.map, tiled)).mul(texture(crackMask(), tiled));
    for (const s of this.level.allSectors()) {
      if (!s.flags.has('crumble')) continue;
      const geo = new RoundedBoxGeometry(BLOCK - 0.04, 0.35, BLOCK - 0.04, 2, 0.03);
      geo.translate(0, -0.175 - 0.015, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(center(s.cx), Math.max(...s.floor), center(s.cz));
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.tileViews.set(`${s.cx},${s.cz}`, mesh);
    }
  }

  private viewFor(a: Actor): THREE.Object3D | null {
    const existing = this.actorViews.get(a.id);
    if (existing) return existing;
    let obj: THREE.Object3D | null = null;
    switch (a.kind) {
      case 'block': {
        const def = this.level.entities.find((e) => e.id === a.id);
        if (def?.type === 'block' && def.look === 'bellows') obj = bellowsBlock(mechanics.blockHeight);
        else obj = this.shelves ? shelfBlock(this.mats) : pushBlock(this.mats);
        break;
      }
      case 'door':
        obj = door(this.mats, a.height);
        obj.rotation.y = this.doorYaw(a.cx, a.cz);
        break;
      case 'lever':
        obj = lever(this.mats);
        break;
      case 'plate':
        obj = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.08, 1.4, 2, 0.02), this.mats.bronze);
        break;
      case 'secret':
        obj = idol(a.variant, this.mats);
        break;
      case 'relic': {
        if (TABLET_RELICS.has(this.level.id)) {
          const t = nameTablet();
          this.relicMesh = t.glow;
          obj = t.group;
          break;
        }
        const r = relic();
        tintRelic(r.material, this.level.id);
        this.relicMesh = r;
        obj = r;
        break;
      }
      case 'medkit':
        obj = medkit();
        break;
      case 'torch': {
        // Lying on the floor, the head towards +X raised on its binding (see TorchView.placeOnFloor).
        const t = torchModel().group;
        t.rotation.z = -Math.PI / 2 + 0.12;
        t.position.set(-0.08, 0.06, 0);
        obj = new THREE.Group().add(t);
        break;
      }
      case 'flares':
        obj = flarePack();
        break;
      case 'watergate': {
        const e = this.level.entities.find((x) => x.id === a.id);
        const wall = e?.type === 'watergate' ? e.wall : undefined;
        obj = sluice(this.mats);
        const d = wall ? DIR_VEC[wall] : { x: 0, z: 0 };
        obj.position.set(center(a.cx) + d.x * (BLOCK / 2 - 0.12), 0, center(a.cz) + d.z * (BLOCK / 2 - 0.12));
        obj.rotation.y = wall ? DIR_YAW[wall] : 0;
        break;
      }
      case 'note': {
        const e = this.level.entities.find((x) => x.id === a.id);
        if (e?.type !== 'note') return null;
        obj = e.style === 'carving' ? carving(a.id, this.mats, !!e.wall) : paper(e.style);
        // Against its wall when it has one, facing the room; otherwise lying where it fell.
        const d = e.wall ? DIR_VEC[e.wall] : { x: 0, z: 0 };
        const inset = e.style === 'carving' ? 0.32 : 0.5;
        obj.position.set(
          center(a.cx) + d.x * (BLOCK / 2 - inset),
          this.level.floorAt(center(a.cx), center(a.cz)),
          center(a.cz) + d.z * (BLOCK / 2 - inset),
        );
        obj.rotation.y = e.wall ? DIR_YAW[e.wall] : 0.35;
        this.glintTexture ??= glintTexture();
        obj.add(glint(this.glintTexture, e.style === 'carving' && !!e.wall ? 0.9 : 0.4));
        break;
      }
      case 'zone':
      case 'brazier':
        return null;
    }
    if (!obj) return null;
    obj.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    // The view is a holder whose child is swapped for the baked model when it loads.
    const holder = new THREE.Group();
    holder.add(obj);
    this.group.add(holder);
    this.actorViews.set(a.id, holder);
    this.actors.set(a.id, a);
    this.upgrade(holder, a);
    return holder;
  }

  /** Doors face along the corridor they block. */
  private doorYaw(cx: number, cz: number): number {
    const open = (dx: number, dz: number): boolean => {
      const s = this.level.sector(cx + dx, cz + dz);
      return !!s && !s.wall;
    };
    return open(0, -1) || open(0, 1) ? 0 : Math.PI / 2;
  }

  update(world: World, time: number, dt: number): void {
    for (const a of world.state.actors) {
      const v = this.viewFor(a);
      if (!v) continue;
      const floorY = this.level.floorAt(center(a.cx), center(a.cz));
      switch (a.kind) {
        case 'block': {
          let x = center(a.cx);
          let z = center(a.cz);
          if (a.from) {
            x = center(a.from.cx) + (x - center(a.from.cx)) * a.t;
            z = center(a.from.cz) + (z - center(a.from.cz)) * a.t;
          }
          v.position.set(x, a.y, z);
          break;
        }
        case 'door':
          v.position.set(center(a.cx), floorY - a.open * a.height * 0.98, center(a.cz));
          break;
        case 'lever': {
          const d = DIR_VEC[a.wall];
          v.position.set(
            center(a.cx) + d.x * (BLOCK / 2 - 0.02),
            floorY + 1.2,
            center(a.cz) + d.z * (BLOCK / 2 - 0.02),
          );
          v.rotation.y = DIR_YAW[a.wall];
          const handle = v.getObjectByName('handle');
          if (handle) {
            const [off, on] = (v.userData.swing as [number, number] | undefined) ?? [0.9, -0.9];
            const target = a.used ? on : off;
            handle.rotation.x += (target - handle.rotation.x) * Math.min(1, dt * 6);
          }
          break;
        }
        case 'plate':
          v.position.set(center(a.cx), floorY + (a.pressed ? 0.01 : 0.04), center(a.cz));
          break;
        case 'watergate': {
          // The sluice's bronze gate rides the water it holds back.
          const gate = v.getObjectByName('gate');
          const water = world.state.water[a.rooms[0] ?? '']?.y ?? (a.raised ? a.high : a.low);
          const frame = v.children[0];
          if (frame) frame.position.y = a.low - 0.5;
          if (gate) gate.position.y = water - a.low + 0.5 - 0.6;
          break;
        }
        case 'flares':
          v.visible = !a.taken;
          v.position.set(center(a.cx), floorY, center(a.cz));
          break;
        case 'secret':
        case 'medkit':
        case 'torch':
          v.visible = !a.taken;
          v.position.set(center(a.cx), floorY + (a.kind === 'secret' ? 0.05 : 0), center(a.cz));
          if (a.kind === 'secret') v.rotation.y = time * 0.6;
          break;
        case 'note': {
          // A faint amber glint marks a note until it has been read (art bible: amber = interaction hint).
          const g = v.getObjectByName('glint');
          if (g instanceof THREE.Sprite) {
            g.visible = !world.stats.notes.includes(a.id);
            g.material.opacity = 0.5 + Math.sin(time * 2.2 + a.cx * 1.7) * 0.25;
          }
          break;
        }
        case 'relic':
          v.visible = !a.taken;
          this.relicBase.set(center(a.cx), floorY + 1.05 + Math.sin(time * 1.3) * 0.05, center(a.cz));
          v.position.copy(this.relicBase);
          v.rotation.y = time * 0.4;
          this.relicLight.position.copy(this.relicBase);
          this.relicLight.intensity = a.taken ? 0 : 26 + Math.sin(time * 2.1) * 4;
          break;
        default:
          break;
      }
      if (this.hidden.has(a.id)) v.visible = false;
    }

    // Collapsing tiles shake while cracked and drop once fallen.
    for (const [key, mesh] of this.tileViews) {
      const t = world.state.tiles[key];
      const baseY = mesh.userData.baseY ?? (mesh.userData.baseY = mesh.position.y);
      if (!t || t.cracked === null) {
        mesh.position.y = baseY;
        mesh.visible = true;
        mesh.userData.fall = 0;
        continue;
      }
      if (!t.fallen) {
        const k = t.cracked / mechanics.crumbleDelay;
        mesh.position.y = baseY - 0.02 * k + Math.sin(time * 70) * 0.012 * k;
      } else {
        mesh.userData.fall = (mesh.userData.fall ?? 0) + dt;
        const f = mesh.userData.fall as number;
        mesh.position.y = baseY - 0.5 * 18 * f * f;
        mesh.rotation.z = f * 0.8;
        mesh.visible = f < 1.5;
      }
    }

    // Cold braziers catch over a second once a flare lights them (and go cold again on a restart).
    for (const f of this.fires) {
      if (!f.cold) continue;
      const a = world.state.actors.find((x) => x.kind === 'brazier' && x.id === f.id);
      const target = a?.kind === 'brazier' && a.lit ? 1 : 0;
      f.level = target > f.level ? Math.min(1, f.level + dt * 1.2) : target;
    }
    for (const [i, m] of this.coldCoals) m.emissiveIntensity = 2.8 * (this.fires[i]?.level ?? 1);

    // Flames and embers.
    for (const f of this.flames) {
      const lit = this.fires[f.fire]?.level ?? 1;
      f.sprite.visible = lit > 0.01;
      if (!f.sprite.visible) continue;
      const n = Math.sin(time * 9 + f.phase) * 0.5 + Math.sin(time * 15.3 + f.phase * 2) * 0.3;
      const grow = 0.3 + 0.7 * lit;
      f.sprite.position.set(f.base.x + Math.sin(time * 3 + f.phase) * 0.02, f.base.y + n * 0.04, f.base.z);
      f.sprite.scale.set(f.scale * (0.62 + n * 0.08) * grow, f.scale * (1 + n * 0.18) * grow, 1);
      // A cold brazier's own materials fade with its fire; the shared ones flicker below.
      const m = f.sprite.material as THREE.SpriteMaterial;
      if (!this.flameMaterials.includes(m)) m.opacity = (0.85 + n * 0.15) * lit;
    }
    this.flameMaterials.forEach((m, k) => {
      const n = Math.sin(time * 9 + k * 2.1) * 0.5 + Math.sin(time * 15.3 + k * 4.2) * 0.3;
      m.opacity = 0.85 + n * 0.15;
    });
    const attr = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    // Only the tier's share is drawn (the renderer's particle budget), so only that moves.
    const drawn = Math.min(this.emberData.length, this.embers.geometry.drawRange.count);
    for (let i = 0; i < drawn; i++) {
      const e = this.emberData[i];
      if (!e) break;
      e.t += dt * e.speed * 0.5;
      if (e.t > 1) e.t -= 1;
      if ((this.fires[e.fire]?.level ?? 1) < e.t) {
        attr.setXYZ(i, e.origin.x, -1000, e.origin.z);
        continue;
      }
      attr.setXYZ(
        i,
        e.origin.x + e.drift.x * e.t * 0.8 + Math.sin(time * 2 + i) * 0.05 * e.t,
        e.origin.y + 0.2 + e.t * 2.2,
        e.origin.z + e.drift.y * e.t * 0.8,
      );
    }
    attr.needsUpdate = true;
    if (this.relicMesh) {
      const m = this.relicMesh.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = (2.2 + Math.sin(time * 2.1) * 0.5) * this.relicGain;
    }
    if (this.coals) {
      this.coals.emissiveIntensity = 2.8 + Math.sin(time * 5.3) * 0.25 + Math.sin(time * 11.7) * 0.15;
    }
  }
}

/** A flame's soft teardrop, for additive sprites (braziers and the torch). */
export function flameTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 92, 2, 32, 80, 60);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.25, 'rgba(255,170,70,0.9)');
    grad.addColorStop(0.6, 'rgba(200,70,20,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(32, 2);
    g.bezierCurveTo(58, 60, 60, 120, 32, 124);
    g.bezierCurveTo(4, 120, 6, 60, 32, 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function brazier(m: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  // Tripod legs.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.05, 6), m.bronze);
    leg.position.set(Math.cos(a) * 0.22, 0.5, Math.sin(a) * 0.22);
    leg.rotation.z = Math.cos(a) * 0.2;
    leg.rotation.x = -Math.sin(a) * 0.2;
    g.add(leg);
  }
  // Bowl.
  const pts = [
    new THREE.Vector2(0.05, 0),
    new THREE.Vector2(0.3, 0.05),
    new THREE.Vector2(0.42, 0.2),
    new THREE.Vector2(0.44, 0.24),
    new THREE.Vector2(0.4, 0.24),
  ];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), m.bronze);
  bowl.position.y = 0.95;
  g.add(bowl);
  // Glowing coals.
  const coals = new THREE.Mesh(
    new THREE.CircleGeometry(0.38, 16),
    new THREE.MeshStandardMaterial({
      color: '#2a0e05',
      emissive: '#ff5a1a',
      emissiveIntensity: 2.5,
      roughness: 1,
    }),
  );
  coals.rotation.x = -Math.PI / 2;
  coals.position.y = 1.15;
  g.add(coals);
  return g;
}

function pushBlock(m: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  // A single dressed monolith (floor slab texture), paler than the walls so it reads as movable.
  const mat = new THREE.MeshStandardMaterial({ ...surfaceParams(m.block), color: '#f3e6cf' });
  const box = new THREE.Mesh(
    new RoundedBoxGeometry(BLOCK - 0.03, mechanics.blockHeight - 0.02, BLOCK - 0.03, 3, 0.06),
    mat,
  );
  box.position.y = mechanics.blockHeight / 2;
  g.add(box);
  // Grip notches on each side (art bible: pushable blocks show grip notches).
  const notchMat = new THREE.MeshStandardMaterial({ color: '#3b2c1f', roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.04), notchMat);
    const a = (i * Math.PI) / 2;
    n.position.set(Math.sin(a) * (BLOCK / 2 - 0.005), 1.2, Math.cos(a) * (BLOCK / 2 - 0.005));
    n.rotation.y = a;
    g.add(n);
  }
  return g;
}

function door(m: PropMaterials, height: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ ...surfaceParams(m.block), color: '#d6c4a6' });
  const slab = new THREE.Mesh(new RoundedBoxGeometry(BLOCK, height, 0.45, 2, 0.04), mat);
  slab.position.y = height / 2;
  g.add(slab);
  // A carved nine-segment seal (identity motif), the ninth segment in amber.
  for (let i = 0; i < 9; i++) {
    const a0 = (i / 9) * Math.PI * 2;
    const seg = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.42, 6, 1, a0 + 0.04, (Math.PI * 2) / 9 - 0.08),
      i === 8
        ? new THREE.MeshStandardMaterial({ color: '#f2a93b', emissive: '#f2a93b', emissiveIntensity: 0.6 })
        : new THREE.MeshStandardMaterial({ color: '#7a6048', roughness: 0.9 }),
    );
    seg.position.set(0, Math.min(height - 0.8, 2.6), 0.231);
    g.add(seg);
    const back = seg.clone();
    back.position.z = -0.231;
    back.rotation.y = Math.PI;
    g.add(back);
  }
  return g;
}

function lever(m: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.5, 0.08, 2, 0.02), m.bronze);
  g.add(plate);
  const handle = new THREE.Group();
  handle.name = 'handle';
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 8), m.bronze);
  rod.position.y = 0.27;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), m.gold);
  knob.position.y = 0.55;
  handle.add(rod, knob);
  handle.position.z = 0.1;
  handle.rotation.x = 0.9;
  g.add(handle);
  return g;
}

function idol(variant: string, m: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const mat =
    variant === 'gold'
      ? m.gold
      : new THREE.MeshPhysicalMaterial({
          color: variant === 'jade' ? '#3f7a52' : '#8c8175',
          roughness: variant === 'jade' ? 0.25 : 0.7,
          clearcoat: variant === 'jade' ? 0.6 : 0,
          emissive: variant === 'jade' ? '#10301c' : '#000000',
        });
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.08, 12), mat);
  pedestal.position.y = 0.04;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.16, 4, 10), mat);
  body.position.y = 0.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), mat);
  head.position.y = 0.36;
  g.add(pedestal, body, head);
  return g;
}

function relic(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> {
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#f2a93b',
    emissive: '#ff9a2a',
    emissiveIntensity: 2.2,
    roughness: 0.15,
    transmission: 0.4,
    thickness: 0.3,
    ior: 1.55,
    clearcoat: 1,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), mat);
  mesh.scale.set(1, 1.3, 1);
  return mesh;
}

/**
 * A shelf cut loose from the rock, full of clay tablets (the Clay Archive):
 * pushed like a block. Three boards between two posts, the tablets one
 * instanced mesh leaning in rows.
 */
function shelfBlock(m: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ ...surfaceParams(m.block), color: '#c98e66' });
  const W = BLOCK - 0.06;
  const H = mechanics.blockHeight - 0.02;
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.24), stone);
  back.position.y = H / 2;
  g.add(back);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, H, W), stone);
    post.position.set(sx * (W / 2 - 0.09), H / 2, 0);
    g.add(post);
  }
  const boards = [0.08, 0.72, 1.36, H - 0.06];
  for (const y of boards) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, W), stone);
    b.position.y = y;
    g.add(b);
  }
  // Tablets on both faces of each of the three shelves.
  const tabletMat = new THREE.MeshStandardMaterial({ color: '#9c5a36', roughness: 0.85 });
  const tablet = new THREE.BoxGeometry(0.16, 0.22, 0.035);
  const per = 8;
  const mesh = new THREE.InstancedMesh(tablet, tabletMat, 3 * 2 * per);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let n = 0;
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = (boards[shelf] ?? 0) + 0.16;
    for (const face of [-1, 1]) {
      for (let i = 0; i < per; i++) {
        const x = -W / 2 + 0.3 + i * ((W - 0.6) / (per - 1));
        const seed = Math.sin((shelf * 31 + i * 7 + face * 3) * 12.9898) * 43758.5453;
        const jitter = seed - Math.floor(seed);
        e.set(0.12 * face + (jitter - 0.5) * 0.1, 0, (jitter - 0.5) * 0.25);
        q.setFromEuler(e);
        mtx.compose(
          new THREE.Vector3(x, y, face * (W / 2 - 0.22)),
          q,
          new THREE.Vector3(1, 0.9 + jitter * 0.2, 1),
        );
        mesh.setMatrixAt(n++, mtx);
      }
    }
  }
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

/** The Tablet of the Name: fired clay with nine columns of signs, the ninth a single glowing sign. */
function nameTablet(): { group: THREE.Group; glow: THREE.Mesh } {
  const group = new THREE.Group();
  const clay = new THREE.MeshStandardMaterial({ color: '#b4683e', roughness: 0.8 });
  const slab = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.3, 0.045, 2, 0.012), clay);
  group.add(slab);
  const marks = new THREE.MeshStandardMaterial({ color: '#5a2c18', roughness: 1 });
  const mark = new THREE.BoxGeometry(0.012, 0.012, 0.01);
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 6; r++) {
      const m = new THREE.Mesh(mark, marks);
      m.position.set(-0.09 + c * 0.021, 0.11 - r * 0.042 - (c % 2) * 0.012, 0.024);
      group.add(m);
    }
  }
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.016, 12),
    new THREE.MeshStandardMaterial({ color: '#ffb070', emissive: '#ff6a2a', emissiveIntensity: 2.4 }),
  );
  glow.position.set(0.085, 0, 0.0235);
  group.add(glow);
  return { group, glow };
}

/** A bundle of red flares tied with cord, lying on the floor. */
function flarePack(): THREE.Group {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#9a2416', roughness: 0.55 });
  const cap = new THREE.MeshStandardMaterial({ color: '#d8cdb4', roughness: 0.7 });
  const cord = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 0.9 });
  const stick = new THREE.CylinderGeometry(0.024, 0.024, 0.3, 8);
  const top = new THREE.CylinderGeometry(0.025, 0.025, 0.035, 8);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(stick, red);
    s.rotation.z = Math.PI / 2;
    s.position.set(0, 0.026 + (i === 2 ? 0.042 : 0), (i === 2 ? 0 : i - 0.5) * 0.05);
    const c = new THREE.Mesh(top, cap);
    c.rotation.z = Math.PI / 2;
    c.position.set(0.16, s.position.y, s.position.z);
    g.add(s, c);
  }
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 14), cord);
  tie.rotation.y = Math.PI / 2;
  tie.position.y = 0.045;
  g.add(tie);
  g.rotation.y = 0.6;
  return g;
}

/** A sluice against its wall: a stone frame and a bronze gate that rides the water level. */
function sluice(m: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.Group();
  const post = new THREE.BoxGeometry(0.3, 6, 0.3);
  for (const x of [-0.8, 0.8]) {
    const p = new THREE.Mesh(post, m.darkMetal);
    p.position.set(x, 3, 0);
    frame.add(p);
  }
  g.add(frame);
  const gate = new THREE.Group();
  gate.name = 'gate';
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.2, 0.08), m.bronze);
  const bar = new THREE.BoxGeometry(1.36, 0.07, 0.12);
  for (const y of [-0.45, 0, 0.45]) {
    const b = new THREE.Mesh(bar, m.darkMetal);
    b.position.y = y;
    gate.add(b);
  }
  gate.add(panel);
  frame.add(gate);
  return g;
}

function medkit(): THREE.Group {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(
    new RoundedBoxGeometry(0.34, 0.2, 0.22, 2, 0.05),
    new THREE.MeshStandardMaterial({ color: '#6b5a3a', roughness: 0.9 }),
  );
  bag.position.y = 0.1;
  const flap = new THREE.Mesh(
    new RoundedBoxGeometry(0.34, 0.03, 0.16, 2, 0.01),
    new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.7 }),
  );
  flap.position.set(0, 0.21, 0.02);
  // A green leaf mark (a red cross is a protected emblem, so it is avoided).
  const mark = new THREE.Mesh(
    new THREE.CircleGeometry(0.035, 12),
    new THREE.MeshStandardMaterial({ color: '#8fa872', emissive: '#3b4a2c' }),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(0, 0.227, 0.03);
  g.add(bag, flap, mark);
  return g;
}

/** Soft amber point for the note glint. */
function glintTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,236,190,1)');
    grad.addColorStop(0.18, 'rgba(242,169,59,0.75)');
    grad.addColorStop(1, 'rgba(242,169,59,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glint(map: THREE.Texture, height: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      color: '#ffc46b',
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    }),
  );
  s.name = 'glint';
  s.scale.set(0.32, 0.32, 1);
  s.position.y = height;
  return s;
}

/** Paper with rows of writing: typed for the expedition log, handwritten for letters. */
function writingTexture(style: NoteStyle): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = style === 'diary' ? '#e3d3b0' : '#ebe1ca';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = style === 'diary' ? 'rgba(40,32,26,0.75)' : 'rgba(52,44,70,0.6)';
    g.lineWidth = style === 'diary' ? 3 : 2;
    let seed = style === 'diary' ? 7 : 3;
    const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 30; y < 236; y += style === 'diary' ? 16 : 20) {
      let x = 22;
      const end = 234 - rand() * 50;
      while (x < end) {
        const w = 8 + rand() * 26;
        g.beginPath();
        g.moveTo(x, y + (style === 'letter' ? Math.sin(x * 0.2) * 1.5 : 0));
        g.lineTo(Math.min(end, x + w), y);
        g.stroke();
        x += w + 6;
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** An expedition notebook left open, or a folded page held down by a pebble. */
function paper(style: NoteStyle): THREE.Group {
  const g = new THREE.Group();
  const page = new THREE.MeshStandardMaterial({ map: writingTexture(style), roughness: 0.95 });
  if (style === 'diary') {
    const cover = new THREE.Mesh(
      new RoundedBoxGeometry(0.4, 0.014, 0.27, 1, 0.005),
      new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.7 }),
    );
    cover.position.y = 0.007;
    g.add(cover);
    for (const side of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.018, 0.25), page);
      leaf.position.set(side * 0.095, 0.022, 0);
      leaf.rotation.z = side * -0.06;
      g.add(leaf);
    }
    const pencil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.17, 6),
      new THREE.MeshStandardMaterial({ color: '#c9a24a', roughness: 0.6 }),
    );
    pencil.rotation.set(Math.PI / 2, 0, 0.4);
    pencil.position.set(0.26, 0.008, 0.05);
    g.add(pencil);
  } else {
    for (const side of [-1, 1]) {
      const half = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.003, 0.15), page);
      half.position.set(side * 0.099, 0.012, 0);
      half.rotation.z = side * -0.12;
      g.add(half);
    }
    const pebble = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.045, 0),
      new THREE.MeshStandardMaterial({ color: '#8c7a62', roughness: 0.9 }),
    );
    pebble.scale.set(1, 0.6, 0.85);
    pebble.position.set(0.05, 0.035, 0.02);
    g.add(pebble);
  }
  return g;
}

/** Incised glyphs on a transparent canvas (the same signs as the reader's rubbing). */
function glyphTexture(seed: string, rows: number, perRow: number): THREE.Texture {
  const cell = 64;
  const c = document.createElement('canvas');
  c.width = perRow * cell + 32;
  c.height = rows * cell + 32;
  const g = c.getContext('2d');
  if (g) {
    g.lineCap = 'square';
    g.lineJoin = 'miter';
    const draw = (dx: number, dy: number, color: string, width: number): void => {
      g.strokeStyle = color;
      g.lineWidth = width;
      glyphRows(seed, rows, perRow).forEach((row, r) =>
        row.forEach((glyph, k) => {
          for (const stroke of glyph) {
            g.beginPath();
            stroke.forEach(([x, y], i) => {
              const px = 16 + (k + 0.12 + x * 0.76) * cell + dx;
              const py = 16 + (r + 0.12 + y * 0.76) * cell + dy;
              if (i) g.lineTo(px, py);
              else g.moveTo(px, py);
            });
            g.stroke();
          }
        }),
      );
    };
    // Light catching the lower lip of each groove, then the shadowed cut.
    draw(1.5, 2, 'rgba(250,236,205,0.45)', 5);
    draw(0, 0, 'rgba(38,27,18,0.9)', 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * A carved inscription: a fallen lintel leaning on the wall, or an inscribed
 * slab set into the floor (at the foot of the dais).
 */
function carving(seed: string, m: PropMaterials, onWall: boolean): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ ...surfaceParams(m.block), color: '#e6d6ba' });
  const [w, h, d] = onWall ? [1.7, 0.62, 0.36] : [1.3, 0.1, 0.9];
  const slab = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.04), stone);
  // Same 2 × 9 signs as the reader's rubbing, in a band sized to the texture.
  const glyphs = glyphTexture(seed, 2, 9);
  const img = glyphs.image as HTMLCanvasElement;
  const faceW = w * 0.86;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(faceW, (faceW * img.height) / img.width),
    new THREE.MeshStandardMaterial({
      map: glyphs,
      transparent: true,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  if (onWall) {
    // Leaning back against the wall behind it (local -Z), its carved face to the room.
    const lean = new THREE.Group();
    lean.rotation.x = -0.32;
    slab.position.y = h / 2;
    face.position.set(0, h / 2, d / 2 + 0.002);
    lean.add(slab, face);
    lean.position.z = -0.02;
    g.add(lean);
  } else {
    slab.position.y = -h / 2 + 0.03;
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.032;
    g.add(slab, face);
  }
  return g;
}
