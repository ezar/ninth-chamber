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

export class CreditsRoll {
  private readonly root = $('roll');
  private readonly track = $('roll-track');
  private openedAt = 0;
  private onClose: () => void = () => {};

  constructor(private readonly cue: (type: string, data?: Record<string, unknown>) => void) {
    this.root.addEventListener('pointerdown', () => this.tryClose());
    this.track.addEventListener('animationend', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.repeat) return;
      e.preventDefault();
      this.tryClose();
    });
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
    if (this.visible && p.any) this.tryClose();
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
