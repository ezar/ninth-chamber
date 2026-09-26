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

  it('a secret found after the last checkpoint counts once and stays found after a death', () => {
    const w = testLevel(['#####', '#...#', '#.X.#', '#.S.#', '#####'], {
      entities: [{ id: 's1', type: 'secret', room: 'r', at: [2, 3], idol: 'jade' }],
      legend: { X: { floor: 0, flags: ['death'] } },
    });
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), ticks(tuning.pickupTime));
    expect(w.stats.secrets).toBe(1);
    expect(w.stats.secretsFound).toEqual(['s1']);

    // Die on the spikes: the respawn restores the checkpoint taken before the secret.
    run(w, frame({ y: 1 }), 30);
    expect(w.state.player.mode).toBe('dead');
    run(w, frame(), ticks(tuning.respawnDelay) + 10);
    expect(w.state.player.mode).toBe('ground');
    const idol = w.state.actors.find((a) => a.id === 's1');
    expect(idol?.kind === 'secret' && idol.taken).toBe(true);
    expect(w.state.signals['s1.taken']).toBe(true);

    // Action on its sector finds nothing to pick up and counts nothing.
    w.events.drain();
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), ticks(tuning.pickupTime));
    expect(w.events.drain().some((e) => e.type === 'secret.found')).toBe(false);
    expect(w.stats.secrets).toBe(1);
  });
});

describe('plate-held and timed gates', () => {
  const HALL = ['#######', '#..D..#', '#.....#', '#.....#', '#.P.S.#', '#######'];
  const gate = (logic: { when: string; do: string[]; once?: boolean }[]) =>
    testLevel(HALL, {
      legend: { D: 0, P: 0 },
      entities: [
        { id: 'plate1', type: 'plate', room: 'r', at: [2, 4] },
        { id: 'gate1', type: 'door', room: 'r', at: [3, 1] },
      ],
      logic,
    });
  const onPlate = (w: ReturnType<typeof gate>): void => {
    runUntil(w, frame({ x: -1 }), (x) => findActor(x, 'plate1', 'plate')?.pressed === true, 120);
  };

  it('opening an open door or closing a closed one emits nothing', () => {
    const w = gate([{ when: 'not plate1.pressed', do: ['gate1.close'], once: false }]);
    run(w, frame(), 5);
    expect(w.events.drain().map((e) => e.type)).not.toContain('door.closing');
  });

  it('a gate held by a plate closes as soon as the weight leaves', () => {
    const w = gate([
      { when: 'plate1.pressed', do: ['gate1.open'], once: false },
      { when: 'not plate1.pressed', do: ['gate1.close'], once: false },
    ]);
    onPlate(w);
    run(w, frame(), ticks(1 / mechanics.doorSpeed));
    expect(w.grid.cellFloor(3, 1)).toBe(0);
    run(w, frame({ x: 1 }), 30);
    run(w, frame(), ticks(1 / mechanics.doorSpeed));
    expect(w.grid.cellFloor(3, 1)).toBe(Infinity);
  });

  it('a timed gate ticks every second, then closes', () => {
    const w = gate([
      { when: 'plate1.pressed', do: ['gate1.open'], once: false },
      { when: 'gate1.open and not plate1.pressed', do: ['gate1.open 3s'], once: false },
    ]);
    onPlate(w);
    run(w, frame(), ticks(1 / mechanics.doorSpeed));
    w.events.drain();
    run(w, frame({ x: 1 }), 30);
    run(w, frame(), ticks(3));
    const events = w.events.drain();
    expect(events.filter((e) => e.type === 'door.tick').map((e) => e.left)).toEqual([2, 1]);
    expect(events.map((e) => e.type)).toContain('door.closing');
  });
});

describe('spring levers and block resets', () => {
  const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#..S..#', '#######'];

  it('a spring lever can be pulled again and fires its rule each time', () => {
    const w = testLevel(ROOM, {
      entities: [{ id: 'reset', type: 'lever', room: 'r', at: [3, 4], wall: 'S', spring: true }],
      logic: [{ when: 'reset.used', do: ['sfx rumble'], once: false }],
    });
    for (let i = 0; i < 2; i++) {
      stepWorld(w, frame({ pressed: ['action'] }));
      expect(w.state.player.mode).toBe('lever');
      run(w, frame(), ticks(tuning.leverTime));
    }
    expect(w.events.drain().filter((e) => e.type === 'sfx')).toHaveLength(2);
    expect(findActor(w, 'reset', 'lever')?.used).toBe(false);
  });

  it('a reset returns a block to its start, even from a pit', () => {
    const w = testLevel(['#####', '#___#', '#...#', '#...#', '#.S.#', '#####'], {
      legend: { _: -4 },
      entities: [
        { id: 'b1', type: 'block', room: 'r', at: [2, 2] },
        { id: 'reset', type: 'lever', room: 'r', at: [2, 4], wall: 'S', spring: true },
      ],
      logic: [{ when: 'reset.used', do: ['b1.reset'], once: false }],
    });
    run(w, frame({ y: 1 }), 30);
    run(w, frame({ held: ['action'] }), 2);
    run(w, frame({ y: 1, held: ['action'] }), ticks(tuning.pushTime) + 30);
    expect(findActor(w, 'b1', 'block')?.y).toBe(-2);
    runUntil(w, frame({ y: -1, held: ['walk'] }), (x) => cellZ(x) === 4, 200);
    run(w, frame(), 10);
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), ticks(tuning.leverTime));
    const b = findActor(w, 'b1', 'block');
    expect([b?.cx, b?.cz, b?.y]).toEqual([2, 2, 0]);
    expect(w.grid.cellFloor(2, 1)).toBe(-2);
  });

  it('a block left without support falls', () => {
    const w = testLevel(ROOM, {
      entities: [
        { id: 'low', type: 'block', room: 'r', at: [2, 2] },
        { id: 'top', type: 'block', room: 'r', at: [4, 2] },
      ],
    });
    const top = findActor(w, 'top', 'block');
    const low = findActor(w, 'low', 'block');
    if (!top || !low) throw new Error('missing block');
    // `top` rests on `low` (as if pushed off a shelf onto it); then `low` moves away.
    top.cx = 2;
    top.y = mechanics.blockHeight;
    low.cz = 1;
    run(w, frame(), 30);
    expect(top.y).toBe(0);
    expect(w.events.drain().map((e) => e.type)).toContain('block.landed');
  });
});
