/**
 * Rope mode (spec §8 "Cuerda para tirar"): like a lever, but hanging. She
 * jumps into a rope with Action held (or auto-grab), pulls it, and lets go.
 */
import { setSignal } from '../../logic/rules';
import { BLOCK, cellCenter } from '../../grid/units';
import type { RopeActor } from '../../state';
import { emit, reachesForHold, setMode, type Ctx } from '../context';
import { tuning } from '../tuning';

/** In the air: grabs a rope within reach of her hands. */
export function tryGrabRope(c: Ctx): boolean {
  const { p, world } = c;
  if (p.sinceRelease < tuning.regrabDelay) return false;
  if (!reachesForHold(c)) return false;
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  const hands = p.pos.y + tuning.handHeight;
  const rope = world.state.actors.find(
    (a): a is RopeActor =>
      a.kind === 'rope' &&
      a.cx === cx &&
      a.cz === cz &&
      hands >= a.y - tuning.grabBelow &&
      hands <= a.y + tuning.ropeLength &&
      Math.hypot(p.pos.x - cellCenter(cx), p.pos.z - cellCenter(cz)) <= tuning.ropeReach,
  );
  if (!rope) return false;
  const grip = Math.min(rope.y + tuning.ropeLength, Math.max(rope.y + 0.3, hands));
  p.pos = { x: cellCenter(cx), y: grip - tuning.handHeight, z: cellCenter(cz) };
  p.vel = { x: 0, y: 0, z: 0 };
  p.target = rope.id;
  p.jumped = false;
  setMode(p, 'rope');
  emit(c, 'rope.grabbed', { id: rope.id });
  return true;
}

export function rope(c: Ctx): void {
  const { p, world } = c;
  const r = world.state.actors.find((a): a is RopeActor => a.kind === 'rope' && a.id === p.target);
  if (r && !r.used && p.modeTime >= tuning.ropeTime / 2) {
    r.used = true;
    setSignal(world, `${r.id}.pulled`, true);
    emit(c, 'rope.pulled', { id: r.id });
  }
  const early = c.pressed('action') && p.modeTime > 0.2;
  if (!r || early || p.modeTime >= tuning.ropeTime) {
    // A spring rope rises again, so its signal can rise again on the next pull.
    if (r?.spring && r.used) {
      r.used = false;
      setSignal(world, `${r.id}.pulled`, false);
    }
    p.vel = { x: 0, y: 0, z: 0 };
    p.airSpeedCap = tuning.airControlMinCap;
    p.fallFrom = p.pos.y;
    p.sinceRelease = 0;
    p.jumped = false;
    p.target = null;
    setMode(p, 'air');
    emit(c, 'player.letGo');
  }
}
