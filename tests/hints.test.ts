import { describe, expect, it } from 'vitest';
import antechamberJson from '../levels/antechamber.level.json';
import antechamberHints from '../levels/antechamber.hints.json';
import cisternsJson from '../levels/cisterns.level.json';
import cisternsHints from '../levels/cisterns.hints.json';
import templeJson from '../levels/sun_temple.level.json';
import templeHints from '../levels/sun_temple.hints.json';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import { Level } from '../src/sim/grid/level';
import { HintTracker, hintFileSchema, validateHints } from '../src/sim/hints/hints';
import { exprNames, parseExpr } from '../src/sim/logic/expr';
import { hints as hintTuning } from '../src/sim/player/tuning';
import { createWorld, type World } from '../src/sim/world';

const files = [
  [antechamberJson, antechamberHints],
  [cisternsJson, cisternsHints],
  [templeJson, templeHints],
] as const;

/** Stands Nora in the first open cell of a room. */
function standIn(w: World, roomId: string): void {
  const r = w.level.rooms.find((x) => x.id === roomId);
  if (!r) throw new Error(roomId);
  for (let cz = r.minZ; cz < r.maxZ; cz++)
    for (let cx = r.minX; cx < r.maxX; cx++) {
      const s = w.level.sector(cx, cz);
      if (s && !s.wall && s.room === roomId) {
        w.state.player.pos.x = cx * 2 + 1;
        w.state.player.pos.z = cz * 2 + 1;
        return;
      }
    }
}

describe("Nora's ideas", () => {
  it('has three hints in Nora’s voice for each puzzle, in every locale, valid against its level', () => {
    for (const [level, hints] of files) {
      const names = new Set(level.logic.flatMap((r) => exprNames(parseExpr(r.when))));
      const rooms = new Set(level.rooms.map((r) => r.id));
      expect(validateHints(hints, rooms, names, new Set(Object.keys(en)))).toEqual([]);
      for (const p of hintFileSchema.parse(hints).puzzles) {
        for (const k of p.hints) {
          const text = (en as Record<string, string>)[k] ?? '';
          expect(text.split(/\s+/).length, k).toBeLessThanOrEqual(25);
          expect((es as Record<string, string>)[k], k).toBeTruthy();
        }
      }
    }
  });

  it('offers an idea after three minutes without progress, then gives one level at a time', () => {
    const w = createWorld(Level.parse(antechamberJson), 1);
    const tracker = new HintTracker(hintFileSchema.parse(antechamberHints).puzzles);
    standIn(w, 'plate_hall');
    tracker.update(w, 0);
    for (let t = 0; t < hintTuning.idle - 1; t += 1) tracker.update(w, 1);
    expect(tracker.available(w)).toBeNull();
    tracker.update(w, 2);
    expect(tracker.available(w)?.id).toBe('weights');
    expect(tracker.takeOffer(w)).toBe(true);
    expect(tracker.takeOffer(w)).toBe(false);
    expect(tracker.next(w)).toMatchObject({ level: 1, more: true, key: 'hints.antechamber.weights.1' });
    expect(tracker.next(w)).toMatchObject({ level: 2, more: true });
    expect(tracker.next(w)).toMatchObject({ level: 3, more: false, key: 'hints.antechamber.weights.3' });
  });

  it('resets the wait on progress, and stays available once asked', () => {
    const w = createWorld(Level.parse(antechamberJson), 1);
    const tracker = new HintTracker(hintFileSchema.parse(antechamberHints).puzzles);
    standIn(w, 'plate_hall');
    tracker.update(w, 0);
    tracker.update(w, hintTuning.idle + 1);
    tracker.next(w);
    w.state.flags.push('something_new');
    tracker.update(w, 1);
    expect(tracker.idle).toBe(0);
    // Already asked about: Nora can be asked again without another wait.
    expect(tracker.available(w)?.id).toBe('weights');
  });

  it('says nothing about a solved puzzle or a room without one', () => {
    const w = createWorld(Level.parse(antechamberJson), 1);
    const tracker = new HintTracker(hintFileSchema.parse(antechamberHints).puzzles);
    standIn(w, 'plate_hall');
    tracker.update(w, 0);
    tracker.update(w, hintTuning.idle + 1);
    w.state.signals['z_hourglass.entered'] = true;
    expect(tracker.available(w)).toBeNull();
    standIn(w, 'entrance');
    expect(tracker.available(w)).toBeNull();
  });
});
