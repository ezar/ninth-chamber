/**
 * Water modes (spec §5.10 "Agua"): swimming at the surface and diving, plus
 * the hooks the ground and air modes call for wading, slipping into water,
 * splashing in and soft landings.
 *
 * Reference heights: at the surface the feet reference sits `surfaceSink`
 * under the water (head and shoulders out). The body in the water is a box
 * from `bodyLow` to `bodyHigh` above the feet reference, the same at the
 * surface and underwater, so surfacing and diving never jump.
 *
 * Controls: the stick swims (camera-relative, like the ground); underwater
 * Jump swims up and Walk swims down, and the body pitches along the swim
 * direction. At the surface Walk dives, and Jump or Action climbs out onto
 * an edge up to one click above the water. Roll turns round, also in water.
 */
import { distanceToEdge, supportHeight, sweep, type GridQuery } from '../../grid/collision';
import { BLOCK, DIR_VEC, wrapAngle, yawToDir } from '../../grid/units';
import { waterDepth, waterSurface } from '../../actors/water';
import { emit, faceDir, hurt, setMode, wishAlong, type Ctx } from '../context';
import { swimming as S, tuning } from '../tuning';

const cellOf = (m: number): number => Math.floor(m / BLOCK);

interface WaterHere {
  surface: number | null;
  depth: number;
  floor: number;
}

/** The water over the player's cell. */
function here(c: Ctx): WaterHere {
  const cx = cellOf(c.p.pos.x);
  const cz = cellOf(c.p.pos.z);
  return {
    surface: waterSurface(c.world, cx, cz),
    depth: waterDepth(c.world, cx, cz),
    floor: c.q.cellFloor(cx, cz),
  };
}

/** Lowest ceiling over the body's footprint. */
function ceilOver(q: GridQuery, x: number, z: number, r: number): number {
  let h = Infinity;
  for (let cx = cellOf(x - r + 1e-4); cx <= cellOf(x + r - 1e-4); cx++) {
    for (let cz = cellOf(z - r + 1e-4); cz <= cellOf(z + r - 1e-4); cz++) h = Math.min(h, q.cellCeil(cx, cz));
  }
  return h;
}

// ───────────────────────────── Hooks for the other modes ─────────────────────────────

/** Where a walker may step without "dropping": the floor, or water over it (walking slips into water). */
export function walkTop(c: Ctx, cx: number, cz: number): number {
  const floor = c.q.cellFloor(cx, cz);
  if (waterDepth(c.world, cx, cz) <= 0) return floor;
  return Math.max(floor, waterSurface(c.world, cx, cz) ?? floor);
}

/** Ground speed, capped while wading. */
export function wadeSpeed(c: Ctx, speed: number, walk: boolean): number {
  const { depth } = here(c);
  if (depth < S.wadeDepth) return speed;
  return Math.min(speed, walk ? S.wadeWalkSpeed : S.wadeSpeed);
}

/** Ground mode: water too deep to stand in (it rose, or she walked in) floats Nora. */
export function floatInDeepWater(c: Ctx): boolean {
  const { surface, depth } = here(c);
  if (surface === null || depth < S.swimDepth || c.p.pos.y > surface) return false;
  startSwim(c);
  return true;
}

/** Air mode: splashes into water; deep water takes over from the fall. `y0` is the feet height before this tick. */
export function enterWaterFromAir(c: Ctx, y0: number): boolean {
  const { p } = c;
  const { surface, depth } = here(c);
  if (surface === null || depth <= 0 || p.pos.y > surface) return false;
  const vy = p.vel.y;
  if (y0 > surface) {
    emit(c, 'player.splash', {
      speed: -vy,
      deep: depth >= S.swimDepth,
      x: p.pos.x,
      y: surface,
      z: p.pos.z,
    });
  }
  if (depth < S.swimDepth) return false;
  p.vel.x *= 0.5;
  p.vel.z *= 0.5;
  p.jumped = false;
  if (vy < -S.plunge) {
    // A plunge: under the surface first, then up again.
    p.vel.y = Math.max(vy * 0.35, -4.5);
    p.swim.pitch = -1.2;
    p.swim.roll = 0;
    setMode(p, 'dive');
  } else {
    startSwim(c);
  }
  return true;
}

/** A landing in water at least `safeDepth` deep does no damage from any height. */
export function softLanding(c: Ctx): boolean {
  return here(c).depth >= S.safeDepth;
}

/** Air refills out of the water; underwater it runs down, then drowning hurts every second. */
export function breathe(c: Ctx): void {
  const { p, dt } = c;
  const s = p.swim;
  if (p.mode === 'dead') return;
  if (p.mode !== 'dive') {
    s.drown = 0;
    s.air = Math.min(S.airMax, s.air + S.airRefill * dt);
    return;
  }
  s.air = Math.max(0, s.air - dt);
  if (s.air > 1e-9) return;
  s.air = 0;
  s.drown += dt;
  if (s.drown >= S.drownInterval - 1e-9) {
    s.drown -= S.drownInterval;
    emit(c, 'player.drowning', { health: Math.max(0, p.health - S.drownDamage) });
    hurt(c, S.drownDamage, 'drown');
  }
}

