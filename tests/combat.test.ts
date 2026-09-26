/**
 * Combat (spec §7): the jackal's perception, pathfinding, refuge behaviour
 * and bites; the pistols' cadence, hit chance and auto-aim; medkits; and the
 * checkpoint reset of enemies.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/core/events';
import { TICK_DT } from '../src/core/loop';
import { alertEnemy, damageEnemy, findEnemy } from '../src/sim/actors/enemies';
import { canStep, findPath, type NavGrid } from '../src/sim/actors/pathfind';
import type { LevelFileInput } from '../src/sim/grid/schema';
import { validateLevel } from '../src/sim/grid/validate';
import { enemyTypes, medkits, tuning, weapons } from '../src/sim/player/tuning';
import type { EnemyState } from '../src/sim/state';
import { saveCheckpoint, stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const JACKAL = enemyTypes.jackal;
const secs = (s: number): number => Math.round(s / TICK_DT);

type Entities = NonNullable<LevelFileInput['entities']>;
const jackal = (id: string, at: [number, number], pack?: string): Entities[number] =>
  pack
    ? { id, type: 'enemy', enemy: 'jackal', room: 'r', at, pack }
    : { id, type: 'enemy', enemy: 'jackal', room: 'r', at };

const enemy = (w: World, id: string): EnemyState => {
  const e = findEnemy(w, id);
  if (!e) throw new Error(`no enemy ${id}`);
  return e;
};

/** Steps `ticks` times and returns every event emitted meanwhile. */
function collect(w: World, input: Parameters<typeof run>[1], ticks: number): SimEvent[] {
  w.events.drain();
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, typeof input === 'function' ? input(i) : input);
    out.push(...w.events.drain());
  }
  return out;
}

const of = (events: SimEvent[], type: string): SimEvent[] => events.filter((e) => e.type === type);
const dist = (e: EnemyState, w: World): number =>
  Math.hypot(e.pos.x - w.state.player.pos.x, e.pos.z - w.state.player.pos.z);

describe('jackal perception', () => {
  it('sees Nora within range and line of sight', () => {
    const w = testLevel(['#########', '#.......#', '#.......#', '#.......#', '#...S...#', '#########'], {
      entities: [jackal('j', [4, 1])],
    });
    const ev = collect(w, frame(), 2);
    expect(of(ev, 'enemy.alerted')[0]).toMatchObject({ id: 'j', cause: 'sight' });
    expect(enemy(w, 'j').mode).toBe('alert');
  });

  it('does not see through walls, beyond its range or far above it', () => {
    const walled = testLevel(['#########', '#.......#', '#.......#', '#.#####.#', '#...S...#', '#########'], {
      entities: [jackal('j', [4, 1])],
    });
    run(walled, frame(), secs(2));
    expect(enemy(walled, 'j').aware).toBe(false);

    const rows = ['#####', '#...#', ...Array.from({ length: 6 }, () => '#...#'), '#.S.#', '#####'];
    const far = testLevel(rows, { entities: [jackal('j', [2, 1])] }); // 14 m away
    run(far, frame(), secs(2));
    expect(enemy(far, 'j').aware).toBe(false);

    const high = testLevel(['#######', '#.....#', '#.....#', '#88888#', '#88S88#', '#######'], {
      entities: [jackal('j', [3, 1])],
      legend: { S: 8 },
    });
    expect(high.state.player.pos.y).toBe(4);
    run(high, frame(), secs(2));
    expect(enemy(high, 'j').aware).toBe(false);
  });

  it('hears Nora running within 6 m, but not walking', () => {
    const rows = ['#########', '#.......#', '#.......#', '#########', '#...S...#', '#########'];
    const w = testLevel(rows, { entities: [jackal('j', [4, 2])] });
    run(w, frame({ x: 1, held: ['walk'] }), secs(1));
    expect(enemy(w, 'j').aware).toBe(false);
    const ev = collect(w, frame({ x: -1 }), secs(0.5));
    expect(of(ev, 'enemy.alerted')[0]).toMatchObject({ id: 'j', cause: 'noise' });
  });

  it('hears a shot within 14 m', () => {
    // Two jackals behind a wall: 12 m and 17 m from Nora.
    const rows = [
      '#########',
      '#.......#',
      '#########',
      ...Array.from({ length: 4 }, () => '#.......#'),
      '#S......#',
      '#########',
    ];
    const w = testLevel(rows, { entities: [jackal('near', [1, 1]), jackal('far', [7, 1])] });
    run(w, frame({ held: ['fire'], pressed: ['fire'] }), 1);
    run(w, frame({ held: ['fire'] }), secs(0.6));
    expect(w.stats.shots).toBeGreaterThan(0);
    expect(enemy(w, 'near').aware).toBe(true);
    expect(enemy(w, 'far').aware).toBe(false);
  });

  it('a pack hunts together: alerting one alerts its mate', () => {
    const rows = [
      '#########',
      '#.......#',
      '#.......#',
      '#.......#',
      '#...S...#',
      '#########',
      '#.......#',
      '#########',
    ];
    const w = testLevel(rows, { entities: [jackal('a', [4, 1], 'p'), jackal('b', [4, 6], 'p')] });
    const ev = collect(w, frame(), 2);
    expect(of(ev, 'enemy.alerted').map((e) => [e.id, e.cause])).toEqual([
      ['a', 'sight'],
      ['b', 'pack'],
    ]);
  });
});

