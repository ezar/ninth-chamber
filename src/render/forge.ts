/**
 * The Bronze Forge's mechanisms (spec §19, chamber VI), stand-ins until the
 * owner's models (docs/art/models-brief.md): molten bronze that rises along
 * its trench, glows orange and darkens as it cools into a bridge, the
 * crucible it pours from with its stream while it runs, and the bellows
 * (pushable blocks with the bellows' look). Views only read the simulation.
 */
import * as THREE from 'three/webgpu';
import type { SimEvent } from '../core/events';
import type { Level } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';
import { defsOf, type PourDef } from '../sim/mechanisms/defs';
import { pourBurns, pourCovers, pourGlow } from '../sim/mechanisms/bronze';
import type { World } from '../sim/world';

const center = (c: number): number => c * BLOCK + BLOCK / 2;
const HOT = new THREE.Color('#ff7a1f');
const WARM = new THREE.Color('#b8461a');
const COLD = new THREE.Color('#5a3d24');
const COLD_TINT = new THREE.Color('#8a6a45');
const HOT_TINT = new THREE.Color('#3a1a0a');

/** A crust of cooled skin over the melt: bright cracks where it still glows. */
function crustTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    let seed = 11;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    g.strokeStyle = '#3a3a3a';
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      g.lineWidth = 3 + rnd() * 9;
      g.beginPath();
      let x = rnd() * size;
      let y = rnd() * size;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rnd() - 0.5) * 50;
        y += (rnd() - 0.5) * 50;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface PourView {
  def: PourDef;
  cells: THREE.Mesh[];
  /** Trench floor under each cell (m). */
  floors: number[];
  material: THREE.MeshStandardMaterial;
  stream: THREE.Mesh | null;
}

export class ForgeView {
  readonly group = new THREE.Group();
  private readonly pours: PourView[] = [];
  private readonly crust = crustTexture();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private clock = 0;

  constructor(level: Level, stone: THREE.Material) {
    const defs = defsOf(level);
    const box = new THREE.BoxGeometry(BLOCK, 1, BLOCK);
    box.translate(0, -0.5, 0);
    this.geometries.push(box);
    const streamGeo = new THREE.CylinderGeometry(0.09, 0.14, 1, 8, 1, true);
    streamGeo.translate(0, -0.5, 0);
    this.geometries.push(streamGeo);
    for (const def of defs.pours.values()) {
      const material = new THREE.MeshStandardMaterial({
        color: COLD,
        roughness: 0.38,
        metalness: 0.85,
        emissive: HOT,
        emissiveMap: this.crust,
        emissiveIntensity: 0,
      });
      this.materials.push(material);
      const cells: THREE.Mesh[] = [];
      const floors: number[] = [];
      for (const c of def.cells) {
        const s = level.sector(c.cx, c.cz);
        const floor = s ? (s.pit ? s.pitFloor : Math.max(...s.floor)) : def.y - 1;
        floors.push(floor);
        const m = new THREE.Mesh(box, material);
        m.position.set(center(c.cx), def.y, center(c.cz));
        m.visible = false;
        m.receiveShadow = true;
        this.group.add(m);
        cells.push(m);
      }
      const stream = this.buildCrucible(def, level, stone, streamGeo, material);
      this.pours.push({ def, cells, floors, material, stream });
    }
  }

