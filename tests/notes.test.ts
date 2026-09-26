/**
 * Journal notes (spec §9): read with Action like a pickup, counted once in the
 * stats, never consumed, and kept across deaths.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import type { SimEvent } from '../src/core/events';
import { Level } from '../src/sim/grid/level';
import type { LevelFileInput } from '../src/sim/grid/schema';
import { validateLevel } from '../src/sim/grid/validate';
import { cellCenter } from '../src/sim/grid/units';
import { createWorld, stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

type NoteInput = Extract<NonNullable<LevelFileInput['entities']>[number], { type: 'note' }>;
const note: NoteInput = { id: 'n1', type: 'note', room: 'r', at: [2, 2], text: 'note.test', style: 'letter' };

/** Presses Action and runs until the pickup finishes; returns the events it produced. */
function readHere(w: World): SimEvent[] {
  const events: SimEvent[] = [];
  stepWorld(w, frame({ pressed: ['action'] }));
  events.push(...w.events.drain());
  for (let i = 0; i < 120 && w.state.player.mode !== 'ground'; i++) {
    stepWorld(w, frame());
    events.push(...w.events.drain());
  }
  return events;
}

describe('journal notes', () => {
  const rows = ['#####', '#...#', '#...#', '#.S.#', '#####'];

  it('are read with Action, counted once and can be read again', () => {
    const w = testLevel(rows, { entities: [{ ...note, at: [2, 3] }] });
    expect(w.state.player.mode).toBe('ground');

    const first = readHere(w).filter((e) => e.type === 'note.read');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: 'n1', text: 'note.test', style: 'letter', first: true, count: 1 });
    expect(w.stats.notes).toEqual(['n1']);
    expect(w.state.signals['n1.read']).toBe(true);

    const again = readHere(w).filter((e) => e.type === 'note.read');
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ first: false, count: 1, total: 1 });
    expect(w.stats.notes).toEqual(['n1']);
  });

  it('crouch like a pickup: the note is read halfway through', () => {
    const w = testLevel(rows, { entities: [{ ...note, at: [2, 3] }] });
    stepWorld(w, frame({ pressed: ['action'] }));
    expect(w.state.player.mode).toBe('pickup');
    expect(w.stats.notes).toEqual([]);
    run(w, frame(), 40);
    expect(w.stats.notes).toEqual(['n1']);
  });

  it('only react on their own sector', () => {
    const w = testLevel(rows, { entities: [note] });
    const events = readHere(w);
    expect(events.some((e) => e.type === 'note.read')).toBe(false);
    expect(w.stats.notes).toEqual([]);
  });

  it('stay read after dying and respawning', () => {
    const w = testLevel(['#####', '#...#', '#.X.#', '#.S.#', '#####'], {
      entities: [{ ...note, at: [2, 3] }],
      legend: { X: { floor: 0, flags: ['death'] } },
    });
    readHere(w);
    expect(w.stats.notes).toEqual(['n1']);
    run(w, frame({ y: 1 }), 30);
    expect(w.state.player.mode).toBe('dead');
    run(w, frame(), 200);
    expect(w.state.player.mode).toBe('ground');
    expect(w.stats.notes).toEqual(['n1']);
    const again = readHere(w).find((e) => e.type === 'note.read');
    expect(again).toMatchObject({ first: false, count: 1 });
  });

  it('are validated: i18n keys and the wall they lean on', () => {
    const level = (entity: object): object => ({
      schema: 1,
      id: 't',
      name: 'title',
      start: { room: 'r', at: [2, 3], face: 'N' },
      rooms: [{ id: 'r', origin: [0, 0, 0], ceil: 20, legend: { '#': 'wall', '.': 0, S: 0 }, rows }],
      entities: [entity],
    });
    const keys = new Set(['title', 'note.test.meta', 'note.test.title', 'note.test.body']);
    expect(validateLevel(level(note), keys).errors).toEqual([]);
    expect(validateLevel(level({ ...note, text: 'note.missing' }), keys).errors).toEqual([
      "note 'n1': missing i18n key 'note.missing.meta'",
      "note 'n1': missing i18n key 'note.missing.title'",
      "note 'n1': missing i18n key 'note.missing.body'",
    ]);
    expect(validateLevel(level({ ...note, at: [2, 1], wall: 'N' }), keys).errors).toEqual([]);
    expect(validateLevel(level({ ...note, wall: 'N' }), keys).errors).toEqual([
      "note 'n1' is not against a wall on its N side",
    ]);
    expect(validateLevel(level({ ...note, style: 'scroll' }), keys).errors.length).toBeGreaterThan(0);
  });
});

describe('The Antechamber notes', () => {
  const level = Level.parse(levelJson);
  const notes = level.entities.filter((e) => e.type === 'note');

  it('has three or four notes, with text in every locale', () => {
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(notes.length).toBeLessThanOrEqual(4);
    for (const n of notes) {
      if (n.type !== 'note') continue;
      for (const part of ['meta', 'title', 'body']) {
        expect(en, `${n.text}.${part}`).toHaveProperty([`${n.text}.${part}`]);
        expect(es, `${n.text}.${part}`).toHaveProperty([`${n.text}.${part}`]);
      }
    }
  });

  it('every note can be read where it lies', () => {
    const w = createWorld(level);
    for (const n of notes) {
      const p = w.state.player;
      p.pos = {
        x: cellCenter(n.at[0]),
        y: level.floorAt(cellCenter(n.at[0]), cellCenter(n.at[1])),
        z: cellCenter(n.at[1]),
      };
      p.vel = { x: 0, y: 0, z: 0 };
      stepWorld(w, frame());
      expect(p.mode, n.id).toBe('ground');
      const read = readHere(w).find((e) => e.type === 'note.read');
      expect(read, n.id).toMatchObject({ id: n.id, first: true });
    }
    expect(w.stats.notes).toHaveLength(notes.length);
  });

  it('has a par time for the rating', () => {
    expect(level.par).toBeGreaterThan(60);
  });
});
