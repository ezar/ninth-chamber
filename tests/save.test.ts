import { describe, expect, it } from 'vitest';
import antechamberJson from '../levels/antechamber.level.json';
import cisternsJson from '../levels/cisterns.level.json';
import { clone } from '../src/core/clone';
import { emptyFrame } from '../src/core/input-frame';
import { Level } from '../src/sim/grid/level';
import { SAVE_SCHEMA, levelStart, migrate, restore, safeToResume, snapshot } from '../src/sim/save/save';
import { createWorld, stepWorld, type World } from '../src/sim/world';
import { run } from './helpers';

const antechamber = Level.parse(antechamberJson);
const cisterns = Level.parse(cisternsJson);

function settled(): World {
  const w = createWorld(antechamber, 1);
  run(w, emptyFrame(), 30);
  return w;
}

describe('saved games', () => {
  it('resumes from the checkpoint with the stats, tick and random state', () => {
    const w = settled();
    const door = w.state.actors.find((a) => a.kind === 'door');
    if (!door || door.kind !== 'door') throw new Error('no door');
    door.open = 1;
    door.target = 1;
    w.state.inventory.key = 1;
    w.checkpoint = clone(w.state);
    w.stats.deaths = 2;
    w.stats.notes.push('note1');
    w.rng.next();
    const save = snapshot(w, '0.2.6', 'now', false);
    expect(save.schema).toBe(SAVE_SCHEMA);
    const back = restore(antechamber, save);
    if (!back) throw new Error('not restored');
    const d = back.state.actors.find((a) => a.id === door.id);
    expect(d && d.kind === 'door' && d.open).toBe(1);
    expect(back.state.inventory.key).toBe(1);
    expect(back.stats.deaths).toBe(2);
    expect(back.stats.notes).toEqual(['note1']);
    expect(back.tick).toBe(w.tick);
    expect(back.rng.state).toBe(w.rng.state);
    // The restored world plays on.
    expect(() => stepWorld(back, emptyFrame())).not.toThrow();
  });

  it('resumes from where Nora stands when it is safe, and keeps the checkpoint for deaths', () => {
    const w = settled();
    const start = { ...w.state.player.pos };
    w.state.player.pos.x += 2;
    expect(safeToResume(w)).toBe(true);
    const back = restore(antechamber, snapshot(w, 'v', 'now', true));
    expect(back?.state.player.pos.x).toBeCloseTo(start.x + 2);
    expect(back?.checkpoint.player.pos.x).toBeCloseTo(start.x);
  });

  it('falls back to the checkpoint when Nora is not standing', () => {
    const w = settled();
    const start = { ...w.state.player.pos };
    w.state.player.mode = 'air';
    w.state.player.pos.y += 3;
    expect(safeToResume(w)).toBe(false);
    const back = restore(antechamber, snapshot(w, 'v', 'now', true));
    expect(back?.state.player.pos.y).toBeCloseTo(start.y);
  });

  it('survives storage (structured clone keeps Infinity)', () => {
    const w = settled();
    const save = structuredClone(snapshot(w, 'v', 'now', true));
    expect(restore(antechamber, save)).not.toBeNull();
  });

  it('starts a level fresh from a level-start save', () => {
    const save = levelStart('cisterns', 'v', 'now');
    const w = restore(cisterns, save);
    expect(w?.tick).toBe(0);
    expect(w?.level.id).toBe('cisterns');
  });

  it('refuses a save for another level or one whose actors no longer match', () => {
    const w = settled();
    const save = snapshot(w, 'v', 'now', false);
    expect(restore(cisterns, save)).toBeNull();
    const changed = clone(save);
    changed.game?.checkpoint.actors.pop();
    expect(restore(antechamber, changed)).toBeNull();
  });

  it('migrates older schemas step by step and rejects what it cannot read', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({ level: 'x' })).toBeNull();
    expect(migrate({ schema: 99, level: 'x' })).toBeNull();
    expect(migrate({ schema: SAVE_SCHEMA, level: 'x', game: null })?.level).toBe('x');
    const steps = [
      (s: Record<string, unknown>) => ({ ...s, level: `${String(s.room)}` }),
      (s: Record<string, unknown>) => ({ ...s, version: 'migrated' }),
    ];
    const out = migrate({ schema: 1, room: 'antechamber' }, steps);
    expect(out).toMatchObject({ schema: 3, level: 'antechamber', version: 'migrated' });
  });
});
