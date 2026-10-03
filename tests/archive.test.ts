/**
 * The Clay Archive's mechanisms (spec §19): glyph locks turned with Action
 * and read from one side, dart traps with a warning click, and the poison
 * they leave, which never kills and which a medkit cures.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { SAVE_SCHEMA, migrate, restore, snapshot } from '../src/sim/save/save';
import { poison, traps, tuning } from '../src/sim/player/tuning';
import { stepWorld } from '../src/sim/world';
import { Level } from '../src/sim/grid/level';
import { frame, run, testLevel } from './helpers';

const ticks = (s: number): number => Math.ceil(s / TICK_DT) + 2;

describe('glyph locks', () => {
  // The lock stands at (2, 1), read from the south; Nora starts below it facing north.
  const lockRoom = () =>
    testLevel(['#####', '#.L.#', '#...#', '#.S.#', '#####'], {
      legend: { L: 0 },
      entities: [
        { id: 'lock', type: 'glyphlock', room: 'r', at: [2, 1], facing: 'S', glyph: 4, target: 1 },
        { id: 'door', type: 'door', room: 'r', at: [3, 1] },
      ],
      logic: [{ when: 'lock.set', do: ['door.open'] }],
    });

  it('turns one face per Action and sets on its target glyph', () => {
    const w = lockRoom();
    run(w, frame({ y: 1 }), 40);
    const lock = (): number => w.state.mechanisms.glyphs[0]?.glyph ?? -1;
    for (let i = 0; i < 3; i++) {
      run(w, frame({ pressed: ['action'] }), 1);
      run(w, frame(), ticks(tuning.leverTime));
    }
    // 4 → 5 → 0 → 1: the target.
    expect(lock()).toBe(1);
    expect(w.state.signals['lock.set']).toBe(true);
    run(w, frame(), 10);
    const door = w.state.actors.find((a) => a.id === 'door');
    expect(door && door.kind === 'door' && door.target).toBe(1);
  });

  it('is solid, and only turns from its reading side', () => {
    const w = testLevel(['#####', '#...#', '#.L.#', '#.S.#', '#####'], {
      legend: { L: 0 },
      // Read from the north: Nora stands south of it, on the wrong side.
      entities: [{ id: 'lock', type: 'glyphlock', room: 'r', at: [2, 2], facing: 'N', glyph: 0, target: 3 }],
    });
    run(w, frame({ y: 1 }), 60);
    expect(w.state.player.pos.z).toBeGreaterThan(6);
    run(w, frame({ pressed: ['action'] }), 1);
    run(w, frame(), ticks(tuning.leverTime));
    expect(w.state.mechanisms.glyphs[0]?.glyph).toBe(0);
  });
});

describe('dart traps', () => {
  // Corridor running north; the painted slab at (2, 2), darts from the west wall.
  const corridor = () =>
    testLevel(['#####', '#...#', '#...#', '#...#', '#.S.#', '#####'], {
      entities: [{ id: 'darts', type: 'darts', room: 'r', at: [2, 2], from: 'W' }],
    });

  it('clicks when stepped on, then hits and poisons whoever stays on the line', () => {
    const w = corridor();
    const events: string[] = [];
    const walk = (): void => {
      stepWorld(w, frame({ y: 1, held: ['walk'] }));
      events.push(...w.events.drain().map((e) => e.type));
    };
    for (let i = 0; i < 400 && !events.includes('darts.click'); i++) walk();
    expect(events).toContain('darts.click');
    // Stand still on the slab.
    const health = w.state.player.health;
    for (let i = 0; i < ticks(traps.darts.delay); i++) {
      stepWorld(w, frame());
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(events).toContain('darts.fired');
    expect(events).toContain('player.poisoned');
    expect(w.state.player.health).toBeLessThan(health);
    expect(w.state.player.poison).toBeGreaterThan(0);
  });

  it('misses a player who steps off the line in time', () => {
    const w = corridor();
    for (let i = 0; i < 400 && w.state.mechanisms.darts[0]?.phase !== 'armed'; i++)
      stepWorld(w, frame({ y: 1, held: ['walk'] }));
    // Keep running north: out of the line before the volley.
    run(w, frame({ y: 1 }), ticks(traps.darts.delay));
    expect(w.state.player.health).toBe(tuning.maxHealth);
    expect(w.state.player.poison).toBe(0);
  });

  it('only fires again once she has stepped off', () => {
    const w = corridor();
    for (let i = 0; i < 400 && w.state.mechanisms.darts[0]?.phase !== 'armed'; i++)
      stepWorld(w, frame({ y: 1, held: ['walk'] }));
    run(w, frame(), ticks(traps.darts.delay + traps.darts.cooldown + 1));
    expect(w.state.mechanisms.darts[0]?.phase).toBe('cooldown');
  });
});

describe('dart poison', () => {
  it('drains health down to a floor and wears off; a medkit cures it', () => {
    const w = testLevel(['#####', '#...#', '#.S.#', '#####']);
    const p = w.state.player;
    p.health = 30;
    p.poison = 100;
    run(w, frame(), ticks(30));
    expect(p.health).toBe(poison.floor);
    expect(p.mode).not.toBe('dead');
    w.state.inventory.medkit_small = 1;
    run(w, frame({ pressed: ['medkit'] }), 1);
    expect(p.poison).toBe(0);
    expect(p.health).toBeGreaterThan(poison.floor);
  });

  it('a medkit cures poison even at full health', () => {
    const w = testLevel(['#####', '#...#', '#.S.#', '#####']);
    w.state.player.poison = 5;
    w.state.inventory.medkit_small = 1;
    run(w, frame({ pressed: ['medkit'] }), 1);
    expect(w.state.player.poison).toBe(0);
    expect(w.state.inventory.medkit_small).toBe(0);
  });
});

describe('saves from before the Clay Archive', () => {
  it('migrate to schema 2 with empty locks, darts and no poison', () => {
    const w = testLevel(['#####', '#...#', '#.S.#', '#####']);
    const save = structuredClone(snapshot(w, 'v', 'now', false)) as unknown as Record<string, unknown>;
    // As 0.2.6 wrote it.
    const game = save.game as {
      checkpoint: Record<string, Record<string, unknown>>;
      resume: Record<string, Record<string, unknown>>;
    };
    for (const s of [game.checkpoint, game.resume]) {
      delete s.mechanisms?.glyphs;
      delete s.mechanisms?.darts;
      delete s.player?.poison;
    }
    save.schema = 1;
    const migrated = migrate(save);
    expect(migrated?.schema).toBe(SAVE_SCHEMA);
    if (!migrated) throw new Error('not migrated');
    const back = restore(w.level as Level, migrated);
    expect(back?.state.mechanisms.glyphs).toEqual([]);
    expect(back?.state.player.poison).toBe(0);
  });
});
