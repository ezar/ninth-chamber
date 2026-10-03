/**
 * The Bronze Forge's mechanisms (spec §19, chamber VI): molten bronze that
 * runs along a trench, kills while it glows and cools into a bridge; pours
 * that repeat and cover their own bridge; heat that drains health away from
 * the shade; bellows that wake a forge from its plate.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { forge, tuning } from '../src/sim/player/tuning';
import { migrate } from '../src/sim/save/save';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

/**
 * A hall crossed by a trench (row 3, two metres deep) with a crucible at its
 * west end. Nora starts south of it; the far side is north.
 */
function trench(extra: Record<string, unknown> = {}, logic: { when: string; do: string[] }[] = []): World {
  return testLevel(['#######', '#.....#', '#.....#', '#ttttt#', '#.....#', '#..S..#', '#######'], {
    legend: { t: -4 },
    entities: [
      {
        id: 'pour',
        type: 'pour',
        room: 'r',
        at: [1, 3],
        path: [
          [1, 3],
          [5, 3],
        ],
        h: 0,
        ...extra,
      },
    ],
    logic: [{ when: 'go', do: ['pour.pour'] }, ...logic],
  });
}

const pour = (w: World) => {
  const s = w.state.mechanisms.pours[0];
  if (!s) throw new Error('no pour');
  return s;
};

describe('pours', () => {
  it('run along the trench, glow, and cool into a bridge at its lip', () => {
    const w = trench();
    expect(w.grid.cellFloor(3, 3)).toBe(-2);
    w.state.flags.push('go');
    run(w, frame(), 2);
    expect(pour(w).phase).toBe('flowing');
    expect(w.state.signals['pour.molten']).toBe(true);
    // Five cells at 2.5 cells/s: full in two seconds, solid after the cooling time.
    run(w, frame(), ticks(5 / forge.pour.speed));
    expect(pour(w).phase).toBe('hot');
    expect(w.grid.cellFloor(3, 3)).toBe(0);
    run(w, frame(), ticks(forge.pour.cool));
    expect(pour(w).phase).toBe('solid');
    expect(w.state.signals['pour.solid']).toBe(true);
    // The bridge carries her across.
    run(w, frame({ y: 1 }), ticks(2.5));
    expect(w.state.player.mode).not.toBe('dead');
    expect(Math.floor(w.state.player.pos.z / 2)).toBeLessThan(3);
  });

  it('kill whoever stands in the trench when the bronze reaches them', () => {
    const w = trench();
    const p = w.state.player;
    p.pos = { x: 5 * 2 + 1, y: -2, z: 3 * 2 + 1 };
    run(w, frame(), 10);
    expect(p.mode).not.toBe('dead');
    w.state.flags.push('go');
    const events: string[] = [];
    for (let i = 0; i < ticks(3) && p.mode !== 'dead'; i++) {
      stepWorld(w, frame());
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(p.mode).toBe('dead');
    expect(events).toContain('player.burned');
  });

  it('cannot be crossed while hot: the bridge only holds once it is dark', () => {
    const w = trench();
    w.state.flags.push('go');
    run(w, frame(), ticks(5 / forge.pour.speed) + 10);
    expect(pour(w).phase).toBe('hot');
    run(w, frame({ y: 1 }), ticks(1.5));
    expect(w.state.player.mode).toBe('dead');
  });

  it('repeat on their period, rumble first, and cover their own bridge', () => {
    const period = 10;
    const w = trench({ period, running: true });
    const events: string[] = [];
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) {
        stepWorld(w, frame());
        events.push(...w.events.drain().map((e) => e.type));
      }
    };
    step(ticks(period - forge.pour.warning));
    expect(events).toContain('bronze.warn');
    step(ticks(forge.pour.warning));
    expect(events).toContain('bronze.pour');
    step(ticks(5 / forge.pour.speed + forge.pour.cool));
    expect(pour(w).phase).toBe('solid');
    // Stand on the bridge until the next pour: it covers her.
    const p = w.state.player;
    p.pos = { x: 1 * 2 + 1, y: 0, z: 3 * 2 + 1 };
    step(ticks(period));
    expect(p.mode).toBe('dead');
  });

  it('stop repeating on `stop`, keeping the bridge', () => {
    const w = trench({ period: 8, running: true }, [{ when: 'halt', do: ['pour.stop'] }]);
    run(w, frame(), ticks(8 + 5 / forge.pour.speed + forge.pour.cool));
    expect(pour(w).cast).toBe(true);
    w.state.flags.push('halt');
    run(w, frame(), ticks(20));
    expect(pour(w).phase).toBe('solid');
  });
});