describe('jackal pathfinding', () => {
  const PILLAR = ['#########', '#...S...#', '#.......#', '#..###..#', '#.......#', '#.......#', '#########'];

  it('A* goes around a pillar', () => {
    const w = testLevel(PILLAR);
    const nav: NavGrid = { q: w.grid, forbidden: () => false };
    const res = findPath(nav, JACKAL, [4, 5], [4, 1], 500);
    expect(res.reached).toBe(true);
    expect(res.path.at(-1)).toEqual([4, 1]);
    for (const [cx, cz] of res.path) expect(w.grid.cellFloor(cx, cz)).toBe(0);
    // The straight line is 4 cells; around the pillar it takes at least 5 steps.
    expect(res.path.length).toBeGreaterThanOrEqual(5);
  });

  it('climbs one click but not two, and never drops more than 1 m', () => {
    const w = testLevel(['#####', '#.S.#', '#111#', '#222#', '#####']);
    const nav: NavGrid = { q: w.grid, forbidden: () => false };
    expect(canStep(nav, JACKAL, 0, 1, 2)).toBe(true); // up 1 click
    expect(canStep(nav, JACKAL, 0, 1, 3)).toBe(false); // up 2 clicks
    expect(canStep(nav, JACKAL, 0.5, 1, 3)).toBe(true); // up 1 click again
    expect(canStep(nav, JACKAL, 2, 1, 3)).toBe(true); // a 1 m drop
    expect(canStep(nav, JACKAL, 2, 1, 2)).toBe(false); // a 1.5 m drop
    expect(canStep({ ...nav, forbidden: () => true }, JACKAL, 0, 1, 2)).toBe(false); // spikes
  });

  it('a jackal behind a pillar runs round it and reaches Nora', () => {
    const w = testLevel(PILLAR, { entities: [jackal('j', [4, 5])] });
    const j = enemy(w, 'j');
    run(w, frame(), 2);
    expect(j.aware).toBe(false); // the pillar hides her
    alertEnemy(w, j, 'noise');
    let t = 0;
    while (j.mode !== 'attack' && t < secs(6)) {
      stepWorld(w, frame());
      t++;
      expect(w.grid.cellFloor(Math.floor(j.pos.x / 2), Math.floor(j.pos.z / 2))).toBe(0);
    }
    expect(j.mode).toBe('attack');
    expect(dist(j, w)).toBeLessThanOrEqual(JACKAL.bite.range);
    // 8 m around the pillar at 4.1 m/s, plus the alert pause.
    expect(t * TICK_DT).toBeLessThan(4);
  });

  it('never drops off a 2 m platform to chase Nora', () => {
    const w = testLevel(['#######', '#44444#', '#44444#', '#.....#', '#..S..#', '#######'], {
      entities: [jackal('j', [3, 1])],
    });
    const j = enemy(w, 'j');
    expect(j.pos.y).toBe(2);
    alertEnemy(w, j, 'noise');
    run(w, frame(), secs(4));
    expect(j.pos.y).toBe(2);
    expect(j.reachable).toBe(false);
  });
});

