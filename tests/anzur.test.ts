/**
 * Anzur, the Observatory's keeper (guardian kind 'giant', spec §19, chamber
 * VIII): three phases advanced by rules as the dome's rings are set; a wide
 * sweep; in phase 2 its slams break the floor into pits; in phase 3 only the
 * oculus light stops it. It never falls, and blows from above do nothing.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import type { EntityFile } from '../src/sim/grid/schema';
import { runActions } from '../src/sim/logic/rules';
import { giantTuning as A } from '../src/sim/player/tuning';
import { stepWorld, tileState, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

/** A great hall, Anzur on its seat in the middle, the oculus pool in the north-west corner. */
function hall(): World {
  const rows = ['###########', ...Array<string>(9).fill('#.........#'), '###########'];
  rows[8] = '#....S....#';
  return testLevel(rows, {
    ceil: 30,
    entities: [
      {
        id: 'anzur',
        type: 'guardian',
        kind: 'giant',
        room: 'r',
        at: [5, 4],
        face: 'S',
        arena: [1, 1, 9, 9],
      } as EntityFile,
      { id: 'oculus', type: 'oculus', room: 'r', at: [1, 1], size: [2, 2] },
    ],
  });
}

const anzur = (w: World) => {
  const g = w.state.guardians[0];
  if (!g) throw new Error('no guardian');
  return g;
};

function collect(w: World, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    stepWorld(w, frame());
    out.push(...w.events.drain().map((e) => e.type));
  }
  return out;
}

/** Puts Anzur at a cell, facing south, ready to act. */
function standAt(w: World, cx: number, cz: number): void {
  const g = anzur(w);
  g.pos = { x: cx * 2 + 1, y: 0, z: cz * 2 + 1 };
  g.vel = { x: 0, z: 0 };
}

describe('Anzur, the giant', () => {
  it('wakes when Nora enters its hall and sweeps wide at her', () => {
    const w = hall();
    const events = collect(w, ticks(6));
    expect(events).toContain('guardian.woke');
    expect(events).toContain('guardian.slam');
    expect(A.slamRadius).toBeGreaterThan(4);
  });

  it('moves through its phases when rules advance it, and no further than three', () => {
    const w = hall();
    run(w, frame(), 5);
    runActions(w, ['anzur.advance']);
    expect(anzur(w).phase).toBe(2);
    expect(w.state.signals['anzur.phase2']).toBe(true);
    runActions(w, ['anzur.advance', 'anzur.advance']);
    expect(anzur(w).phase).toBe(3);
    expect(w.state.signals['anzur.phase3']).toBe(true);
  });

  it('in phase 1 its slams leave the floor whole', () => {
    const w = hall();
    const events = collect(w, ticks(8));
    expect(events).toContain('guardian.slam');
    expect(events).not.toContain('tile.cracked');
  });

  it('in phase 2 its slams break the floor ahead of it into pits, and it strides over them', () => {
    const w = hall();
    run(w, frame(), 5);
    runActions(w, ['anzur.advance']);
    const events = collect(w, ticks(10));
    expect(events).toContain('tile.cracked');
    expect(events).toContain('tile.fell');
    // It strides over the holes it opens: always at the hall's floor height.
    const g = anzur(w);
    expect(g.mode).not.toBe('falling');
    expect(g.pos.y).toBe(0);
  });

  it('never breaks the floor in the oculus light', () => {
    const w = hall();
    runActions(w, ['anzur.wake', 'anzur.advance']);
    // Lure it to the oculus corner: Nora stands just south of the pool.
    const p = w.state.player;
    p.pos = { x: 1 * 2 + 1, y: 0, z: 3 * 2 + 1 };
    standAt(w, 3, 2);
    // It does break the floor round her, just not in the light.
    expect(collect(w, ticks(10))).toContain('tile.cracked');
    for (const [x, z] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ])
      expect(tileState(w, x as number, z as number).fallen).toBe(false);
  });

  it('never falls, even with the floor gone under it', () => {
    const w = hall();
    runActions(w, ['anzur.wake']);
    const g = anzur(w);
    const t = tileState(w, Math.floor(g.pos.x / 2), Math.floor(g.pos.z / 2));
    t.fallen = true;
    run(w, frame(), ticks(1));
    expect(g.mode).not.toBe('falling');
    expect(g.pos.y).toBe(0);
  });

  it('in phase 3 is stopped by the oculus light, and only by it', () => {
    const w = hall();
    runActions(w, ['anzur.wake', 'anzur.advance', 'anzur.advance', 'oculus.on']);
    standAt(w, 1, 1);
    const events = collect(w, 3);
    expect(events).toContain('guardian.lit');
    expect(anzur(w).mode).toBe('defeated');
    expect(w.state.signals['anzur.defeated']).toBe(true);
  });

  it('before phase 3 the oculus light does not stop it', () => {
    const w = hall();
    runActions(w, ['anzur.wake', 'anzur.advance', 'oculus.on']);
    standAt(w, 1, 1);
    run(w, frame(), 5);
    expect(anzur(w).mode).not.toBe('defeated');
  });

  it('in phase 3 out of the light it does not stop', () => {
    const w = hall();
    runActions(w, ['anzur.wake', 'anzur.advance', 'anzur.advance']);
    standAt(w, 1, 1);
    run(w, frame(), ticks(2));
    expect(anzur(w).mode).not.toBe('defeated');
  });

  it('shrugs off a fall onto its back', () => {
    const w = hall();
    runActions(w, ['anzur.wake']);
    const g = anzur(w);
    g.mode = 'recover';
    g.modeTime = 0;
    const p = w.state.player;
    p.pos = { x: g.pos.x, y: A.coreTop + 0.1, z: g.pos.z };
    p.vel = { x: 0, y: -6, z: 0 };
    p.mode = 'air';
    p.fallFrom = A.coreTop + 4;
    run(w, frame(), 2);
    expect(g.phase).toBe(1);
    expect(g.mode).not.toBe('stunned');
  });

  it('only breaks the floor at its own level: a ledge above it holds', () => {
    // A 2 m ledge along the north wall; Nora on it, Anzur pounding the wall below her.
    const rows = ['###########', '#rrrrrrrrr#', ...Array<string>(8).fill('#.........#'), '###########'];
    rows[8] = '#....S....#';
    const w = testLevel(rows, {
      legend: { r: 4 },
      ceil: 30,
      entities: [
        {
          id: 'anzur',
          type: 'guardian',
          kind: 'giant',
          room: 'r',
          at: [5, 5],
          face: 'N',
          arena: [1, 1, 9, 9],
        } as EntityFile,
      ],
    });
    runActions(w, ['anzur.wake', 'anzur.advance']);
    const p = w.state.player;
    p.pos = { x: 5 * 2 + 1, y: 2, z: 1 * 2 + 1 };
    const events = collect(w, ticks(12));
    expect(events).toContain('tile.cracked');
    for (let x = 1; x <= 9; x++) expect(tileState(w, x, 1).fallen).toBe(false);
    expect(p.mode).not.toBe('dead');
  });
});
