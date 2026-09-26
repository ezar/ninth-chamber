/**
 * Combat presentation (spec §7): the jackal views, Nora's pistols with muzzle
 * flashes and a brief light, hit and ricochet puffs, and a subtle marker over
 * the locked enemy. It reads the simulation state and listens to its events;
 * it never writes to the simulation.
 */
import * as THREE from 'three/webgpu';
import type { SimEvent } from '../core/events';
import { enemyCenter, findEnemy } from '../sim/actors/enemies';
import { weapons } from '../sim/player/tuning';
import type { World } from '../sim/world';
import { EnemyViews } from './enemies';
import type { NoraPose } from './nora';
import type { NoraRig } from './nora-scan';

const wrap = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** How long a muzzle flash and its light last (s). */
const FLASH_TIME = 0.055;
/** The arms stay up this long after the last shot without a target (s). */
const AIM_HOLD = 0.5;

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A compact service pistol: slide, frame, raked grip and trigger guard (~150 triangles). */
function pistolMesh(): { group: THREE.Group; muzzle: THREE.Vector3 } {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#34322f', roughness: 0.38, metalness: 0.85 });
  const worn = new THREE.MeshStandardMaterial({ color: '#57534c', roughness: 0.3, metalness: 0.9 });
  const wood = new THREE.MeshStandardMaterial({ color: '#5b3a24', roughness: 0.62, metalness: 0 });
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
  ): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    g.add(m);
  };
  // Origin: top of the grip, where the web of the hand sits. -Z is the muzzle, +Y up.
  add(new THREE.BoxGeometry(0.03, 0.03, 0.19), metal, 0, 0.03, -0.06);
  add(new THREE.BoxGeometry(0.026, 0.006, 0.17), worn, 0, 0.046, -0.06);
  add(new THREE.BoxGeometry(0.026, 0.02, 0.13), metal, 0, 0.006, -0.075);
  add(new THREE.CylinderGeometry(0.007, 0.007, 0.02, 8), worn, 0, 0.028, -0.16, Math.PI / 2);
  add(new THREE.BoxGeometry(0.029, 0.1, 0.044), wood, 0, -0.045, 0.012, 0.22);
  const guard = new THREE.TorusGeometry(0.02, 0.0035, 4, 10, Math.PI);
  add(guard, metal, 0, -0.004, -0.03, Math.PI);
  return { group: g, muzzle: new THREE.Vector3(0, 0.028, -0.172) };
}

interface Pistol {
  group: THREE.Group;
  muzzle: THREE.Vector3;
  flash: THREE.Sprite;
  flashLeft: number;
}

interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
}

