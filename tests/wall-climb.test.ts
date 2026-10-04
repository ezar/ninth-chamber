/**
 * Climbing walls (spec §5 "Escalar paredes", §19 chamber V): faces marked
 * `climb<D>` are climbed up, down and sideways; Nora gets on from the floor,
 * from a jump or from the ledge above, hangs from the top edge, steps off at
 * the bottom and jumps back off the face.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { wallInReach } from '../src/sim/player/modes/wall';
import { enemyTypes, tuning, wallClimb as W } from '../src/sim/player/tuning';
import type { EntityFile } from '../src/sim/grid/schema';
import type { World } from '../src/sim/world';
import { frame, run, runUntil, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

/** Root wall: a 6 m block along the north side whose south face is climbable, except the east cell. */
function rootWall(extra: { ceil?: number; legend?: Record<string, unknown> } = {}): World {
  return testLevel(['######', '#RRRP#', '#....#', '#.S..#', '######'], {
    ceil: extra.ceil ?? 30,
    legend: {
      R: { floor: 12, flags: ['climbS'] },
      P: 12,
      ...extra.legend,
    },
  });
}

const up = frame({ y: 1 });
const down = frame({ y: -1 });
const east = frame({ x: 1 });
const west = frame({ x: -1 });
const idle = frame();

/** Walks north into the face and gets on it. */
function getOn(w: World): void {
  runUntil(w, up, (x) => x.state.player.pos.z < 2 * 2 + tuning.radius + 0.05, 120);
  run(w, frame({ pressed: ['action'] }), 1);
}