describe('refuge', () => {
  // Nora on a 1 m pillar of rock, the jackal on the floor.
  const LEDGE = ['#########', '#.......#', '#.......#', '#.......#', '#...S...#', '#.......#', '#########'];

  it('Nora on a 1 m ledge is out of reach: the jackal prowls below and leaves after 8 s', () => {
    // Where the jackal prowls: right below her, within bite range but a metre too low.
    const below = testLevel(LEDGE, { entities: [jackal('j', [4, 1])], legend: { S: 2 } });
    run(below, (i) => (i < secs(1) ? frame({ y: 1, held: ['walk'] }) : frame()), secs(4));
    const jb = enemy(below, 'j');
    expect(jb.mode).toBe('chase');
    expect(jb.reachable).toBe(false);
    expect(dist(jb, below)).toBeLessThan(JACKAL.bite.range + 0.2);

    const w = testLevel(LEDGE, { entities: [jackal('j', [4, 1])], legend: { S: 2 } });
    const j = enemy(w, 'j');
    expect(w.state.player.pos.y).toBe(1);
    // Nora walks to the north edge of her ledge (walking never drops off it) and waits.
    const ev = collect(w, (i) => (i < secs(1) ? frame({ y: 1, held: ['walk'] }) : frame()), secs(12));
    const alerted = of(ev, 'enemy.alerted');
    const gaveUp = of(ev, 'enemy.gaveUp');
    expect(alerted).toHaveLength(1);
    expect(gaveUp).toHaveLength(1);
    expect(of(ev, 'player.hurt')).toHaveLength(0);
    const waited = ((gaveUp[0] as SimEvent).tick - (alerted[0] as SimEvent).tick) * TICK_DT;
    expect(waited).toBeCloseTo(JACKAL.alertTime + JACKAL.refugeTime, 1);
    // It walks back home and rests there, ignoring her while calm.
    expect(j.mode).toBe('idle');
    expect(Math.hypot(j.pos.x - j.home.x, j.pos.z - j.home.z)).toBeLessThan(0.35);
    expect(w.state.player.health).toBe(tuning.maxHealth);
  });

  it('a one-click ledge is no refuge', () => {
    const w = testLevel(LEDGE, { entities: [jackal('j', [4, 1])], legend: { S: 1 } });
    run(w, frame({ y: 1, held: ['walk'] }), secs(1));
    const ev = collect(w, frame(), secs(4));
    expect(of(ev, 'player.hurt').length).toBeGreaterThan(0);
  });
});

describe('jackal bite', () => {
  it('bites for 9 every 0.9 s once within 1.1 m', () => {
    const w = testLevel(['#######', '#.....#', '#.....#', '#.....#', '#..S..#', '#######'], {
      entities: [jackal('j', [3, 2])],
    });
    const ev = collect(w, frame(), secs(6.5));
    const bites = of(ev, 'player.hurt');
    expect(bites.length).toBeGreaterThanOrEqual(5);
    for (const b of bites) expect(b).toMatchObject({ amount: JACKAL.bite.damage, cause: 'jackal' });
    const gaps = bites.slice(1).map((b, i) => b.tick - (bites[i] as SimEvent).tick);
    for (const g of gaps) expect(g).toBe(secs(JACKAL.bite.interval));
    expect(w.state.player.health).toBe(tuning.maxHealth - JACKAL.bite.damage * bites.length);
    // The first bite comes after the alert pause, the approach and the wind-up.
    const first = (bites[0] as SimEvent).tick * TICK_DT;
    expect(first).toBeGreaterThan(JACKAL.alertTime + JACKAL.bite.windup);
  });

  it('twelve bites kill Nora', () => {
    const w = testLevel(['#######', '#.....#', '#.....#', '#..S..#', '#######'], {
      entities: [jackal('j', [3, 1])],
    });
    const ev = collect(w, frame(), secs(13.5));
    expect(of(ev, 'player.died')[0]).toMatchObject({ cause: 'jackal' });
    expect(of(ev, 'player.hurt').length).toBe(Math.ceil(tuning.maxHealth / JACKAL.bite.damage));
  });
});