describe('heat', () => {
  // A furnace room: open heat, with shade along the north wall (row 1).
  const furnace = (logic: { when: string; do: string[] }[] = []): World =>
    testLevel(['#####', '#sss#', '#...#', '#.S.#', '#####'], {
      legend: { s: { floor: 0, flags: ['shade'] } },
      entities: [{ id: 'heat', type: 'heat', room: 'r', at: [1, 1], size: [3, 3] }],
      logic,
    });

  it('drains health in the open and kills in the end', () => {
    const w = furnace();
    const events: string[] = [];
    stepWorld(w, frame());
    events.push(...w.events.drain().map((e) => e.type));
    expect(events).toContain('heat.enter');
    run(w, frame(), ticks(5));
    expect(w.state.player.health).toBeLessThan(tuning.maxHealth - forge.heat.rate * 4);
    run(w, frame(), ticks(tuning.maxHealth / forge.heat.rate));
    expect(w.stats.deaths).toBe(1);
  });

  it('spares her in the shade of the wall', () => {
    const w = furnace();
    run(w, frame({ y: 1 }), ticks(1));
    run(w, frame(), ticks(10));
    expect(Math.floor(w.state.player.pos.z / 2)).toBe(1);
    const h = w.state.player.health;
    run(w, frame(), ticks(5));
    expect(w.state.player.health).toBe(h);
    expect(w.state.mechanisms.scorched).toBe(false);
  });

  it('stops when its furnace is put out', () => {
    const w = furnace([{ when: 'cool', do: ['heat.off'] }]);
    w.state.flags.push('cool');
    run(w, frame(), ticks(5));
    expect(w.state.player.health).toBe(tuning.maxHealth);
  });
});

describe('bellows', () => {
  it('pushed onto its plate, wake the forge, whose heat opens the door', () => {
    const w = testLevel(['#####', '#...#', '#...#', '#...#', '#.S.#', '#####'], {
      entities: [
        { id: 'bellows', type: 'block', look: 'bellows', room: 'r', at: [2, 3] },
        { id: 'plate', type: 'plate', room: 'r', at: [2, 2] },
        { id: 'forge', type: 'brazier', room: 'r', at: [1, 1], lit: false },
        { id: 'door', type: 'door', room: 'r', at: [2, 1] },
      ],
      logic: [
        { when: 'plate.pressed', do: ['forge.light'] },
        { when: 'forge.lit', do: ['door.open'] },
      ],
    });
    expect(w.state.signals['forge.lit']).not.toBe(true);
    // Push the bellows north.
    run(w, frame({ y: 1, held: ['walk'] }), 30);
    run(w, frame({ held: ['action'] }), 1);
    run(w, frame({ y: 1, held: ['action'] }), ticks(tuning.pushTime + 0.3));
    run(w, frame(), 30);
    expect(w.state.signals['forge.lit']).toBe(true);
    const door = w.state.actors.find((a) => a.id === 'door');
    expect(door && door.kind === 'door' && door.target).toBe(1);
  });
});

describe('saves from before the Forge', () => {
  it('migrate with no pours, no heat and Nora out of the heat', () => {
    const state = { mechanisms: { glyphs: [], darts: [] }, player: { poison: 0 } };
    const save = { schema: 2, level: 'x', game: { checkpoint: structuredClone(state), resume: null } };
    const m = migrate(save) as { game: { checkpoint: { mechanisms: Record<string, unknown> } } } | null;
    expect(m?.game.checkpoint.mechanisms.pours).toEqual([]);
    expect(m?.game.checkpoint.mechanisms.heat).toEqual([]);
    expect(m?.game.checkpoint.mechanisms.scorched).toBe(false);
  });
});
