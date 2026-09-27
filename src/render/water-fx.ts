/**
 * Small water effects that sell contact with the water (spec §11 "Agua",
 * "goteo en las cisternas"): splashes of droplets and foam when Nora or a
 * flare hits the water, rings spreading from strokes and drops, drips
 * falling from the vaults of wet rooms, and bubbles rising from a diver.
 * Presentation only: fed from simulation events and the player's state.
 */
import * as THREE from 'three/webgpu';
import { sectorTop, type Level } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';
import { swimming } from '../sim/player/tuning';
import type { World } from '../sim/world';

const DROPS = 220;
const RINGS = 28;
const BUBBLES = 90;
const DRIPS = 10;

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
}

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  size: number;
  alpha: number;
}

interface Drip {
  x: number;
  z: number;
  y: number;
  vy: number;
  stop: number;
  active: boolean;
}

function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(64, 64, 34, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WaterFx {
  readonly root = new THREE.Group();
  private readonly drops: Particle[] = [];
  private readonly dropAttr: THREE.BufferAttribute;
  private readonly bubbles: Particle[] = [];
  private readonly bubbleAttr: THREE.BufferAttribute;
  private readonly rings: Ring[] = [];
  private readonly drips: Drip[] = [];
  private readonly dripAttr: THREE.BufferAttribute;
  private nextDrop = 0;
  private nextBubble = 0;
  private nextRing = 0;
  private seed = 3;
  private dripClock = 0;
  private bubbleClock = 0;
  /** Whether Nora's feet were in the water last frame, and the ground covered since the last wake ring. */
  private wading = false;
  private wakeDist = 0;
  private stillClock = 0;
  /** Wet cells under a vault, where drips fall. */
  private dripCells: { x: number; z: number; ceil: number }[] = [];
  /** Share of the full particle counts (quality tier). */
  budget = 1;

  constructor(private readonly surfaceAt: (x: number, z: number) => number | null) {
    this.root.name = 'water-fx';
    const points = (n: number, color: string, size: number, opacity: number): THREE.BufferAttribute => {
      const attr = new THREE.BufferAttribute(new Float32Array(n * 3).fill(-1e4), 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', attr);
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false }),
      );
      pts.frustumCulled = false;
      this.root.add(pts);
      return attr;
    };
    this.dropAttr = points(DROPS, '#d8ecec', 0.035, 0.75);
    this.bubbleAttr = points(BUBBLES, '#c8f0f0', 0.028, 0.6);
    this.dripAttr = points(DRIPS, '#e0f4f4', 0.03, 0.9);
    for (let i = 0; i < DROPS; i++) this.drops.push(this.particle());
    for (let i = 0; i < BUBBLES; i++) this.bubbles.push(this.particle());
    for (let i = 0; i < DRIPS; i++) this.drips.push({ x: 0, z: 0, y: -1e4, vy: 0, stop: 0, active: false });

    const tex = ringTexture();
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: '#e8f6f4',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.rings.push({ mesh, mat, age: 1, life: 1, size: 1, alpha: 0 });
    }
  }

  private particle(): Particle {
    return { pos: new THREE.Vector3(0, -1e4, 0), vel: new THREE.Vector3(), age: 1, life: 1 };
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** Wet cells with a vault over them, for drips. */
  build(level: Level, world: World): void {
    this.dripCells = [];
    for (const s of level.allSectors()) {
      if (s.wall) continue;
      const cx = s.cx * BLOCK + BLOCK / 2;
      const cz = s.cz * BLOCK + BLOCK / 2;
      const top = sectorTop(s);
      const w = world.state.water[s.room]?.y ?? s.water;
      if (w === null || w === undefined || w <= top) continue;
      if (s.ceil - w < 1.5 || s.ceil - w > 16) continue;
      this.dripCells.push({ x: cx, z: cz, ceil: s.ceil });
    }
  }

  /** A body or a flare hitting the water at `speed` (m/s). */
  splash(x: number, y: number, z: number, speed: number): void {
    const k = Math.min(1, Math.max(0.2, speed / 12));
    const n = Math.round((10 + 50 * k) * this.budget);
    for (let i = 0; i < n; i++) {
      const p = this.drops[this.nextDrop];
      this.nextDrop = (this.nextDrop + 1) % DROPS;
      if (!p) continue;
      const a = this.rand() * Math.PI * 2;
      const r = (0.4 + this.rand() * 1.8) * (0.5 + k);
      p.pos.set(x + Math.cos(a) * 0.2, y + 0.02, z + Math.sin(a) * 0.2);
      p.vel.set(Math.cos(a) * r, 1.5 + this.rand() * 4.5 * k + 1.2 * k, Math.sin(a) * r);
      p.age = 0;
      p.life = 0.5 + this.rand() * 0.6;
    }
    this.ring(x, y, z, 0.5 + 1.8 * k, 1.3 + k, 0.4);
    this.ring(x, y, z, 0.3 + 0.9 * k, 0.8, 0.28);
  }

  /** A ring spreading on the surface. */
  ring(x: number, y: number, z: number, size: number, life: number, alpha: number): void {
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % RINGS;
    if (!r) return;
    r.mesh.position.set(x, y + 0.012, z);
    r.mesh.visible = true;
    r.age = 0;
    r.life = life;
    r.size = size;
    r.alpha = alpha;
  }

  /** Bubbles from a diver's mouth. */
  bubble(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const p = this.bubbles[this.nextBubble];
      this.nextBubble = (this.nextBubble + 1) % BUBBLES;
      if (!p) continue;
      p.pos.set(x + (this.rand() - 0.5) * 0.1, y, z + (this.rand() - 0.5) * 0.1);
      p.vel.set((this.rand() - 0.5) * 0.15, 0.7 + this.rand() * 0.5, (this.rand() - 0.5) * 0.15);
      p.age = 0;
      p.life = 4;
    }
  }

  /** Droplets kicked up ahead of a wading foot. */
  private kick(x: number, y: number, z: number, dx: number, dz: number, speed: number): void {
    const n = Math.round((2 + speed * 1.2) * this.budget);
    for (let i = 0; i < n; i++) {
      const d = this.drops[this.nextDrop];
      this.nextDrop = (this.nextDrop + 1) % DROPS;
      if (!d) continue;
      const a = (this.rand() - 0.5) * 1.6;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const r = 0.4 + this.rand() * 0.5 * speed;
      d.pos.set(x + (this.rand() - 0.5) * 0.2, y + 0.02, z + (this.rand() - 0.5) * 0.2);
      d.vel.set((dx * c - dz * sn) * r, 0.8 + this.rand() * (0.6 + speed * 0.35), (dx * sn + dz * c) * r);
      d.age = 0;
      d.life = 0.35 + this.rand() * 0.35;
    }
  }

  /**
   * Walking into, out of and through shallow water: the simulation only
   * reports falls into water (player.splash), so the wade is read from her
   * feet against the surface. Entering or leaving splashes a little; moving
   * leaves rings and kicks droplets every stride; standing still makes a faint
   * ring now and then.
   */
  private wade(p: World['state']['player'], dt: number): void {
    const s = this.surfaceAt(p.pos.x, p.pos.z);
    const onFoot = p.mode === 'ground';
    const wet = onFoot && s !== null && p.pos.y < s - 0.03;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (s !== null && onFoot && wet !== this.wading) {
      this.splash(p.pos.x, s, p.pos.z, 1.5 + speed * 0.9);
      this.wakeDist = 0;
    }
    this.wading = wet;
    if (!wet || s === null) return;
    const depth = s - p.pos.y;
    if (speed > 0.3) {
      this.stillClock = 0;
      this.wakeDist += speed * dt;
      const stride = speed > 2.5 ? 0.7 : 0.5;
      if (this.wakeDist >= stride) {
        this.wakeDist -= stride;
        const dx = p.vel.x / speed;
        const dz = p.vel.z / speed;
        // Rings trail behind her, a little wider in deeper water and at a run.
        this.ring(p.pos.x - dx * 0.15, s, p.pos.z - dz * 0.15, 0.8 + depth + speed * 0.15, 1.3, 0.16);
        this.kick(p.pos.x + dx * 0.25, s, p.pos.z + dz * 0.25, dx, dz, speed);
      }
    } else {
      this.stillClock -= dt;
      if (this.stillClock <= 0) {
        this.stillClock = 1.2 + this.rand() * 1.4;
        this.ring(p.pos.x, s, p.pos.z, 0.7 + depth * 0.5, 1.6, 0.1);
      }
    }
  }

  /** Per frame: particles, rings, drips near the camera and bubbles from a diving Nora. */
  update(dt: number, world: World, eye: THREE.Vector3): void {
    const g = 9.8;
    this.drops.forEach((p, i) => {
      if (p.age >= p.life) return;
      p.age += dt;
      p.vel.y -= g * dt;
      p.pos.addScaledVector(p.vel, dt);
      const s = this.surfaceAt(p.pos.x, p.pos.z);
      if (p.age >= p.life || (s !== null && p.pos.y < s && p.vel.y < 0)) {
        if (s !== null && p.age < p.life && this.rand() < 0.15)
          this.ring(p.pos.x, s, p.pos.z, 0.25, 0.6, 0.3);
        p.age = p.life;
        this.dropAttr.setXYZ(i, 0, -1e4, 0);
        return;
      }
      this.dropAttr.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
    });
    this.dropAttr.needsUpdate = true;

    this.bubbles.forEach((p, i) => {
      if (p.age >= p.life) return;
      p.age += dt;
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(p.age * 9 + i) * 0.004;
      const s = this.surfaceAt(p.pos.x, p.pos.z);
      if (s === null || p.pos.y >= s - 0.02 || p.age >= p.life) {
        if (s !== null && p.age < p.life && this.rand() < 0.3)
          this.ring(p.pos.x, s, p.pos.z, 0.18, 0.5, 0.25);
        p.age = p.life;
        this.bubbleAttr.setXYZ(i, 0, -1e4, 0);
        return;
      }
      this.bubbleAttr.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
    });
    this.bubbleAttr.needsUpdate = true;

    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const s = r.size * (0.25 + 0.75 * Math.sqrt(t));
      r.mesh.scale.set(s, 1, s);
      r.mat.opacity = r.alpha * (1 - t) * (1 - t);
    }

    // Drips from the vaults near the camera.
    this.dripClock -= dt;
    if (this.dripClock <= 0 && this.dripCells.length) {
      this.dripClock = (0.25 + this.rand() * 0.6) / Math.max(0.2, this.budget);
      const near = this.dripCells.filter((c) => Math.hypot(c.x - eye.x, c.z - eye.z) < 16);
      const cell = near[Math.floor(this.rand() * near.length)];
      const d = this.drips.find((x) => !x.active);
      if (cell && d) {
        d.x = cell.x + (this.rand() - 0.5) * 1.6;
        d.z = cell.z + (this.rand() - 0.5) * 1.6;
        d.y = cell.ceil - 0.05;
        d.vy = 0;
        d.stop = this.surfaceAt(d.x, d.z) ?? -1e4;
        d.active = d.stop > -1e3;
      }
    }
    this.drips.forEach((d, i) => {
      if (!d.active) {
        this.dripAttr.setXYZ(i, 0, -1e4, 0);
        return;
      }
      d.vy -= g * dt;
      d.y += d.vy * dt;
      if (d.y <= d.stop) {
        d.active = false;
        this.ring(d.x, d.stop, d.z, 0.35, 0.9, 0.35);
        this.dripAttr.setXYZ(i, 0, -1e4, 0);
        return;
      }
      this.dripAttr.setXYZ(i, d.x, d.y, d.z);
    });
    this.dripAttr.needsUpdate = true;

    const p = world.state.player;
    this.wade(p, dt);

    // A diver breathes out now and then.
    if (p.mode === 'dive') {
      this.bubbleClock -= dt;
      if (this.bubbleClock <= 0) {
        this.bubbleClock = 0.7 + this.rand() * 1.2;
        const head = p.pos.y + swimming.bodyHigh - 0.1;
        this.bubble(
          p.pos.x - Math.sin(p.yaw) * 0.25,
          head,
          p.pos.z - Math.cos(p.yaw) * 0.25,
          3 + Math.floor(this.rand() * 4),
        );
      }
    }
  }
}
