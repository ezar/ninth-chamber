/**
 * The Wind Stair's gusts (spec §19, chamber VII): "with a following gust a
 * running jump crosses 3 blocks". Wind zones carry Nora along in the air,
 * hold her up in an updraught, push her on the ground without ever dropping
 * her off an edge, and tear her off a ledge when a gust blows on her long
 * enough. Camera yaw 0: forward is north (-Z).
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import type { LevelFileInput } from '../src/sim/grid/schema';
import { tuning, wind } from '../src/sim/player/tuning';
import { migrate } from '../src/sim/save/save';
import { validateLevel } from '../src/sim/grid/validate';
import { stepWorld, type World } from '../src/sim/world';
import { cellZ, frame, run, runUntil, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

type WindOpts = Partial<{
  at: [number, number];
  size: [number, number];
  dir: 'N' | 'E' | 'S' | 'W' | 'up';
  period: number;
  blow: number;
  offset: number;
  tear: boolean;
  on: boolean;
}>;

type Entity = NonNullable<LevelFileInput['entities']>[number];

const zone = (o: WindOpts = {}): Entity => ({
  id: 'gust',
  type: 'wind',
  room: 'r',
  at: [1, 1],
  size: [3, 12],
  dir: 'N',
  ...o,
});

/** Runs north and jumps at the edge of the gap; true when she lands or grabs beyond it. */
function runningJump(w: World, edgeZ: number, farZ: number): boolean {
  run(w, frame({ y: 1 }), 30);
  runUntil(w, frame({ y: 1 }), (x) => x.state.player.pos.z <= edgeZ + 0.1);
  stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
  runUntil(w, frame({ y: 1 }), (x) => x.state.player.mode !== 'air', 180);
  const p = w.state.player;
  return (p.mode === 'ground' && p.pos.y === 0 && p.pos.z < farZ) || p.mode === 'hang' || p.mode === 'climb';
}

describe('gusts in the air', () => {
  // A 3-block gap (6 m), rows 3–5; the near edge is at z = 12.
  const GAP3 = [
    '#####',
    '#...#',
    '#...#',
    '#___#',
    '#___#',
    '#___#',
    '#...#',
    '#...#',
    '#...#',
    '#.S.#',
    '#####',
  ];
  // A 2-block gap (4 m), rows 3–4; the near edge is at z = 10.
  const GAP2 = ['#####', '#...#', '#...#', '#___#', '#___#', '#...#', '#...#', '#...#', '#.S.#', '#####'];

  it('without wind, a running jump does not clear 3 blocks', () => {
    const w = testLevel(GAP3);
    expect(runningJump(w, 12, 6)).toBe(false);
  });

  it('with a following gust, a running jump clears 3 blocks', () => {
    const w = testLevel(GAP3, { entities: [zone({ dir: 'N' })] });
    expect(runningJump(w, 12, 6)).toBe(true);
  });

  it('a head gust stops a running jump clearing 2 blocks', () => {
    const w = testLevel(GAP2, { entities: [zone({ dir: 'S' })] });
    expect(runningJump(w, 10, 6)).toBe(false);
  });

  it('a gust only blows in its zone and on its cycle: in the lull the jump is short again', () => {
    // The gust blows for 1 s out of every 20, at the very start: long over by the jump.
    const w = testLevel(GAP3, { entities: [zone({ dir: 'N', period: 20, blow: 1 })] });
    expect(runningJump(w, 12, 6)).toBe(false);
  });

  it('an updraught lets a jump reach a ledge out of reach', () => {
    const wall = (clicks: number): string[] => [
      '#####',
      `#${String(clicks).repeat(3)}#`,
      '#...#',
      '#.S.#',
      '#####',
    ];
    const reach = (entities: Entity[]): boolean => {
      const w = testLevel(wall(9), { entities });
      run(w, frame({ y: 1 }), 60);
      stepWorld(w, frame({ pressed: ['jump'] }));
      runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 90);
      return w.state.player.mode === 'hang';
    };
    expect(reach([])).toBe(false);
    expect(reach([zone({ dir: 'up', at: [1, 2], size: [3, 2] })])).toBe(true);
  });

  it('an updraught slows a fall but the height fallen still hurts', () => {
    const rows = ['#####', '#...#', '#...#', '#___#', '#.S.#', '#####'];
    const fallTime = (entities: Entity[]): { t: number; hurt: boolean } => {
      const w = testLevel(rows, { legend: { _: -9 }, entities });
      let hurt = false;
      run(w, frame({ y: 1, held: [] }), 12);
      const t = runUntil(
        w,
        frame(),
        (x) => {
          if (x.events.drain().some((e) => e.type === 'player.hurt')) hurt = true;
          return x.state.player.mode === 'ground' && x.state.player.pos.y < -1;
        },
        300,
      );
      return { t, hurt };
    };
    const still = fallTime([]);
    const held = fallTime([zone({ dir: 'up', at: [1, 3], size: [3, 1] })]);
    expect(held.t).toBeGreaterThan(still.t * 1.2);
    expect(still.hurt).toBe(true);
    expect(held.hurt).toBe(true);
  });
});

