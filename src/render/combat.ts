/**
 * Combat presentation (spec §7): the jackal views, Nora's pistols with muzzle
 * flashes and a brief light, hit and ricochet puffs, and a subtle marker over
 * the locked enemy. It reads the simulation state and listens to its events;
 * it never writes to the simulation.
 */
import * as THREE from 'three/webgpu';
import type { SimEvent } from '../core/events';
import { enemyCenter, findEnemy } from '../sim/actors/enemies';
import { torchInHand } from '../sim/player/torch';
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

/**
 * A compact service pistol: a bevelled side profile (slide, dust cover, trigger
 * guard, raked grip) extruded to its thickness, walnut grip panels, sights and
 * a barrel crown. Origin: top of the grip, where the web of the hand sits;
 * -Z is the muzzle, +Y up.
 */
function pistolMesh(): { group: THREE.Group; muzzle: THREE.Vector3 } {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#2e2c29', roughness: 0.42, metalness: 0.8 });
  const worn = new THREE.MeshStandardMaterial({ color: '#6a655c', roughness: 0.35, metalness: 0.85 });
  const wood = new THREE.MeshStandardMaterial({ color: '#5a3520', roughness: 0.6, metalness: 0 });
  // Profile in (forward, up) metres; the grip's top rear sits at the origin.
  const O = 0.03;
  const P = (u: number, v: number): THREE.Vector2 => new THREE.Vector2(u + O, v);
  const body = new THREE.Shape([
    P(-0.035, 0.042),
    P(0.155, 0.042),
    P(0.155, 0.014),
    P(0.13, 0.014),
    P(0.13, -0.004),
    P(0.064, -0.004),
    P(0.06, -0.026),
    P(0.048, -0.036),
    P(0.018, -0.036),
    P(0.009, -0.02),
    P(-0.006, -0.1),
    P(-0.05, -0.104),
    P(-0.043, -0.03),
    P(-0.05, 0.012),
    P(-0.035, 0.014),
  ]);
  body.holes.push(new THREE.Path([P(0.05, -0.008), P(0.018, -0.008), P(0.022, -0.028), P(0.046, -0.028)]));
  const grip = new THREE.Shape([P(-0.002, -0.022), P(-0.012, -0.094), P(-0.044, -0.097), P(-0.038, -0.03)]);
  const extrude = (shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry =>
    new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 4,
    })
      .translate(0, 0, -depth / 2)
      .rotateY(Math.PI / 2);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
  };
  add(extrude(body, 0.022, 0.0018), metal);
  add(extrude(grip, 0.03, 0.0015), wood);
  // Slide top rib, sights and the barrel crown.
  add(new THREE.BoxGeometry(0.006, 0.003, 0.17), worn, 0, 0.0445, -0.095);
  add(new THREE.BoxGeometry(0.004, 0.006, 0.006), metal, 0, 0.047, -0.178);
  add(new THREE.BoxGeometry(0.012, 0.005, 0.006), metal, 0, 0.047, -0.003);
  add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 10).rotateX(Math.PI / 2), worn, 0, 0.028, -0.187);
  // Trigger.
  add(new THREE.BoxGeometry(0.005, 0.018, 0.004), worn, 0, -0.016, -0.062);
  return { group: g, muzzle: new THREE.Vector3(0, 0.028, -0.19) };
}

/** Height of the grip's middle under the pistol's origin (the grip's top rear). */
const GRIP_CENTRE = 0.06;

/** A leather thigh holster; origin at its mouth, -Z down the barrel, +Y towards her front. */
function holsterMesh(): THREE.Group {
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.8, metalness: 0 });
  const strap = new THREE.MeshStandardMaterial({ color: '#2e2016', roughness: 0.85, metalness: 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.052, 0.17), leather);
  body.position.set(0, 0.012, -0.085);
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.03, 0.03), leather);
  flap.position.set(0, -0.018, -0.005);
  // Two straps around the thigh, on the inner side of the holster.
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.075, 0.018), strap);
  s1.position.set(-0.022, 0.012, -0.05);
  const s2 = s1.clone();
  s2.position.z = -0.13;
  for (const m of [body, flap, s1, s2]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Sets the opacity of every mesh material in a group, switching transparency only when needed. */
function fadeGroup(g: THREE.Object3D, a: number): void {
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material;
    const transparent = a < 0.99;
    if (m.transparent !== transparent) {
      m.transparent = transparent;
      m.needsUpdate = true;
    }
    m.opacity = a;
    o.castShadow = a > 0.5;
  });
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
const _hip = new THREE.Vector3();
const _hipO = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _hd = new THREE.Vector3();
const _ho = new THREE.Vector3();
const _hf = new THREE.Vector3();
const _hx = new THREE.Vector3();

export class CombatView {
  readonly group = new THREE.Group();
  private readonly holsters: [THREE.Group, THREE.Group] = [holsterMesh(), holsterMesh()];
  private readonly enemies: EnemyViews;
  private readonly pistols: [Pistol, Pistol];
  private readonly light = new THREE.PointLight('#ffc98a', 0, 8, 2);
  private readonly marker: THREE.Sprite;
  private readonly puffs: Puff[] = [];
  private readonly puffTexture: THREE.Texture;
  private sinceShot = Infinity;
  /** Smoothed aiming weight, for the barrels' direction. */
  private aimW = 0;
  private drawn = 0;
  /** 1 while her left hand is free for a pistol, 0 while it holds the torch (smoothed). */
  private leftFree = 1;
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
    for (const h of this.holsters) {
      h.visible = false;
      this.group.add(h);
    }

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

