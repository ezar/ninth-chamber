/**
 * The intro after "Enter the tomb": story cards over a slow camera move down
 * through the entrance's light shaft, landing behind Nora where play begins.
 * Any key, tap or button skips it after half a second. Cards already read over
 * the loading reel (ui/prelude.ts) are left out; with none left it is a short
 * flythrough.
 *
 * Audio hooks (dispatched through `cue` on the event bus, like sim events):
 * `intro.start` { duration, cards }, `intro.card` { index }, `intro.skip`,
 * `intro.end` { skipped }.
 */
import { lerpShot, samplePath, smoothstep, type Shot } from '../camera/cinematic';
import { t, type StringKey } from './i18n';
import { CARD_FADE, readTime } from './story-timing';

/** Letterbox time before the first card (s). */
const LEAD_IN = 1.8;
/** Camera time after the last card, landing on Nora (s). */
const LAND = 2.6;
/** Card fade (s); matches the CSS transition. */
const FADE = CARD_FADE;
/** The flythrough alone, when every card was read during loading (s). */
const FLIGHT = 9;
/** Reduced motion with no cards: a held shot, then the cut to Nora (s). */
const STILL_CUT = 2.4;
const SKIP_AFTER = 0.5;
/** Blend from wherever the camera is to the gameplay camera after a skip (s). */
const SKIP_BLEND = 1.2;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

export class Intro {
  private readonly root = $('intro');
  private readonly card = $('intro-card');
  private readonly skipHint = $('intro-skip');
  private schedule: { start: number; end: number; text: string }[] = [];
  private cards = 0;
  private duration = 0;
  private time = 0;
  private shots: Shot[] = [];
  private shown = -1;
  private skipFrom: { shot: Shot; time: number } | null = null;
  private last: Shot | null = null;
  private hideTimer = 0;
  /** Reduced motion: the camera holds the opening shot and cuts to Nora at the end. */
  private still = false;
  active = false;

  constructor(
    private readonly onDone: (skipped: boolean) => void,
    private readonly cue: (type: string, data?: Record<string, unknown>) => void,
  ) {}

  /**
   * Starts the sequence from `shots` (the first is where the camera is now)
   * with the level's story cards (ui/campaign.ts).
   */
  start(shots: Shot[], cards: readonly StringKey[], touch: boolean, still = false): void {
    this.still = still;
    let at = LEAD_IN;
    this.cards = cards.length;
    this.schedule = cards.map((key) => {
      const text = t(key);
      const slot = { start: at, end: at + readTime(text), text };
      at = slot.end;
      return slot;
    });
    this.duration = cards.length > 0 ? at + LAND : still ? STILL_CUT : FLIGHT;
    this.shots = shots;
    this.time = 0;
    this.shown = -1;
    this.skipFrom = null;
    this.last = shots[0] ?? null;
    this.active = true;
    window.clearTimeout(this.hideTimer);
    this.card.textContent = '';
    this.card.classList.remove('show');
    this.skipHint.textContent = t(touch ? 'intro.skipTouch' : 'intro.skip');
    this.skipHint.classList.remove('show');
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('on'));
    this.cue('intro.start', { duration: this.duration, cards: this.cards });
  }

  get canSkip(): boolean {
    return this.active && this.time >= SKIP_AFTER && this.skipFrom === null;
  }

  skip(): void {
    if (!this.canSkip || !this.last) return;
    this.skipFrom = { shot: this.last, time: this.time };
    this.card.classList.remove('show');
    this.skipHint.classList.remove('show');
    this.cue('intro.skip');
  }

  /** Advances the sequence; returns this frame's camera. `gameplay` is the orbit camera behind Nora. */
  update(dt: number, gameplay: Shot): Shot {
    if (!this.active) return gameplay;
    this.time += dt;
    let shot: Shot;
    if (this.skipFrom) {
      const k = this.still ? 1 : smoothstep((this.time - this.skipFrom.time) / SKIP_BLEND);
      shot = lerpShot(this.skipFrom.shot, gameplay, k);
      if (k >= 1) this.finish(true);
    } else {
      this.skipHint.classList.toggle('show', this.time >= SKIP_AFTER);
      const index = this.schedule.findIndex((c) => this.time >= c.start && this.time < c.end - FADE);
      if (index !== this.shown) {
        const slot = this.schedule[index];
        if (slot) {
          this.card.textContent = slot.text;
          this.card.classList.add('show');
          this.cue('intro.card', { index, count: this.cards });
        } else {
          this.card.classList.remove('show');
        }
        this.shown = index;
      }
      shot = this.still
        ? (this.shots[0] ?? gameplay)
        : samplePath([...this.shots, gameplay], smoothstep(this.time / this.duration));
      if (this.time >= this.duration) this.finish(false);
    }
    this.last = shot;
    return shot;
  }

  private finish(skipped: boolean): void {
    this.active = false;
    this.card.classList.remove('show');
    this.skipHint.classList.remove('show');
    this.root.classList.remove('on');
    this.hideTimer = window.setTimeout(() => (this.root.hidden = true), 1600);
    this.cue('intro.end', { skipped });
    this.onDone(skipped);
  }
}
