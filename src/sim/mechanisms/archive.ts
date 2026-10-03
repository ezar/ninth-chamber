/**
 * The Clay Archive's mechanisms (spec §19): glyph locks and dart traps.
 *
 * - A glyph lock is a stone cylinder with six carved faces. Action, from the
 *   side it is read from, turns it one face; `<id>.set` is true while the
 *   glyph shown is its target, and rules open doors on a set of locks. The
 *   sequence is read from the room's notes and reliefs.
 * - A dart trap is a painted slab. Stepping on it clicks; a moment later a
 *   volley flies across the corridor from the niches in one wall to the
 *   other, and whoever is on that line is hurt and mildly poisoned. It fires
 *   again only once she has stepped off.
 * - Poison drains health slowly and never kills; a medkit cures it.
 */
import { BLOCK } from '../grid/units';
import { setSignal } from '../logic/rules';
import { damagePlayer } from '../player/context';
import { poison, traps } from '../player/tuning';
import type { World } from '../world';
import type { DartDef, GlyphLockDef } from './defs';
import type { DartState, GlyphLockState } from './types';

/** Glyphs on a lock. */
export const GLYPH_FACES = 6;

export function createGlyphLock(d: GlyphLockDef): GlyphLockState {
  return { id: d.id, cx: d.cx, cz: d.cz, glyph: d.glyph };
}

export function createDarts(d: DartDef): DartState {
  return { id: d.id, phase: 'idle', time: 0 };
}

/** Turns a lock one face on. */
export function turnGlyph(world: World, id: string): boolean {
  const lock = world.state.mechanisms.glyphs.find((g) => g.id === id);
  if (!lock) return false;
  lock.glyph = (lock.glyph + 1) % GLYPH_FACES;
  world.events.emit({
    type: 'glyph.turned',
    tick: world.tick,
    id,
    glyph: lock.glyph,
    x: lock.cx * BLOCK + BLOCK / 2,
    y: world.state.player.pos.y + 1,
    z: lock.cz * BLOCK + BLOCK / 2,
  });
  return true;
}

export function updateGlyphs(world: World, defs: ReadonlyMap<string, GlyphLockDef>): void {
  for (const g of world.state.mechanisms.glyphs) {
    const d = defs.get(g.id);
    if (d) setSignal(world, `${g.id}.set`, g.glyph === d.target);
  }
}

const cellOf = (v: number): number => Math.floor(v / BLOCK);

export function updateDarts(world: World, d: DartDef, st: DartState, dt: number): void {
  const p = world.state.player;
  const floor = world.level.floorAt(d.cx * BLOCK + BLOCK / 2, d.cz * BLOCK + BLOCK / 2);
  const onSlab =
    p.mode !== 'dead' && cellOf(p.pos.x) === d.cx && cellOf(p.pos.z) === d.cz && p.pos.y - floor < 0.15;
  st.time += dt;
  setSignal(world, `${d.id}.fired`, false);
  switch (st.phase) {
    case 'idle':
      if (!onSlab) return;
      st.phase = 'armed';
      st.time = 0;
      world.events.emit({ type: 'darts.click', tick: world.tick, id: d.id, cx: d.cx, cz: d.cz });
      return;
    case 'armed': {
      if (st.time < traps.darts.delay) return;
      st.phase = 'cooldown';
      st.time = 0;
      setSignal(world, `${d.id}.fired`, true);
      const first = d.line[0];
      const last = d.line[d.line.length - 1];
      world.events.emit({
        type: 'darts.fired',
        tick: world.tick,
        id: d.id,
        count: d.count,
        from: first ? [first.cx, first.cz] : [d.cx, d.cz],
        to: last ? [last.cx, last.cz] : [d.cx, d.cz],
        y: floor + 1.1,
      });
      const pcx = cellOf(p.pos.x);
      const pcz = cellOf(p.pos.z);
      const inLine = d.line.some((c) => c.cx === pcx && c.cz === pcz);
      if (inLine && p.mode !== 'dead' && p.pos.y - floor < traps.darts.height) {
        damagePlayer(world, traps.darts.damage, 'darts');
        if (p.health > 0) {
          p.poison = poison.duration;
          world.events.emit({ type: 'player.poisoned', tick: world.tick });
        }
      }
      return;
    }
    case 'cooldown':
      if (st.time >= traps.darts.cooldown && !onSlab) {
        st.phase = 'idle';
        st.time = 0;
      }
      return;
  }
}

/** Poison drains health slowly, down to a floor it never passes. */
export function updatePoison(world: World, dt: number): void {
  const p = world.state.player;
  if (p.poison <= 0) return;
  if (p.mode === 'dead') {
    p.poison = 0;
    return;
  }
  p.poison = Math.max(0, p.poison - dt);
  if (p.health > poison.floor) p.health = Math.max(poison.floor, p.health - poison.rate * dt);
  if (p.poison === 0) world.events.emit({ type: 'player.cured', tick: world.tick });
}
