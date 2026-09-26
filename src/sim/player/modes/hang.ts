/** Hang and climb modes: hanging from a ledge, shimmying, letting go and climbing up. */
import { blocks, ledgeAhead } from '../../grid/collision';
import { BLOCK, DIR_VEC, RIGHT_OF } from '../../grid/units';
import type { Ledge } from '../../state';
import { emit, faceDir, setMode, wishAlong, type Ctx } from '../context';
import { tuning } from '../tuning';

export function startHang(c: Ctx, ledge: Ledge, x: number, z: number): void {
  const { p } = c;
  p.pos = { x, y: ledge.y - tuning.handHeight, z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.ledge = ledge;
  p.jumped = false;
  faceDir(p, ledge.dir);
  setMode(p, 'hang');
  emit(c, 'player.grabbed', { y: ledge.y });
}

export function hang(c: Ctx): void {
  const { p, q, dt } = c;
  const ledge = p.ledge;
  if (!ledge || q.cellFloor(ledge.cx, ledge.cz) !== ledge.y) {
    letGo(c);
    return;
  }
  const forward = wishAlong(c, ledge.dir);
  const right = RIGHT_OF[ledge.dir];
  const side = wishAlong(c, right);

  if (c.pressed('action') || (forward < -0.5 && p.modeTime > 0.2)) {
    letGo(c);
    return;
  }
  if ((c.pressed('jump') || forward > 0.5) && p.modeTime > 0.25) {
    if (startClimb(c)) return;
  }
  if (Math.abs(side) > 0.5) shimmy(c, Math.sign(side), dt);
}

function shimmy(c: Ctx, sign: number, dt: number): void {
  const { p, q } = c;
  const ledge = p.ledge;
  if (!ledge) return;
  const sv = DIR_VEC[RIGHT_OF[ledge.dir]];
  const step = sign * tuning.shimmySpeed * dt;
  const nx = p.pos.x + sv.x * step;
  const nz = p.pos.z + sv.z * step;
  // The ledge must continue under the leading hand.
  const lead = { x: nx + sv.x * sign * tuning.radius, z: nz + sv.z * sign * tuning.radius };
  const ahead = ledgeAhead(q, lead.x, lead.z, ledge.dir);
  if (!ahead || Math.abs(ahead.y - ledge.y) > 1e-3) return;
  // The hanging body must fit in the cell it slides into.
  const cx = Math.floor(lead.x / BLOCK);
  const cz = Math.floor(lead.z / BLOCK);
  if (blocks(q, cx, cz, p.pos.y, tuning.height, 0)) return;
  p.pos.x = nx;
  p.pos.z = nz;
  p.ledge = { ...ledge, cx: ahead.cx, cz: ahead.cz };
}

function letGo(c: Ctx): void {
  const { p } = c;
  const back = p.ledge ? DIR_VEC[p.ledge.dir] : { x: 0, z: 0 };
  p.vel = { x: -back.x * 0.4, y: 0, z: -back.z * 0.4 };
  p.airSpeedCap = tuning.airControlMinCap;
  p.fallFrom = p.pos.y;
  p.sinceRelease = 0;
  p.jumped = false;
  p.ledge = null;
  setMode(p, 'air');
  emit(c, 'player.letGo');
}

/** Starts climbing onto the current ledge if there is headroom. */
export function startClimb(c: Ctx): boolean {
  const { p, q } = c;
  const ledge = p.ledge;
  if (!ledge) return false;
  if (q.cellCeil(ledge.cx, ledge.cz) - ledge.y < tuning.height) return false;
  const v = DIR_VEC[ledge.dir];
  const to = { x: p.pos.x, y: ledge.y, z: p.pos.z };
  // End standing a little inside the ledge sector, on its centre line along the edge.
  if (v.x !== 0) to.x = v.x > 0 ? ledge.cx * BLOCK + 0.5 : (ledge.cx + 1) * BLOCK - 0.5;
  else to.z = v.z > 0 ? ledge.cz * BLOCK + 0.5 : (ledge.cz + 1) * BLOCK - 0.5;
  if (v.x !== 0)
    to.z = Math.min(Math.max(to.z, ledge.cz * BLOCK + tuning.radius), (ledge.cz + 1) * BLOCK - tuning.radius);
  else
    to.x = Math.min(Math.max(to.x, ledge.cx * BLOCK + tuning.radius), (ledge.cx + 1) * BLOCK - tuning.radius);
  const duration = p.pos.y > ledge.y - tuning.handHeight + 0.3 ? tuning.climbTime * 0.6 : tuning.climbTime;
  p.move = { from: { ...p.pos }, to, duration };
  p.vel = { x: 0, y: 0, z: 0 };
  faceDir(p, ledge.dir);
  setMode(p, 'climb');
  emit(c, 'player.climbing');
  return true;
}

export function climb(c: Ctx): void {
  const { p } = c;
  const m = p.move;
  if (!m) {
    setMode(p, 'ground');
    return;
  }
  const t = Math.min(1, p.modeTime / m.duration);
  // Lift first, then step forward onto the ledge.
  const lift = Math.min(1, t / 0.6);
  const ease = (u: number): number => u * u * (3 - 2 * u);
  const fwd = Math.max(0, (t - 0.45) / 0.55);
  p.pos.y = m.from.y + (m.to.y - m.from.y) * ease(lift);
  p.pos.x = m.from.x + (m.to.x - m.from.x) * ease(fwd);
  p.pos.z = m.from.z + (m.to.z - m.from.z) * ease(fwd);
  if (t >= 1) {
    p.pos = { ...m.to };
    p.move = null;
    p.ledge = null;
    setMode(p, 'ground');
    emit(c, 'player.climbed');
  }
}
