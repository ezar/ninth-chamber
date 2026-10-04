/**
 * Wall mode (spec §5 "Escalar paredes", §19 chamber V): climbing a face of
 * roots up, down and sideways. A sector flag `climb<D>` marks the face of
 * that sector looking towards D, and a grown tangle of roots is climbable on
 * every side. Nora faces the other way, `p.dir`, while on
 * it. At the top she hangs from its edge, at the bottom she steps off, and a
 * jump takes her back off the face.
 */
import { blocks, distanceToEdge } from '../../grid/collision';
import { sectorTop } from '../../grid/level';
import type { SectorFlag } from '../../grid/schema';
import { BLOCK, DIR_VEC, OPPOSITE, RIGHT_OF, yawToDir, type Dir } from '../../grid/units';
import { tangleAt } from '../../mechanisms/tangles';
import { tearingGust } from '../../mechanisms/wind';
import type { World } from '../../world';
import { emit, faceDir, setMode, wishAlong, type Ctx } from '../context';
import { tuning, wallClimb as W, wind as windTuning } from '../tuning';
import { startHang } from './hang';

const FLAG: Record<Dir, SectorFlag> = { N: 'climbN', E: 'climbE', S: 'climbS', W: 'climbW' };

/** Whether the face of a cell that looks towards `look` can be climbed. */
export function climbableFace(world: World, cx: number, cz: number, look: Dir): boolean {
  // A grown tangle of roots is climbable on every side.
  return (world.level.sector(cx, cz)?.flags.has(FLAG[look]) ?? false) || tangleAt(world, cx, cz) !== null;
}

/**
 * Top of a climbable face (m): a grown tangle's top, or the sector's own top
 * (its ceiling for solid rock). Static geometry only: a block, door or
 * platform in the cell adds no handholds.
 */
function faceTop(world: World, cx: number, cz: number): number {
  const roots = tangleAt(world, cx, cz);
  if (roots) return roots.top;
  const s = world.level.sector(cx, cz);
  if (!s) return -Infinity;
  return s.wall ? s.ceil : sectorTop(s);
}

/** The cell in front of a point, looking `dir`. */
function cellAhead(x: number, z: number, dir: Dir): { cx: number; cz: number } {
  const v = DIR_VEC[dir];
  return { cx: Math.floor(x / BLOCK) + v.x, cz: Math.floor(z / BLOCK) + v.z };
}

/** A climbable face in front of her, within reach and tall enough to climb (not just a ledge). */
function faceAhead(world: World, dir: Dir): boolean {
  const p = world.state.player;
  const w = cellAhead(p.pos.x, p.pos.z, dir);
  if (!climbableFace(world, w.cx, w.cz, OPPOSITE[dir])) return false;
  if (distanceToEdge(p.pos.x, p.pos.z, dir) - tuning.radius > W.reach) return false;
  return faceTop(world, w.cx, w.cz) - (p.pos.y + tuning.handHeight) >= W.minAbove;
}

/** She stands facing a face she can get on with Action (the HUD prompts it). */
export function wallInReach(world: World): boolean {
  const p = world.state.player;
  return p.mode === 'ground' && faceAhead(world, yawToDir(p.yaw));
}

function startWall(c: Ctx, dir: Dir, y: number): void {
  const { p } = c;
  const v = DIR_VEC[dir];
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  const gap = tuning.radius + W.gap;
  if (v.x !== 0) p.pos.x = v.x > 0 ? (cx + 1) * BLOCK - gap : cx * BLOCK + gap;
  else p.pos.z = v.z > 0 ? (cz + 1) * BLOCK - gap : cz * BLOCK + gap;
  p.pos.y = y;
  p.vel = { x: 0, y: 0, z: 0 };
  p.dir = dir;
  p.ledge = null;
  p.jumped = false;
  faceDir(p, dir);
  setMode(p, 'wall');
  emit(c, 'player.onWall', { y });
}

/** From the floor: Action facing a climbable face. */
export function tryGetOnWall(c: Ctx): boolean {
  const dir = yawToDir(c.p.yaw);
  if (!faceAhead(c.world, dir)) return false;
  startWall(c, dir, c.p.pos.y + W.lift);
  return true;
}

/** From a jump or a fall: Action held (or the auto-grab after a jump), facing a climbable face. */
export function tryCatchWall(c: Ctx): boolean {
  const { p } = c;
  if (p.sinceRelease < tuning.regrabDelay) return false;
  if (!c.held('action') && !p.jumped) return false;
  const dir = yawToDir(p.yaw);
  if (!faceAhead(c.world, dir)) return false;
  if (p.pos.y <= c.q.floorAt(p.pos.x, p.pos.z) + 0.05) return false;
  startWall(c, dir, p.pos.y);
  return true;
}

/** From the top edge: pulling back while hanging puts her on the face below it, if it is climbable. */
export function tryWallFromLedge(c: Ctx): boolean {
  const { p } = c;
  const ledge = p.ledge;
  if (!ledge || !climbableFace(c.world, ledge.cx, ledge.cz, OPPOSITE[ledge.dir])) return false;
  startWall(c, ledge.dir, p.pos.y - W.fromLedge);
  return true;
}

