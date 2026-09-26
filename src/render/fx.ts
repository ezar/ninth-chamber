/**
 * Small ground effects that sell contact with the world: footprints left in
 * sand that fade over time, and dust puffs from running feet, landings,
 * falling masonry and grinding doors. Presentation only: fed from
 * simulation events and footstep cues, never read back by the simulation.
 */
import * as THREE from 'three/webgpu';

const PRINTS = 56;
const PRINT_LIFE = 28;
const PUFFS = 48;

interface Print {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  strength: number;
}

interface Puff {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  alpha: number;
}

/** A boot sole: forefoot and heel pads with tread lines, dark on transparent. */
function soleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  const pad = (x: number, y: number, rx: number, ry: number): void => {
    const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    grad.addColorStop(0, 'rgba(0,0,0,0.95)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.75)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  };
  pad(32, 38, 21, 32); // forefoot (toe at the top: -Z in the mesh)
  pad(32, 98, 15, 20); // heel
  // Tread: lighter bars where the lugs pushed less sand.
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 14; y < 70; y += 9) g.fillRect(14, y, 36, 3);
  for (let y = 86; y < 116; y += 8) g.fillRect(19, y, 26, 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GroundFx {
  readonly root = new THREE.Group();
  private readonly prints: Print[] = [];
  private readonly puffs: Puff[] = [];
  private nextPrint = 0;
  private nextPuff = 0;
  private leftFoot = false;
  private seed = 1;

  constructor(scene: THREE.Object3D) {
    this.root.name = 'ground-fx';
    scene.add(this.root);

    const sole = soleTexture();
    const printGeo = new THREE.PlaneGeometry(0.13, 0.28).rotateX(-Math.PI / 2);
    for (let i = 0; i < PRINTS; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: sole,
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(printGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      this.root.add(mesh);
      this.prints.push({ mesh, material, age: PRINT_LIFE, strength: 0 });
    }

    const soft = puffTexture();
    for (let i = 0; i < PUFFS; i++) {
      const material = new THREE.SpriteMaterial({
        map: soft,
        color: 0x5e4d3b,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.root.add(sprite);
      this.puffs.push({
        sprite,
        material,
        vel: new THREE.Vector3(),
        age: 1,
        life: 1,
        size: 0.3,
        grow: 1,
        alpha: 0,
      });
    }
  }

  /** Presentation-side noise; the simulation's RNG stays untouched. */
  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** A footstep at the character's position; `yaw` follows the player convention (facing -Z at 0). */
  footstep(pos: { x: number; y: number; z: number }, yaw: number, material: string, run: boolean): void {
    this.leftFoot = !this.leftFoot;
    const side = this.leftFoot ? -1 : 1;
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const x = pos.x + right.x * side * 0.11;
    const z = pos.z + right.z * side * 0.11;
    if (material === 'sand') {
      const p = this.prints[this.nextPrint];
      this.nextPrint = (this.nextPrint + 1) % PRINTS;
      if (p) {
        p.mesh.position.set(x, pos.y + 0.012, z);
        p.mesh.rotation.set(0, yaw + side * 0.08, 0);
        p.mesh.scale.set(side, 1, run ? 1.08 : 1);
        p.mesh.visible = true;
        p.age = 0;
        p.strength = run ? 0.85 : 0.75;
      }
      if (run) this.burst(x, pos.y + 0.05, z, 2, 0.22, 0.6, 0.18);
    } else if (run && material === 'stone') {
      this.burst(x, pos.y + 0.04, z, 1, 0.14, 0.45, 0.08);
    }
  }

  /** Landing dust, scaled by how far the character fell. */
  land(pos: { x: number; y: number; z: number }, fall: number, material: string): void {
    if (fall < 0.8) return;
    const k = Math.min(1, (fall - 0.8) / 4);
    const dusty = material === 'sand' ? 1 : 0.55;
    this.ring(pos.x, pos.y + 0.06, pos.z, Math.round(4 + 6 * k), 0.8 + 1.6 * k, 0.28, 0.35 * dusty);
  }

  /** Heavy stone meeting the floor or a floor tile dropping away. */
  impact(pos: { x: number; y: number; z: number }, size: number): void {
    this.ring(pos.x, pos.y + 0.1, pos.z, 12, 1.6 * size, 0.5 * size, 0.42);
    this.burst(pos.x, pos.y + 0.4, pos.z, 4, 0.6 * size, 1.4, 0.25);
  }

  /** Dust sifting down from a door lintel as the slab grinds. */
  sift(pos: { x: number; y: number; z: number }): void {
    for (let i = 0; i < 8; i++) {
      const x = pos.x + (this.rand() - 0.5) * 1.6;
      const z = pos.z + (this.rand() - 0.5) * 0.5;
      this.spawn(x, pos.y + 2.4 + this.rand() * 0.4, z, 0, -0.35 - this.rand() * 0.3, 0, 0.18, 2.2, 1.8, 0.3);
    }
  }

  private ring(x: number, y: number, z: number, n: number, speed: number, size: number, alpha: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.5;
      const s = speed * (0.7 + this.rand() * 0.6);
      this.spawn(x, y, z, Math.cos(a) * s, 0.15 + this.rand() * 0.25, Math.sin(a) * s, size, 1.3, 2.2, alpha);
    }
  }

  private burst(x: number, y: number, z: number, n: number, size: number, life: number, alpha: number): void {
    for (let i = 0; i < n; i++) {
      this.spawn(
        x + (this.rand() - 0.5) * 0.2,
        y,
        z + (this.rand() - 0.5) * 0.2,
        (this.rand() - 0.5) * 0.5,
        0.2 + this.rand() * 0.3,
        (this.rand() - 0.5) * 0.5,
        size,
        life,
        1.8,
        alpha,
      );
    }
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    grow: number,
    alpha: number,
  ): void {
    const p = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % PUFFS;
    if (!p) return;
    p.sprite.position.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.age = 0;
    p.life = life;
    p.size = size;
    p.grow = grow;
    p.alpha = alpha;
    p.material.rotation = this.rand() * Math.PI * 2;
    p.sprite.visible = true;
  }

  update(dt: number): void {
    for (const p of this.prints) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      const t = p.age / PRINT_LIFE;
      if (t >= 1) {
        p.mesh.visible = false;
        continue;
      }
      // Fresh prints settle in over a moment, then wind slowly fills them.
      const settle = Math.min(1, p.age / 0.25);
      p.material.opacity = p.strength * settle * (1 - t * t);
    }
    const drag = Math.exp(-2.5 * dt);
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.vel.multiplyScalar(drag);
      p.vel.y += 0.05 * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const s = p.size * (1 + p.grow * t);
      p.sprite.scale.set(s, s, s);
      // Quick rise, long fade.
      p.material.opacity = p.alpha * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
  }
}
