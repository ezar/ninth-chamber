/** Block, push, pull, lever, pickup and dead modes. */
import { blocks } from '../../grid/collision';
import { BLOCK, DIR_VEC } from '../../grid/units';
import { setSignal } from '../../logic/rules';
import { blockAt, findActor, floorWith, respawn } from '../../world';
import { emit, setMode, wishAlong, type Ctx } from '../context';
import { mechanics, tuning } from '../tuning';

/** Holding a block, waiting for push or pull input. */
export function block(c: Ctx): void {
  const { p, q, world } = c;
  const b = p.target ? findActor(world, p.target, 'block') : undefined;
  if (!b || !p.dir || !c.held('action')) {
    release(c);
    return;
  }
  const dir = p.dir;
  const v = DIR_VEC[dir];
  const fwd = wishAlong(c, dir);

  if (fwd > 0.5) {
    const dx = b.cx + v.x;
    const dz = b.cz + v.z;
    const dest = floorWith(world, dx, dz, null);
    const ok =
      Number.isFinite(dest) &&
      dest <= b.y + 1e-3 &&
      !blockAt(world, dx, dz) &&
      q.cellCeil(dx, dz) - b.y >= mechanics.blockHeight;
    if (ok) {
      startMove(c, b.id, dx, dz, tuning.pushTime, 'push');
      return;
    }
  } else if (fwd < -0.5) {
    const pcx = Math.floor(p.pos.x / BLOCK);
    const pcz = Math.floor(p.pos.z / BLOCK);
    const bx = pcx - v.x;
    const bz = pcz - v.z;
    const behind = q.cellFloor(bx, bz);
    const ok =
      Math.abs(behind - p.pos.y) < 1e-3 &&
      !blocks(q, bx, bz, p.pos.y, tuning.height, 0) &&
      !blockAt(world, bx, bz);
    if (ok) {
      startMove(c, b.id, pcx, pcz, tuning.pullTime, 'pull');
      return;
    }
  }
}

function startMove(
  c: Ctx,
  id: string,
  toCx: number,
  toCz: number,
  duration: number,
  mode: 'push' | 'pull',
): void {
  const { p, world } = c;
  const b = findActor(world, id, 'block');
  if (!b || !p.dir) return;
  const v = DIR_VEC[p.dir];
  const sign = mode === 'push' ? 1 : -1;
  b.from = { cx: b.cx, cz: b.cz };
  b.cx = toCx;
  b.cz = toCz;
  b.t = 0;
  p.move = {
    from: { ...p.pos },
    to: { x: p.pos.x + v.x * BLOCK * sign, y: p.pos.y, z: p.pos.z + v.z * BLOCK * sign },
    duration,
  };
  setMode(p, mode);
  emit(c, 'block.moving', { id, mode });
}

/** Push and pull: the player and the block slide one sector together. */
export function moveBlock(c: Ctx): void {
  const { p, world } = c;
  const b = p.target ? findActor(world, p.target, 'block') : undefined;
  const m = p.move;
  if (!b || !m) {
    release(c);
    return;
  }
  const t = Math.min(1, p.modeTime / m.duration);
  b.t = t;
  p.pos.x = m.from.x + (m.to.x - m.from.x) * t;
  p.pos.z = m.from.z + (m.to.z - m.from.z) * t;
  if (t < 1) return;

  b.from = null;
  b.t = 0;
  p.move = null;
  emit(c, 'block.moved', { id: b.id });
  const floor = floorWith(world, b.cx, b.cz, b.id);
  if (floor < b.y - 1e-3) {
    b.fallTo = floor;
    emit(c, 'block.falling', { id: b.id });
    release(c);
    return;
  }
  setMode(p, c.held('action') ? 'block' : 'ground');
  if (p.mode === 'ground') release(c);
}

function release(c: Ctx): void {
  c.p.target = null;
  c.p.dir = null;
  c.p.move = null;
  setMode(c.p, 'ground');
}

/** Pulling a lever: it triggers halfway through the animation. */
export function lever(c: Ctx): void {
  const { p, world } = c;
  const l = p.target ? findActor(world, p.target, 'lever') : undefined;
  if (l && !l.used && p.modeTime >= tuning.leverTime / 2) {
    l.used = true;
    setSignal(world, `${l.id}.used`, true);
    emit(c, 'lever.pulled', { id: l.id });
  }
  if (p.modeTime >= tuning.leverTime) release(c);
}

/** Crouching to pick up a secret or the relic. */
export function pickup(c: Ctx): void {
  const { p, world } = c;
  const a = world.state.actors.find((x) => x.id === p.target);
  if (a && (a.kind === 'secret' || a.kind === 'relic') && !a.taken && p.modeTime >= tuning.pickupTime / 2) {
    a.taken = true;
    setSignal(world, `${a.id}.taken`, true);
    if (a.kind === 'secret') {
      world.stats.secrets++;
      emit(c, 'secret.found', { id: a.id, idol: a.variant });
    } else {
      emit(c, 'relic.taken', { id: a.id });
    }
  }
  if (p.modeTime >= tuning.pickupTime) release(c);
}

export function dead(c: Ctx): void {
  if (c.p.modeTime >= tuning.respawnDelay) respawn(c.world);
}