// ───────────────────────────── Shared ─────────────────────────────

function startSwim(c: Ctx): void {
  const { p } = c;
  p.vel.y = 0;
  p.swim.roll = 0;
  p.swim.pitch = 0;
  p.runTime = 0;
  p.jumped = false;
  setMode(p, 'swim');
}

/** Stands up on the floor of shallow water, if there is headroom. */
function stand(c: Ctx, floor: number): boolean {
  const { p, q } = c;
  if (!Number.isFinite(floor)) return false;
  if (ceilOver(q, p.pos.x, p.pos.z, tuning.radius) - floor < tuning.height) return false;
  p.pos.y = floor;
  p.vel.y = 0;
  p.swim.roll = 0;
  p.swim.pitch = 0;
  setMode(p, 'ground');
  emit(c, 'player.stood');
  return true;
}

/** The water went away under her: fall. */
function fall(c: Ctx): void {
  const { p } = c;
  p.vel.y = 0;
  p.fallFrom = p.pos.y;
  p.airSpeedCap = Math.max(Math.hypot(p.vel.x, p.vel.z), tuning.airControlMinCap);
  p.jumped = false;
  setMode(p, 'air');
}

/** A roll in the water: a quick 180° turn. True while it runs. */
function roll(c: Ctx): boolean {
  const { p, dt } = c;
  const s = p.swim;
  if (s.roll <= 0 && c.pressed('roll')) {
    s.roll = S.rollTime;
    emit(c, 'player.rolled', { water: true });
  }
  if (s.roll <= 0) return false;
  const step = Math.min(s.roll, dt);
  p.yaw = wrapAngle(p.yaw + (Math.PI * step) / S.rollTime);
  s.roll = Math.max(0, s.roll - step);
  const k = Math.exp(-6 * dt);
  p.vel.x *= k;
  p.vel.z *= k;
  if (p.mode === 'dive') p.vel.y *= k;
  return true;
}

function turn(c: Ctx): void {
  if (c.wish.mag < 0.05) return;
  const target = Math.atan2(-c.wish.x, -c.wish.z);
  const diff = wrapAngle(target - c.p.yaw);
  const max = S.swimTurn * c.dt;
  c.p.yaw = wrapAngle(c.p.yaw + Math.max(-max, Math.min(max, diff)));
}

function stroke(c: Ctx, d: number, under: boolean): void {
  const s = c.p.swim;
  s.stroke += d;
  if (s.stroke >= S.strokeDistance) {
    s.stroke = 0;
    emit(c, 'player.stroke', { under });
  }
}

/** Swim sideways by the velocity, colliding the body box; returns the distance moved. */
function moveBody(c: Ctx, bodyY: number): number {
  const { p, q, dt } = c;
  const res = sweep(
    q,
    { x: p.pos.x, z: p.pos.z, y: bodyY + S.bodyLow, radius: tuning.radius, height: S.bodyHigh - S.bodyLow },
    p.vel.x * dt,
    p.vel.z * dt,
    0,
  );
  if (res.hitX) p.vel.x = 0;
  if (res.hitZ) p.vel.z = 0;
  const d = Math.hypot(res.x - p.pos.x, res.z - p.pos.z);
  p.pos.x = res.x;
  p.pos.z = res.z;
  return d;
}

// ───────────────────────────── Surface ─────────────────────────────

/** Climbing out onto an edge up to one click above the water, facing it (Jump, or Action held). */
function tryClimbOut(c: Ctx, surface: number): boolean {
  const { p, q } = c;
  if (!c.pressed('jump') && !c.held('action')) return false;
  const dir = yawToDir(p.yaw);
  if (c.wish.mag > 0.3 && wishAlong(c, dir) < 0) return false;
  const cx = cellOf(p.pos.x);
  const cz = cellOf(p.pos.z);
  const v = DIR_VEC[dir];
  const nx = cx + v.x;
  const nz = cz + v.z;
  const top = q.cellFloor(nx, nz);
  if (!Number.isFinite(top)) return false;
  if (top > surface + S.climbOutAbove + 1e-3 || top < surface - S.climbOutBelow - 1e-3) return false;
  if (q.cellCeil(nx, nz) - top < tuning.height) return false;
  if (distanceToEdge(p.pos.x, p.pos.z, dir) - tuning.radius > S.climbOutReach) return false;
  // End standing a little inside the edge sector, like a climb from a hang.
  const to = { x: p.pos.x, y: top, z: p.pos.z };
  if (v.x !== 0) {
    to.x = v.x > 0 ? nx * BLOCK + 0.5 : (nx + 1) * BLOCK - 0.5;
    to.z = Math.min(Math.max(to.z, nz * BLOCK + tuning.radius), (nz + 1) * BLOCK - tuning.radius);
  } else {
    to.z = v.z > 0 ? nz * BLOCK + 0.5 : (nz + 1) * BLOCK - 0.5;
    to.x = Math.min(Math.max(to.x, nx * BLOCK + tuning.radius), (nx + 1) * BLOCK - tuning.radius);
  }
  p.move = { from: { ...p.pos }, to, duration: S.climbOutTime };
  p.vel = { x: 0, y: 0, z: 0 };
  p.ledge = { dir, cx: nx, cz: nz, y: top };
  p.swim.roll = 0;
  faceDir(p, dir);
  setMode(p, 'climb');
  emit(c, 'player.climbing', { water: true });
  return true;
}

