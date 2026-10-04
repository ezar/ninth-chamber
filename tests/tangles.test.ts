/**
 * Tangles of roots (spec §19, chamber V): solid and climbable while grown; a
 * lit torch close by makes them shrink back and opens the way, and takes their
 * handholds away; with the torch out or away they grow back slowly, never
 * onto Nora. Rules can seal one (it grows whatever the torch) or part it.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import type { EntityFile } from '../src/sim/grid/schema';
import { runActions } from '../src/sim/logic/rules';
import { migrate } from '../src/sim/save/save';
import { validateLevel } from '../src/sim/grid/validate';
import { tangle as T, tuning } from '../src/sim/player/tuning';
import type { World } from '../src/sim/world';
import { frame, run, runUntil, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

/** A corridor blocked at row 2 by a tangle up to 4 m (8 clicks); Nora starts at row 5. */
function corridor(extra: Partial<EntityFile> = {}): World {
  return testLevel(['#####', '#...#', '#...#', '#...#', '#...#', '#.S.#', '#####'], {
    ceil: 12,
    entities: [
      { id: 'roots', type: 'tangle', room: 'r', at: [1, 2], size: [3, 1], top: 8, ...extra } as EntityFile,
    ],
  });
}

const st = (w: World) => {
  const s = w.state.mechanisms.tangles[0];
  if (!s) throw new Error('no tangle');
  return s;
};

const withTorch = (w: World, lit = true): void => {
  w.state.player.torch = { has: true, lit, stowed: false, away: false };
};

/** Stands Nora in a cell, facing north. */
function stand(w: World, cx: number, cz: number): void {
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: 0, z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = 0;
}

const idle = frame();

