/** Ground mode: run, walk, step up and down, start jumps and interactions. */
import { distanceToEdge, supportHeight, sweep } from '../../grid/collision';
import { BLOCK, DIR_VEC, OPPOSITE, cellCenter, yawToDir, yawVec } from '../../grid/units';
import { useMechanism } from '../../mechanisms';
import { blockAt } from '../../world';
import { die, emit, faceDir, setMode, turnTowardsWish, wishAlong, type Ctx } from '../context';
import { tryLightTorch } from '../torch';
import { windAt } from '../../mechanisms/wind';
import { tuning, wind as windTuning } from '../tuning';
import { startHang } from './hang';
import { floatInDeepWater, wadeSpeed, walkTop } from './swim';
import { tryGetOnWall } from './wall';

export function ground(c: Ctx): void {
  const { p, q, dt } = c;
  const walk = c.held('walk');
  const action = c.held('action');
  if (floatInDeepWater(c)) return;

  if (c.pressed('action') && (tryInteract(c) || useMechanism(c) || tryGetOnWall(c))) return;
  if (action && tryGrabBlock(c)) return;
  if (walk && action && tryDropToHang(c)) return;

  if (p.sinceJumpPressed <= tuning.jumpBuffer) {
    jump(c);
    return;
  }

  const speed = wadeSpeed(c, walk ? tuning.walkSpeed : tuning.runSpeed, walk);
  const k = Math.min(1, tuning.accel * dt);
  p.vel.x += (c.wish.x * speed - p.vel.x) * k;
  p.vel.z += (c.wish.z * speed - p.vel.z) * k;
  // Walking with Action held backs up without turning, to drop and hang from edges.
  if (!(walk && action)) turnTowardsWish(c);

  const hspeed = Math.hypot(p.vel.x, p.vel.z);
  p.runTime = !walk && hspeed > tuning.runSpeed * 0.8 ? p.runTime + dt : 0;

  const feet = p.pos.y;
  // Walking never drops off an edge higher than one click (it slips into water that close, though).
  const canEnter = walk
    ? (cx: number, cz: number): boolean => walkTop(c, cx, cz) >= feet - 0.5 - 1e-3
    : undefined;
  const res = sweep(
    q,
    { x: p.pos.x, z: p.pos.z, y: feet, radius: tuning.radius, height: tuning.height },
    p.vel.x * dt,
    p.vel.z * dt,
    tuning.stepUp,
    canEnter,
  );
  if (res.hitX) p.vel.x = 0;
  if (res.hitZ) p.vel.z = 0;
  if (walk) {
    // The box may already overhang a drop (e.g. after a landing); the centre still never crosses it.
    const drop = (x: number, z: number): boolean =>
      walkTop(c, Math.floor(x / BLOCK), Math.floor(z / BLOCK)) < feet - 0.5 - 1e-3;
    if (drop(res.x, p.pos.z)) {
      res.x = p.pos.x;
      p.vel.x = 0;
    }
    if (drop(res.x, res.z)) {
      res.z = p.pos.z;
      p.vel.z = 0;
    }
  }
  p.pos.x = res.x;
  p.pos.z = res.z;
  pushByWind(c, feet);

  const floor = q.floorAt(p.pos.x, p.pos.z);
  const support = Math.max(floor, supportHeight(q, p.pos.x, p.pos.z, 0.05));
  if (support >= feet - tuning.stepDown) {
    p.pos.y = support;
  } else {
    setMode(p, 'air');
    p.vel.y = 0;
    p.airSpeedCap = Math.max(hspeed, tuning.airControlMinCap);
    p.jumped = false;
    p.fallFrom = feet;
    p.sinceGround = 0;
    return;
  }

  const sector = c.world.level.sector(Math.floor(p.pos.x / BLOCK), Math.floor(p.pos.z / BLOCK));
  if (sector?.flags.has('death') && Math.abs(p.pos.y - floor) < 0.05) die(c, 'spikes');
}

/** A gust pushes her along the floor, but never off an edge (spec §19, chamber VII). */
function pushByWind(c: Ctx, feet: number): void {
  const { p, q, dt } = c;
  const w = windAt(c.world, p.pos.x, p.pos.z);
  if (w.x === 0 && w.z === 0) return;
  const k = windTuning.ground * dt;
  const res = sweep(
    q,
    { x: p.pos.x, z: p.pos.z, y: feet, radius: tuning.radius, height: tuning.height },
    w.x * k,
    w.z * k,
    tuning.stepUp,
    (cx, cz) => walkTop(c, cx, cz) >= feet - tuning.stepDown,
  );
  const drop = (x: number, z: number): boolean =>
    walkTop(c, Math.floor(x / BLOCK), Math.floor(z / BLOCK)) < feet - tuning.stepDown;
  if (!drop(res.x, p.pos.z)) p.pos.x = res.x;
  if (!drop(p.pos.x, res.z)) p.pos.z = res.z;
}

