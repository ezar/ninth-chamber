import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { mechanics, tuning } from '../src/sim/player/tuning';
import { findActor, stepWorld } from '../src/sim/world';
import { parseExpr, evalExpr } from '../src/sim/logic/expr';
import { cellZ, frame, run, runUntil, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

describe('pushable blocks', () => {
  const ROOM = ['#####', '#...#', '#...#', '#...#', '#...#', '#.S.#', '#####'];
  const withBlock = () => testLevel(ROOM, { entities: [{ id: 'b1', type: 'block', room: 'r', at: [2, 3] }] });

  it('pushes a block one sector per push', () => {
    const w = withBlock();
    run(w, frame({ y: 1 }), 30); // walk up against the block
    run(w, frame({ held: ['action'] }), 2);
    expect(w.state.player.mode).toBe('block');
    run(w, frame({ y: 1, held: ['action'] }), 5);
    run(w, frame({ held: ['action'] }), ticks(tuning.pushTime));
    const b = findActor(w, 'b1', 'block');
    expect(b?.cz).toBe(2);
    expect(w.state.player.mode).toBe('block');
    expect(cellZ(w)).toBe(3);
  });

  it('pulls a block towards the player', () => {
    const w = withBlock();
    run(w, frame({ y: 1 }), 30);
    run(w, frame({ held: ['action'] }), 2);
    run(w, frame({ y: -1, held: ['action'] }), ticks(tuning.pullTime));
    expect(findActor(w, 'b1', 'block')?.cz).toBe(4);
  });

  it('pushing a block against a wall does nothing', () => {
    const w = testLevel(ROOM, { entities: [{ id: 'b1', type: 'block', room: 'r', at: [2, 1] }] });
    run(w, frame({ y: 1 }), 90);
    run(w, frame({ held: ['action'] }), 2);
    run(w, frame({ y: 1, held: ['action'] }), 120);
    expect(findActor(w, 'b1', 'block')?.cz).toBe(1);
  });

  it('a block pushed into a pit falls and becomes floor', () => {
    const w = testLevel(['#####', '#___#', '#...#', '#...#', '#.S.#', '#####'], {
      entities: [{ id: 'b1', type: 'block', room: 'r', at: [2, 2] }],
      legend: { _: -4 },
    });
    run(w, frame({ y: 1 }), 30);
    run(w, frame({ held: ['action'] }), 2);
    run(w, frame({ y: 1, held: ['action'] }), ticks(tuning.pushTime) + 30);
    const b = findActor(w, 'b1', 'block');
    expect(b?.cz).toBe(1);
    expect(b?.y).toBe(-2);
    expect(w.grid.cellFloor(2, 1)).toBe(-2 + mechanics.blockHeight);
  });
});

describe('levers, doors and rules', () => {
  it('a lever opens a door through a rule', () => {
    const w = testLevel(['#####', '#.D.#', '#...#', '#.S.#', '#####'], {
      legend: { D: 0 },
      entities: [
        { id: 'lever1', type: 'lever', room: 'r', at: [2, 3], wall: 'S' },
        { id: 'door1', type: 'door', room: 'r', at: [2, 1] },
      ],
      logic: [{ when: 'lever1.used', do: ['door1.open', 'camera.focus door1 2s'] }],
    });
    expect(w.grid.cellFloor(2, 1)).toBe(Infinity);
    stepWorld(w, frame({ pressed: ['action'] }));
    expect(w.state.player.mode).toBe('lever');
    run(w, frame(), ticks(tuning.leverTime));
    const events = w.events.drain().map((e) => e.type);
    expect(events).toContain('lever.pulled');
    expect(events).toContain('camera.focus');
    run(w, frame(), ticks(1 / mechanics.doorSpeed));
    expect(w.grid.cellFloor(2, 1)).toBe(0);
  });

  it('a pressure plate is pressed by the player', () => {
    const w = testLevel(['#####', '#.P.#', '#.S.#', '#####'], {
      legend: { P: 0 },
      entities: [{ id: 'plate1', type: 'plate', room: 'r', at: [2, 1] }],
      logic: [{ when: 'plate1.pressed', do: ['flag set opened'] }],
    });
    runUntil(w, frame({ y: 1 }), (x) => cellZ(x) === 1, 60);
    run(w, frame(), 2);
    expect(w.state.flags).toContain('opened');
  });

  it('parses and evaluates conditions', () => {
    const e = parseExpr('a and (b or not c)');
    expect(evalExpr(e, (n) => ({ a: true, b: false, c: false })[n] ?? false)).toBe(true);
    expect(evalExpr(e, (n) => ({ a: true, b: false, c: true })[n] ?? false)).toBe(false);
    expect(() => parseExpr('a and')).toThrow();
  });
});

describe('traps and pickups', () => {
  it('a cracked tile falls after the warning time', () => {
    const w = testLevel(['#####', '#...#', '#.C.#', '#.S.#', '#####'], {
      legend: { C: { floor: 0, flags: ['crumble'] } },
    });
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => cellZ(x) === 2, 120);
    run(w, frame(), 2);
    const events = w.events.drain().map((e) => e.type);
    expect(events).toContain('tile.cracked');
    run(w, frame(), ticks(mechanics.crumbleDelay));
    expect(w.grid.cellFloor(2, 2)).toBeLessThan(-1);
    run(w, frame(), 90);
    expect(w.state.player.mode).toBe('dead');
  });

  it('landing on spikes kills', () => {
    const w = testLevel(['#####', '#XXX#', '#...#', '#.S.#', '#####'], {
      legend: { X: { floor: -2, flags: ['death'] } },
    });
    run(w, frame({ y: 1 }), 90);
    expect(w.state.player.mode).toBe('dead');
  });

  it('taking the relic ends the level', () => {
    const w = testLevel(['#####', '#.S.#', '#####'], {
      entities: [{ id: 'heart', type: 'relic', room: 'r', at: [2, 1] }],
      logic: [{ when: 'heart.taken', do: ['wait 1s', 'level.end'] }],
    });
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), ticks(tuning.pickupTime) + ticks(1));
    expect(w.ended).toBe(true);
  });

  it('a secret counts in the stats', () => {
    const w = testLevel(['#####', '#.S.#', '#####'], {
      entities: [{ id: 's1', type: 'secret', room: 'r', at: [2, 1], idol: 'jade' }],
    });
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), ticks(tuning.pickupTime));
    expect(w.stats.secrets).toBe(1);
  });
});