  /**
   * Places a thigh holster from the visible body's hip and knee; false while
   * the scanned body is not loaded. Leaves the thigh direction in _hd.
   */
  private placeHolster(nora: NoraRig, side: 0 | 1, h: THREE.Group): boolean {
    const s = side === 0 ? 'L' : 'R';
    const o = side === 0 ? 'R' : 'L';
    if (!nora.jointPosition(`thigh_${s}`, _hip) || !nora.jointPosition(`shin_${s}`, _knee)) {
      h.visible = false;
      return false;
    }
    nora.jointPosition(`thigh_${o}`, _hipO);
    _hd.subVectors(_knee, _hip).normalize();
    const out = _ho.subVectors(_hip, _hipO);
    out.addScaledVector(_hd, -out.dot(_hd)).normalize();
    const fwd = nora.facing(_hf);
    fwd.addScaledVector(_hd, -fwd.dot(_hd)).normalize();
    h.position.copy(_hip).addScaledVector(_hd, 0.2).addScaledVector(out, 0.056);
    // Basis: -Z along the thigh (barrel down), +Y towards her front, X from their cross product.
    _hx.crossVectors(fwd, _c.copy(_hd).negate());
    _m.makeBasis(_hx, fwd, _c);
    h.quaternion.setFromRotationMatrix(_m);
    h.visible = nora.opacity > 0.2;
    if (h.visible) fadeGroup(h, nora.opacity);
    return true;
  }

  update(world: World, nora: NoraRig, alpha: number, dt: number): void {
    this.time += dt;
    this.sinceShot += dt;
    this.enemies.update(world, alpha, dt);
    const p = world.state.player;

    // Pistols in Nora's hands while drawn.
    const armed = p.weapon.drawn && (p.mode === 'ground' || p.mode === 'air');
    this.drawn += ((armed ? 1 : 0) - this.drawn) * (1 - Math.exp(-dt * 18));
    // Follows Nora's aiming layer (nora.ts smooths it at the same rate).
    const aiming = armed ? this.aimPose(world).aiming : 0;
    this.aimW += (aiming - this.aimW) * (1 - Math.exp(-dt * 14));
    // The torch fills her left hand: that pistol stays in its holster.
    this.leftFree += ((torchInHand(p) ? 0 : 1) - this.leftFree) * (1 - Math.exp(-dt * 18));
    this.pistols.forEach((pistol, i) => {
      const side = i as 0 | 1;
      const g = pistol.group;
      // Holsters ride on her thighs; the pistols sit in them until drawn.
      const holster = this.holsters[side];
      const holstered = this.placeHolster(nora, side, holster);
      const inHand = this.drawn > 0.35 && (side === 1 || this.leftFree > 0.5);
      // The pistols fade with Nora when the camera closes in, so they never float on their own.
      g.visible = nora.opacity > 0.2 && (inHand || holstered);
      if (g.visible) fadeGroup(g, nora.opacity);
      if (g.visible && !inHand) {
        // Holstered: muzzle down the thigh, the grip out of the holster's mouth towards her back.
        g.position.copy(holster.position).addScaledVector(_hd, -0.02);
        g.quaternion.copy(holster.quaternion);
        g.scale.setScalar(1);
      } else if (g.visible) {
        let f: THREE.Vector3;
        let u: THREE.Vector3;
        if (nora.gripFrame(side, _pos, _f)) {
          // The visible hand: held ready the barrel follows the forearm. Aiming, the
          // elbows flare and each forearm turns ~12° inwards, so the barrel follows
          // the whole arm (shoulder to wrist) and the two pistols stay parallel.
          f = _f;
          if (this.aimW > 1e-3 && nora.jointPosition(side === 0 ? 'upperArm_L' : 'upperArm_R', _x)) {
            nora.jointPosition(side === 0 ? 'hand_L' : 'hand_R', _c);
            _c.sub(_x).normalize();
            f.lerp(_c, this.aimW).normalize();
          }
          u = _u.copy(UP).addScaledVector(f, -UP.dot(f));
          if (u.lengthSq() < 1e-4) u.set(0, 0, -1);
          u.normalize();
          // The middle of the grip (6 cm under the pistol's origin) sits in the visible palm.
          g.position.copy(_pos).addScaledVector(u, GRIP_CENTRE);
        } else {
          nora.handFrame(side, _pos, _q);
          // The aim layer points the fingers 0.3 below the aim: the barrel lifts them back to it.
          const fingers = _f.set(0, -1, 0).applyQuaternion(_q);
          f = _x.copy(fingers).addScaledVector(UP, 0.3).normalize();
          u = _u.copy(UP).addScaledVector(f, -UP.dot(f)).normalize();
          // Grip in the palm, a hand's breadth past the wrist.
          g.position.copy(_pos).addScaledVector(fingers, 0.075).addScaledVector(u, 0.005);
        }
        _p.crossVectors(u, _c.copy(f).negate());
        _m.makeBasis(_p, u, _c);
        g.quaternion.setFromRotationMatrix(_m);
        g.scale.setScalar(Math.min(1, this.drawn * 1.2, side === 0 ? this.leftFree * 1.2 : 1));
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
