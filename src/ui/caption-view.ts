/**
 * Draws the captions from ui/captions.ts: a short stack of subtitle lines above
 * the action prompt, and an arrow at the screen edge pointing at a trap that
 * has just armed. Created here so the page markup stays as is.
 */
import type { SimEvent } from '../core/events';
import { CaptionGate, captionFor, type Caption, type CaptionSize } from './captions';
import { t, type StringKey } from './i18n';

const LINES = 3;
const LINE_TIME = 3.5;
const CUE_TIME = 1.6;

interface Line {
  el: HTMLElement;
  left: number;
}

export class CaptionView {
  /** Subtitles on or off (Options → Accessibility). */
  subtitles = false;
  /** Trap arrows on or off. */
  trapCues = true;
  private readonly box = document.createElement('div');
  private readonly cues = document.createElement('div');
  private readonly gate = new CaptionGate();
  private lines: Line[] = [];
  private cueList: Line[] = [];
  private clock = 0;

  constructor(parent: HTMLElement) {
    this.box.id = 'captions';
    this.box.setAttribute('aria-live', 'polite');
    this.cues.id = 'trap-cues';
    this.cues.setAttribute('aria-hidden', 'true');
    parent.append(this.cues, this.box);
  }

  setSize(size: CaptionSize): void {
    this.box.dataset.size = size;
  }

  onEvent(e: SimEvent, at: { x: number; z: number }, listener: { x: number; z: number }, yaw: number): void {
    if (!this.subtitles && !this.trapCues) return;
    const c = captionFor(e, at, listener, yaw);
    if (!c || !this.gate.allow(c, this.clock)) return;
    if (this.subtitles) this.addLine(c);
    if (this.trapCues && c.trap) this.addCue(c);
  }

  private addLine(c: Caption): void {
    const sound = t(c.key);
    const text =
      c.side === 'near'
        ? t('caption.plain', { sound })
        : t('caption.withSide', { sound, side: t(`caption.side.${c.side}` as StringKey) });
    // The same words again just stay up longer.
    const same = this.lines.find((l) => l.el.textContent === text);
    if (same) {
      same.left = LINE_TIME;
      return;
    }
    const el = document.createElement('p');
    el.textContent = text;
    if (c.trap) el.className = 'trap';
    this.box.append(el);
    this.lines.push({ el, left: LINE_TIME });
    while (this.lines.length > LINES) this.lines.shift()?.el.remove();
  }

  private addCue(c: Caption): void {
    const el = document.createElement('div');
    el.className = 'cue';
    // On an ellipse around the screen centre, pointing outwards.
    const x = 50 + Math.sin(c.angle) * 40;
    const y = 50 - Math.cos(c.angle) * 34;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.style.setProperty('--angle', `${c.angle}rad`);
    this.cues.append(el);
    this.cueList.push({ el, left: CUE_TIME });
  }

  update(dt: number): void {
    this.clock += dt;
    for (const list of [this.lines, this.cueList]) {
      for (const l of list) {
        l.left -= dt;
        if (l.left <= 0) l.el.remove();
      }
    }
    this.lines = this.lines.filter((l) => l.left > 0);
    this.cueList = this.cueList.filter((l) => l.left > 0);
  }

  reset(): void {
    for (const l of [...this.lines, ...this.cueList]) l.el.remove();
    this.lines = [];
    this.cueList = [];
    this.gate.clear();
  }
}