/** Jackals across a pit they cannot cross: always in sight, never in reach. */
const MOAT = ['#########', '#.......#', '#.......#', '#_______#', '#.......#', '#...S...#', '#########'];

describe('pistols', () => {
  it('draw and holster with the weapons button; Fire draws them too; interactions holster them', () => {
    const w = testLevel(['#####', '#...#', '#.S.#', '#####'], {
      entities: [{ id: 'l', type: 'lever', room: 'r', at: [2, 2], wall: 'S' }],
    });
    const wp = w.state.player.weapon;
    let ev = collect(w, frame({ pressed: ['weapons'] }), 1);
    expect(wp.drawn).toBe(true);
    expect(of(ev, 'weapons.drawn')).toHaveLength(1);
    ev = collect(w, frame({ pressed: ['weapons'] }), 1);
    expect(wp.drawn).toBe(false);
    expect(of(ev, 'weapons.holstered')[0]).toMatchObject({ auto: false });
    collect(w, frame({ pressed: ['fire'] }), 1);
    expect(wp.drawn).toBe(true);
    ev = collect(w, frame({ pressed: ['action'] }), 2);
    expect(w.state.player.mode).toBe('lever');
    expect(wp.drawn).toBe(false);
    expect(of(ev, 'weapons.holstered')[0]).toMatchObject({ auto: true });
  });

  it('fires every 0.24 s, alternating hands; with no target, ahead with no effect', () => {
    const w = testLevel(['#####', '#...#', '#.S.#', '#####']);
    const ev = collect(
      w,
      (i) => frame({ held: ['fire'], pressed: i === 0 ? ['fire'] : [] }),
      secs(0.3 + 4.8),
    );
    const shots = of(ev, 'weapon.fired');
    // The first shot after the draw, then one every 0.24 s (ticks quantise single gaps to 14 or 15).
    expect(shots.length).toBeGreaterThanOrEqual(Math.floor(4.8 / weapons.pistols.cadence));
    expect(shots.length).toBeLessThanOrEqual(Math.floor(4.8 / weapons.pistols.cadence) + 1);
    expect((shots[0] as SimEvent).tick * TICK_DT).toBeCloseTo(weapons.drawTime, 1);
    const first = shots[0] as SimEvent;
    const last = shots.at(-1) as SimEvent;
    expect(((last.tick - first.tick) * TICK_DT) / (shots.length - 1)).toBeCloseTo(weapons.pistols.cadence, 2);
    expect(shots.map((s) => s.hand).slice(0, 4)).toEqual([1, 0, 1, 0]);
    for (const s of shots) expect(s).toMatchObject({ target: null, hit: false });
    expect(of(ev, 'enemy.hit')).toHaveLength(0);
  });

  it('hits 85% of shots at a visible target, deterministically for a seed', () => {
    const sequence = (seed: number): boolean[] => {
      const w = testLevel(MOAT, { entities: [jackal('A', [2, 1])] });
      w.rng.state = seed;
      enemy(w, 'A').health = 1e6;
      const ev = collect(w, (i) => frame({ held: ['fire'], pressed: i === 0 ? ['fire'] : [] }), secs(60));
      return of(ev, 'weapon.fired')
        .filter((s) => s.target === 'A')
        .map((s) => s.hit === true);
    };
    const a = sequence(7);
    const b = sequence(7);
    const c = sequence(8);
    expect(a.length).toBeGreaterThan(200);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    const rate = a.filter(Boolean).length / a.length;
    expect(rate).toBeGreaterThan(weapons.pistols.hitChance - 0.05);
    expect(rate).toBeLessThan(weapons.pistols.hitChance + 0.05);
  });

  it('four hits kill a jackal', () => {
    const w = testLevel(MOAT, { entities: [jackal('A', [2, 1])] });
    const ev = collect(w, (i) => frame({ held: ['fire'], pressed: i === 0 ? ['fire'] : [] }), secs(4));
    const hits = of(ev, 'enemy.hit');
    expect(hits.map((h) => h.health)).toEqual([3, 2, 1, 0]);
    expect(of(ev, 'enemy.died')[0]).toMatchObject({ id: 'A' });
    expect(enemy(w, 'A').mode).toBe('dead');
    expect(w.state.signals['A.dead']).toBe(true);
    // Once it is dead there is nothing left to lock.
    expect(w.state.player.weapon.target).toBeNull();
  });

  it('auto-aim locks the nearest visible enemy, keeps it and switches by hand', () => {
    const w = testLevel(MOAT, { entities: [jackal('A', [2, 2]), jackal('B', [6, 1])] });
    const wp = w.state.player.weapon;
    stepWorld(w, frame({ held: ['fire'], pressed: ['fire'] }));
    expect(wp.target).toBe('A');
    // B comes closer: the lock does not change on its own.
    const b = enemy(w, 'B');
    b.pos = { x: 9, y: 0, z: 5.5 };
    stepWorld(w, frame({ held: ['fire'] }));
    expect(wp.target).toBe('A');
    stepWorld(w, frame({ held: ['fire'], pressed: ['target'] }));
    expect(wp.target).toBe('B');
    stepWorld(w, frame({ held: ['fire'], pressed: ['target'] }));
    expect(wp.target).toBe('A');
    // A dies: the lock moves to the next visible enemy.
    damageEnemy(w, enemy(w, 'A'), 99);
    stepWorld(w, frame({ held: ['fire'] }));
    expect(wp.target).toBe('B');
    // Releasing Fire drops the lock.
    stepWorld(w, frame());
    expect(wp.target).toBeNull();
  });

  it('standing still, Nora turns to her target; running, she keeps her course and speed', () => {
    const w = testLevel(MOAT, { entities: [jackal('A', [1, 1])] });
    run(w, (i) => frame({ held: ['fire'], pressed: i === 0 ? ['fire'] : [] }), secs(1));
    const a = enemy(w, 'A');
    const want = Math.atan2(-(a.pos.x - w.state.player.pos.x), -(a.pos.z - w.state.player.pos.z));
    expect(Math.abs(w.state.player.yaw - want)).toBeLessThan(0.1);

    // Running east along the moat, shooting at a jackal across it.
    const r = testLevel(
      [
        '###########',
        '#.........#',
        '#.........#',
        '#_________#',
        '#.........#',
        '#S........#',
        '###########',
      ],
      { entities: [jackal('A', [5, 1])] },
    );
    enemy(r, 'A').health = 1e6;
    const ev = collect(
      r,
      (i) => frame({ x: 1, held: ['fire'], pressed: i === 0 ? ['fire'] : [] }),
      secs(1.2),
    );
    expect(r.state.player.yaw).toBeCloseTo(-Math.PI / 2, 2);
    const v = r.state.player.vel;
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(tuning.runSpeed, 1);
    expect(of(ev, 'weapon.fired').filter((s) => s.target === 'A').length).toBeGreaterThan(2);
  });
});

