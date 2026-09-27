/**
 * The stone guardian (spec §7 "Guardián de piedra"): a slow, heavy mini-boss
 * that is immune to everything except falling into a pit (a trapdoor or
 * crumbling floor it is lured onto) and a blow to its core from above. A
 * puzzle shaped like an enemy. Cells are world cells.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import type { GuardianState } from '../src/sim/actors/guardian-types';
import type { EntityFile } from '../src/sim/grid/schema';
import { runActions, signal } from '../src/sim/logic/rules';
import { killPlayer } from '../src/sim/player/context';
import { guardianTuning as G, tuning } from '../src/sim/player/tuning';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, runUntil, testLevel } from './helpers';

const secs = (s: number): number => Math.round(s / TICK_DT);
const cellOf = (m: number): number => Math.floor(m / 2);

function guardian(w: World): GuardianState {
  const g = w.state.guardians[0];
  if (!g) throw new Error('no guardian');
  return g;
}

const stone = (at: [number, number], arena: [number, number, number, number]): EntityFile =>
  ({ id: 'g1', type: 'guardian', room: 'r', at, face: 'S', arena }) as EntityFile;

function place(w: World, cx: number, cz: number): void {
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.mode = 'ground';
}

/** Collects event types (with their tick) while running. */
function runCollect(w: World, input: ReturnType<typeof frame>, ticks: number, out: [string, number][]): void {
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, input);
    for (const e of w.events.drain()) out.push([e.type, w.tick]);
  }
}

const HALL = [
  '#########',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#.......#',
  '#...S...#',
  '#########',
];

