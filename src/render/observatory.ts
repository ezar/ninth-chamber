/**
 * The Observatory's dome (spec §19, chamber VIII), stand-ins until the
 * owner's models (docs/art/models-brief.md): three bronze rings under the
 * dome, each carrying its signs (eight stars and the bright ninth, the
 * moon's phases, the sun) and turning, eased, to the simulation's position;
 * a notch in the stone at the ninth place they align to; the oculus's shaft
 * of moonlight and its pool on the floor; and the night sky beyond the
 * openings, with the Amber Heart's eight stars drawn as a constellation.
 * Views only read the simulation.
 */
import * as THREE from 'three/webgpu';
import type { Level } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';
import { defsOf, type OculusDef, type RingDef } from '../sim/mechanisms/defs';
import type { World } from '../sim/world';

const TAU = Math.PI * 2;
/** Angle round the dome (clockwise from north, radians) of position `i` of `n`. */
const step = (i: number, n: number): number => (i / n) * TAU;

interface RingView {
  def: RingDef;
  group: THREE.Group;
  /** Shown angle, eased towards the simulation's. */
  angle: number;
}

interface OculusView {
  def: OculusDef;
  shaft: THREE.Mesh;
  pool: THREE.Mesh;
  light: THREE.PointLight;
  /** 0 … 1, eased. */
  open: number;
}