describe('tangles of roots', () => {
  it('a grown tangle blocks the way up to its top', () => {
    const w = corridor();
    expect(w.grid.cellFloor(2, 2)).toBe(4);
    runUntil(w, frame({ y: 1 }), () => false, ticks(3));
    expect(w.state.player.pos.z).toBeGreaterThan(3 * 2);
  });

  it('shrinks back from a lit torch close by and opens the way', () => {
    const w = corridor();
    withTorch(w);
    stand(w, 2, 3);
    const events: string[] = [];
    for (let i = 0; i < ticks(T.shrinkTime); i++) {
      run(w, idle, 1);
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(events).toContain('tangle.shrink');
    expect(events).toContain('tangle.open');
    expect(w.state.signals['roots.open']).toBe(true);
    expect(w.grid.cellFloor(2, 2)).toBe(0);
    runUntil(w, frame({ y: 1 }), (x) => x.state.player.pos.z < 2 * 2, ticks(2));
    expect(w.state.player.pos.z).toBeLessThan(2 * 2);
  });

  it('does nothing for an unlit torch, a torch on her belt, or one too far away', () => {
    const w = corridor();
    withTorch(w, false);
    stand(w, 2, 3);
    run(w, idle, ticks(2));
    expect(st(w).grown).toBe(1);
    withTorch(w);
    w.state.player.torch.away = true;
    run(w, idle, ticks(2));
    expect(st(w).grown).toBe(1);
    withTorch(w);
    stand(w, 2, 5);
    run(w, idle, ticks(2));
    expect(st(w).grown).toBe(1);
  });

  it('grows back slowly once the torch goes away', () => {
    const w = corridor();
    withTorch(w);
    stand(w, 2, 3);
    run(w, idle, ticks(T.shrinkTime));
    expect(st(w).grown).toBe(0);
    stand(w, 2, 5);
    run(w, idle, ticks(T.regrowDelay - 0.2));
    expect(st(w).grown).toBe(0);
    run(w, idle, ticks(1));
    expect(st(w).grown).toBeGreaterThan(0);
    expect(st(w).grown).toBeLessThan(0.5);
    const events: string[] = [];
    for (let i = 0; i < ticks(T.regrowTime); i++) {
      run(w, idle, 1);
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(events).toContain('tangle.closed');
    expect(st(w).grown).toBe(1);
    expect(w.grid.cellFloor(2, 2)).toBe(4);
  });

  it('putting the torch out lets it grow back too', () => {
    const w = corridor();
    withTorch(w);
    stand(w, 2, 3);
    run(w, idle, ticks(T.shrinkTime));
    w.state.player.torch.lit = false;
    run(w, idle, ticks(T.regrowDelay + T.regrowTime));
    expect(st(w).grown).toBe(1);
  });

  it('never grows back onto Nora', () => {
    const w = corridor();
    withTorch(w);
    stand(w, 2, 3);
    run(w, idle, ticks(T.shrinkTime));
    stand(w, 2, 2);
    w.state.player.torch.lit = false;
    run(w, idle, ticks(T.regrowDelay + T.regrowTime + 2));
    expect(st(w).grown).toBe(0);
    expect(w.state.player.mode).toBe('ground');
    // She steps out, and it grows.
    stand(w, 2, 4);
    run(w, idle, ticks(T.regrowDelay + T.regrowTime));
    expect(st(w).grown).toBe(1);
  });

  it('is climbable while grown, and drops her when it shrinks', () => {
    const w = corridor({ top: 12 } as Partial<EntityFile>);
    stand(w, 2, 3);
    w.state.player.pos.z = 3 * 2 + tuning.radius + 0.05;
    run(w, frame({ pressed: ['action'] }), 1);
    const p = w.state.player;
    expect(p.mode).toBe('wall');
    run(w, frame({ y: 1 }), ticks(1));
    // The roots shrink away from her hands.
    w.events.drain();
    runActions(w, ['roots.part']);
    const events: string[] = [];
    for (let i = 0; i < ticks(T.shrinkTime); i++) {
      run(w, idle, 1);
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(events).toContain('player.letGo');
    expect(p.mode).not.toBe('wall');
  });

  it('a sealed tangle grows whatever the torch, and a parted one stays open', () => {
    const w = corridor();
    withTorch(w);
    stand(w, 2, 3);
    run(w, idle, ticks(T.shrinkTime));
    runActions(w, ['roots.seal']);
    run(w, idle, ticks(T.regrowTime + 0.5));
    expect(st(w).grown).toBe(1);
    runActions(w, ['roots.part']);
    stand(w, 2, 5);
    w.state.player.torch.lit = false;
    run(w, idle, ticks(T.shrinkTime + T.regrowDelay + T.regrowTime));
    expect(st(w).grown).toBe(0);
  });

  it('a tangle over a hole in the floor opens with the torch held over it', () => {
    // Roots fill a 3 m deep hole as floor (top at the room floor).
    const w = testLevel(['#####', '#...#', '#.h.#', '#...#', '#.S.#', '#####'], {
      ceil: 12,
      legend: { h: { floor: -6 } },
      entities: [{ id: 'roots', type: 'tangle', room: 'r', at: [2, 2], top: 0 } as EntityFile],
    });
    expect(w.grid.cellFloor(2, 2)).toBe(0);
    withTorch(w);
    stand(w, 2, 3);
    run(w, idle, ticks(T.shrinkTime));
    expect(w.grid.cellFloor(2, 2)).toBe(-3);
  });

  it('old saves are migrated with no tangles', () => {
    const save = { schema: 6, level: 'x', game: { checkpoint: { mechanisms: { oculi: [] } }, resume: null } };
    const m = migrate(save) as { game: { checkpoint: { mechanisms: Record<string, unknown> } } } | null;
    expect(m?.game.checkpoint.mechanisms.tangles).toEqual([]);
  });

  it('the level validator rejects a tangle that never rises above the floor or grows into rock', () => {
    const file = (top: number, at: [number, number]) => ({
      schema: 1,
      id: 't',
      name: 't',
      start: { room: 'r', at: [2, 3] as [number, number], face: 'N' as const },
      rooms: [
        {
          id: 'r',
          origin: [0, 0, 0] as [number, number, number],
          ceil: 12,
          legend: { '#': 'wall' as const, '.': 0 },
          rows: ['#####', '#...#', '#...#', '#...#', '#####'],
        },
      ],
      entities: [{ id: 'roots', type: 'tangle' as const, room: 'r', at, top }],
      logic: [],
    });
    const errs = (top: number, at: [number, number]) =>
      validateLevel(file(top, at)).errors.filter((e) => e.includes('tangle'));
    expect(errs(4, [2, 1])).toEqual([]);
    expect(errs(0, [2, 1])).toEqual(["tangle 'roots': its top is not above the floor at 2,1"]);
    expect(errs(4, [0, 1])).toEqual(["tangle 'roots' grows into a wall at 0,1"]);
  });
});
