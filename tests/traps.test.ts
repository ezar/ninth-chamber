/**
 * Traps (spec §8 "Trampas"): the rolling boulder, pendulum blades and the
 * fire floor. Each warns before it acts and resets when Nora respawns at a
 * checkpoint. Cells are world cells.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import type { EntityFile } from '../src/sim/grid/schema';
import { runActions, signal } from '../src/sim/logic/rules';
import { defsOf } from '../src/sim/mechanisms/defs';
import { bladeAngle, bladeAngularSpeed, bladePose } from '../src/sim/mechanisms/traps';
import { traps, tuning } from '../src/sim/player/tuning';
import { stepWorld, type World } from '../src/sim/world';
import { cellZ, frame, run, runUntil, testLevel } from './helpers';

const secs = (s: number): number => Math.round(s / TICK_DT);
const drainTypes = (w: World): string[] => w.events.drain().map((e) => e.type);
const deathCause = (w: World): unknown => w.events.drain().find((e) => e.type === 'player.died')?.cause;

/** A long east-west corridor with a side alcove at x = 4. */
const CORRIDOR = ['###########', '#.........#', '####.######', '###########'];

function place(w: World, cx: number, cz: number): void {
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
}

describe('rolling boulder', () => {
  const boulder = {
    id: 'b1',
    type: 'boulder',
    room: 'r',
    at: [1, 1],
    path: [
      [1, 1],
      [9, 1],
    ],
  } as EntityFile;

  it('rumbles first, then rolls down the corridor and crushes Nora in its way', () => {
    const w = testLevel(CORRIDOR, {
      entities: [boulder, { id: 'z1', type: 'zone', room: 'r', at: [7, 1] } as EntityFile],
      logic: [{ when: 'z1.entered', do: ['b1.release'] }],
    });
    place(w, 7, 1);
    run(w, frame(), 2);
    expect(drainTypes(w)).toContain('boulder.warning');
    const b = w.state.mechanisms.boulders[0];
    run(w, frame(), secs(traps.boulder.warning) - 4);
    expect(b?.pos.x).toBeCloseTo(3, 5);
    expect(b?.mode).toBe('warning');
    run(w, frame(), 6);
    expect(b?.mode).toBe('rolling');
    expect(signal(w, 'b1.rolling')).toBe(true);
    runUntil(w, frame(), (x) => x.state.player.mode === 'dead', secs(5));
    expect(w.state.player.mode).toBe('dead');
    expect(deathCause(w)).toBe('boulder');
  });

  it('a side alcove is safe; the boulder crashes at the end of its path', () => {
    const w = testLevel(CORRIDOR, { entities: [boulder] });
    place(w, 4, 2);
    runActions(w, ['b1.release']);
    run(w, frame(), secs(6));
    expect(w.state.player.mode).toBe('ground');
    const b = w.state.mechanisms.boulders[0];
    expect(b?.mode).toBe('done');
    expect(b?.pos.x).toBeCloseTo(19, 5);
    expect(signal(w, 'b1.done')).toBe(true);
    expect(drainTypes(w)).toContain('boulder.crashed');
  });

  it('outrunning it to the alcove works, and respawning resets it', () => {
    const w = testLevel(CORRIDOR, {
      entities: [boulder, { id: 'z1', type: 'zone', room: 'r', at: [1, 1], size: [2, 1] } as EntityFile],
      logic: [{ when: 'z1.entered', do: ['b1.release'] }],
    });
    place(w, 2, 1);
    // Run east to the alcove and duck into it.
    runUntil(w, frame({ x: 1 }), (x) => x.state.player.pos.x >= 9, secs(3));
    runUntil(w, frame({ y: -1 }), (x) => cellZ(x) === 2 && x.state.player.pos.z > 5, secs(1));
    run(w, frame(), secs(5));
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.mechanisms.boulders[0]?.mode).toBe('done');

    // A second world: caught in the corridor, she dies and comes back to an idle boulder.
    const v = testLevel(CORRIDOR, { entities: [boulder] });
    place(v, 6, 1);
    runActions(v, ['b1.release']);
    runUntil(v, frame(), (x) => x.state.player.mode === 'dead', secs(5));
    run(v, frame(), secs(tuning.respawnDelay) + 2);
    expect(v.state.player.mode).toBe('ground');
    expect(v.state.mechanisms.boulders[0]?.mode).toBe('idle');
    expect(v.state.mechanisms.boulders[0]?.pos.x).toBeCloseTo(3, 5);
  });
});

