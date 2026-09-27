/**
 * Water in the level (spec §4 `water`, §8 "Compuerta de agua"): surface
 * heights per sector, and water gates that raise or lower a room's water
 * over a few seconds, changing which edges can be reached from it.
 *
 * A sector's water is its static surface from the level file unless a gate
 * controls its room: then the room's dynamic level applies to every sector
 * of the room whose floor lies under it.
 */
import type { Level } from '../grid/level';
import { BLOCK, CLICK } from '../grid/units';
import { setSignal } from '../logic/rules';
import { mechanics } from '../player/tuning';
import type { Actor, RoomWater, WaterGateActor } from '../state';
import type { World } from '../world';

/** Water surface (m) over a cell, or null when it has none. It may lie under the floor (a dry cell). */
export function waterSurface(world: World, cx: number, cz: number): number | null {
  const s = world.level.sector(cx, cz);
  if (!s || s.wall) return null;
  const dyn = world.state.water[s.room];
  return dyn ? dyn.y : s.water;
}

/** Depth of water (m) over a cell's effective floor; 0 when dry. */
export function waterDepth(world: World, cx: number, cz: number): number {
  const w = waterSurface(world, cx, cz);
  if (w === null) return 0;
  const f = world.grid.cellFloor(cx, cz);
  return Number.isFinite(f) ? Math.max(0, w - f) : 0;
}

/** Water surface over a world point, when there is water above the floor there. */
export function wetSurfaceAt(world: World, x: number, z: number): number | null {
  const cx = Math.floor(x / BLOCK);
  const cz = Math.floor(z / BLOCK);
  return waterDepth(world, cx, cz) > 0 ? waterSurface(world, cx, cz) : null;
}

/** Water gates from the level file, as actors (levels in metres). */
export function createWaterGates(level: Level): WaterGateActor[] {
  const out: WaterGateActor[] = [];
  for (const e of level.entities) {
    if (e.type !== 'watergate') continue;
    const room = level.rooms.find((r) => r.id === e.room);
    const base = room?.y ?? 0;
    out.push({
      kind: 'watergate',
      id: e.id,
      cx: e.at[0],
      cz: e.at[1],
      rooms: e.rooms ?? [e.room],
      low: base + e.low * CLICK,
      high: base + e.high * CLICK,
      raised: e.raised,
    });
  }
  return out;
}

/** Initial water of gate-controlled rooms. */
export function createRoomWater(actors: readonly Actor[]): Record<string, RoomWater> {
  const water: Record<string, RoomWater> = {};
  for (const a of actors) {
    if (a.kind !== 'watergate') continue;
    const y = a.raised ? a.high : a.low;
    for (const r of a.rooms) water[r] = { y, target: y };
  }
  return water;
}

/** Moves every changing water surface towards its target and keeps the gates' signals. */
export function updateWater(world: World, dt: number): void {
  const { state } = world;
  for (const [room, w] of Object.entries(state.water)) {
    if (w.y === w.target) continue;
    const step = mechanics.waterSpeed * dt;
    w.y = w.target > w.y ? Math.min(w.target, w.y + step) : Math.max(w.target, w.y - step);
    if (w.y === w.target) world.events.emit({ type: 'water.stopped', tick: world.tick, room, y: w.y });
  }
  for (const a of state.actors) {
    if (a.kind !== 'watergate') continue;
    const levels = a.rooms.map((r) => state.water[r]).filter((w): w is RoomWater => !!w);
    const still = levels.every((w) => w.y === w.target);
    setSignal(world, `${a.id}.high`, still && levels.every((w) => w.y === a.high));
    setSignal(world, `${a.id}.low`, still && levels.every((w) => w.y === a.low));
  }
}

function moveRoomWater(world: World, rooms: readonly string[], target: number, id: string): void {
  const moving: string[] = [];
  let from = target;
  for (const room of rooms) {
    const w = (world.state.water[room] ??= {
      y: world.level.rooms.find((r) => r.id === room)?.water ?? target,
      target,
    });
    if (w.y !== target) moving.push(room);
    from = w.y;
    w.target = target;
  }
  if (moving.length) {
    world.events.emit({ type: 'water.moving', tick: world.tick, id, rooms: moving, from, to: target });
  }
}

/**
 * Rule actions on water: `<gate>.raise`, `<gate>.lower`, `<gate>.toggle`, and
 * `water.set <room> <clicks>` (clicks relative to the room's origin).
 * Returns false when the action is not about water.
 */
export function runWaterAction(world: World, id: string, op: string, args: readonly string[]): boolean {
  if (id === 'water' && op === 'set') {
    const room = world.level.rooms.find((r) => r.id === args[0]);
    const clicks = Number(args[1]);
    if (!room || !Number.isFinite(clicks)) throw new Error(`Bad action "water.set ${args.join(' ')}"`);
    moveRoomWater(world, [room.id], room.y + clicks * CLICK, 'water');
    return true;
  }
  const gate = world.state.actors.find((a): a is WaterGateActor => a.kind === 'watergate' && a.id === id);
  if (!gate) return false;
  let raised: boolean;
  if (op === 'raise') raised = true;
  else if (op === 'lower') raised = false;
  else if (op === 'toggle') raised = !gate.raised;
  else return false;
  gate.raised = raised;
  moveRoomWater(world, gate.rooms, raised ? gate.high : gate.low, gate.id);
  return true;
}
