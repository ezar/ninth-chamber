import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allLocales, preludeCards, preludeKeys, preludeSchedules, readLocales } from '../scripts/vite-site';
import { CHAMBERS } from '../src/ui/campaign';
import {
  CARD_FADE,
  PRELUDE_LEAD,
  preludeSchedule,
  readTime,
  revealTime,
  seenCards,
} from '../src/ui/story-timing';

const root = new URL('..', import.meta.url).pathname;
const locales = readLocales(root);

describe('the story prelude over the loading reel', () => {
  it('plays the first chamber’s intro cards, in order', () => {
    expect(preludeKeys(locales)).toEqual(CHAMBERS[0]?.intro);
    expect(preludeKeys(locales)).toHaveLength(4);
  });

  it('times each card by its length, one after another, each image arriving before its card', () => {
    const texts = ['short', 'x'.repeat(120), 'y'.repeat(400)];
    const s = preludeSchedule(texts);
    expect(s.cards[0]?.at).toBe(PRELUDE_LEAD);
    expect(s.cards[0]?.image).toBe(0);
    s.cards.forEach((c, i) => {
      expect(c.end - c.at).toBeCloseTo(readTime(texts[i] ?? ''), 1);
      expect(c.out).toBeCloseTo(c.end - CARD_FADE, 5);
      expect(c.image).toBeLessThan(c.at);
      const next = s.cards[i + 1];
      if (next) expect(next.at).toBeGreaterThan(c.end);
    });
    expect(s.end).toBe(s.cards.at(-1)?.end);
  });

  it('never cuts a card mid-read when loading finishes', () => {
    const s = preludeSchedule(['a'.repeat(100), 'b'.repeat(100)]);
    const [one, two] = s.cards;
    if (!one || !two) throw new Error('two cards');
    // Before the first card and between cards: at once.
    expect(revealTime(s, 0.5)).toBe(0.5);
    expect(revealTime(s, one.end + 0.1)).toBeCloseTo(one.end + 0.1);
    // During a card, even while it fades in: when it has faded out.
    expect(revealTime(s, one.at)).toBe(one.end);
    expect(revealTime(s, one.out - 0.1)).toBe(one.end);
    expect(revealTime(s, two.at + 2)).toBe(two.end);
  });

  it('counts a card as read once its fade-out has begun', () => {
    const s = preludeSchedule(['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)]);
    expect(seenCards(s, -1)).toBe(0);
    expect(seenCards(s, (s.cards[0]?.out ?? 0) - 0.01)).toBe(0);
    expect(seenCards(s, s.cards[0]?.end ?? 0)).toBe(1);
    expect(seenCards(s, s.end)).toBe(3);
    // The in-engine intro then shows only the rest.
    const intro = CHAMBERS[0]?.intro ?? [];
    expect(intro.slice(seenCards(s, s.cards[1]?.end ?? 0))).toEqual(intro.slice(2));
  });

  it('bakes every locale’s cards and schedule into the page', () => {
    const schedules = preludeSchedules(locales);
    expect(Object.keys(schedules).sort()).toEqual(Object.keys(locales).sort());
    for (const s of Object.values(schedules)) expect(s.cards).toHaveLength(4);
    const cards = preludeCards(locales);
    expect(cards.match(/class="prelude-card/g)).toHaveLength(4);
    expect(cards).toContain('<span lang="es">Se conocen ocho cámaras.');
    expect(allLocales(locales, 'prelude.skip')).toBe(
      '<span lang="en">Skip</span><span lang="ca">Saltar</span><span lang="es">Saltar</span>',
    );
    expect(allLocales({ en: { k: 'a < b & "c"' } }, 'k')).toBe(
      '<span lang="en">a &lt; b &amp; &quot;c&quot;</span>',
    );
  });

  it('keeps the placeholders in index.html that the build fills', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    for (const mark of [
      '/*%prelude:schedule%*/ null',
      '<!--%prelude:cards%-->',
      '<!--%splash:seal%-->',
      'id="prelude-clock"',
      'id="prelude-skip"',
      '%version%',
    ])
      expect(html).toContain(mark);
    // One reel image per card.
    expect(html.match(/class="reel reel-\d"/g)).toHaveLength(4);
  });
});
