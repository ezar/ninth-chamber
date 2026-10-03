/**
 * The Clay Archive's mechanisms (spec §19), stand-ins until the owner's models
 * (docs/art/models-brief.md): glyph locks, a stone plinth under a six-sided
 * drum carved with the six glyphs, each with its own shape and colour so they
 * read on a phone and with colour blindness; dart traps, a slab painted with a
 * red-ochre stroke, dark niches in the wall the volley comes from, and the
 * darts themselves crossing the corridor. Views only read the simulation.
 */
import * as THREE from 'three/webgpu';
import type { SimEvent } from '../core/events';
import type { Level } from '../sim/grid/level';
import { BLOCK, DIR_VEC, DIR_YAW, type Dir } from '../sim/grid/units';
import { defsOf, type MechanismDefs } from '../sim/mechanisms/defs';
import { GLYPHS } from '../sim/mechanisms/schema';
import type { World } from '../sim/world';

const center = (c: number): number => c * BLOCK + BLOCK / 2;
const FACES = GLYPHS.length;
/** Drum radius (to a face's middle) and height (m). */
const DRUM_R = 0.42;
const DRUM_H = 0.8;
const PLINTH_H = 0.55;
/** Seconds a volley takes to cross. */
const FLIGHT = 0.28;

/** Glyph colours: distinct in hue and in lightness. */
const GLYPH_COLOURS: Record<(typeof GLYPHS)[number], string> = {
  sun: '#d8452b',
  water: '#2f6fb8',
  reed: '#4f8a3a',
  eye: '#f2ead8',
  star: '#f0c03a',
  mountain: '#2a2420',
};