describe('gusts on the ground', () => {
  it('push her along, slower than she walks against them', () => {
    const rows = ['#######', '#.....#', '#.....#', '#..S..#', '#.....#', '#######'];
    const w = testLevel(rows, { entities: [zone({ dir: 'E', at: [1, 1], size: [5, 4] })] });
    const x0 = w.state.player.pos.x;
    run(w, frame(), ticks(1));
    expect(w.state.player.pos.x).toBeGreaterThan(x0 + wind.speed * wind.ground * 0.8);
    // Walking west, into it, still gets her somewhere.
    const x1 = w.state.player.pos.x;
    run(w, frame({ x: -1, held: ['walk'] }), ticks(1));
    expect(w.state.player.pos.x).toBeLessThan(x1 - 0.5);
  });

  it('never push her off an edge', () => {
    // A ledge row with a deadly drop east of it.
    const rows = ['#######', '#...__#', '#.S.__#', '#...__#', '#######'];
    const w = testLevel(rows, {
      legend: { _: 'pit' },
      entities: [zone({ dir: 'E', at: [1, 1], size: [5, 3] })],
    });
    run(w, frame(), ticks(8));
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.player.pos.y).toBe(0);
    // Blown right up to the edge of the drop (x = 8), but not over it.
    expect(w.state.player.pos.x).toBeGreaterThan(7);
    expect(w.state.player.pos.x).toBeLessThan(8);
  });
});

describe('gusts on ledges', () => {
  const wall = ['#####', '#666#', '#...#', '#.S.#', '#####'];

  /** Jumps to the ledge and hangs. */
  function hangOn(w: World): void {
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 60);
    expect(w.state.player.mode).toBe('hang');
  }

  it('a tearing gust pulls her off once it has blown on her long enough', () => {
    const w = testLevel(wall, { entities: [zone({ dir: 'S', at: [1, 2], size: [3, 1], tear: true })] });
    hangOn(w);
    const events: string[] = [];
    for (let i = 0; i < ticks(wind.grip + 0.2) && w.state.player.mode === 'hang'; i++) {
      stepWorld(w, frame());
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(w.state.player.mode).not.toBe('hang');
    expect(events).toContain('player.torn');
  });

  it('in the lull between gusts she holds on', () => {
    // Gusts of 1 s every 30 s, the first long past by the time she hangs.
    const w = testLevel(wall, {
      entities: [zone({ dir: 'S', at: [1, 2], size: [3, 1], tear: true, period: 30, blow: 1 })],
    });
    hangOn(w);
    run(w, frame(), ticks(5));
    expect(w.state.player.mode).toBe('hang');
  });

  it('a gust too short for her grip does not tear her off', () => {
    const w = testLevel(wall, {
      entities: [zone({ dir: 'S', at: [1, 2], size: [3, 1], tear: true, period: 4, blow: wind.grip * 0.8 })],
    });
    hangOn(w);
    run(w, frame(), ticks(12));
    expect(w.state.player.mode).toBe('hang');
  });

  it('a gust that does not tear lets her hang through it', () => {
    const w = testLevel(wall, { entities: [zone({ dir: 'S', at: [1, 2], size: [3, 1] })] });
    hangOn(w);
    run(w, frame(), ticks(3));
    expect(w.state.player.mode).toBe('hang');
    expect(cellZ(w)).toBe(2);
  });
});

