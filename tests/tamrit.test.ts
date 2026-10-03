/**
 * Tamrit, the clay scribe (spec §19): it hunts Nora, falls apart when shot
 * and rises again, and only water dissolves it for good.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { damageEnemy } from '../src/sim/actors/enemies';
import { clayGuardian, enemyTypes } from '../src/sim/player/tuning';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

/** A long hall with Tamrit at the far end and a sluice that can flood it (floor 0, water up to 3 clicks). */
function hall(): World {
  return testLevel(['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#..S..#', '#######'], {
    entities: [
      { id: 'tamrit', type: 'enemy', enemy: 'clay', room: 'r', at: [3, 1] },
      { id: 'sluice', type: 'watergate', room: 'r', at: [5, 6], wall: 'E', low: -4, high: 3 },
    ],
    logic: [{ when: 'flood', do: ['sluice.toggle'] }],
  });
}

const tamrit = (w: World) => {
  const e = w.state.enemies.find((x) => x.id === 'tamrit');
  if (!e) throw new Error('no Tamrit');
  return e;
};

describe('Tamrit', () => {
  it('sees Nora and comes for her', () => {
    const w = hall();
    const start = tamrit(w).pos.z;
    run(w, frame(), ticks(4));
    expect(tamrit(w).aware).toBe(true);
    expect(tamrit(w).pos.z).toBeGreaterThan(start + 1);
  });

  it('crumbles when shot to pieces and rises again whole', () => {
    const w = hall();
    run(w, frame(), 10);
    damageEnemy(w, tamrit(w), enemyTypes.clay.health);
    expect(tamrit(w).mode).toBe('dead');
    expect(w.state.signals['tamrit.dead']).not.toBe(true);
    expect(w.stats.kills).toBe(0);
    run(w, frame(), ticks(clayGuardian.reform));
    expect(tamrit(w).mode).not.toBe('dead');
    expect(tamrit(w).health).toBe(enemyTypes.clay.health);
  });

  it('dissolves for good when the water rises over it', () => {
    const w = hall();
    run(w, frame(), 10);
    w.state.flags.push('flood');
    const events: string[] = [];
    for (let i = 0; i < ticks(20) && !events.includes('enemy.dissolved'); i++) {
      stepWorld(w, frame());
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(events).toContain('enemy.dissolved');
    expect(tamrit(w).dissolved).toBe(true);
    expect(w.state.signals['tamrit.dead']).toBe(true);
    run(w, frame(), ticks(clayGuardian.reform + 1));
    expect(tamrit(w).mode).toBe('dead');
  });
});