/** The six glyphs side by side on a strip, one per drum face, carved into clay. */
function glyphStrip(): THREE.CanvasTexture {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = cell * FACES;
  c.height = cell;
  const g = c.getContext('2d');
  if (g) {
    for (let i = 0; i < FACES; i++) {
      const x0 = i * cell;
      g.fillStyle = '#9a5a36';
      g.fillRect(x0, 0, cell, cell);
      // A sunk panel for the glyph.
      g.fillStyle = '#6e3c22';
      g.fillRect(x0 + 10, 10, cell - 20, cell - 20);
      const name = GLYPHS[i] ?? 'sun';
      g.fillStyle = GLYPH_COLOURS[name];
      g.strokeStyle = GLYPH_COLOURS[name];
      g.lineWidth = 9;
      g.lineCap = 'round';
      const cx = x0 + cell / 2;
      const cy = cell / 2;
      g.beginPath();
      switch (name) {
        case 'sun':
          g.arc(cx, cy, 20, 0, Math.PI * 2);
          g.fill();
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            g.moveTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
            g.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
          }
          g.stroke();
          break;
        case 'water':
          for (let k = -1; k <= 1; k++) {
            g.moveTo(cx - 40, cy + k * 22);
            for (let s = 0; s <= 8; s++) g.lineTo(cx - 40 + s * 10, cy + k * 22 + (s % 2 ? -8 : 8));
          }
          g.stroke();
          break;
        case 'reed':
          for (const dx of [-22, 0, 22]) {
            g.moveTo(cx + dx, cy + 42);
            g.lineTo(cx + dx, cy - 30);
            g.moveTo(cx + dx, cy - 30);
            g.lineTo(cx + dx + 10, cy - 42);
          }
          g.stroke();
          break;
        case 'eye':
          g.moveTo(cx - 44, cy);
          g.quadraticCurveTo(cx, cy - 40, cx + 44, cy);
          g.quadraticCurveTo(cx, cy + 40, cx - 44, cy);
          g.fill();
          g.beginPath();
          g.fillStyle = '#2a2420';
          g.arc(cx, cy, 13, 0, Math.PI * 2);
          g.fill();
          break;
        case 'star':
          for (let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
            const r = k % 2 ? 18 : 44;
            if (k === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          }
          g.closePath();
          g.fill();
          break;
        case 'mountain':
          g.moveTo(cx - 46, cy + 36);
          g.lineTo(cx - 8, cy - 38);
          g.lineTo(cx + 14, cy);
          g.lineTo(cx + 24, cy - 16);
          g.lineTo(cx + 46, cy + 36);
          g.closePath();
          g.fill();
          break;
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A red-ochre stroke painted on a slab: the darts' warning. */
function paintTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(156, 40, 22, 0.85)';
    g.lineWidth = 14;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(22, 96);
    g.bezierCurveTo(40, 30, 88, 100, 106, 30);
    g.stroke();
    g.lineWidth = 6;
    g.beginPath();
    g.arc(64, 64, 52, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface LockView {
  id: string;
  drum: THREE.Mesh;
  /** Yaw that shows face 0 towards the reading side. */
  base: number;
  shown: number;
}

interface Volley {
  darts: THREE.Mesh[];
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

export class ArchiveView {
  readonly group = new THREE.Group();
  private readonly defs: MechanismDefs;
  private readonly locks: LockView[] = [];
  private readonly volleys: Volley[] = [];
  private readonly dartGeo = new THREE.CylinderGeometry(0.012, 0.018, 0.24, 5);
  private readonly dartMat = new THREE.MeshStandardMaterial({ color: '#3b2c22', roughness: 0.6 });
  private readonly disposables: { dispose(): void }[] = [this.dartGeo, this.dartMat];

  constructor(
    private readonly level: Level,
    stone: THREE.Material,
  ) {
    this.defs = defsOf(level);
    this.group.name = 'archive';
    this.dartGeo.rotateX(Math.PI / 2);
    this.buildLocks(stone);
    this.buildDarts();
  }

  /** Whether the level has any of the Archive's mechanisms. */
  get empty(): boolean {
    return this.defs.glyphs.size === 0 && this.defs.darts.size === 0;
  }

  private buildLocks(stone: THREE.Material): void {
    if (this.defs.glyphs.size === 0) return;
    const strip = glyphStrip();
    const drumMat = new THREE.MeshStandardMaterial({ map: strip, roughness: 0.8 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#7a4428', roughness: 0.85 });
    const plinthGeo = new THREE.BoxGeometry(1.1, PLINTH_H, 1.1);
    // Six sides, flat faces centred on angles k·60°; caps get the plain clay.
    const drumGeo = new THREE.CylinderGeometry(
      DRUM_R / Math.cos(Math.PI / FACES),
      DRUM_R / Math.cos(Math.PI / FACES),
      DRUM_H,
      FACES,
      1,
    );
    this.disposables.push(strip, drumMat, capMat, plinthGeo, drumGeo);
    for (const d of this.defs.glyphs.values()) {
      const x = center(d.cx);
      const z = center(d.cz);
      const y = this.level.floorAt(x, z);
      const plinth = new THREE.Mesh(plinthGeo, stone);
      plinth.position.set(x, y + PLINTH_H / 2, z);
      const drum = new THREE.Mesh(drumGeo, [drumMat, capMat, capMat]);
      drum.position.set(x, y + PLINTH_H + DRUM_H / 2, z);
      this.group.add(plinth, drum);
      // three's cylinder starts its first side's middle at +Z… rotate so face 0 looks along `facing`.
      const base = DIR_YAW[d.facing] + Math.PI + Math.PI / FACES;
      this.locks.push({ id: d.id, drum, base, shown: d.glyph });
      drum.rotation.y = base - (d.glyph * Math.PI * 2) / FACES;
    }
  }

  private buildDarts(): void {
    if (this.defs.darts.size === 0) return;
    const paint = paintTexture();
    const paintMat = new THREE.MeshStandardMaterial({
      map: paint,
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
    });
    const slabGeo = new THREE.PlaneGeometry(BLOCK * 0.9, BLOCK * 0.9);
    slabGeo.rotateX(-Math.PI / 2);
    const nicheGeo = new THREE.BoxGeometry(0.5, 0.3, 0.06);
    const nicheMat = new THREE.MeshStandardMaterial({ color: '#140d0a', roughness: 1 });
    this.disposables.push(paint, paintMat, slabGeo, nicheGeo, nicheMat);
    for (const d of this.defs.darts.values()) {
      const x = center(d.cx);
      const z = center(d.cz);
      const y = this.level.floorAt(x, z);
      const slab = new THREE.Mesh(slabGeo, paintMat);
      slab.position.set(x, y + 0.012, z);
      slab.receiveShadow = true;
      this.group.add(slab);
      // The niches on the wall face the volley leaves from.
      const first = d.line[0];
      if (!first) continue;
      const v = DIR_VEC[d.from];
      const niche = new THREE.Mesh(nicheGeo, nicheMat);
      niche.position.set(
        center(first.cx) + v.x * (BLOCK / 2 - 0.02),
        y + 1.1,
        center(first.cz) + v.z * (BLOCK / 2 - 0.02),
      );
      niche.rotation.y = DIR_YAW[d.from as Dir];
      this.group.add(niche);
    }
  }

  onEvent(e: SimEvent): void {
    if (e.type !== 'darts.fired') return;
    const from = e.from as [number, number] | undefined;
    const to = e.to as [number, number] | undefined;
    const def = this.defs.darts.get(String(e.id));
    if (!from || !to || !def) return;
    const y = typeof e.y === 'number' ? e.y : 1;
    const v = DIR_VEC[def.from];
    const a = new THREE.Vector3(center(from[0]) + v.x * BLOCK * 0.5, y, center(from[1]) + v.z * BLOCK * 0.5);
    const b = new THREE.Vector3(center(to[0]) - v.x * BLOCK * 0.5, y, center(to[1]) - v.z * BLOCK * 0.5);
    const darts: THREE.Mesh[] = [];
    const n = typeof e.count === 'number' ? e.count : 3;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.dartGeo, this.dartMat);
      m.lookAt(b.x - a.x, 0, b.z - a.z);
      m.userData.offset = new THREE.Vector3(
        -v.z * (i - (n - 1) / 2) * 0.18,
        (i % 2) * 0.12 - 0.06,
        v.x * (i - (n - 1) / 2) * 0.18,
      );
      this.group.add(m);
      darts.push(m);
    }
    this.volleys.push({ darts, from: a, to: b, t: 0 });
  }

  update(world: World, dt: number): void {
    for (const lock of this.locks) {
      const st = world.state.mechanisms.glyphs.find((g) => g.id === lock.id);
      if (!st) continue;
      // Turn the shortest way onwards (the drum only ever turns one way, a face at a time).
      const target = lock.base - (st.glyph * Math.PI * 2) / FACES;
      let diff = target - lock.drum.rotation.y;
      diff = ((((diff + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      lock.drum.rotation.y += diff * (1 - Math.exp(-dt * 8));
    }
    for (let i = this.volleys.length - 1; i >= 0; i--) {
      const v = this.volleys[i];
      if (!v) continue;
      v.t += dt / FLIGHT;
      for (const m of v.darts) {
        m.position.lerpVectors(v.from, v.to, Math.min(1, v.t)).add(m.userData.offset as THREE.Vector3);
      }
      if (v.t >= 1.4) {
        for (const m of v.darts) this.group.remove(m);
        this.volleys.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