describe('climbing walls', () => {
  it('gets on a climbable face with Action, facing it', () => {
    const w = rootWall();
    getOn(w);
    const p = w.state.player;
    expect(p.mode).toBe('wall');
    expect(p.dir).toBe('N');
  });

  it('does not get on a plain wall', () => {
    const w = rootWall({ legend: { R: 12 } });
    getOn(w);
    expect(w.state.player.mode).not.toBe('wall');
  });

  it('climbs up the face, hangs from its top and climbs onto it', () => {
    const w = rootWall();
    getOn(w);
    const p = w.state.player;
    const y0 = p.pos.y;
    run(w, up, ticks(1));
    expect(p.mode).toBe('wall');
    expect(p.pos.y - y0).toBeCloseTo(W.up * (ticks(1) - 0) * TICK_DT, 0);
    runUntil(w, up, (x) => x.state.player.mode === 'ground' && x.state.player.pos.y > 5, ticks(12));
    expect(p.mode).toBe('ground');
    expect(p.pos.y).toBeCloseTo(6, 3);
    expect(Math.floor(p.pos.z / 2)).toBe(1);
  });

  it('passes through a hang at the top edge on the way up', () => {
    const w = rootWall();
    getOn(w);
    const modes = new Set<string>();
    runUntil(
      w,
      up,
      (x) => {
        modes.add(x.state.player.mode);
        return x.state.player.mode === 'ground';
      },
      ticks(12),
    );
    expect([...modes]).toEqual(expect.arrayContaining(['wall', 'hang', 'climb', 'ground']));
  });

  it('climbs down and steps off onto the floor', () => {
    const w = rootWall();
    getOn(w);
    const p = w.state.player;
    run(w, up, ticks(1.5));
    run(w, down, ticks(3));
    expect(p.mode).toBe('ground');
    expect(p.pos.y).toBe(0);
    expect(p.health).toBe(tuning.maxHealth);
  });

  it('moves sideways along the face and stops where it ends', () => {
    const w = rootWall();
    getOn(w);
    const p = w.state.player;
    run(w, up, ticks(1));
    const x0 = p.pos.x;
    run(w, east, ticks(0.5));
    expect(p.pos.x).toBeGreaterThan(x0 + 0.2);
    // Cell 4 is plain rock: she stops at the end of the roots.
    run(w, east, ticks(6));
    expect(p.mode).toBe('wall');
    expect(p.pos.x).toBeLessThanOrEqual(4 * 2 - tuning.radius + 1e-6);
    // And back west, to the side wall.
    run(w, west, ticks(8));
    expect(p.mode).toBe('wall');
    expect(p.pos.x).toBeGreaterThanOrEqual(1 * 2 + tuning.radius - 1e-6);
  });

  it('jumps back off the face, turning round', () => {
    const w = rootWall();
    getOn(w);
    const p = w.state.player;
    run(w, up, ticks(0.6));
    const z0 = p.pos.z;
    run(w, frame({ pressed: ['jump'] }), 1);
    expect(p.mode).toBe('air');
    runUntil(w, idle, (x) => x.state.player.mode === 'ground', ticks(3));
    expect(p.pos.z).toBeGreaterThan(z0 + 1);
    // Facing away from the face, south (+Z).
    expect(Math.abs(Math.abs(p.yaw) - Math.PI)).toBeLessThan(1e-6);
  });

  it('lets go with Action and falls', () => {
    const w = rootWall();
    getOn(w);
    const p = w.state.player;
    run(w, up, ticks(1));
    run(w, frame({ pressed: ['action'] }), 1);
    expect(p.mode).toBe('air');
    runUntil(w, idle, (x) => x.state.player.mode === 'ground', ticks(3));
    expect(p.pos.y).toBe(0);
  });

  it('catches the face from a jump with Action held', () => {
    const w = rootWall();
    runUntil(w, up, (x) => x.state.player.pos.z < 3 * 2 + 0.6, 120);
    run(w, frame({ y: 1, held: ['action'], pressed: ['jump'] }), 1);
    runUntil(w, frame({ y: 1, held: ['action'] }), (x) => x.state.player.mode !== 'air', ticks(2));
    const p = w.state.player;
    expect(p.mode).toBe('wall');
    expect(p.pos.y).toBeGreaterThan(0.3);
  });

  it('gets back on the face from its top edge, pulling back while hanging', () => {
    const w = rootWall();
    getOn(w);
    const p = w.state.player;
    runUntil(w, up, (x) => x.state.player.mode === 'hang', ticks(10));
    run(w, idle, ticks(0.4));
    run(w, down, 2);
    expect(p.mode).toBe('wall');
    run(w, down, ticks(8));
    expect(p.mode).toBe('ground');
    expect(p.pos.y).toBe(0);
  });

  it('a face up to the ceiling stops her head under it', () => {
    const w = rootWall({ ceil: 8, legend: { R: { floor: 8, flags: ['climbS'] } } });
    getOn(w);
    const p = w.state.player;
    run(w, up, ticks(8));
    expect(p.mode).toBe('wall');
    expect(p.pos.y + tuning.height).toBeLessThanOrEqual(4 + 1e-6);
  });

  it('a face too low to climb is grabbed as a ledge instead', () => {
    const w = rootWall({ legend: { R: { floor: 4, flags: ['climbS'] } } });
    getOn(w);
    expect(w.state.player.mode).not.toBe('wall');
  });

  it('puts the torch on her belt while climbing', () => {
    const w = rootWall();
    const p = w.state.player;
    p.torch = { has: true, lit: true, stowed: false, away: false };
    getOn(w);
    run(w, up, 2);
    expect(p.torch.stowed).toBe(true);
  });

  it('tells the HUD when a face can be climbed', () => {
    const w = rootWall();
    expect(wallInReach(w)).toBe(false);
    runUntil(w, up, (x) => x.state.player.pos.z < 2 * 2 + tuning.radius + 0.05, 120);
    run(w, idle, 1);
    expect(wallInReach(w)).toBe(true);
    w.state.player.yaw = Math.PI;
    expect(wallInReach(w)).toBe(false);
  });

  it('takes the height of a face from the rock, not from a door or block in its cell', () => {
    // A closed door stands in a floor cell marked climbable: it adds no face of roots to climb.
    const w = testLevel(['#####', '#.D.#', '#...#', '#.S.#', '#####'], {
      ceil: 12,
      legend: { D: { floor: 0, flags: ['climbS'] } },
      entities: [{ id: 'door', type: 'door', room: 'r', at: [2, 1], height: 6 } as EntityFile],
    });
    runUntil(w, up, (x) => x.state.player.pos.z < 2 * 2 + tuning.radius + 0.05, 120);
    run(w, idle, 1);
    expect(wallInReach(w)).toBe(false);
    run(w, frame({ pressed: ['action'] }), 1);
    expect(w.state.player.mode).not.toBe('wall');
  });

  it('a jackal at the foot of the face bites until she climbs out of its reach, then gives up', () => {
    const w = testLevel(['######', '#RRRR#', '#....#', '#.S..#', '######'], {
      ceil: 30,
      legend: { R: { floor: 12, flags: ['climbS'] } },
      entities: [{ id: 'j', type: 'enemy', enemy: 'jackal', room: 'r', at: [3, 2], face: 'W' } as EntityFile],
    });
    getOn(w);
    const p = w.state.player;
    expect(p.mode).toBe('wall');
    // Low on the face she is still within its bite: it keeps at her and does not give up.
    run(w, idle, ticks(enemyTypes.jackal.refugeTime + 1));
    expect(w.state.enemies[0]?.mode).toBe('attack');
    p.health = tuning.maxHealth;
    // Climb out of its reach and stay there: no more bites land.
    run(w, up, ticks(2.5));
    const h0 = p.health;
    run(w, idle, ticks(4));
    expect(p.mode).toBe('wall');
    expect(p.health).toBe(h0);
  });
});
