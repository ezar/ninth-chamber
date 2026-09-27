/**
 * Dust puffs: a fixed pool of soft camera-facing cards in one instanced
 * draw (points cannot be sized on every backend). A puff swells as it
 * drifts and slows, then shrinks away; grit (`heavy`) falls instead and
 * stays small. Spawning and updating allocate nothing.
 */
import * as THREE from 'three/webgpu';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,0.4)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.15)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class PuffPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly heavy: Uint8Array;
  private next = 0;
  private live = false;

  constructor(
    private readonly count: number,
    tint: string,
    /** Seconds a puff lives and its largest size (m). */
    private readonly life = 1.5,
    private readonly size = 1.4,
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: puffTexture(), color: tint, transparent: true, depthWrite: false }),
      count,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.age = new Float32Array(count).fill(Infinity);
    this.heavy = new Uint8Array(count);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, _m);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, heavy = false): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.heavy[i] = heavy ? 1 : 0;
    this.live = true;
  }

  update(dt: number, eye: { x: number; y: number; z: number }): void {
    if (!this.live) return;
    let any = false;
    const drag = Math.exp(-dt * 2.4);
    for (let i = 0; i < this.count; i++) {
      const age = (this.age[i] ?? Infinity) + dt;
      this.age[i] = age;
      if (age > this.life) {
        if (age - dt <= this.life) {
          _m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, _m);
        }
        continue;
      }
      any = true;
      const heavy = this.heavy[i] === 1;
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        if (!heavy) this.vel[j] = (this.vel[j] ?? 0) * drag;
        this.pos[j] = (this.pos[j] ?? 0) + (this.vel[j] ?? 0) * dt;
      }
      this.vel[i * 3 + 1] = (this.vel[i * 3 + 1] ?? 0) + (heavy ? -9 : 0.25) * dt;
      _p.set(this.pos[i * 3] ?? 0, this.pos[i * 3 + 1] ?? 0, this.pos[i * 3 + 2] ?? 0);
      _q.setFromAxisAngle(UP, Math.atan2(eye.x - _p.x, eye.z - _p.z));
      const k = age / this.life;
      const sz = heavy ? 0.12 : this.size * Math.min(1, 0.35 + k * 1.6) * Math.min(1, (1 - k) * 3);
      _s.set(sz, sz, sz);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = any;
    this.live = any;
  }
}