export function swim(c: Ctx): void {
  const { p, dt } = c;
  const { surface, depth, floor } = here(c);
  if (surface === null || depth <= 0) {
    fall(c);
    return;
  }
  if (depth < S.swimDepth && stand(c, floor)) return;

  // Settle at the surface after a splash, then ride it as a gate moves the water.
  const rest = surface - S.surfaceSink;
  const dy = rest - p.pos.y;
  const settle = Math.max(Math.abs(dy) * 8, 1) * dt;
  p.pos.y = Math.abs(dy) <= settle ? rest : p.pos.y + Math.sign(dy) * settle;
  p.vel.y = 0;

  if (roll(c)) {
    moveBody(c, rest);
    return;
  }
  if (tryClimbOut(c, surface)) return;
  if (c.pressed('walk')) {
    p.vel.y = -S.duckDive;
    p.swim.pitch = -0.6;
    setMode(p, 'dive');
    emit(c, 'player.dived');
    return;
  }

  const k = Math.min(1, S.swimAccel * dt);
  p.vel.x += (c.wish.x * S.swimSpeed - p.vel.x) * k;
  p.vel.z += (c.wish.z * S.swimSpeed - p.vel.z) * k;
  turn(c);
  stroke(c, moveBody(c, rest), false);
}

// ───────────────────────────── Underwater ─────────────────────────────

export function dive(c: Ctx): void {
  const { p, q, dt } = c;
  const { surface, depth, floor } = here(c);
  if (surface === null || depth <= 0) {
    fall(c);
    return;
  }

  const rolling = roll(c);
  if (!rolling) {
    const up = (c.held('jump') ? 1 : 0) - (c.held('walk') ? 1 : 0);
    const m = Math.hypot(c.wish.x, up, c.wish.z);
    let tx = 0;
    let ty = S.buoyancy;
    let tz = 0;
    if (m > 0.05) {
      const s = (S.diveSpeed * Math.min(1, m)) / m;
      tx = c.wish.x * s;
      ty = up * s;
      tz = c.wish.z * s;
    }
    const k = Math.min(1, S.diveAccel * dt);
    p.vel.x += (tx - p.vel.x) * k;
    p.vel.y += (ty - p.vel.y) * k;
    p.vel.z += (tz - p.vel.z) * k;
    turn(c);
  }

  // The body pitches along the swim direction (head up when rising, down when diving).
  const h = Math.hypot(p.vel.x, p.vel.z);
  const want = Math.hypot(h, p.vel.y) > 0.3 ? Math.max(-1.35, Math.min(1.35, Math.atan2(p.vel.y, h))) : 0;
  p.swim.pitch += (want - p.swim.pitch) * Math.min(1, 5 * dt);

  const moved = moveBody(c, p.pos.y);
  let y = p.pos.y + p.vel.y * dt;
  const bottom = supportHeight(q, p.pos.x, p.pos.z, tuning.radius);
  if (y + S.bodyLow < bottom) {
    y = bottom - S.bodyLow;
    p.vel.y = Math.max(0, p.vel.y);
  }
  const ceil = ceilOver(q, p.pos.x, p.pos.z, tuning.radius);
  if (y + S.bodyHigh > ceil) {
    y = ceil - S.bodyHigh;
    p.vel.y = Math.min(0, p.vel.y);
  }
  stroke(c, Math.hypot(moved, y - p.pos.y), true);
  p.pos.y = y;

  // Shallows: stand up.
  if (depth < S.swimDepth && stand(c, floor)) return;

  // Surfacing: the head reaches the surface where there is air above it.
  const rest = surface - S.surfaceSink;
  const air = ceil >= surface + (S.bodyHigh - S.surfaceSink) - 1e-6;
  if (air && y >= rest - 1e-6 && p.vel.y > -0.05 && p.modeTime > 0.25) {
    p.pos.y = rest;
    p.vel.y = 0;
    p.swim.pitch = 0;
    const deep = 1 - p.swim.air / S.airMax;
    setMode(p, 'swim');
    emit(c, 'player.surfaced', { x: p.pos.x, y: surface, z: p.pos.z });
    if (p.swim.air < S.airMax * S.gaspBelow) emit(c, 'player.breath', { deep });
  }
}
