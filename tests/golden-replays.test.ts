/**
 * Golden replays (spec §16): every chamber's recorded golden path, played
 * back on a fresh world, must hash the same every HASH_EVERY ticks. A
 * difference names the first stretch of ticks that diverged. If the change is
 * intended, record them again with `pnpm replay:update`.
 */
import { describe, expect, it } from 'vitest';
import { Level } from '../src/sim/grid/level';
import { loadLevelFile, levelIds } from '../src/levels';
import { HASH_EVERY, loadReplays, playBack, replayFrames } from './golden';

const replays = loadReplays();

describe('golden replays', () => {
  it('every chamber has one', () => {
    expect(replays.map((r) => r.level).sort()).toEqual([...levelIds()].sort());
  });

  for (const r of replays) {
    it(`${r.level} plays back the same, tick for tick`, { timeout: 120_000 }, async () => {
      const level = Level.parse(await loadLevelFile(r.level));
      const back = playBack(level, replayFrames(r), r.seed);
      expect(back.ticks).toBe(r.ticks);
      const first = back.hashes.findIndex((h, i) => h !== r.hashes[i]);
      if (first >= 0)
        throw new Error(
          `${r.level} diverges between ticks ${first * HASH_EVERY} and ${(first + 1) * HASH_EVERY}; ` +
            'if the change is intended, run pnpm replay:update',
        );
      expect(back.final).toBe(r.final);
    });
  }
});
