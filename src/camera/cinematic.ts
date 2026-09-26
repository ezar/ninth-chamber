/**
 * Cinematic camera moves for the title screen and the intro: a slow drift in
 * the sunlit entrance and a path that comes down through the light shaft and
 * lands behind Nora, where the orbit camera takes over. Shots are derived from
 * the level (start room, ceiling, start position and facing), not hard-coded.
 */
import type { Level } from '../sim/grid/level';
import { BLOCK } from '../sim/grid/units';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Shot {
  eye: Vec3;
  look: Vec3;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export const lerpShot = (a: Shot, b: Shot, t: number): Shot => ({
  eye: lerpV(a.eye, b.eye, t),
  look: lerpV(a.look, b.look, t),
});

/** Listener yaw for a shot, same convention as the player (0 looks towards -Z). */
export const shotYaw = (s: Shot): number => Math.atan2(-(s.look.x - s.eye.x), -(s.look.z - s.eye.z));

/**
 * Key shots in the start room: low in the far corner with the light shaft
 * across the frame and Nora beyond it, into the shaft, a three-quarter front
 * view and her side. The orbit camera behind her is the last shot, added at
 * run time.
 */
export function entranceShots(level: Level, player: Vec3, yaw: number): Shot[] {
  const cx = Math.floor(player.x / BLOCK);
  const cz = Math.floor(player.z / BLOCK);
  const room = level.roomAt(cx, cz);
  const floor = player.y;
  const ceil = level.sector(cx, cz)?.ceil ?? floor + 8;
  const h = ceil - floor;
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const c = room
    ? { x: ((room.minX + room.maxX) / 2) * BLOCK, z: ((room.minZ + room.maxZ) / 2) * BLOCK }
    : { x: player.x + f.x * 6, z: player.z + f.z * 6 };
  // Room half extents (m) along Nora's forward and right axes.
  const w = room ? room.maxX - room.minX : 8;
  const d = room ? room.maxZ - room.minZ : 8;
  const halfF = ((Math.abs(f.x) * w + Math.abs(f.z) * d) * BLOCK) / 2;
  const halfR = ((Math.abs(r.x) * w + Math.abs(r.z) * d) * BLOCK) / 2;
  const at = (base: { x: number; z: number }, fwd: number, right: number, y: number): Vec3 =>
    v(base.x + f.x * fwd + r.x * right, floor + y, base.z + f.z * fwd + r.z * right);
  const nora = (y: number): Vec3 => v(player.x, floor + y, player.z);

  const shots: Shot[] = [
    // Low in the far corner: the shaft cuts across the frame, Nora small and lit beyond it (key art).
    { eye: at(c, halfF * 0.29, -halfR * 0.72, Math.min(h * 0.27, 3.4)), look: at(player, 2, 3, 1.8) },
    // Past the shaft, close enough for the dust, outside the beam so the frame keeps its contrast.
    { eye: at(c, 0.5, halfR * 0.24, Math.min(h * 0.3, 3.8)), look: nora(1.25) },
    // Three-quarter front: she is looking up at the opening.
    { eye: at(player, 3.4, 2.4, 1.9), look: nora(1.45) },
    // Her right side, turning to go behind her.
    { eye: at(player, 0.5, 3.4, 1.8), look: nora(1.4) },
  ];
  return shots.map((s) => ({ eye: keepInside(level, s.eye, c, floor, ceil), look: s.look }));
}

/** Pulls a camera position towards the room centre until it is off walls and under the ceiling. */
function keepInside(level: Level, p: Vec3, c: { x: number; z: number }, floor: number, ceil: number): Vec3 {
  let q = { ...p, y: Math.min(ceil - 0.6, Math.max(floor + 0.4, p.y)) };
  for (let i = 0; i < 12; i++) {
    const s = level.sector(Math.floor(q.x / BLOCK), Math.floor(q.z / BLOCK));
    const margin = [
      [0.6, 0],
      [-0.6, 0],
      [0, 0.6],
      [0, -0.6],
    ].every(([dx = 0, dz = 0]) => {
      const n = level.sector(Math.floor((q.x + dx) / BLOCK), Math.floor((q.z + dz) / BLOCK));
      return n && !n.wall && q.y < n.ceil - 0.3 && q.y > Math.max(...n.floor) + 0.3;
    });
    if (s && !s.wall && margin) break;
    q = lerpV(q, v(c.x, q.y, c.z), 0.2);
  }
  return q;
}

/** The title-screen shot: the first key shot, breathing slowly. */
export function titleShot(first: Shot, time: number): Shot {
  const e = first.eye;
  const l = first.look;
  return {
    eye: v(
      e.x + Math.sin(time * 0.07) * 0.5,
      e.y + Math.sin(time * 0.05) * 0.2,
      e.z + Math.cos(time * 0.06) * 0.35,
    ),
    look: v(l.x + Math.sin(time * 0.04) * 0.3, l.y + Math.sin(time * 0.09) * 0.08, l.z),
  };
}

/** Uniform Catmull-Rom point on the segment p1–p2. */
function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const c = (a: number, b: number, d: number, e: number): number =>
    0.5 * (2 * b + (-a + d) * t + (2 * a - 5 * b + 4 * d - e) * t2 + (-a + 3 * b - 3 * d + e) * t3);
  return v(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z));
}

/**
 * A smooth path through shots. `sample(u)` takes u in [0, 1]; segment lengths
 * weight the timing so the camera keeps an even pace, and the last shot may
 * move (the orbit camera) while the path runs.
 */
export function samplePath(shots: readonly Shot[], u: number): Shot {
  const n = shots.length;
  const first = shots[0];
  if (!first || n === 1) return first ?? { eye: v(0, 0, 0), look: v(0, 0, 0) };
  const lengths: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = shots[i];
    const b = shots[i + 1];
    lengths.push(a && b ? dist(a.eye, b.eye) + 0.5 * dist(a.look, b.look) + 0.5 : 1);
  }
  const total = lengths.reduce((s, l) => s + l, 0);
  let d = Math.min(1, Math.max(0, u)) * total;
  let i = 0;
  while (i < lengths.length - 1 && d > (lengths[i] ?? 0)) d -= lengths[i++] ?? 0;
  const t = Math.min(1, d / (lengths[i] ?? 1));
  const get = (k: number): Shot => shots[Math.min(n - 1, Math.max(0, k))] ?? first;
  const [s0, s1, s2, s3] = [get(i - 1), get(i), get(i + 1), get(i + 2)];
  return {
    eye: catmull(s0.eye, s1.eye, s2.eye, s3.eye, t),
    look: catmull(s0.look, s1.look, s2.look, s3.look, t),
  };
}