describe('stone guardian', () => {
  it('stands dormant until Nora enters its hall, and its body blocks her', () => {
    const w = testLevel(HALL, { entities: [stone([4, 3], [1, 1, 7, 3])] });
    run(w, frame(), secs(1));
    expect(guardian(w).mode).toBe('dormant');
    // Walk into it from the south, staying out of its hall: pushed back, it sleeps on.
    run(w, frame({ y: 1 }), secs(2));
    expect(w.state.player.pos.z).toBeGreaterThan(7 + G.bodyRadius + tuning.radius - 0.05);
    expect(guardian(w).mode).toBe('dormant');
    expect(signal(w, 'g1.awake')).toBe(false);

    const v = testLevel(HALL, { entities: [stone([4, 3], [1, 1, 7, 5])] });
    const seen: [string, number][] = [];
    runCollect(v, frame({ y: 1 }), secs(1.2), seen);
    expect(seen.map(([t]) => t)).toContain('guardian.woke');
    expect(signal(v, 'g1.awake')).toBe(true);
  });

  it('walks round what it cannot climb: one click at a time, never jumping', () => {
    const w = testLevel(['#########', '#.......#', '#222222.#', '#.......#', '#...S...#', '#########'], {
      entities: [stone([1, 1], [1, 1, 7, 4])],
    });
    const cells = new Set<string>();
    const seen: [string, number][] = [];
    for (let i = 0; i < secs(20) && guardian(w).mode !== 'windup'; i++) {
      runCollect(w, frame(), 1, seen);
      const g = guardian(w);
      cells.add(`${cellOf(g.pos.x)},${cellOf(g.pos.z)}`);
      expect(g.pos.y).toBeLessThan(0.01);
    }
    expect(guardian(w).mode).toBe('windup');
    expect(cells.has('7,2')).toBe(true);
    expect(seen.filter(([t]) => t === 'guardian.step').length).toBeGreaterThan(4);
  });

  it('winds up readably, then slams: heavy damage around it', () => {
    const w = testLevel(HALL, { entities: [stone([4, 3], [1, 1, 7, 8])] });
    const seen: [string, number][] = [];
    for (let i = 0; i < secs(15) && !seen.some(([t]) => t === 'guardian.slam'); i++)
      runCollect(w, frame(), 1, seen);
    const windup = seen.find(([t]) => t === 'guardian.windup')?.[1] ?? NaN;
    const slam = seen.find(([t]) => t === 'guardian.slam')?.[1] ?? NaN;
    expect((slam - windup) * TICK_DT).toBeGreaterThanOrEqual(1);
    expect(w.state.player.health).toBe(tuning.maxHealth - G.slamDamage);
    expect(guardian(w).mode).toBe('recover');
  });

  it('a jump just before the blow lets the shockwave pass underneath', () => {
    const w = testLevel(HALL, { entities: [stone([4, 3], [1, 1, 7, 8])] });
    runUntil(w, frame(), (x) => guardian(x).mode === 'windup', secs(15));
    run(w, frame(), secs((G.windup[0] ?? 1) - 0.3));
    stepWorld(w, frame({ pressed: ['jump'] }));
    const seen: [string, number][] = [];
    runCollect(w, frame(), secs(0.6), seen);
    expect(seen.map(([t]) => t)).toContain('guardian.slam');
    expect(w.state.player.health).toBe(tuning.maxHealth);
  });

  it('lured onto a trapdoor over a pit, it falls, drags itself out and keeps off trapdoors after', () => {
    const w = testLevel(
      [
        '#########',
        '#.......#',
        '#.......#',
        '#___T___#',
        '#___T___#',
        '#.......#',
        '#...S...#',
        '#########',
      ],
      {
        legend: { T: 'pit' },
        entities: [
          stone([4, 2], [1, 1, 7, 6]),
          { id: 'td', type: 'trapdoor', room: 'r', at: [4, 3], size: [1, 2], h: 0 } as EntityFile,
        ],
      },
    );
    runUntil(w, frame(), (x) => cellOf(guardian(x).pos.z) === 4, secs(15));
    expect(guardian(w).mode).toBe('chase');
    runActions(w, ['td.open']);
    const seen: [string, number][] = [];
    runCollect(w, frame(), secs(1.5), seen);
    expect(seen.map(([t]) => t)).toContain('guardian.fell');
    expect(guardian(w).pos.y).toBeLessThan(-7);
    expect(signal(w, 'g1.phase2')).toBe(true);
    runUntil(w, frame(), (x) => guardian(x).mode === 'chase', secs(8));
    expect(guardian(w).phase).toBe(2);
    expect(guardian(w).pos.y).toBeCloseTo(0, 5);
    expect(cellOf(guardian(w).pos.z)).toBe(2);
    runActions(w, ['td.close']);
    for (let i = 0; i < secs(8); i++) {
      stepWorld(w, frame());
      expect(cellOf(guardian(w).pos.z)).toBeLessThanOrEqual(2);
    }
  });

  it('crumbling floor gives way under its weight', () => {
    const w = testLevel(
      ['#########', '#.......#', '#.......#', '#CCCCCCC#', '#.......#', '#...S...#', '#########'],
      {
        legend: { C: { floor: 0, flags: ['crumble'] } },
        entities: [stone([4, 2], [1, 1, 7, 5])],
      },
    );
    const seen: [string, number][] = [];
    for (let i = 0; i < secs(15) && !seen.some(([t]) => t === 'guardian.fell'); i++)
      runCollect(w, frame(), 1, seen);
    expect(seen.map(([t]) => t)).toContain('tile.cracked');
    expect(seen.map(([t]) => t)).toContain('guardian.fell');
    expect(guardian(w).phase).toBe(2);
  });

  const BALCONY = ['#########', '#8888888#', '#.......#', '#.......#', '#.......#', '#.......#', '#########'];

  /** Runs south off the balcony once the guardian has pounded the wall below and is recovering. */
  function dropOnto(w: World): [string, number][] {
    const seen: [string, number][] = [];
    for (let i = 0; i < secs(15) && guardian(w).mode !== 'recover'; i++) runCollect(w, frame(), 1, seen);
    expect(guardian(w).mode).toBe('recover');
    const slam = w.state.guardians[0];
    expect(slam?.pound).toBe(true);
    runCollect(w, frame({ y: -0.8 }), secs(0.6), seen);
    runCollect(w, frame(), secs(1.5), seen);
    return seen;
  }

  it('a fall onto its core from above, while its fists are buried, breaks it: two blows defeat it', () => {
    const w = testLevel(BALCONY, { entities: [stone([4, 4], [1, 1, 7, 5])] });
    place(w, 4, 1);
    let seen = dropOnto(w);
    expect(seen.map(([t]) => t)).toContain('guardian.stunned');
    expect(guardian(w).phase).toBe(2);
    expect(signal(w, 'g1.phase2')).toBe(true);
    expect(w.state.player.mode).not.toBe('dead');
    expect(w.state.player.health).toBe(tuning.maxHealth);

    runUntil(w, frame(), (x) => guardian(x).mode === 'chase', secs(5));
    place(w, 4, 1);
    seen = dropOnto(w);
    expect(seen.map(([t]) => t)).toContain('guardian.defeated');
    expect(guardian(w).mode).toBe('defeated');
    expect(signal(w, 'g1.defeated')).toBe(true);
  });

  it('outside the window, or from too low, it shrugs her off unharmed', () => {
    const w = testLevel(BALCONY, { entities: [stone([4, 4], [1, 1, 7, 5])] });
    place(w, 4, 1);
    runUntil(w, frame(), (x) => guardian(x).mode === 'windup', secs(15));
    const seen: [string, number][] = [];
    runCollect(w, frame({ y: -0.8 }), secs(0.6), seen);
    expect(seen.map(([t]) => t)).toContain('guardian.shrug');
    expect(guardian(w).phase).toBe(1);

    const low = testLevel(
      ['#########', '#4444444#', '#.......#', '#.......#', '#.......#', '#.......#', '#########'],
      {
        entities: [stone([4, 4], [1, 1, 7, 5])],
      },
    );
    place(low, 4, 1);
    const s2 = dropOnto(low);
    expect(s2.map(([t]) => t)).toContain('guardian.shrug');
    expect(guardian(low).phase).toBe(1);
  });

  it('pistols do nothing to it', () => {
    const w = testLevel(HALL, { entities: [stone([4, 3], [1, 1, 7, 8])] });
    run(w, frame({ held: ['fire'], pressed: ['fire'] }), 1);
    run(w, frame({ held: ['fire'] }), secs(2));
    expect(w.stats.hits).toBe(0);
    expect(guardian(w).phase).toBe(1);
  });

  it('goes back to its pedestal when Nora respawns, and never leaves its hall', () => {
    const w = testLevel(HALL, { entities: [stone([4, 3], [1, 1, 7, 5])] });
    runUntil(w, frame({ y: 1 }), (x) => guardian(x).mode === 'chase', secs(3));
    run(w, frame(), secs(1.5));
    expect(guardian(w).pos.z).toBeGreaterThan(7.2);
    killPlayer(w, 'test');
    run(w, frame(), secs(tuning.respawnDelay) + 2);
    expect(w.state.player.mode).toBe('ground');
    expect(guardian(w).mode).toBe('dormant');
    expect(guardian(w).pos).toEqual({ x: 9, y: 0, z: 7 });

    // Woken, then left behind: it stays in its hall and walks home.
    runUntil(w, frame({ y: 1 }), (x) => guardian(x).mode === 'chase', secs(3));
    for (let i = 0; i < secs(12); i++) {
      stepWorld(w, frame({ y: -1 }));
      expect(cellOf(guardian(w).pos.z)).toBeLessThanOrEqual(5);
    }
    expect(guardian(w).mode).toBe('dormant');
    expect(Math.hypot(guardian(w).pos.x - 9, guardian(w).pos.z - 7)).toBeLessThan(0.3);
  });
});
