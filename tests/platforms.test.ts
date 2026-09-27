/**
 * Moving platforms (spec §8 "Plataforma móvil"): a block-sized stone slab
 * that follows a path of sectors, rests at each waypoint and carries Nora
 * (standing, hanging from its edge or climbing onto it) and blocks.
 * Cells are world cells; the test room's origin is 0, so '_' pits are 8 m deep.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { runActions, signal } from '../src/sim/logic/rules';
import type { PlatformState } from '../src/sim/mechanisms/types';
import { tuning } from '../src/sim/player/tuning';
import { findActor, stepWorld, type World } from '../src/sim/world';
import { cellX, cellZ, frame, run, runUntil, testLevel } from './helpers';

const secs = (s: number): number => Math.round(s / TICK_DT);

function plat(w: World, id = 'p1'): PlatformState {
  const p = w.state.mechanisms.platforms.find((x) => x.id === id);
  if (!p) throw new Error(`no platform ${id}`);
  return p;
}

/** A pit crossed north-south by a platform between two ledges. */
const CROSSING = ['#######', '#.....#', '#_____#', '#_____#', '#_____#', '#..S..#', '#######'];

describe('moving platforms', () => {
  it('follows its path at its speed and rests at each waypoint', () => {
    const w = testLevel(CROSSING, {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [3, 4],
          path: [
            [3, 4, 0],
            [3, 2, 0],
          ],
          speed: 2,
          pause: 1,
          running: true,
        },
      ],
    });
    expect(plat(w).pos).toEqual({ x: 7, y: 0, z: 9 });
    run(w, frame(), secs(1));
    expect(plat(w).pos.z).toBeCloseTo(7, 1);
    expect(signal(w, 'p1.moving')).toBe(true);
    run(w, frame(), secs(1) + 1);
    expect(plat(w).pos.z).toBeCloseTo(5, 5);
    expect(signal(w, 'p1.at1')).toBe(true);
    run(w, frame(), secs(0.5));
    expect(plat(w).pos.z).toBeCloseTo(5, 5);
    // Back again after the rest (ping-pong).
    run(w, frame(), secs(1));
    expect(plat(w).pos.z).toBeGreaterThan(5.5);
    expect(plat(w).pos.z).toBeLessThan(7);
  });

  it('is floor only where it is: whole cells for collision, its footprint for standing', () => {
    const w = testLevel(CROSSING, {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [3, 4],
          path: [
            [3, 4, 0],
            [3, 2, 0],
          ],
          speed: 2,
          running: true,
        },
      ],
    });
    expect(w.grid.cellFloor(3, 4)).toBe(0);
    expect(w.grid.cellFloor(3, 3)).toBe(-8);
    run(w, frame(), secs(0.5)); // centre at z = 8: it straddles cells 3 and 4
    expect(w.grid.cellFloor(3, 4)).toBeCloseTo(0, 5);
    expect(w.grid.cellFloor(3, 3)).toBeCloseTo(0, 5);
    expect(w.grid.floorAt(7, 8.5)).toBeCloseTo(0, 5);
    expect(w.grid.floorAt(7, 9.5)).toBe(-8);
    expect(w.grid.floorAt(5.5, 8)).toBe(-8);
  });

  it('carries Nora across a pit while she stands still', () => {
    const w = testLevel(CROSSING, {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [3, 4],
          path: [
            [3, 4, 0],
            [3, 2, 0],
          ],
          speed: 2,
        },
      ],
    });
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.pos.z <= 9.1, 200);
    run(w, frame(), 10);
    expect(cellZ(w)).toBe(4);
    runActions(w, ['p1.start']);
    let lowest = Infinity;
    for (let i = 0; i < secs(2.5); i++) {
      stepWorld(w, frame());
      lowest = Math.min(lowest, w.state.player.pos.y);
      expect(w.state.player.mode).toBe('ground');
    }
    expect(lowest).toBeCloseTo(0, 5);
    expect(w.state.player.pos.z).toBeCloseTo(5, 0);
    runUntil(w, frame({ y: 1 }), (x) => cellZ(x) === 1, 120);
    expect(cellZ(w)).toBe(1);
    expect(w.state.player.pos.y).toBe(0);
  });

  it('lifts Nora to an upper floor and lowers her again', () => {
    const w = testLevel(['#####', '#888#', '#8_8#', '#.S.#', '#####'], {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [2, 2],
          path: [
            [2, 2, 0],
            [2, 2, 8],
          ],
          speed: 1.5,
          pause: 0.5,
        },
      ],
    });
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.pos.z <= 5.1, 200);
    run(w, frame(), 10);
    expect(cellZ(w)).toBe(2);
    runActions(w, ['p1.next']);
    run(w, frame(), secs(3));
    expect(w.state.player.pos.y).toBeCloseTo(4, 5);
    expect(w.state.player.mode).toBe('ground');
    runActions(w, ['p1.goto 0']);
    run(w, frame(), secs(3));
    expect(w.state.player.pos.y).toBeCloseTo(0, 5);
    runActions(w, ['p1.next']);
    run(w, frame(), secs(3));
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => cellZ(x) === 1, 120);
    expect(cellZ(w)).toBe(1);
    expect(w.state.player.pos.y).toBe(4);
  });

  it('carries a block pushed onto it', () => {
    const w = testLevel(
      ['#######', '#.....#', '#_____#', '#_____#', '#_____#', '#.....#', '#..S..#', '#######'],
      {
        entities: [
          {
            id: 'p1',
            type: 'platform',
            room: 'r',
            at: [3, 4],
            path: [
              [3, 4, 0],
              [3, 2, 0],
            ],
            speed: 2,
          },
          { id: 'b1', type: 'block', room: 'r', at: [3, 5] },
        ],
      },
    );
    run(w, frame({ y: 1 }), 30);
    run(w, frame({ held: ['action'] }), 2);
    expect(w.state.player.mode).toBe('block');
    run(w, frame({ y: 1, held: ['action'] }), 5);
    run(w, frame({ held: ['action'] }), secs(tuning.pushTime) + 5);
    run(w, frame(), 5);
    const b = findActor(w, 'b1', 'block');
    expect([b?.cx, b?.cz, b?.y]).toEqual([3, 4, 0]);
    runActions(w, ['p1.start']);
    run(w, frame(), secs(0.5));
    // Mid-leg the block moves with the slab, cell to cell.
    expect(b?.from).toEqual({ cx: 3, cz: 4 });
    expect(b?.cz).toBe(3);
    expect(b?.t).toBeCloseTo(0.5, 1);
    run(w, frame(), secs(2));
    expect([b?.cx, b?.cz, b?.y, b?.from, b?.fallTo]).toEqual([3, 2, 0, null, null]);
    expect(w.grid.cellFloor(3, 2)).toBe(2);
  });

  it('lets Nora hang from its edge and carries her while she hangs', () => {
    const w = testLevel(['#####', '#___#', '#___#', '#.S.#', '#####'], {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [2, 2],
          path: [
            [2, 2, 6],
            [2, 2, 14],
          ],
          speed: 2,
        },
      ],
    });
    run(w, frame({ y: 1, held: ['walk'] }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 90);
    expect(w.state.player.mode).toBe('hang');
    expect(w.state.player.pos.y).toBeCloseTo(1, 5);
    runActions(w, ['p1.next']);
    for (let i = 0; i < secs(4.5); i++) {
      stepWorld(w, frame());
      expect(w.state.player.mode).toBe('hang');
    }
    expect(w.state.player.pos.y).toBeCloseTo(5, 5);
    run(w, frame({ y: 1 }), 20);
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 120);
    expect(w.state.player.pos.y).toBeCloseTo(7, 5);
    expect(cellZ(w)).toBe(2);
  });

  it('rules start it, and it signals the waypoint it rests at', () => {
    const w = testLevel(CROSSING, {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [3, 4],
          path: [
            [3, 4, 0],
            [3, 2, 0],
          ],
          speed: 2,
          loop: 'once',
        },
        { id: 'z1', type: 'zone', room: 'r', at: [3, 5] },
      ],
      logic: [
        { when: 'z1.entered', do: ['p1.start'] },
        { when: 'p1.at1', do: ['flag set arrived'] },
      ],
    });
    run(w, frame(), 2);
    expect(signal(w, 'p1.moving')).toBe(true);
    expect(signal(w, 'p1.at0')).toBe(false);
    run(w, frame(), secs(3));
    expect(w.state.flags).toContain('arrived');
    run(w, frame(), secs(3));
    expect(plat(w).pos.z).toBeCloseTo(5, 5);
    expect(signal(w, 'p1.moving')).toBe(false);
  });

  it('stop parks it at the next waypoint; next and goto move it on and park it', () => {
    const w = testLevel(CROSSING, {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [3, 4],
          path: [
            [3, 4, 0],
            [3, 3, 0],
            [3, 2, 0],
          ],
          speed: 2,
          pause: 0.2,
          running: true,
        },
      ],
    });
    run(w, frame(), secs(0.3));
    runActions(w, ['p1.stop']);
    run(w, frame(), secs(3));
    expect(plat(w).pos.z).toBeCloseTo(7, 5);
    expect(signal(w, 'p1.at1')).toBe(true);
    runActions(w, ['p1.next']);
    run(w, frame(), secs(3));
    expect(plat(w).pos.z).toBeCloseTo(5, 5);
    runActions(w, ['p1.goto 0']);
    run(w, frame(), secs(4));
    expect(plat(w).pos.z).toBeCloseTo(9, 5);
    expect(plat(w).running).toBe(false);
  });

  it('a standing jump reaches a platform resting across a one-block gap', () => {
    const w = testLevel(['#######', '#.....#', '#_____#', '#_____#', '#..S..#', '#######'], {
      entities: [
        {
          id: 'p1',
          type: 'platform',
          room: 'r',
          at: [3, 2],
          path: [
            [3, 2, 0],
            [5, 2, 0],
          ],
        },
      ],
    });
    run(w, frame({ y: 1, held: ['walk'] }), 90);
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    runUntil(w, frame({ y: 1, held: ['action'] }), (x) => x.state.player.mode === 'ground', 200);
    expect(w.state.player.mode).toBe('ground');
    expect(cellZ(w)).toBe(2);
    expect(cellX(w)).toBe(3);
    expect(w.state.player.pos.y).toBeCloseTo(0, 5);
  });
});
