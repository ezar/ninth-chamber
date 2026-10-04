/**
 * The credits roll after the campaign's end (spec §19, chamber IX: "créditos
 * largos con la música del título"): the keepers, the credits and the
 * signatures of the ending reached, rising slowly over black. Any key, tap or
 * button closes it; with reduced motion it is a still list to scroll.
 *
 * Audio hooks (via `cue`): `credits.roll`, `credits.closed`.
 */
import { creditRows } from './credits-data';
import { t, type StringKey } from './i18n';
import type { PadEdges } from './nav';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

/** Seconds the roll takes to rise through the screen. */
const ROLL_SECONDS = 75;
/** Input this soon after it opens does not close it (the button press that opened it). */
const GRACE = 0.8;
/** A pointer that moves less than this (px) between down and up is a tap, not a scroll. */
const TAP = 10;
/** Keys that scroll the still list instead of closing it. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export class CreditsRoll {
  private readonly root = $('roll');
  private readonly track = $('roll-track');
  private openedAt = 0;
  private onClose: () => void = () => {};

  constructor(private readonly cue: (type: string, data?: Record<string, unknown>) => void) {
    // Rolling, any touch closes it. As a still list (reduced motion) it scrolls by hand, so only
    // a tap closes it, and the keys that scroll keep scrolling.
    let down: { x: number; y: number } | null = null;
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.still) this.tryClose();
      else down = { x: e.clientX, y: e.clientY };
    });
    this.root.addEventListener('pointerup', (e) => {
      if (this.still && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP) this.tryClose();
      down = null;
    });
    this.root.addEventListener('pointercancel', () => (down = null));
    this.track.addEventListener('animationend', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      // Focus stays on the button that opened the roll, so the keys scroll the list by hand
      // (held down, they keep scrolling).
      if (this.still && SCROLL_KEYS.has(e.key)) {
        e.preventDefault();
        this.scrollBy(e.key);
        return;
      }
      e.preventDefault();
      if (e.repeat) return;
      this.tryClose();
    });
  }

  private scrollBy(key: string): void {
    const page = this.root.clientHeight * 0.85;
    const top =
      key === 'Home'
        ? -this.root.scrollTop
        : key === 'End'
          ? this.root.scrollHeight
          : key === 'ArrowUp'
            ? -60
            : key === 'ArrowDown'
              ? 60
              : key === 'PageUp'
                ? -page
                : page;
    this.root.scrollBy({ top });
  }

  /** Shown as a still list, scrolled by hand: the system's or the game's reduced motion. */
  private get still(): boolean {
    return (
      document.documentElement.classList.contains('reduce-motion') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(signatures: readonly StringKey[], onClose: () => void): void {
    this.onClose = onClose;
    const track = this.track;
    track.replaceChildren();
    const line = (cls: string, text: string): void => {
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = text;
      track.append(p);
    };
    line('roll-title', t('chamber.9.name'));
    line('roll-label', t('credits.roll.keepers'));
    line('roll-value', t('credits.roll.keepers.value'));
    for (const [label, values] of creditRows()) {
      line('roll-label', label);
      for (const v of values) line('roll-value', v);
    }
    line('roll-thanks', t('credits.roll.thanks'));
    for (const s of signatures) line('roll-signature', t(s));
    track.style.setProperty('--roll-seconds', `${ROLL_SECONDS}s`);
    this.root.hidden = false;
    this.root.classList.remove('rolling');
    void this.root.offsetWidth;
    this.root.classList.add('rolling');
    this.openedAt = performance.now();
    this.cue('credits.roll');
  }

  pad(p: PadEdges): void {
    if (!this.visible) return;
    if (!this.still) {
      if (p.any) this.tryClose();
      return;
    }
    // The still list: up and down scroll it, a button closes it.
    if (p.up || p.down) this.root.scrollBy({ top: (p.down ? 1 : -1) * this.root.clientHeight * 0.4 });
    if (p.confirm || p.back) this.tryClose();
  }

  private tryClose(): void {
    if (performance.now() - this.openedAt >= GRACE * 1000) this.close();
  }

  private close(): void {
    if (!this.visible) return;
    this.root.hidden = true;
    this.root.classList.remove('rolling');
    this.cue('credits.closed');
    this.onClose();
  }
}
