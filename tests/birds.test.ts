/**
 * The Wind Stair's rock birds (spec §19, chamber VII): they perch until they
 * see Nora, dive at her and shove her instead of biting, climb away and dive
 * again; two pistol hits bring one down. A shove can knock her off a ledge.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { damageEnemy } from '../src/sim/actors/enemies';
import { enemyTypes } from '../src/sim/player/tuning';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, runUntil, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

const bird = (w: World) => {
  const e = w.state.enemies.find((x) => x.id === 'b1');
  if (!e) throw new Error('no bird');
  return e;
};

/** A tall hall with a nest at the far end. */
function hall(rows = ['#######', '#..N..#', '#.....#', '#.....#', '#.....#', '#..S..#', '#######']): World {
  return testLevel(rows, {
    legend: { N: 0 },
    entities: [{ id: 'b1', type: 'enemy', enemy: 'bird', room: 'r', at: [3, 1], face: 'S' }],
  });
}

function collect(w: World, n: number, input = frame()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    stepWorld(w, input);
    out.push(...w.events.drain().map((e) => e.type));
  }
  return out;
}

describe('rock birds', () => {
  it('perch until they see her, then screech, rise and dive', () => {
    const w = hall();
    const events = collect(w, ticks(enemyTypes.bird.alertTime + 0.2));
    expect(events).toContain('enemy.alerted');
    expect(bird(w).pos.y).toBeGreaterThan(0.3);
  });

  it('stay perched while she is out of sight', () => {
    // A wall between the nest and Nora.
    const w = hall(['#######', '#..N..#', '#.....#', '#######', '#.....#', '#..S..#', '#######']);
    run(w, frame(), ticks(3));
    expect(bird(w).mode).toBe('idle');
    expect(bird(w).pos.y).toBe(0);
  });

  it('shove her instead of biting: a little damage and a push along the dive', () => {
    const w = hall();
    const z0 = w.state.player.pos.z;
    const h0 = w.state.player.health;
    const events = collect(w, ticks(4));
    expect(events).toContain('enemy.shove');
    expect(w.state.player.health).toBe(h0 - enemyTypes.bird.bite.damage);
    // The bird dives from the north: she is pushed south.
    expect(w.state.player.pos.z).toBeGreaterThan(z0 + 0.3);
  });

  it('climb away after a shove and dive again', () => {
    const w = hall();
    const events = collect(w, ticks(10));
    expect(events.filter((t) => t === 'enemy.shove').length).toBeGreaterThanOrEqual(2);
  });

  it('knock her off a ledge', () => {
    // She hangs from a 6-click ledge on the north wall; the nest is across the room.
    const rows = ['#######', '#66666#', '#.....#', '#.....#', '#..S..#', '#.....#', '#..N..#', '#######'];
    const w = testLevel(rows, {
      legend: { N: 0 },
      entities: [{ id: 'b1', type: 'enemy', enemy: 'bird', room: 'r', at: [3, 6], face: 'N' }],
    });
    // Out of sight first: the bird is put to sleep until she hangs.
    bird(w).calm = 1e9;
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 90);
    expect(w.state.player.mode).toBe('hang');
    bird(w).calm = 0;
    const events = collect(w, ticks(5));
    expect(events).toContain('player.torn');
    expect(w.state.player.mode).not.toBe('hang');
  });

  it('fall to two pistol hits', () => {
    const w = hall();
    run(w, frame(), ticks(1.2));
    damageEnemy(w, bird(w), 1);
    expect(bird(w).mode).not.toBe('dead');
    damageEnemy(w, bird(w), 1);
    expect(bird(w).mode).toBe('dead');
    expect(w.state.signals['b1.dead']).toBe(true);
    run(w, frame(), ticks(2));
    expect(bird(w).pos.y).toBeCloseTo(0, 5);
  });

  it('never fly into walls, floor or ceiling', () => {
    const w = testLevel(['#######', '#..N..#', '#.....#', '#.....#', '#..S..#', '#######'], {
      legend: { N: 0 },
      ceil: 6,
      entities: [{ id: 'b1', type: 'enemy', enemy: 'bird', room: 'r', at: [3, 1], face: 'S' }],
    });
    for (let i = 0; i < ticks(15); i++) {
      // Nora runs about to draw it around the room.
      stepWorld(w, frame({ x: Math.sin(i / 40), y: Math.cos(i / 55) }));
      const e = bird(w);
      expect(e.pos.x).toBeGreaterThan(2);
      expect(e.pos.x).toBeLessThan(12);
      expect(e.pos.z).toBeGreaterThan(2);
      expect(e.pos.z).toBeLessThan(10);
      expect(e.pos.y).toBeGreaterThanOrEqual(0);
      expect(e.pos.y + enemyTypes.bird.height).toBeLessThanOrEqual(3);
    }
  });

  it('go home to the nest once she is down', () => {
    const w = hall();
    run(w, frame(), ticks(1.5));
    w.state.player.health = 1;
    runUntil(w, frame(), (x) => x.state.player.mode === 'dead', ticks(10));
    expect(w.state.player.mode).toBe('dead');
    run(w, frame(), ticks(1));
    expect(['flee', 'idle']).toContain(bird(w).mode);
  });

  it('never fly into a cell too low for their body', () => {
    // A strip of low ceiling (1.5 m) between the nest and Nora: the bird dives at her chest, where
    // its back would scrape that ceiling, so it must not cross (rather than snap down under it).
    const w = testLevel(['#######', '#..N..#', '#.....#', '#lllll#', '#..S..#', '#######'], {
      legend: { N: 0, l: { floor: 0, ceil: 3 } },
      entities: [{ id: 'b1', type: 'enemy', enemy: 'bird', room: 'r', at: [3, 1], face: 'S' }],
    });
    for (let i = 0; i < ticks(8); i++) {
      stepWorld(w, frame());
      const e = bird(w);
      // It flies at her chest height, where its body and clearance do not fit under the strip.
      expect(Math.floor(e.pos.z / 2)).not.toBe(3);
      expect(e.pos.y).toBeGreaterThanOrEqual(0);
    }
  });
});
