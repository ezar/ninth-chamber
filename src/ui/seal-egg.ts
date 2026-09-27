/**
 * An easter egg on the title seal: each tap (or Enter) lights the next of the
 * eight carved segments with a rising note; the ninth tap fills the missing
 * segment, the ring opens and glows, a line appears under it, and after a few
 * seconds it closes again. Taps more than a few seconds apart start over, so
 * a stray tap only lights one segment for a moment.
 */
import { buzz } from '../core/haptics';
import { t } from './i18n';

/** Seconds without a tap before the lit segments go out. */
const IDLE = 5;
/** How long the ring stays open. */
const OPEN = 4.2;
/** How far each segment moves out when the ring opens (seal viewBox units). */
const SPREAD = 16;

export class SealEgg {
  private lit = 0;
  private idle: number | undefined;
  private closing: number | undefined;
  private readonly whisper: HTMLElement;

  /** `cue` dispatches presentation events (the audio listens for seal.note and seal.open). */
  constructor(
    private readonly root: HTMLElement,
    private readonly cue: (type: string, data?: Record<string, unknown>) => void,
  ) {
    root.setAttribute('role', 'button');
    root.tabIndex = 0;
    root.setAttribute('aria-label', t('seal.label'));
    root.classList.add('seal-egg');
    this.whisper = document.createElement('p');
    this.whisper.className = 'seal-whisper';
    this.whisper.setAttribute('aria-live', 'polite');
    root.after(this.whisper);
    root.addEventListener('click', () => this.tap());
    root.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      // Keeps the title's own Enter (start the game) from firing too.
      e.preventDefault();
      e.stopPropagation();
      this.tap();
    });
  }

  private segments(): SVGPathElement[] {
    return Array.from(this.root.querySelectorAll<SVGPathElement>('.seal-stone, .seal-ninth'));
  }

  private tap(): void {
    if (this.root.classList.contains('open')) return;
    window.clearTimeout(this.idle);
    const segs = this.segments();
    if (this.lit < 8) {
      segs[this.lit]?.classList.add('glow');
      this.cue('seal.note', { i: this.lit });
      buzz(8);
      this.lit++;
      // A little turn with every segment, as if something inside were being wound.
      this.root.style.setProperty('--turn', `${this.lit * 5}deg`);
      this.root.classList.remove('nudge');
      void this.root.offsetWidth;
      this.root.classList.add('nudge');
      this.idle = window.setTimeout(() => this.reset(), IDLE * 1000);
      return;
    }
    this.open(segs);
  }

  private open(segs: SVGPathElement[]): void {
    segs.forEach((p, i) => {
      // Each segment moves out along its own middle angle (segment i spans -90 + 40i … +40°).
      const a = ((-70 + i * 40) * Math.PI) / 180;
      p.style.setProperty('--dx', `${(Math.cos(a) * SPREAD).toFixed(1)}px`);
      p.style.setProperty('--dy', `${(Math.sin(a) * SPREAD).toFixed(1)}px`);
      p.classList.add('glow');
    });
    this.root.classList.add('open');
    this.whisper.textContent = t('seal.whisper');
    this.whisper.classList.add('show');
    this.cue('seal.open');
    buzz(40);
    this.closing = window.setTimeout(() => this.reset(), OPEN * 1000);
  }

  private reset(): void {
    window.clearTimeout(this.idle);
    window.clearTimeout(this.closing);
    this.lit = 0;
    this.root.classList.remove('open', 'nudge');
    this.root.style.setProperty('--turn', '0deg');
    for (const p of this.segments()) p.classList.remove('glow');
    this.whisper.classList.remove('show');
  }
}