  /** A crucible on the wall behind the trench's first cell, and the stream it pours. */
  private buildCrucible(
    def: PourDef,
    level: Level,
    stone: THREE.Material,
    streamGeo: THREE.BufferGeometry,
    melt: THREE.Material,
  ): THREE.Mesh | null {
    const first = def.cells[0];
    if (!first) return null;
    const next = def.cells[1] ?? first;
    // Back towards the wall the trench starts from.
    let bx = Math.sign(first.cx - next.cx);
    let bz = Math.sign(first.cz - next.cz);
    if (bx === 0 && bz === 0) {
      for (const [dx, dz] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        if (level.sector(first.cx + dx, first.cz + dz)?.wall) {
          bx = dx;
          bz = dz;
          break;
        }
      }
    }
    const g = new THREE.Group();
    const bowlGeo = new THREE.CylinderGeometry(0.62, 0.42, 0.7, 16, 1, true);
    const rimGeo = new THREE.TorusGeometry(0.62, 0.07, 6, 18);
    const baseGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 16);
    this.geometries.push(bowlGeo, rimGeo, baseGeo);
    const pot = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.55, metalness: 0.6 });
    this.materials.push(pot);
    const bowl = new THREE.Mesh(bowlGeo, pot);
    const rim = new THREE.Mesh(rimGeo, pot);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.35;
    const base = new THREE.Mesh(baseGeo, pot);
    base.position.y = -0.35;
    // Tipped towards the trench.
    const tip = new THREE.Group();
    tip.add(bowl, rim, base);
    tip.rotation.set(bz * 0.5, 0, -bx * 0.5);
    g.add(tip);
    // A stone bracket into the wall.
    const bracketGeo = new THREE.BoxGeometry(0.5, 0.25, 0.9);
    this.geometries.push(bracketGeo);
    const bracket = new THREE.Mesh(bracketGeo, stone);
    bracket.position.set(bx * 0.55, -0.45, bz * 0.55);
    bracket.rotation.y = Math.atan2(bx, bz);
    g.add(bracket);
    const top = def.y + 2.2;
    g.position.set(center(first.cx) + bx * 0.55, top, center(first.cz) + bz * 0.55);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    this.group.add(g);
    const stream = new THREE.Mesh(streamGeo, melt);
    stream.position.set(center(first.cx) + bx * 0.25, top - 0.2, center(first.cz) + bz * 0.25);
    stream.scale.y = top - 0.2 - def.y;
    stream.visible = false;
    this.group.add(stream);
    return stream;
  }

  update(world: World, dt: number): void {
    this.clock += dt;
    const flicker = 0.92 + 0.08 * Math.sin(this.clock * 9.1) * Math.sin(this.clock * 3.7);
    for (const v of this.pours) {
      const st = world.state.mechanisms.pours.find((p) => p.id === v.def.id);
      if (!st) continue;
      const glow = pourGlow(v.def, st);
      // Colour: dark bronze when cold, a deep red skin over orange cracks while hot.
      v.material.color.copy(COLD_TINT).lerp(HOT_TINT, Math.min(1, glow * 1.5));
      v.material.emissive.copy(WARM).lerp(HOT, glow);
      v.material.emissiveIntensity = glow > 0 ? (0.4 + 3.2 * glow) * flicker : 0;
      v.cells.forEach((m, i) => {
        const shown = pourCovers(st, i);
        m.visible = shown;
        if (!shown) return;
        const floor = v.floors[i] ?? v.def.y - 1;
        // A cell the front is crossing fills from the trench floor up.
        const fill = st.phase === 'flowing' && !st.cast && pourBurns(st, i) ? Math.min(1, st.front - i) : 1;
        const depth = Math.max(0.05, v.def.y - floor);
        m.scale.y = depth * fill;
        m.position.y = floor + depth * fill;
      });
      if (v.stream) v.stream.visible = st.phase === 'flowing';
    }
  }

  onEvent(_e: SimEvent): void {
    // Sparks and smoke arrive with the effects pass.
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.crust.dispose();
    this.group.removeFromParent();
  }
}

/** Bellows (spec §19): two boards, pleated leather between them and a bronze nozzle; a block's footprint. */
export function bellowsBlock(height: number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.85 });
  const leather = new THREE.MeshStandardMaterial({ color: '#3b2618', roughness: 0.95 });
  const bronze = new THREE.MeshStandardMaterial({ color: '#8a6a3c', roughness: 0.4, metalness: 0.85 });
  const w = BLOCK - 0.25;
  const board = new THREE.BoxGeometry(w, 0.14, w);
  const bottom = new THREE.Mesh(board, wood);
  bottom.position.y = 0.07;
  const top = new THREE.Mesh(board, wood);
  top.position.y = height - 0.07;
  top.rotation.x = -0.06;
  g.add(bottom, top);
  // Pleats: alternating wide and narrow rings of leather.
  const pleats = 7;
  for (let i = 0; i < pleats; i++) {
    const t = (i + 0.5) / pleats;
    const s = i % 2 === 0 ? w - 0.05 : w - 0.3;
    const pleat = new THREE.Mesh(new THREE.BoxGeometry(s, (height - 0.28) / pleats, s), leather);
    pleat.position.y = 0.14 + t * (height - 0.28);
    g.add(pleat);
  }
  // Handles on top and the nozzle out of one side.
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, w * 0.7, 8), wood);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, height + 0.08, -w * 0.3);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.7, 10), bronze);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.35, w / 2 + 0.3);
  g.add(handle, nozzle);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}