describe('medkits', () => {
  const room = (): World => testLevel(['#####', '#...#', '#.S.#', '#####']);

  it('uses the smallest kit that heals fully, else the largest', () => {
    const w = room();
    const p = w.state.player;
    w.state.inventory = { medkit_small: 1, medkit_large: 1 };
    p.health = 60;
    let ev = collect(w, frame({ pressed: ['medkit'] }), 1);
    expect(of(ev, 'medkit.used')[0]).toMatchObject({ size: 'small', heal: 40 });
    expect(p.health).toBe(100);
    p.health = 20;
    ev = collect(w, frame({ pressed: ['medkit'] }), 1);
    expect(of(ev, 'medkit.used')[0]).toMatchObject({ size: 'large', heal: 80 });
    expect(p.health).toBe(100);
    expect(w.state.inventory).toEqual({ medkit_small: 0, medkit_large: 0 });
    expect(w.stats.medkitsUsed).toBe(2);
  });

  it('a small kit heals 50; nothing happens at full health or without kits', () => {
    const w = room();
    const p = w.state.player;
    w.state.inventory = { medkit_small: 2 };
    collect(w, frame({ pressed: ['medkit'] }), 1);
    expect(w.state.inventory.medkit_small).toBe(2);
    p.health = 10;
    collect(w, frame({ pressed: ['medkit'] }), 1);
    expect(p.health).toBe(10 + medkits.small);
    w.state.inventory = {};
    const ev = collect(w, frame({ pressed: ['medkit'] }), 1);
    expect(of(ev, 'medkit.none')).toHaveLength(1);
    expect(p.health).toBe(10 + medkits.small);
  });
});