const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class CombatView {
  readonly group = new THREE.Group();
  private readonly enemies: EnemyViews;
  private readonly pistols: [Pistol, Pistol];
  private readonly light = new THREE.PointLight('#ffc98a', 0, 8, 2);
  private readonly marker: THREE.Sprite;
  private readonly puffs: Puff[] = [];
  private readonly puffTexture: THREE.Texture;
  private sinceShot = Infinity;
  private drawn = 0;
  private markerFor: string | null = null;
  private time = 0;

  constructor(jackalUrl: string | null) {
    this.enemies = new EnemyViews(jackalUrl);
    this.group.add(this.enemies.group, this.light);

    const flashTex = canvasTexture(64, (g) => {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,250,225,1)');
      grad.addColorStop(0.25, 'rgba(255,205,120,0.9)');
      grad.addColorStop(0.6, 'rgba(255,120,40,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = i % 2 === 0 ? 32 : 11;
        g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      g.fill();
    });
    const make = (): Pistol => {
      const { group, muzzle } = pistolMesh();
      const flash = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: flashTex,
          color: '#ffd9a0',
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          fog: false,
        }),
      );
      flash.position.copy(muzzle).add(new THREE.Vector3(0, 0, -0.05));
      flash.visible = false;
      group.add(flash);
      group.visible = false;
      this.group.add(group);
      return { group, muzzle, flash, flashLeft: 0 };
    };
    this.pistols = [make(), make()];

    // Four thin corner ticks in bone white: present, not loud.
    const markerTex = canvasTexture(64, (g) => {
      g.strokeStyle = 'rgba(236,227,208,0.95)';
      g.lineWidth = 3;
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 3;
      const k = 14;
      for (const [x, y, sx, sy] of [
        [8, 8, 1, 1],
        [56, 8, -1, 1],
        [8, 56, 1, -1],
        [56, 56, -1, -1],
      ] as const) {
        g.beginPath();
        g.moveTo(x, y + sy * k);
        g.lineTo(x, y);
        g.lineTo(x + sx * k, y);
        g.stroke();
      }
    });
    this.marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: markerTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    this.marker.scale.setScalar(0.34);
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.group.add(this.marker);

    this.puffTexture = canvasTexture(32, (g) => {
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
    });
  }

  /** Arms layer input for Nora's pose: pistols drawn, aiming and the aim direction. */
  aimPose(world: World): Pick<NoraPose, 'weapons' | 'aiming' | 'aimYaw' | 'aimPitch'> {
    const p = world.state.player;
    const w = p.weapon;
    const target = w.target ? findEnemy(world, w.target) : undefined;
    if (!target) {
      return { weapons: w.drawn ? 1 : 0, aiming: this.sinceShot < AIM_HOLD ? 1 : 0, aimYaw: 0, aimPitch: 0 };
    }
    const c = enemyCenter(target);
    const dx = c.x - p.pos.x;
    const dz = c.z - p.pos.z;
    const yaw = clamp(wrap(Math.atan2(-dx, -dz) - p.yaw), -weapons.aimArc, weapons.aimArc);
    const pitch = Math.atan2(c.y - (p.pos.y + weapons.aimHeight), Math.hypot(dx, dz));
    return { weapons: w.drawn ? 1 : 0, aiming: 1, aimYaw: yaw, aimPitch: pitch };
  }

  onEvent(e: SimEvent, world: World): void {
    switch (e.type) {
      case 'weapon.fired': {
        this.sinceShot = 0;
        const pistol = this.pistols[e.hand === 0 ? 0 : 1];
        pistol.flashLeft = FLASH_TIME;
        pistol.flash.material.rotation = Math.random() * Math.PI;
        pistol.flash.scale.setScalar(0.16 + Math.random() * 0.08);
        this.light.intensity = 9;
        this.light.userData.hand = e.hand === 0 ? 0 : 1;
        // A miss kicks up dust near the target.
        if (typeof e.target === 'string' && e.hit !== true) {
          const t = findEnemy(world, e.target);
          if (t) {
            const a = Math.random() * Math.PI * 2;
            const r = 0.4 + Math.random() * 0.5;
            this.burst(
              _c.set(t.pos.x + Math.cos(a) * r, t.pos.y + 0.03, t.pos.z + Math.sin(a) * r),
              'dust',
              5,
            );
          }
        }
        break;
      }
      case 'enemy.hit': {
        const id = String(e.id);
        if (this.enemies.center(id, _c)) this.burst(_c, 'hit', 6);
        this.enemies.flinch(id);
        break;
      }
      case 'enemy.died': {
        const id = String(e.id);
        if (this.enemies.center(id, _c)) this.burst(_c.setY(_c.y - 0.3), 'dust', 8);
        break;
      }
      default:
        break;
    }
  }

  private burst(at: THREE.Vector3, kind: 'hit' | 'dust', n: number): void {
    for (let i = 0; i < n; i++) {
      let puff = this.puffs.find((p) => p.life <= 0);
      if (!puff) {
        if (this.puffs.length >= 48) return;
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: this.puffTexture, transparent: true, depthWrite: false }),
        );
        this.group.add(sprite);
        puff = { sprite, vel: new THREE.Vector3(), life: 0, max: 1, grow: 1 };
        this.puffs.push(puff);
      }
      const hit = kind === 'hit';
      const m = puff.sprite.material;
      m.color.set(hit ? '#5a2419' : '#b89a72');
      m.opacity = hit ? 0.9 : 0.55;
      puff.sprite.position.copy(at);
      puff.vel.set(
        (Math.random() - 0.5) * (hit ? 1.6 : 0.8),
        (hit ? 0.2 : 0.5) + Math.random() * (hit ? 0.8 : 0.6),
        (Math.random() - 0.5) * (hit ? 1.6 : 0.8),
      );
      puff.max = puff.life = (hit ? 0.28 : 0.7) + Math.random() * 0.2;
      puff.grow = hit ? 0.05 : 0.22;
      puff.sprite.scale.setScalar(hit ? 0.05 : 0.12);
      puff.sprite.visible = true;
    }
  }

  update(world: World, nora: NoraRig, alpha: number, dt: number): void {
    this.time += dt;
    this.sinceShot += dt;
    this.enemies.update(world, alpha, dt);
    const p = world.state.player;

    // Pistols in Nora's hands while drawn.
    const armed = p.weapon.drawn && (p.mode === 'ground' || p.mode === 'air');
    this.drawn += ((armed ? 1 : 0) - this.drawn) * (1 - Math.exp(-dt * 18));
    this.pistols.forEach((pistol, i) => {
      const side = i as 0 | 1;
      const g = pistol.group;
      g.visible = this.drawn > 0.35;
      if (g.visible) {
        nora.handFrame(side, _pos, _q);
        // The aim layer points the fingers 0.3 below the aim: the barrel lifts them back to it.
        const fingers = _f.set(0, -1, 0).applyQuaternion(_q);
        const f = _x.copy(fingers).addScaledVector(UP, 0.3).normalize();
        const u = _u.copy(UP).addScaledVector(f, -UP.dot(f)).normalize();
        // Grip in the palm, a hand's breadth past the wrist.
        g.position.copy(_pos).addScaledVector(fingers, 0.075).addScaledVector(u, 0.005);
        _p.crossVectors(u, _c.copy(f).negate());
        _m.makeBasis(_p, u, _c);
        g.quaternion.setFromRotationMatrix(_m);
        g.scale.setScalar(Math.min(1, this.drawn * 1.2));
      }
      pistol.flashLeft -= dt;
      pistol.flash.visible = g.visible && pistol.flashLeft > 0;
      if (this.light.intensity > 0 && this.light.userData.hand === side && g.visible) {
        this.light.position.copy(pistol.muzzle).applyMatrix4(g.matrixWorld);
      }
    });
    this.light.intensity = Math.max(0, this.light.intensity - dt * (9 / FLASH_TIME));
    // Keep the matrices of the pistols fresh for the light position next frame.
    for (const pistol of this.pistols) pistol.group.updateMatrixWorld();

    // Target marker: over the locked enemy, gently breathing.
    const id = p.weapon.target;
    const m = this.marker.material;
    if (id && this.enemies.center(id, _c)) {
      if (this.markerFor !== id) m.opacity = 0;
      this.markerFor = id;
      this.marker.position.copy(_c).setY(_c.y + 0.55 + Math.sin(this.time * 3) * 0.02);
      m.opacity = Math.min(0.75, m.opacity + dt * 5);
      m.rotation = Math.PI / 4 + Math.sin(this.time * 1.4) * 0.08;
      this.marker.visible = true;
    } else {
      this.markerFor = null;
      m.opacity = Math.max(0, m.opacity - dt * 6);
      this.marker.visible = m.opacity > 0.01;
    }

    // Puffs.
    for (const puff of this.puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      if (puff.life <= 0) {
        puff.sprite.visible = false;
        continue;
      }
      puff.vel.y -= dt * 1.5;
      puff.vel.multiplyScalar(1 - dt * 2.5);
      puff.sprite.position.addScaledVector(puff.vel, dt);
      puff.sprite.scale.addScalar(puff.grow * dt);
      const k = puff.life / puff.max;
      puff.sprite.material.opacity = Math.min(puff.sprite.material.opacity, k * 0.9);
    }
  }
}