export class DomeView {
  readonly group = new THREE.Group();
  private readonly rings: RingView[] = [];
  private readonly oculi: OculusView[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(level: Level, bronze: THREE.Material) {
    const defs = defsOf(level);
    const mat = <T extends THREE.Material>(m: T): T => {
      this.materials.push(m);
      return m;
    };
    const geo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const starMat = mat(new THREE.MeshBasicMaterial({ color: '#dfe8ff' }));
    const ninthMat = mat(new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
    const moonLit = mat(new THREE.MeshBasicMaterial({ color: '#cfd8e6' }));
    const moonDark = mat(new THREE.MeshStandardMaterial({ color: '#1a1e26', roughness: 0.9 }));
    const sunMat = mat(new THREE.MeshBasicMaterial({ color: '#ffb54a' }));
    const stone = mat(new THREE.MeshStandardMaterial({ color: '#2a2c34', roughness: 0.9 }));
    const dot = geo(new THREE.SphereGeometry(0.09, 8, 6));
    const big = geo(new THREE.SphereGeometry(0.16, 10, 8));
    const disc = geo(new THREE.CircleGeometry(0.22, 18));

    for (const def of defs.rings.values()) {
      const ceil = level.sector(def.cx, def.cz)?.ceil ?? 8;
      const y = ceil - 0.6 - (def.kind === 'sky' ? 0 : def.kind === 'moon' ? 0.35 : 0.7);
      const group = new THREE.Group();
      group.position.set(def.cx * BLOCK + BLOCK / 2, y, def.cz * BLOCK + BLOCK / 2);
      const band = new THREE.Mesh(geo(new THREE.TorusGeometry(def.radius, 0.07, 6, 64)), bronze);
      band.rotation.x = Math.PI / 2;
      band.castShadow = true;
      group.add(band);
      // Signs round the ring: position 0 carries its own mark; the others are plain.
      for (let i = 0; i < def.positions; i++) {
        const a = step(i, def.positions);
        const x = Math.sin(a) * def.radius;
        const z = -Math.cos(a) * def.radius;
        let m: THREE.Mesh;
        if (def.kind === 'sky') m = new THREE.Mesh(i === 0 ? big : dot, i === 0 ? ninthMat : starMat);
        else if (def.kind === 'moon') {
          // Phases: the mark (the new moon) is dark; the others wax and wane.
          const lit = i === 0 ? 0 : (1 - Math.cos(step(i, def.positions))) / 2;
          m = new THREE.Mesh(disc, i === 0 ? moonDark : moonLit);
          m.scale.setScalar(0.5 + lit * 0.6);
          m.rotation.x = Math.PI / 2;
        } else m = new THREE.Mesh(i === 0 ? big : dot, i === 0 ? sunMat : stone);
        m.position.set(x, -0.12, z);
        group.add(m);
      }
      this.group.add(group);
      this.rings.push({ def, group, angle: step(def.start, def.positions) });
    }

    // The notch at the ninth place, cut in the stone above the rings.
    const notched = new Set<string>();
    for (const def of defs.rings.values()) {
      const key = `${def.cx},${def.cz}`;
      if (notched.has(key)) continue;
      notched.add(key);
      const ceil = level.sector(def.cx, def.cz)?.ceil ?? 8;
      const r = Math.max(
        ...[...defs.rings.values()].filter((d) => d.cx === def.cx && d.cz === def.cz).map((d) => d.radius),
      );
      const a = step(def.target, def.positions);
      const notch = new THREE.Mesh(geo(new THREE.BoxGeometry(0.5, 0.5, 1.2)), ninthMat);
      notch.position.set(
        def.cx * BLOCK + BLOCK / 2 + Math.sin(a) * (r + 0.6),
        ceil - 0.3,
        def.cz * BLOCK + BLOCK / 2 - Math.cos(a) * (r + 0.6),
      );
      notch.rotation.y = -a;
      this.group.add(notch);
    }

    // The oculus: a shaft of moonlight and its pool on the floor.
    const shaftMat = mat(
      new THREE.MeshBasicMaterial({
        color: '#bcd0ff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    const poolMat = mat(
      new THREE.MeshBasicMaterial({ color: '#dfe8ff', transparent: true, opacity: 0, depthWrite: false }),
    );
    for (const def of defs.oculi.values()) {
      const w = (def.maxX - def.minX) * BLOCK;
      const d = (def.maxZ - def.minZ) * BLOCK;
      const cx = ((def.minX + def.maxX) / 2) * BLOCK;
      const cz = ((def.minZ + def.maxZ) / 2) * BLOCK;
      const floor = level.floorAt(cx, cz);
      const ceil = level.sector(def.minX, def.minZ)?.ceil ?? floor + 10;
      const h = Math.max(1, ceil - floor);
      const r = Math.min(w, d) / 2;
      const shaft = new THREE.Mesh(geo(new THREE.CylinderGeometry(r * 0.8, r, h, 24, 1, true)), shaftMat);
      shaft.position.set(cx, floor + h / 2, cz);
      const pool = new THREE.Mesh(geo(new THREE.CircleGeometry(r, 32)), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(cx, floor + 0.02, cz);
      const light = new THREE.PointLight('#c8d8ff', 0, Math.max(8, h), 2);
      light.position.set(cx, floor + 2.5, cz);
      shaft.visible = pool.visible = false;
      this.group.add(shaft, pool, light);
      this.oculi.push({ def, shaft, pool, light, open: def.on ? 1 : 0 });
    }
  }

  update(world: World, dt: number): void {
    const k = 1 - Math.exp(-dt * 3);
    for (const v of this.rings) {
      const st = world.state.mechanisms.rings.find((r) => r.id === v.def.id);
      if (!st) continue;
      // The shortest way round to the ring's position (its mark travels clockwise as it turns).
      const target = step(st.pos, v.def.positions);
      let d = target - v.angle;
      d -= TAU * Math.round(d / TAU);
      v.angle += d * k;
      v.group.rotation.y = -v.angle;
    }
    for (const v of this.oculi) {
      const st = world.state.mechanisms.oculi.find((o) => o.id === v.def.id);
      const want = st?.on ? 1 : 0;
      v.open += (want - v.open) * (1 - Math.exp(-dt * 1.2));
      const shown = v.open > 0.01;
      v.shaft.visible = v.pool.visible = shown;
      (v.shaft.material as THREE.MeshBasicMaterial).opacity = 0.16 * v.open;
      (v.pool.material as THREE.MeshBasicMaterial).opacity = 0.55 * v.open;
      v.light.intensity = 40 * v.open;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}

/** The Amber Heart's eight stars (render of its map, as in ui/relic-figures.ts), as directions near the zenith. */
function heartStars(): THREE.Vector3[] {
  const radii = [66, 84, 58, 78, 90, 62, 82, 72];
  return radii.map((r, i) => {
    const a = ((-70 + i * 40) * Math.PI) / 180;
    // Figure x is east, figure y (down the page) is south; 90 units ≈ 20° off the zenith.
    return new THREE.Vector3(r * Math.cos(a) * 0.004, 1, r * Math.sin(a) * 0.004).normalize();
  });
}

/**
 * The night sky beyond the openings: a sphere of stars far around the level,
 * the Heart's constellation brighter, near the zenith. Only levels with a
 * night look draw it.
 */
export class StarField {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(centre: THREE.Vector3, radius = 600) {
    let seed = 99;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const faint: number[] = [];
    for (let i = 0; i < 1800; i++) {
      // Upper hemisphere mostly: the sky is seen through openings above.
      const u = rnd() * 2 - 1;
      const y = Math.abs(u) * 0.95 + 0.05;
      const t = rnd() * TAU;
      const s = Math.sqrt(1 - y * y);
      faint.push(Math.cos(t) * s * radius, y * radius, Math.sin(t) * s * radius);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(faint, 3));
    const m = new THREE.PointsMaterial({ color: '#c9d4ee', size: 1.4, sizeAttenuation: false, fog: false });
    const bright = new THREE.BufferGeometry();
    bright.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        heartStars().flatMap((v) => [v.x * radius, v.y * radius, v.z * radius]),
        3,
      ),
    );
    const bm = new THREE.PointsMaterial({ color: '#ffe7b0', size: 3.2, sizeAttenuation: false, fog: false });
    this.geometries.push(g, bright);
    this.materials.push(m, bm);
    const pts = new THREE.Points(g, m);
    const heart = new THREE.Points(bright, bm);
    pts.frustumCulled = heart.frustumCulled = false;
    this.group.add(pts, heart);
    this.group.position.copy(centre);
  }

  /** Keeps the sky centred on the eye, so it never gets closer. */
  follow(eye: THREE.Vector3): void {
    this.group.position.copy(eye);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