export function wall(c: Ctx): void {
  const { p } = c;
  const dir = p.dir;
  if (!dir) {
    letGo(c);
    return;
  }
  const w = cellAhead(p.pos.x, p.pos.z, dir);
  // The face can go (a tangle shrinking from the torch takes its handholds away).
  if (!climbableFace(c.world, w.cx, w.cz, OPPOSITE[dir])) {
    letGo(c);
    return;
  }
  // A tearing gust that has blown on her long enough pulls her off, as from a ledge.
  const gust = p.modeTime >= windTuning.grip ? tearingGust(c.world, p.pos.x, p.pos.z) : null;
  if (gust) {
    letGo(c);
    p.vel.x += gust.x * windTuning.throw;
    p.vel.z += gust.z * windTuning.throw;
    emit(c, 'player.torn');
    return;
  }
  if (c.pressed('action')) {
    letGo(c);
    return;
  }
  if (c.pressed('jump')) {
    jumpBack(c, dir);
    return;
  }
  const vert = wishAlong(c, dir);
  const side = wishAlong(c, RIGHT_OF[dir]);
  // The stronger axis wins, so a diagonal stick does not drift.
  if (Math.abs(vert) >= Math.abs(side)) {
    if (vert > 0.3) climbUp(c, dir, w, vert);
    else if (vert < -0.3) climbDown(c, vert);
  } else if (Math.abs(side) > 0.3) climbSide(c, dir, Math.sign(side));
}

function climbUp(c: Ctx, dir: Dir, w: { cx: number; cz: number }, k: number): void {
  const { p, q } = c;
  const top = faceTop(c.world, w.cx, w.cz);
  let y = p.pos.y + k * W.up * c.dt;
  if (y + tuning.handHeight >= top) {
    // The top edge: she hangs from it if it can be held, and stops below it otherwise.
    if (q.grabbable(w.cx, w.cz) && q.cellCeil(w.cx, w.cz) - top >= 0.6) {
      p.dir = null;
      startHang(c, { dir, cx: w.cx, cz: w.cz, y: top }, p.pos.x, p.pos.z);
      return;
    }
    y = top - tuning.handHeight;
  }
  const ceil = q.cellCeil(Math.floor(p.pos.x / BLOCK), Math.floor(p.pos.z / BLOCK));
  p.pos.y = Math.max(p.pos.y, Math.min(y, ceil - tuning.height));
}

function climbDown(c: Ctx, k: number): void {
  const { p, q } = c;
  const floor = q.floorAt(p.pos.x, p.pos.z);
  const y = p.pos.y + k * W.down * c.dt;
  if (y > floor) {
    p.pos.y = y;
    return;
  }
  p.pos.y = floor;
  p.dir = null;
  setMode(p, 'ground');
  emit(c, 'player.offWall');
}

function climbSide(c: Ctx, dir: Dir, sign: number): void {
  const { p, q } = c;
  const sv = DIR_VEC[RIGHT_OF[dir]];
  const step = sign * W.side * c.dt;
  const nx = p.pos.x + sv.x * step;
  const nz = p.pos.z + sv.z * step;
  // The face must continue under the leading hand, as high as her hands.
  const lx = nx + sv.x * sign * tuning.radius;
  const lz = nz + sv.z * sign * tuning.radius;
  const w = cellAhead(lx, lz, dir);
  if (!climbableFace(c.world, w.cx, w.cz, OPPOSITE[dir])) return;
  if (faceTop(c.world, w.cx, w.cz) < p.pos.y + tuning.handHeight) return;
  // And her body must fit in the cell it moves into.
  if (blocks(q, Math.floor(lx / BLOCK), Math.floor(lz / BLOCK), p.pos.y, tuning.height, 0)) return;
  p.pos.x = nx;
  p.pos.z = nz;
}

/** A jump back off the face: she turns round in the air, ready to catch what is behind her. */
function jumpBack(c: Ctx, dir: Dir): void {
  const { p } = c;
  const v = DIR_VEC[dir];
  p.vel = { x: -v.x * W.backSpeed, y: tuning.jumpSpeed * W.backLift, z: -v.z * W.backSpeed };
  faceDir(p, OPPOSITE[dir]);
  p.airSpeedCap = W.backSpeed;
  p.jumped = true;
  p.fallFrom = p.pos.y;
  p.sinceRelease = 0;
  p.sinceJumpPressed = Infinity;
  p.dir = null;
  setMode(p, 'air');
  emit(c, 'player.jumped', { kind: 'wall' });
}

function letGo(c: Ctx): void {
  const { p } = c;
  const back = p.dir ? DIR_VEC[p.dir] : { x: 0, z: 0 };
  p.vel = { x: -back.x * 0.4, y: 0, z: -back.z * 0.4 };
  p.airSpeedCap = tuning.airControlMinCap;
  p.fallFrom = p.pos.y;
  p.sinceRelease = 0;
  p.jumped = false;
  p.dir = null;
  setMode(p, 'air');
  emit(c, 'player.letGo');
}