/** Starts a jump: vertical when still, standing or running forward otherwise. */
export function jump(c: Ctx): void {
  const { p } = c;
  p.sinceJumpPressed = Infinity;
  let kind: string;
  if (c.wish.mag < 0.2) {
    p.vel.x = 0;
    p.vel.z = 0;
    kind = 'up';
  } else if (p.runTime >= tuning.runJumpMinTime) {
    const f = yawVec(p.yaw);
    const s = Math.max(Math.hypot(p.vel.x, p.vel.z), tuning.runSpeed);
    p.vel.x = f.x * s;
    p.vel.z = f.z * s;
    kind = 'running';
  } else {
    p.yaw = Math.atan2(-c.wish.x, -c.wish.z);
    p.vel.x = (c.wish.x / c.wish.mag) * tuning.standJumpSpeed;
    p.vel.z = (c.wish.z / c.wish.mag) * tuning.standJumpSpeed;
    kind = 'forward';
  }
  p.vel.y = tuning.jumpSpeed;
  p.airSpeedCap = Math.max(Math.hypot(p.vel.x, p.vel.z), tuning.airControlMinCap);
  p.jumped = true;
  p.fallFrom = p.pos.y;
  p.runTime = 0;
  setMode(p, 'air');
  emit(c, 'player.jumped', { kind });
}

/** Levers, pickups and journal notes in the player's sector, then a brazier to light the torch at. */
function tryInteract(c: Ctx): boolean {
  const { p, world } = c;
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  for (const a of world.state.actors) {
    if (a.cx !== cx || a.cz !== cz) continue;
    if (a.kind === 'lever' && !a.used) {
      faceDir(p, a.wall);
      p.vel = { x: 0, y: 0, z: 0 };
      p.target = a.id;
      setMode(p, 'lever');
      return true;
    }
    if (
      ((a.kind === 'secret' || a.kind === 'relic' || a.kind === 'torch') && !a.taken) ||
      a.kind === 'note'
    ) {
      p.vel = { x: 0, y: 0, z: 0 };
      p.target = a.id;
      setMode(p, 'pickup');
      return true;
    }
  }
  return tryLightTorch(c);
}

/** Grabs a block right in front of the player. */
function tryGrabBlock(c: Ctx): boolean {
  const { p, world } = c;
  const dir = yawToDir(p.yaw);
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  const v = DIR_VEC[dir];
  const block = blockAt(world, cx + v.x, cz + v.z);
  if (!block || Math.abs(block.y - p.pos.y) > 0.05) return false;
  if (distanceToEdge(p.pos.x, p.pos.z, dir) > tuning.radius + 0.3) return false;
  // Snap to the centre line of the sector, against the block.
  const gap = tuning.radius + 0.02;
  if (v.x !== 0) {
    p.pos.z = cellCenter(cz);
    p.pos.x = v.x > 0 ? (cx + 1) * BLOCK - gap : cx * BLOCK + gap;
  } else {
    p.pos.x = cellCenter(cx);
    p.pos.z = v.z > 0 ? (cz + 1) * BLOCK - gap : cz * BLOCK + gap;
  }
  faceDir(p, dir);
  p.vel = { x: 0, y: 0, z: 0 };
  p.target = block.id;
  p.dir = dir;
  setMode(p, 'block');
  emit(c, 'player.grabbedBlock', { id: block.id });
  return true;
}

/** Walking backwards off an edge with Action held drops into a hang (spec §5.5). */
function tryDropToHang(c: Ctx): boolean {
  const { p, q } = c;
  const facing = yawToDir(p.yaw);
  const back = OPPOSITE[facing];
  if (wishAlong(c, back) < 0.5) return false;
  if (distanceToEdge(p.pos.x, p.pos.z, back) > tuning.radius + 0.05) return false;
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  const bv = DIR_VEC[back];
  const below = q.cellFloor(cx + bv.x, cz + bv.z);
  if (!Number.isFinite(below) || below > p.pos.y - tuning.handHeight) return false;
  const y = q.cellFloor(cx, cz);
  const edge = { x: p.pos.x, z: p.pos.z };
  if (bv.x !== 0) edge.x = bv.x > 0 ? (cx + 1) * BLOCK : cx * BLOCK;
  else edge.z = bv.z > 0 ? (cz + 1) * BLOCK : cz * BLOCK;
  startHang(
    c,
    { dir: facing, cx, cz, y },
    edge.x + bv.x * (tuning.radius + 0.02),
    edge.z + bv.z * (tuning.radius + 0.02),
  );
  return true;
}