describe('checkpoints', () => {
  it('respawning sends living enemies home and makes them forget Nora; the dead stay dead', () => {
    // Nora waits out of sight behind a wall; B comes round through the gap.
    const w = testLevel(
      ['#########', '#.......#', '#.......#', '#.......#', '#######.#', '#S......#', '#########'],
      {
        entities: [jackal('A', [2, 1]), jackal('B', [6, 1])],
      },
    );
    damageEnemy(w, enemy(w, 'A'), 99);
    saveCheckpoint(w);
    const b = enemy(w, 'B');
    run(w, frame(), secs(1));
    expect(b.aware).toBe(false);
    alertEnemy(w, b, 'noise');
    for (let i = 0; i < secs(8) && b.mode !== 'attack'; i++) stepWorld(w, frame());
    expect(b.mode).toBe('attack');
    damageEnemy(w, b, 1);
    w.state.player.health = 1;
    for (let i = 0; i < secs(2) && w.state.player.mode !== 'dead'; i++) stepWorld(w, frame());
    expect(w.state.player.mode).toBe('dead');
    const ev = collect(w, frame(), secs(tuning.respawnDelay) + secs(1));
    expect(of(ev, 'player.respawned')).toHaveLength(1);
    const a2 = enemy(w, 'A');
    const b2 = enemy(w, 'B');
    expect(a2.mode).toBe('dead');
    expect(b2).toMatchObject({ mode: 'idle', aware: false, health: JACKAL.health, path: [] });
    expect(b2.pos).toEqual(b2.home);
    expect(w.state.player.weapon.target).toBeNull();
  });
});

describe('level format', () => {
  const level = (entities: unknown[]): unknown => ({
    schema: 1,
    id: 't',
    name: 't',
    start: { room: 'r', at: [1, 1], face: 'N' },
    rooms: [
      {
        id: 'r',
        origin: [0, 0, 0],
        ceil: 16,
        legend: { '#': 'wall', '.': 0 },
        rows: ['####', '#..#', '#..#', '####'],
      },
    ],
    entities,
  });

  it('accepts jackals and rejects unknown enemy types', () => {
    const ok = validateLevel(level([{ id: 'j', type: 'enemy', enemy: 'jackal', room: 'r', at: [2, 2] }]));
    expect(ok.errors).toEqual([]);
    const bad = validateLevel(level([{ id: 'j', type: 'enemy', enemy: 'dragon', room: 'r', at: [2, 2] }]));
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('warns about a pack of one and knows the dead signal', () => {
    const res = validateLevel({
      ...(level([{ id: 'j', type: 'enemy', enemy: 'jackal', room: 'r', at: [2, 2], pack: 'p' }]) as object),
      logic: [{ when: 'j.dead', do: ['flag set clear'] }],
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings).toContain("pack 'p' has a single member");
  });
});
