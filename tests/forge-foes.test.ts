/**
 * The Forge's foes (spec §19, chamber VI): bronze automatons, which pistols
 * barely scratch and which quench water or molten bronze ends for good; and
 * Bazûr, the bronze guardian, whose phases are lost to molten bronze poured
 * over it. Cells are world cells.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { damageEnemy } from '../src/sim/actors/enemies';
import type { EntityFile } from '../src/sim/grid/schema';
import { runActions } from '../src/sim/logic/rules';
import { enemyTypes, forge, guardianTuning as G } from '../src/sim/player/tuning';
import { migrate } from '../src/sim/save/save';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

const automaton = (w: World) => {
  const e = w.state.enemies.find((x) => x.id === 'a1');
  if (!e) throw new Error('no automaton');
  return e;
};

function collect(w: World, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    stepWorld(w, frame());
    out.push(...w.events.drain().map((e) => e.type));
  }
  return out;
}

describe('bronze automatons', () => {
  it('shrug off pistol fire: a tenth of a jackal-killing volley barely marks them', () => {
    const w = testLevel(['#######', '#..A..#', '#.....#', '#.....#', '#..S..#', '#######'], {
      legend: { A: 0 },
      entities: [{ id: 'a1', type: 'enemy', enemy: 'automaton', room: 'r', at: [3, 1] }],
    });
    for (let i = 0; i < 40; i++) damageEnemy(w, automaton(w), 1);
    expect(automaton(w).mode).not.toBe('dead');
    expect(automaton(w).health).toBeCloseTo(
      enemyTypes.automaton.health - 40 * (enemyTypes.automaton.armour ?? 1),
      5,
    );
  });

  it('are quenched for good in deep water', () => {
    const w = testLevel(['#######', '#..A..#', '#.....#', '#.....#', '#..S..#', '#######'], {
      legend: { A: 0 },
      entities: [
        { id: 'a1', type: 'enemy', enemy: 'automaton', room: 'r', at: [3, 1] },
        { id: 'sluice', type: 'watergate', room: 'r', at: [5, 4], wall: 'E', low: -4, high: 3 },
      ],
      logic: [{ when: 'flood', do: ['sluice.raise'] }],
    });
    w.state.flags.push('flood');
    const events = collect(w, ticks(20));
    expect(events).toContain('enemy.quenched');
    expect(automaton(w).mode).toBe('dead');
    expect(w.state.signals['a1.dead']).toBe(true);
  });

  it('melt in molten bronze poured over them', () => {
    const w = testLevel(['#######', '#.....#', '#ttttt#', '#.....#', '#..S..#', '#######'], {
      legend: { t: -4 },
      entities: [
        { id: 'a1', type: 'enemy', enemy: 'automaton', room: 'r', at: [5, 2] },
        {
          id: 'pour',
          type: 'pour',
          room: 'r',
          at: [1, 2],
          path: [
            [1, 2],
            [5, 2],
          ],
          h: 0,
        },
      ],
      logic: [{ when: 'go', do: ['pour.pour'] }],
    });
    run(w, frame(), 5);
    w.state.flags.push('go');
    const events = collect(w, ticks(5 / forge.pour.speed + 0.5));
    expect(events).toContain('enemy.melted');
    expect(automaton(w).dissolved).toBe(true);
  });
});

describe('Bazûr, the bronze guardian', () => {
  // A casting hall: a trench across the middle with a crucible at its west end. Nora watches
  // from beyond the arena (rows 1–4), where its fists cannot reach her.
  const hall = (): World =>
    testLevel(
      [
        '#########',
        '#.......#',
        '#.......#',
        '#ttttttt#',
        '#.......#',
        '#.......#',
        '#...S...#',
        '#########',
      ],
      {
        legend: { t: -1 },
        entities: [
          {
            id: 'bazur',
            type: 'guardian',
            kind: 'bronze',
            room: 'r',
            at: [4, 1],
            face: 'S',
            arena: [1, 1, 7, 4],
          } as EntityFile,
          {
            id: 'pour',
            type: 'pour',
            room: 'r',
            at: [1, 3],
            path: [
              [1, 3],
              [7, 3],
            ],
            h: 0,
          },
        ],
        logic: [{ when: 'go', do: ['pour.pour'] }],
      },
    );

  const bazur = (w: World) => {
    const g = w.state.guardians[0];
    if (!g) throw new Error('no guardian');
    return g;
  };

  /** Stands Bazûr in the trench and pours over it. */
  function pourOver(w: World): string[] {
    const g = bazur(w);
    g.pos = { x: 1 * 2 + 1, y: w.grid.cellFloor(1, 3), z: 3 * 2 + 1 };
    g.vel = { x: 0, z: 0 };
    g.mode = 'recover';
    g.modeTime = 0;
    runActions(w, ['pour.pour']);
    return collect(w, ticks(7 / forge.pour.speed));
  }

  it('loses a phase to molten bronze, and the same pour counts only once', () => {
    const w = hall();
    runActions(w, ['bazur.wake']);
    run(w, frame(), 10);
    const events = pourOver(w);
    expect(events.filter((t) => t === 'guardian.burned')).toHaveLength(1);
    expect(bazur(w).phase).toBe(2);
    expect(w.state.signals['bazur.phase2']).toBe(true);
    expect(bazur(w).mode).not.toBe('defeated');
  });

  it('is defeated by a second pour once its plates have cooled', () => {
    const w = hall();
    runActions(w, ['bazur.wake']);
    run(w, frame(), 10);
    pourOver(w);
    run(w, frame(), ticks(G.bronzeImmune));
    // The trench has cast into a bridge by now: Bazûr stands on it when the next pour covers it.
    pourOver(w);
    expect(bazur(w).mode).toBe('defeated');
    expect(w.state.signals['bazur.defeated']).toBe(true);
  });

  it('a stone guardian ignores molten bronze', () => {
    const w = hall();
    const g = bazur(w);
    g.kind = 'stone';
    runActions(w, ['bazur.wake']);
    run(w, frame(), 10);
    pourOver(w);
    expect(bazur(w).phase).toBe(1);
  });
});

describe('saves from before Bazûr', () => {
  it('migrate their guardians to stone with no immunity', () => {
    const g = { id: 'ubara', mode: 'dormant' };
    const save = { schema: 3, level: 'x', game: { checkpoint: { guardians: [g] }, resume: null } };
    const m = migrate(save) as { game: { checkpoint: { guardians: Record<string, unknown>[] } } } | null;
    expect(m?.game.checkpoint.guardians[0]?.kind).toBe('stone');
    expect(m?.game.checkpoint.guardians[0]?.immune).toBe(0);
  });
});
