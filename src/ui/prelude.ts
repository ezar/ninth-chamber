/**
 * The splash and the prelude: the seal carving itself, then the story cards
 * over the loading reel, from the first paint (prelude.css).
 *
 * index.html carries the cards in every locale and each locale's schedule,
 * baked in at build time (scripts/vite-site.ts); a small inline script picks
 * the locale and starts the CSS sequence before any bundle arrives. It always
 * handles the splash (any tap or key skips it), and the cards' natural end
 * and the Skip button until this class takes over.
 *
 * From here: when loading finishes, the card on screen is allowed to finish,
 * then the title comes up (never a cut mid-read; during the splash, right
 * after it). Skip, Escape, Enter, Space or a pad button bring the title at
 * once. The cards read here are not shown again by the in-engine intro (see
 * `seen`).
 */
import { revealTime, seenCards, type PreludeSchedule } from './story-timing';

/** What the inline script in index.html leaves on `window.__prelude`. */
interface InlinePrelude {
  schedule: PreludeSchedule;
  over: boolean;
  seen: number;
  skipped: boolean;
  /** Set here: the inline handlers stand down. */
  claimed?: boolean;
  /** Seconds since the cards started (their CSS clock); -1 during the splash. */
  now: () => number;
  /** Ends the splash: the cards start. */
  run: () => void;
}

const root = document.documentElement;

export class Prelude {
  private readonly inline: InlinePrelude | null;
  private revealed: boolean;
  private timer = 0;

  /** `onReveal` runs when the title comes up; not at all if it was already up when the game loaded. */
  constructor(private readonly onReveal: (skipped: boolean) => void) {
    // Library boundary: the object the inline script left on window.
    this.inline = (window as unknown as { __prelude?: InlinePrelude }).__prelude ?? null;
    this.revealed = !this.inline || this.inline.over;
    if (this.inline) this.inline.claimed = true;
    if (!this.inline || this.revealed) {
      root.classList.add('prelude-over');
      return;
    }
    document.addEventListener('animationend', (e) => {
      if (e.animationName === 'prelude-clock') this.reveal(false);
    });
    document.getElementById('prelude-skip')?.addEventListener('click', () => this.skip());
    // Capture, so the title screen never sees the key that brought it up.
    window.addEventListener(
      'keydown',
      (e) => {
        // During the splash the inline script takes any key.
        if (this.revealed || e.repeat || this.splashing) return;
        if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.skip();
        }
      },
      { capture: true },
    );
  }

  /** The cards are still playing. */
  get running(): boolean {
    return !this.revealed;
  }

  /** The splash is still on screen (the cards have not started). */
  get splashing(): boolean {
    return this.running && !root.classList.contains('prelude-run');
  }

  /** How many cards were read in full (always the first ones). */
  get seen(): number {
    return this.inline?.seen ?? 0;
  }

  /** Loading has finished: let the card on screen finish, then bring up the title. */
  ready(): void {
    if (this.revealed || !this.inline) return;
    root.classList.add('prelude-ready');
    if (this.splashing) {
      // The splash plays out, then the title (every card is left for the in-engine intro).
      document.addEventListener('prelude-run', () => this.reveal(false), { once: true });
      return;
    }
    const t = this.inline.now();
    const at = revealTime(this.inline.schedule, t);
    window.clearTimeout(this.timer);
    if (at <= t) this.reveal(false);
    else this.timer = window.setTimeout(() => this.reveal(false), (at - t) * 1000);
  }

  /** The title at once (Skip, a key); during the splash, the cards at once. */
  skip(): void {
    if (this.splashing) this.inline?.run();
    else this.reveal(true);
  }

  private reveal(skipped: boolean): void {
    if (this.revealed || !this.inline) return;
    this.revealed = true;
    window.clearTimeout(this.timer);
    const p = this.inline;
    p.over = true;
    p.skipped = skipped;
    p.seen = seenCards(p.schedule, p.now());
    root.classList.add('prelude-over');
    this.onReveal(skipped);
  }
}
