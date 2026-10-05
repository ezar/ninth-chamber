/** Air mode: gravity, air control, ledge grabs and landing (with fall damage). */
import { ledgeAhead, sweep } from '../../grid/collision';
import { BLOCK, DIR_VEC, yawToDir } from '../../grid/units';
import { die, emit, hurt, setMode, type Ctx } from '../context';
import { windAt } from '../../mechanisms/wind';
import { tuning } from '../tuning';
import { jump } from './ground';
import { startClimb, startHang } from './hang';
import { tryGrabRope } from './rope';
import { enterWaterFromAir, softLanding } from './swim';
import { tryCatchWall } from './wall';

export function air(c: Ctx): void {
  const { p, q, dt } = c;
  const y0 = p.pos.y;

  // Coyote time: a jump just after running off an edge still counts.
  if (!p.jumped && c.assisted && p.sinceGround <= tuning.coyoteTime && c.pressed('jump')) {
    jump(c);
    return;
  }

  p.vel.x += c.wish.x * tuning.airControl * dt;
  p.vel.z += c.wish.z * tuning.airControl * dt;
  const cap = Math.min(tuning.airMaxSpeed, p.airSpeedCap);
  const h = Math.hypot(p.vel.x, p.vel.z);
  if (h > cap) {
    p.vel.x *= cap / h;
    p.vel.z *= cap / h;
  }

  // Wind (spec §19, chamber VII) carries her along and an updraught holds her up.
  const wind = windAt(c.world, p.pos.x, p.pos.z);
  const gravity = tuning.gravity * (1 - wind.lift);

  // Gravity integrated exactly (constant acceleration): jump height and air time
  // match the spec's formulas regardless of the step size.
  const vy0 = p.vel.y;
  let y = p.pos.y + vy0 * dt - 0.5 * gravity * dt * dt;
  p.vel.y = vy0 - gravity * dt;

  const res = sweep(
    q,
    { x: p.pos.x, z: p.pos.z, y: Math.min(p.pos.y, y), radius: tuning.radius, height: tuning.height },
    (p.vel.x + wind.x) * dt,
    (p.vel.z + wind.z) * dt,
    0,
  );
  if (res.hitX) p.vel.x = 0;
  if (res.hitZ) p.vel.z = 0;
  p.pos.x = res.x;
  p.pos.z = res.z;

  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  const ceil = q.cellCeil(cx, cz);
  if (y + tuning.height > ceil) {
    y = ceil - tuning.height;
    p.vel.y = Math.min(0, p.vel.y);
  }
  const rising = p.vel.y > 0;
  p.pos.y = y;
  p.fallFrom = Math.max(p.fallFrom, y);

  if (tryGrabRope(c)) return;
  if (tryGrab(c, rising)) return;
  if (tryCatchWall(c)) return;
  if (enterWaterFromAir(c, y0)) return;

  const floor = q.floorAt(p.pos.x, p.pos.z);
  if (p.vel.y <= 0 && y <= floor) land(c, floor);
  else if (y < -200) die(c, 'void');
}

function tryGrab(c: Ctx, rising: boolean): boolean {
  const { p, q } = c;
  if (p.sinceRelease < tuning.regrabDelay) return false;
  // Auto-grab (an assist, on by default) grabs after a jump without holding Action.
  if (!c.held('action') && (!p.jumped || !c.assisted)) return false;
  const dir = yawToDir(p.yaw);
  const ledge = ledgeAhead(q, p.pos.x, p.pos.z, dir);
  if (!ledge || ledge.distance - tuning.radius > tuning.grabReach) return false;
  const hands = p.pos.y + tuning.handHeight;
  const inWindow = hands >= ledge.y - tuning.grabBelow && hands <= ledge.y + tuning.grabAbove;
  // While rising, hands can also reach down to a ledge between the knees and the head.
  const reachDown = rising && ledge.y > p.pos.y + tuning.stepUp && ledge.y <= hands;
  if (!inWindow && !reachDown) return false;

  const v = DIR_VEC[dir];
  const cx = ledge.cx - v.x;
  const cz = ledge.cz - v.z;
  const gap = tuning.radius + 0.02;
  let x = p.pos.x;
  let z = p.pos.z;
  if (v.x !== 0) x = v.x > 0 ? (cx + 1) * BLOCK - gap : cx * BLOCK + gap;
  else z = v.z > 0 ? (cz + 1) * BLOCK - gap : cz * BLOCK + gap;

  const target = { dir, cx: ledge.cx, cz: ledge.cz, y: ledge.y };
  // A ledge too low to hang from (the feet would sink into the floor) is vaulted directly.
  if (ledge.y - tuning.handHeight < q.cellFloor(cx, cz)) {
    p.pos.x = x;
    p.pos.z = z;
    p.ledge = target;
    return startClimb(c);
  }
  startHang(c, target, x, z);
  return true;
}

function land(c: Ctx, floor: number): void {
  const { p } = c;
  const fall = p.fallFrom - floor;
  p.pos.y = floor;
  p.vel.y = 0;
  p.jumped = false;
  setMode(p, 'ground');
  // Water deep enough breaks any fall (spec §5.10).
  const soft = softLanding(c);
  const hard = fall > tuning.fallDamageFrom && !soft;
  emit(c, 'player.landed', { fall, hard, water: soft });
  if (fall >= tuning.fallDeathFrom && !soft) {
    die(c, 'fall');
    return;
  }
  if (hard) {
    p.vel.x = 0;
    p.vel.z = 0;
    hurt(c, Math.round((fall - tuning.fallDamageFrom) * tuning.fallDamagePerMetre), 'fall');
  }
  const sector = c.world.level.sector(Math.floor(p.pos.x / BLOCK), Math.floor(p.pos.z / BLOCK));
  if (sector?.flags.has('death')) die(c, 'spikes');
}
