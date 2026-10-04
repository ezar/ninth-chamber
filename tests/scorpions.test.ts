/**
 * Scorpions (spec §19, chamber V): small, in groups, and their sting poisons
 * like the Clay Archive's darts. A pistol hit or two kills one.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { damageEnemy } from '../src/sim/actors/enemies';
import type { EntityFile } from '../src/sim/grid/schema';
import { enemyTypes, poison } from '../src/sim/player/tuning';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;
const S = enemyTypes.scorpion;

function nest(n = 3): World {
  const entities: EntityFile[] = [];
  for (let i = 0; i < n; i++)
    entities.push({
      id: `s${i}`,
      type: 'enemy',
      enemy: 'scorpion',
      room: 'r',
      at: [2 + i, 1],
      face: 'S',
      pack: 'nest',
    });
  return testLevel(['#######', '#.....#', '#.....#', '#.....#', '#..S..#', '#######'], { entities });
}

function collect(w: World, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    stepWorld(w, frame());
    out.push(...w.events.drain().map((e) => e.type));
  }
  return out;
}

describe('scorpions', () => {
  it('are small and fragile', () => {
    expect(S.height).toBeLessThan(0.5);
    expect(S.health).toBeLessThanOrEqual(2);
    expect(enemyTypes.jackal.bite.damage).toBeGreaterThan(S.bite.damage);
  });

  it('come as a group when one sees her', () => {
    const w = nest();
    const events = collect(w, ticks(S.alertTime + 1));
    expect(events.filter((t) => t === 'enemy.alerted').length).toBe(3);
  });

  it('sting and poison her', () => {
    const w = nest(1);
    const events = collect(w, ticks(6));
    expect(events).toContain('enemy.bite');
    expect(events).toContain('player.poisoned');
    expect(w.state.player.poison).toBeGreaterThan(0);
    expect(w.state.player.poison).toBeLessThanOrEqual(poison.duration);
  });

  it('a pistol hit or two kills one', () => {
    const w = nest(1);
    const e = w.state.enemies[0];
    if (!e) throw new Error('no scorpion');
    run(w, frame(), 2);
    damageEnemy(w, e, 1);
    damageEnemy(w, e, 1);
    expect(e.mode).toBe('dead');
  });

  it('a floor of roots that gives way says so, for its creaking sound', () => {
    const w = testLevel(['#####', '#...#', '#.c.#', '#.S.#', '#####'], {
      legend: { c: { floor: 0, mat: 'wood', flags: ['crumble'] } },
    });
    const p = w.state.player;
    p.pos = { x: 2 * 2 + 1, y: 0, z: 2 * 2 + 1 };
    const events: { type: string; mat?: unknown }[] = [];
    for (let i = 0; i < ticks(2); i++) {
      stepWorld(w, frame());
      events.push(...w.events.drain());
    }
    expect(events.find((e) => e.type === 'tile.cracked')?.mat).toBe('wood');
    expect(events.find((e) => e.type === 'tile.fell')?.mat).toBe('wood');
  });
});
