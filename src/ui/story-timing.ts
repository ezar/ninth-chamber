/**
 * Timing of the story cards, shared by the in-engine intro (ui/intro.ts), the
 * prelude over the loading reel (ui/prelude.ts, index.html) and the build,
 * which bakes each locale's prelude schedule into index.html
 * (scripts/vite-site.ts) so the cards can play before any bundle arrives.
 *
 * Pure: no DOM, so the Vite config can import it.
 */

/** Card fade in and out (s); matches the CSS transitions and animations. */
export const CARD_FADE = 1.1;

/** Time on screen for a card, fades included, from its length (a slow reading pace for a cinematic). */
export const readTime = (text: string): number => Math.min(10.5, Math.max(5.5, 2.4 + text.length * 0.048));

/** Prelude: the first image and the letterbox settle before the first card (s). */
export const PRELUDE_LEAD = 1.8;
/** Prelude: a dark beat between two cards while the reel changes image (s). */
export const PRELUDE_GAP = 0.6;
/** Prelude: the next image starts its crossfade this long before a card has faded out (s). */
export const IMAGE_LEAD = 0.2;

/**
 * One card of the prelude, in seconds from its start: its image crossfades in
 * from `image`, the card fades in at `at`, fades out from `out` and is gone at `end`.
 */
export interface CardSlot {
  image: number;
  at: number;
  out: number;
  end: number;
}

export interface PreludeSchedule {
  cards: CardSlot[];
  /** When the last card has faded out and the title comes up (s). */
  end: number;
}

const round = (s: number): number => Math.round(s * 100) / 100;

/** The prelude's timeline for these card texts (one locale). */
export function preludeSchedule(texts: readonly string[]): PreludeSchedule {
  let at = PRELUDE_LEAD;
  let image = 0;
  const cards = texts.map((text): CardSlot => {
    const end = at + readTime(text);
    const slot = { image: round(image), at: round(at), out: round(end - CARD_FADE), end: round(end) };
    image = end - IMAGE_LEAD;
    at = end + PRELUDE_GAP;
    return slot;
  });
  return { cards, end: cards.at(-1)?.end ?? PRELUDE_LEAD };
}

/** Cards read by time `t`: those whose fade-out has begun. The seen cards are always the first ones. */
export function seenCards(schedule: PreludeSchedule, t: number): number {
  return schedule.cards.filter((c) => t >= c.out).length;
}

/**
 * When the title may come up if loading finishes at `t`: at once between
 * cards, else once the card on screen has faded out (never cut mid-read).
 */
export function revealTime(schedule: PreludeSchedule, t: number): number {
  const card = schedule.cards.find((c) => t >= c.at && t < c.end);
  return card ? card.end : t;
}
