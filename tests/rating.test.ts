import { describe, expect, it } from 'vitest';
import { rateLevel } from '../src/sim/rating';
import { rating } from '../src/sim/player/tuning';
import type { Stats } from '../src/sim/state';
import { testLevel } from './helpers';

/** A finished run: fresh stats (whatever fields they carry) with the ones the rating reads. */
const stats = (s: Partial<Stats> = {}): Stats => ({
  ...testLevel(['###', '#S#', '###']).stats,
  time: 200,
  deaths: 0,
  notes: ['a', 'b', 'c', 'd'],
  secrets: 3,
  ...s,
});
const totals = { secrets: 3, notes: 4 };

describe('end-of-level rating', () => {
  it('a fast, complete and deathless run earns the amber seal', () => {
    const r = rateLevel(stats(), totals, 240);
    expect(r.score).toBe(100);
    expect(r.rank).toBe('amber');
    expect(r.rankIndex).toBe(rating.ranks.length - 1);
  });

  it('time points fall linearly from par to zero', () => {
    const par = 240;
    const zero = par * rating.timeZeroAt;
    expect(rateLevel(stats({ time: par }), totals, par).parts.time).toBe(rating.timePoints);
    expect(rateLevel(stats({ time: (par + zero) / 2 }), totals, par).parts.time).toBeCloseTo(
      rating.timePoints / 2,
    );
    expect(rateLevel(stats({ time: zero * 2 }), totals, par).parts.time).toBe(0);
  });

  it('deaths, missed secrets and unread notes lower the seal', () => {
    const r = rateLevel(stats({ time: 480, deaths: 2, secrets: 1, notes: ['a'] }), totals, 240);
    expect(r.parts.deaths).toBe(rating.deathPoints - 2 * rating.deathPenalty);
    expect(r.parts.secrets).toBeCloseTo(rating.secretPoints / 3);
    expect(r.parts.notes).toBeCloseTo(rating.notePoints / 4);
    expect(r.rankIndex).toBeLessThan(3);
    const worst = rateLevel(stats({ time: 5000, deaths: 20, secrets: 0, notes: [] }), totals, 240);
    expect(worst.score).toBe(0);
    expect(worst.rank).toBe('sand');
  });

  it('levels without secrets or notes do not penalise', () => {
    const r = rateLevel(stats({ secrets: 0, notes: [] }), { secrets: 0, notes: 0 }, 240);
    expect(r.score).toBe(100);
  });

  it('ranks are sorted and start at zero', () => {
    expect(rating.ranks[0]?.min).toBe(0);
    for (let i = 1; i < rating.ranks.length; i++)
      expect(rating.ranks[i]?.min).toBeGreaterThan(rating.ranks[i - 1]?.min ?? 0);
  });
});
