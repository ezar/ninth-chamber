import { describe, expect, it } from 'vitest';
import type { EntityFile } from '../src/sim/grid/schema';
import { frame, run, testLevel } from './helpers';

/**
 * Set dressing with a model of its own (a kiln, a forge hearth, a mould): it fills its
 * cell, so Nora walks up against it instead of through it, as against a keeper's statue.
 */
describe('decor', () => {
  const room = ['#####', '#...#', '#...#', '#...#', '#.S.#', '#####'];

  it('fills its cell: she stops against it', () => {
    const decor = { id: 'kiln', type: 'decor', room: 'r', at: [2, 1], model: 'kiln' } as EntityFile;
    const w = testLevel(room, { entities: [decor] });
    run(w, frame({ y: 1 }), 120);
    // The decor's cell spans z 2..4: she stays south of it.
    expect(w.state.player.pos.z).toBeGreaterThan(4);
  });

  it('one marked not solid (set in the floor, like the mould) lets her walk over it', () => {
    const decor = {
      id: 'm',
      type: 'decor',
      room: 'r',
      at: [2, 1],
      model: 'mould',
      solid: false,
    } as EntityFile;
    const w = testLevel(room, { entities: [decor] });
    run(w, frame({ y: 1 }), 120);
    expect(w.state.player.pos.z).toBeLessThan(4);
  });

  it('without it she walks on to the far wall', () => {
    const w = testLevel(room);
    run(w, frame({ y: 1 }), 120);
    expect(w.state.player.pos.z).toBeLessThan(4);
  });
});