describe('the gust cycle', () => {
  const room = ['#####', '#...#', '#...#', '#.S.#', '#####'];

  it('the flutes warn before each gust, which blows and dies down', () => {
    const period = 6;
    const blow = 2;
    const w = testLevel(room, { entities: [zone({ period, blow, offset: blow, size: [3, 3] })] });
    const seen: { type: string; t: number }[] = [];
    for (let i = 0; i < ticks(period * 2); i++) {
      stepWorld(w, frame());
      for (const e of w.events.drain())
        if (e.type.startsWith('wind.')) seen.push({ type: e.type, t: (i + 1) * TICK_DT });
    }
    const types = seen.map((s) => s.type);
    expect(types.slice(0, 3)).toEqual(['wind.warn', 'wind.gust', 'wind.calm']);
    const warn = seen[0]?.t ?? 0;
    const gust = seen[1]?.t ?? 0;
    expect(gust - warn).toBeCloseTo(wind.warning, 1);
    expect(w.state.signals['gust.gust']).toBeDefined();
  });

  it('a steady wind announces its gust once, so its sound starts', () => {
    const w = testLevel(room, { entities: [zone({ size: [3, 3] })] });
    const types: string[] = [];
    for (let i = 0; i < ticks(3); i++) {
      stepWorld(w, frame());
      types.push(
        ...w.events
          .drain()
          .map((e) => e.type)
          .filter((t) => t.startsWith('wind.')),
      );
    }
    expect(types).toEqual(['wind.gust']);
  });

  it('a zone with no cells is a level error', () => {
    const lv = {
      schema: 1,
      id: 't',
      name: 't',
      start: { room: 'r', at: [2, 3], face: 'N' },
      rooms: [
        {
          id: 'r',
          origin: [0, 0, 0],
          ceil: 24,
          legend: { '#': 'wall', '.': 0 },
          rows: room.map((r) => r.replace('S', '.')),
        },
      ],
      entities: [{ id: 'gust', type: 'wind', room: 'r', at: [1, 1], size: [0, 3], dir: 'N' }],
      logic: [],
    };
    expect(validateLevel(lv).errors.some((e) => e.includes('size'))).toBe(true);
  });

  it('rules turn a zone on and off (the flute levers)', () => {
    const w = testLevel(room, {
      entities: [zone({ size: [3, 3], on: false })],
      logic: [
        { when: 'open', do: ['gust.on'] },
        { when: 'shut', do: ['gust.toggle'] },
      ],
    });
    run(w, frame(), 5);
    expect(w.state.signals['gust.gust']).toBe(false);
    w.state.flags.push('open');
    run(w, frame(), 5);
    expect(w.state.signals['gust.gust']).toBe(true);
    w.state.flags.push('shut');
    run(w, frame(), 5);
    expect(w.state.signals['gust.gust']).toBe(false);
  });

  it('the same inputs give the same world (replay), with wind', () => {
    const make = (): World => testLevel(room, { entities: [zone({ size: [3, 3], period: 3, blow: 1 })] });
    const a = make();
    const b = make();
    for (let i = 0; i < 300; i++) {
      const f = frame({ x: Math.sin(i / 20), y: Math.cos(i / 30), pressed: i % 50 === 0 ? ['jump'] : [] });
      stepWorld(a, f);
      stepWorld(b, f);
    }
    expect(a.state.player.pos).toEqual(b.state.player.pos);
  });
});

describe('saves from before the wind', () => {
  it('migrate with no wind zones', () => {
    const save = {
      schema: 4,
      level: 'x',
      game: { checkpoint: { mechanisms: { pours: [] } }, resume: null },
    };
    const m = migrate(save) as { game: { checkpoint: { mechanisms: Record<string, unknown> } } } | null;
    expect(m?.game.checkpoint.mechanisms.winds).toEqual([]);
  });
});

it('the gust speed lengthens a level running jump by about a block', () => {
  // Air time of a jump landing at the same height, times the gust's speed.
  const air = (2 * tuning.jumpSpeed) / tuning.gravity;
  expect(air * wind.speed).toBeGreaterThan(1.8);
  expect(air * wind.speed).toBeLessThan(2.4);
});