describe('pendulum blades', () => {
  /** A one-block corridor running north, ten metres high, with a blade at (1, 3). */
  const HALL = ['###', '#.#', '#.#', '#.#', '#.#', '#.#', '#S#', '###'];
  const blade = (phase: number): EntityFile =>
    ({ id: 'bl1', type: 'blade', room: 'r', at: [1, 3], axis: 'x', phase }) as EntityFile;

  it('swings on a fixed 2.4 s cycle', () => {
    const w = testLevel(HALL, { ceil: 20, entities: [blade(0)] });
    const pose = (): { angle: number } => bladePose(w, 'bl1');
    expect(pose().angle).toBeCloseTo(0, 5);
    run(w, frame(), secs(traps.blade.period / 4));
    expect(pose().angle).toBeCloseTo(traps.blade.amplitude, 3);
    run(w, frame(), secs(traps.blade.period / 4));
    expect(pose().angle).toBeCloseTo(0, 3);
    run(w, frame(), secs(traps.blade.period / 2));
    expect(pose().angle).toBeCloseTo(0, 3);
    expect(traps.blade.period).toBe(2.4);
  });

  it('reports its angle and swing speed without a pose, for the renderer', () => {
    const w = testLevel(HALL, { ceil: 20, entities: [blade(0.2)] });
    const def = defsOf(w.level).blades.get('bl1');
    const st = w.state.mechanisms.blades[0];
    if (!def || !st) throw new Error('no blade');
    for (let i = 0; i < 6; i++) {
      const before = bladeAngle(def, st);
      expect(before).toBeCloseTo(bladePose(w, 'bl1').angle, 9);
      const rate = bladeAngularSpeed(def, st);
      expect(Math.sign(rate)).toBe(bladePose(w, 'bl1').sign);
      run(w, frame(), 1);
      expect(bladeAngle(def, st) - before).toBeCloseTo(rate * TICK_DT, 2);
      run(w, frame(), secs(0.37));
    }
  });

  it('standing in its path costs 40 health once per pass, with a push', () => {
    const w = testLevel(HALL, { ceil: 20, entities: [blade(0)] });
    place(w, 1, 3);
    stepWorld(w, frame());
    expect(w.state.player.health).toBe(tuning.maxHealth - traps.blade.damage);
    const hurt = w.events.drain().find((e) => e.type === 'player.hurt');
    expect(hurt).toMatchObject({ amount: 40, cause: 'blade' });
    expect(w.state.player.mode).toBe('air');
    expect(Math.abs(w.state.player.vel.x)).toBeGreaterThan(2);
    run(w, frame(), secs(0.8));
    expect(w.state.player.health).toBe(60);
    run(w, frame(), secs(0.6));
    expect(w.state.player.health).toBe(20);
  });

  it('a well-timed run passes unhurt; the same run half a swing later is hit', () => {
    const crossing = (phase: number): { hurt: boolean; at: number } => {
      const w = testLevel(HALL, { ceil: 20, entities: [blade(phase)] });
      let at = -1;
      for (let i = 0; i < secs(2); i++) {
        stepWorld(w, frame({ y: 1 }));
        if (at < 0 && w.state.player.pos.z < 7) at = i * TICK_DT;
      }
      return { hurt: w.state.player.health < tuning.maxHealth, at };
    };
    // She reaches the blade's plane about 1.2 s after setting off: with phase 0.25 the blade is at the top of its swing.
    const good = crossing(0.25);
    expect(good.hurt).toBe(false);
    // Put the blade at the bottom of its swing just when she crosses its plane.
    const bad = crossing((((0.5 - good.at / traps.blade.period) % 1) + 1) % 1);
    expect(bad.hurt).toBe(true);
  });

  it('restarts its swing when Nora respawns', () => {
    const w = testLevel(HALL, { ceil: 20, entities: [blade(0)] });
    run(w, frame(), secs(0.9));
    w.state.player.health = 1;
    place(w, 1, 3);
    runUntil(w, frame(), (x) => x.state.player.mode === 'dead', secs(3));
    run(w, frame(), secs(tuning.respawnDelay) + 1);
    expect(w.state.player.mode).not.toBe('dead');
    expect(w.state.mechanisms.blades[0]?.time).toBeLessThan(0.1);
  });
});

describe('fire floor', () => {
  const ROOM = ['#####', '#...#', '#.F.#', '#.S.#', '#####'];
  const fire = {
    id: 'f1',
    type: 'fire',
    room: 'r',
    at: [2, 2],
    period: 3,
    burn: 1.2,
    offset: 1.2,
  } as EntityFile;

  it('warns, bursts and dies down on its rhythm', () => {
    const w = testLevel(ROOM, { legend: { F: 0 }, entities: [fire] });
    const seen: [string, number][] = [];
    for (let i = 0; i < secs(3.5); i++) {
      stepWorld(w, frame());
      for (const e of w.events.drain()) if (e.type.startsWith('fire.')) seen.push([e.type, i * TICK_DT]);
    }
    expect(seen.map(([t]) => t)).toEqual(['fire.warn', 'fire.burst', 'fire.out']);
    const [warn = 0, burst = 0, out = 0] = seen.map(([, t]) => t);
    expect(burst - warn).toBeCloseTo(traps.fire.warning, 1);
    expect(out - burst).toBeCloseTo(1.2, 1);
  });

  it('standing on it is safe until it bursts, then deadly', () => {
    const w = testLevel(ROOM, { legend: { F: 0 }, entities: [fire] });
    place(w, 2, 2);
    run(w, frame(), secs(1.7));
    expect(w.state.player.mode).toBe('ground');
    expect(signal(w, 'f1.burning')).toBe(false);
    runUntil(w, frame(), (x) => x.state.player.mode === 'dead', secs(0.5));
    expect(w.state.player.mode).toBe('dead');
    expect(deathCause(w)).toBe('fire');
  });

  it('in the air over the flames Nora is unharmed', () => {
    const w = testLevel(ROOM, { legend: { F: 0 }, entities: [fire] });
    run(w, frame(), secs(1.9));
    expect(signal(w, 'f1.burning')).toBe(true);
    place(w, 2, 2);
    const p = w.state.player;
    p.pos.y = 1.2;
    p.vel.y = 3;
    p.mode = 'air';
    p.fallFrom = 1.2;
    run(w, frame(), 10);
    expect(p.mode).toBe('air');
  });

  it('respawning restarts the rhythm', () => {
    const w = testLevel(ROOM, { legend: { F: 0 }, entities: [fire] });
    place(w, 2, 2);
    runUntil(w, frame(), (x) => x.state.player.mode === 'dead', secs(3));
    run(w, frame(), secs(tuning.respawnDelay) + 1);
    const f = w.state.mechanisms.fires[0];
    expect(f?.time).toBeLessThan(0.1);
    expect(f?.phase).toBe('idle');
    expect(w.state.player.mode).toBe('ground');
  });
});
