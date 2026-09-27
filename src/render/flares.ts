/**
 * Burning flares (spec §7 "Bengalas", §11 "la oscuridad invita a encender
 * una bengala"): a red-orange point light with a restless flicker, a bright
 * core and a shower of sparks. The lights are created up front and only
 * move and dim, so lighting a flare never recompiles a material.
 */
import * as THREE from 'three/webgpu';
import { flares } from '../sim/player/tuning';
import type { FlareState } from '../sim/state';
import type { World } from '../sim/world';

/** Flare lights in the scene (the nearest burning flares get them). */
export const FLARE_LIGHTS = 2;
const SPARKS = 160;
const COLOR = new THREE.Color('#ff4a1c');

interface Spark {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,245,230,1)');
    grad.addColorStop(0.18, 'rgba(255,150,90,0.9)');
    grad.addColorStop(0.5, 'rgba(255,70,30,0.3)');
    grad.addColorStop(1, 'rgba(255,40,10,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FlareView {
  readonly group = new THREE.Group();
  readonly lights: THREE.PointLight[] = [];
  private readonly sticks: THREE.Mesh[] = [];
  private readonly glows: THREE.Sprite[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkPoints: THREE.Points;
  private readonly sparkAttr: THREE.BufferAttribute;
  private nextSpark = 0;
  private seed = 7;
  private time = 0;

  constructor() {
    this.group.name = 'flares';
    for (let i = 0; i < FLARE_LIGHTS; i++) {
      const l = new THREE.PointLight(COLOR, 0, flares.radius * 1.3, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
    const stickGeo = new THREE.CylinderGeometry(0.018, 0.02, 0.24, 8);
    stickGeo.translate(0, -0.1, 0);
    const stickMat = new THREE.MeshStandardMaterial({ color: '#8a1d12', roughness: 0.6 });
    const glowTex = glowTexture();
    for (let i = 0; i < flares.max; i++) {
      const stick = new THREE.Mesh(stickGeo, stickMat);
      stick.visible = false;
      this.sticks.push(stick);
      this.group.add(stick);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: '#ffffff',
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          fog: false,
        }),
      );
      glow.visible = false;
      this.glows.push(glow);
      this.group.add(glow);
    }
    const pos = new Float32Array(SPARKS * 3).fill(-1e4);
    const geo = new THREE.BufferGeometry();
    this.sparkAttr = new THREE.BufferAttribute(pos, 3);
    geo.setAttribute('position', this.sparkAttr);
    this.sparkPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: '#ffb070',
        size: 0.03,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.sparkPoints.frustumCulled = false;
    for (let i = 0; i < SPARKS; i++)
      this.sparks.push({ pos: new THREE.Vector3(0, -1e4, 0), vel: new THREE.Vector3(), age: 1, life: 1 });
    this.group.add(this.sparkPoints);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /**
   * `hand` is where Nora's hand is (a held flare burns there), `eye` the
   * camera, `wet` tells whether a point is under water (sparks drown).
   */
  update(
    world: World,
    dt: number,
    hand: THREE.Vector3 | null,
    eye: THREE.Vector3,
    wet: (x: number, y: number, z: number) => boolean,
  ): void {
    this.time += dt;
    const list: { f: FlareState; at: THREE.Vector3 }[] = world.state.flares.map((f) => ({
      f,
      at: f.held && hand ? hand.clone() : new THREE.Vector3(f.x, f.y, f.z),
    }));
    // A lying flare burns on its side, just above the floor.
    for (const { f, at } of list) if (!f.held) at.y += 0.04;

    this.sticks.forEach((s, i) => {
      const e = list[i];
      const glow = this.glows[i];
      s.visible = !!e;
      if (glow) glow.visible = !!e;
      if (!e) return;
      s.position.copy(e.at);
      s.rotation.set(e.f.held ? 0.3 : Math.PI / 2, 0, e.f.held ? 0.2 : 0);
      const fade = this.fade(e.f);
      if (glow) {
        const k = 0.28 + 0.06 * Math.sin(this.time * 31 + i) * Math.sin(this.time * 17.3 + i * 2);
        glow.position.copy(e.at);
        glow.scale.setScalar(k * (0.4 + 0.6 * fade));
      }
      // Sparks spit from the burning tip (none underwater, where it smokes and bubbles instead).
      if (fade > 0.1 && !wet(e.at.x, e.at.y, e.at.z)) {
        const n = Math.round(dt * 70 * fade + this.rand() * 0.6);
        for (let k = 0; k < n; k++) this.spark(e.at);
      }
    });

    // The nearest flares get the lights.
    const byDistance = [...list].sort((a, b) => a.at.distanceToSquared(eye) - b.at.distanceToSquared(eye));
    this.lights.forEach((l, i) => {
      const e = byDistance[i];
      if (!e) {
        l.intensity = 0;
        return;
      }
      const t = this.time * 1.0 + i * 3.1;
      const flick =
        0.78 +
        0.12 * Math.sin(t * 23.7) * Math.sin(t * 13.1 + 0.7) +
        0.07 * Math.sin(t * 41.3 + 1.1) +
        0.05 * (this.rand() - 0.5);
      l.position.set(e.at.x, e.at.y + 0.08, e.at.z);
      l.color.copy(COLOR);
      l.intensity = 34 * flick * this.fade(e.f);
    });

    const g = 7;
    this.sparks.forEach((s, i) => {
      s.age += dt;
      if (s.age >= s.life) {
        this.sparkAttr.setXYZ(i, 0, -1e4, 0);
        return;
      }
      s.vel.y -= g * dt;
      s.pos.addScaledVector(s.vel, dt);
      this.sparkAttr.setXYZ(i, s.pos.x, s.pos.y, s.pos.z);
    });
    this.sparkAttr.needsUpdate = true;
  }

  /** 1 while burning, fading over the last two seconds. */
  private fade(f: FlareState): number {
    return Math.min(1, Math.max(0, (flares.life - f.age) / 2), f.age / 0.3);
  }

  private spark(at: THREE.Vector3): void {
    const s = this.sparks[this.nextSpark];
    this.nextSpark = (this.nextSpark + 1) % SPARKS;
    if (!s) return;
    s.pos.copy(at);
    const a = this.rand() * Math.PI * 2;
    const r = 0.6 + this.rand() * 1.6;
    s.vel.set(Math.cos(a) * r, 0.6 + this.rand() * 1.8, Math.sin(a) * r);
    s.age = 0;
    s.life = 0.25 + this.rand() * 0.45;
  }
}
