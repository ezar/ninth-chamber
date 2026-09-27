/**
 * Key items and item slots (spec §8 "Cerradura y hueco de objeto", §9
 * "Llaves de puzle"): a key is taken with Action into the inventory and set
 * into its slot with Action, which then emits `<slot>.filled`.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import type { EntityFile } from '../src/sim/grid/schema';
import { signal } from '../src/sim/logic/rules';
import { tuning } from '../src/sim/player/tuning';
import { findActor, stepWorld } from '../src/sim/world';
import { cellZ, frame, run, runUntil, testLevel } from './helpers';

const secs = (s: number): number => Math.round(s / TICK_DT) + 2;

const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#..S..#', '#######'];
const entities: EntityFile[] = [
  { id: 'ray1', type: 'item', room: 'r', at: [3, 3], item: 'bronze_ray' } as EntityFile,
  { id: 'slot1', type: 'slot', room: 'r', at: [3, 1], wall: 'N', accepts: 'bronze_ray' } as EntityFile,
  { id: 'd1', type: 'door', room: 'r', at: [1, 1], height: 8 } as EntityFile,
];
const logic = [{ when: 'slot1.filled', do: ['d1.open'] }];

describe('key items and slots', () => {
  it('a key is taken with Action and kept in the inventory', () => {
    const w = testLevel(ROOM, { entities, logic });
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.pos.z <= 7.05, 200);
    expect(cellZ(w)).toBe(3);
    stepWorld(w, frame({ pressed: ['action'] }));
    expect(w.state.player.mode).toBe('pickup');
    run(w, frame(), secs(tuning.pickupTime));
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.inventory.bronze_ray).toBe(1);
    expect(signal(w, 'ray1.taken')).toBe(true);
    expect(w.state.mechanisms.items[0]?.taken).toBe(true);
    const picked = w.events.drain().find((e) => e.type === 'item.picked');
    expect(picked).toMatchObject({ id: 'ray1', item: 'bronze_ray' });
  });

  it('the slot takes it with Action, signals filled and a rule opens the door', () => {
    const w = testLevel(ROOM, { entities, logic });
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.pos.z <= 7.05, 200);
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), secs(tuning.pickupTime));
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.pos.z <= 3.05, 200);
    expect(cellZ(w)).toBe(1);
    stepWorld(w, frame({ x: 1, pressed: ['action'] }));
    expect(w.state.player.mode).toBe('lever');
    expect(w.state.player.yaw).toBeCloseTo(0, 5); // faces the slot in the north wall
    run(w, frame(), secs(tuning.leverTime));
    expect(w.state.mechanisms.slots[0]?.filled).toBe(true);
    expect(w.state.inventory.bronze_ray ?? 0).toBe(0);
    expect(signal(w, 'slot1.filled')).toBe(true);
    run(w, frame(), 2);
    expect(findActor(w, 'd1', 'door')?.target).toBe(1);
  });

  it('without the key the slot refuses and nothing moves', () => {
    const w = testLevel(ROOM, { entities, logic });
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.pos.z <= 3.05, 400);
    expect(cellZ(w)).toBe(1);
    w.events.drain();
    stepWorld(w, frame({ pressed: ['action'] }));
    expect(w.state.player.mode).toBe('ground');
    expect(w.events.drain().find((e) => e.type === 'slot.denied')).toMatchObject({
      id: 'slot1',
      item: 'bronze_ray',
    });
    run(w, frame(), secs(1));
    expect(w.state.mechanisms.slots[0]?.filled).toBe(false);
  });
});
