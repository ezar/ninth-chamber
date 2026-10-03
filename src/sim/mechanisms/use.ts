/**
 * Operating the temple's mechanisms with Action (spec §5.11 "Interactuar"):
 * turning a mirror's drum, taking a key item and setting it in its slot.
 * They reuse Nora's lever and pickup modes (the same timing and animation):
 * the mechanism reacts halfway through, like a lever.
 */
import { distanceToEdge } from '../grid/collision';
import { BLOCK, DIR_VEC, yawToDir } from '../grid/units';
import { setSignal } from '../logic/rules';
import { faceDir, setMode, type Ctx } from '../player/context';
import { devices, tuning } from '../player/tuning';
import type { World } from '../world';
import { defsOf } from './defs';
import type { Facing4 } from './types';
import { turnGlyph } from './archive';

/** Starts operating a mechanism from the ground; false when there is nothing to operate. */
export function useMechanism(c: Ctx): boolean {
  const { p, world } = c;
  const m = world.state.mechanisms;
  const defs = defsOf(world.level);
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);

  const item = m.items.find((i) => !i.taken && i.cx === cx && i.cz === cz);
  if (item) {
    start(c, item.id, 'pickup');
    return true;
  }

  const slot = m.slots.find((s) => !s.filled && s.cx === cx && s.cz === cz);
  const slotDef = slot ? defs.slots.get(slot.id) : undefined;
  if (slot && slotDef) {
    if ((world.state.inventory[slotDef.accepts] ?? 0) <= 0) {
      // Nothing to set in it: Nora shakes her head (spec §9 "Inventario").
      world.events.emit({ type: 'slot.denied', tick: world.tick, id: slot.id, item: slotDef.accepts });
      return true;
    }
    faceDir(p, slotDef.wall);
    start(c, slot.id, 'lever');
    return true;
  }

  const dir = yawToDir(p.yaw);
  const v = DIR_VEC[dir];
  const mirror = m.mirrors.find((mi) => !mi.fixed && mi.cx === cx + v.x && mi.cz === cz + v.z);
  if (mirror && distanceToEdge(p.pos.x, p.pos.z, dir) <= devices.mirrorReach) {
    faceDir(p, dir);
    start(c, mirror.id, 'lever');
    return true;
  }
  const lock = glyphAhead(world, cx, cz, dir);
  if (lock && distanceToEdge(p.pos.x, p.pos.z, dir) <= devices.mirrorReach) {
    faceDir(p, dir);
    start(c, lock, 'lever');
    return true;
  }
  return false;
}

/** The glyph lock in front of Nora, if she stands on its reading side facing it. */
function glyphAhead(world: World, cx: number, cz: number, dir: ReturnType<typeof yawToDir>): string | null {
  const v = DIR_VEC[dir];
  const lock = world.state.mechanisms.glyphs.find((g) => g.cx === cx + v.x && g.cz === cz + v.z);
  if (!lock) return null;
  const def = defsOf(world.level).glyphs.get(lock.id);
  // She faces the lock from the side it is read from: opposite to its facing.
  const back = DIR_VEC[def?.facing ?? dir];
  return back.x === -v.x && back.z === -v.z ? lock.id : null;
}

function start(c: Ctx, id: string, mode: 'lever' | 'pickup'): void {
  c.p.vel = { x: 0, y: 0, z: 0 };
  c.p.target = id;
  setMode(c.p, mode);
  c.world.state.mechanisms.use = { id, done: false };
}

/** Called every tick: the operated mechanism reacts halfway through Nora's motion. */
export function updateUse(world: World): void {
  const m = world.state.mechanisms;
  const use = m.use;
  if (!use) return;
  const p = world.state.player;
  if (p.target !== use.id || (p.mode !== 'lever' && p.mode !== 'pickup')) {
    // Finished (the mode released its target) or interrupted.
    m.use = null;
    return;
  }
  const half = (p.mode === 'lever' ? tuning.leverTime : tuning.pickupTime) / 2;
  if (use.done || p.modeTime < half) return;
  use.done = true;
  const item = m.items.find((i) => i.id === use.id);
  if (item && !item.taken) {
    item.taken = true;
    world.state.inventory[item.item] = (world.state.inventory[item.item] ?? 0) + 1;
    setSignal(world, `${item.id}.taken`, true);
    world.events.emit({ type: 'item.picked', tick: world.tick, id: item.id, item: item.item });
    return;
  }
  const slot = m.slots.find((s) => s.id === use.id);
  const slotDef = defsOf(world.level).slots.get(use.id);
  if (slot && slotDef && !slot.filled) {
    slot.filled = true;
    world.state.inventory[slotDef.accepts] = Math.max(0, (world.state.inventory[slotDef.accepts] ?? 0) - 1);
    setSignal(world, `${slot.id}.filled`, true);
    world.events.emit({ type: 'slot.filled', tick: world.tick, id: slot.id, item: slotDef.accepts });
    return;
  }
  const mirror = m.mirrors.find((mi) => mi.id === use.id);
  if (mirror) {
    turnMirror(world, mirror.id);
    return;
  }
  if (m.glyphs.some((g) => g.id === use.id)) turnGlyph(world, use.id);
}

/** Turns a mirror a quarter turn clockwise. */
export function turnMirror(world: World, id: string): boolean {
  const mirror = world.state.mechanisms.mirrors.find((mi) => mi.id === id);
  if (!mirror) return false;
  mirror.facing = ((mirror.facing + 1) % 4) as Facing4;
  world.events.emit({
    type: 'mirror.turned',
    tick: world.tick,
    id,
    facing: mirror.facing,
    x: mirror.cx * BLOCK + BLOCK / 2,
    y: world.state.player.pos.y + 1.5,
    z: mirror.cz * BLOCK + BLOCK / 2,
  });
  return true;
}

/** The context prompt for a mechanism Nora can operate where she stands (an i18n key), or null. */
export function mechanismPrompt(world: World): string | null {
  const p = world.state.player;
  if (p.mode !== 'ground') return null;
  const m = world.state.mechanisms;
  const cx = Math.floor(p.pos.x / BLOCK);
  const cz = Math.floor(p.pos.z / BLOCK);
  if (m.items.some((i) => !i.taken && i.cx === cx && i.cz === cz)) return 'prompt.take';
  const slot = m.slots.find((s) => !s.filled && s.cx === cx && s.cz === cz);
  if (slot) {
    const def = defsOf(world.level).slots.get(slot.id);
    return def && (world.state.inventory[def.accepts] ?? 0) > 0 ? 'prompt.slot' : 'prompt.slotEmpty';
  }
  const dir = yawToDir(p.yaw);
  const v = DIR_VEC[dir];
  const near = m.mirrors.some((mi) => !mi.fixed && mi.cx === cx + v.x && mi.cz === cz + v.z);
  if (near && distanceToEdge(p.pos.x, p.pos.z, dir) <= devices.mirrorReach) return 'prompt.mirror';
  if (glyphAhead(world, cx, cz, dir) && distanceToEdge(p.pos.x, p.pos.z, dir) <= devices.mirrorReach)
    return 'prompt.glyph';
  return null;
}
