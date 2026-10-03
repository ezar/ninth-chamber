/**
 * The journal note reader: opens on the simulation's `note.read` event and
 * shows the note as a typed expedition log, a handwritten page or a rubbing of
 * a carving with Nora's translation. The game pauses while it is open (main
 * stops stepping the simulation). Closing dispatches `note.closed`.
 */
import { actionKey, actionLabel } from './control-labels';
import { glyphRows } from '../core/glyphs';
import type { NoteStyle } from '../sim/grid/schema';
import type { Device } from './hud';
import { t, type StringKey } from './i18n';
import type { PadEdges } from './nav';

export interface NoteView {
  id: string;
  /** i18n key prefix of the note. */
  text: string;
  style: NoteStyle;
  /** First time this note is read. */
  first: boolean;
  /** Distinct notes read so far, and in the level. */
  count: number;
  total: number;
}

/** Ignore closing input for this long after opening, so the Action press that opened it does not close it. */
const OPEN_GRACE = 0.35;
const CLOSE_KEYS = new Set(['Escape', 'Enter', 'Space', 'Backspace', 'NumpadEnter']);

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

export class Reader {
  private readonly root = $('reader');
  private readonly sheet = $('reader-sheet');
  private note: NoteView | null = null;
  private age = 0;

  constructor(
    private readonly onClose: (note: NoteView) => void,
    private readonly device: () => Device,
  ) {
    $('reader-close').addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (!this.sheet.contains(e.target as Node) && !(e.target as HTMLElement).closest('.reader-foot'))
        this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.repeat || !(CLOSE_KEYS.has(e.code) || e.code === actionKey())) return;
      e.preventDefault();
      this.close();
    });
  }

  get isOpen(): boolean {
    return this.note !== null;
  }

  open(note: NoteView): void {
    this.note = note;
    this.age = 0;
    this.render(note);
    this.root.hidden = false;
    this.root.scrollTop = 0;
    requestAnimationFrame(() => this.root.classList.add('show'));
    $('reader-close').focus({ preventScroll: true });
  }

  close(): void {
    const note = this.note;
    if (!note || this.age < OPEN_GRACE) return;
    this.note = null;
    this.root.classList.remove('show');
    this.root.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur();
    this.onClose(note);
  }

  update(dt: number): void {
    if (this.note) this.age += dt;
  }

  pad(p: PadEdges): void {
    if (this.isOpen && (p.confirm || p.back)) this.close();
  }

  private render(note: NoteView): void {
    const key = (part: string): string => t(`${note.text}.${part}` as StringKey);
    this.sheet.dataset.style = note.style;
    $('reader-meta').textContent = key('meta');
    $('reader-title').textContent = key('title');
    $('reader-counter').textContent = t('reader.counter', { n: note.count, total: note.total });
    const device = this.device();
    const kbd = $('reader-key');
    kbd.textContent = actionLabel(device);
    kbd.hidden = device === 'touch';

    const rubbing = $('reader-rubbing');
    rubbing.hidden = note.style !== 'carving';
    if (note.style === 'carving') $('reader-glyphs').innerHTML = rubbingSvg(note.id);

    const body = $('reader-body');
    body.replaceChildren();
    key('body')
      .split(/\n{2,}/)
      .forEach((para, i) => {
        const verse = note.style === 'carving' && i === 0;
        const el = document.createElement(verse ? 'blockquote' : 'p');
        if (para.startsWith('—')) el.className = 'sign';
        para.split('\n').forEach((line, j) => {
          if (j > 0) el.append(document.createElement('br'));
          el.append(line);
        });
        body.append(el);
      });
  }
}

/** Two rows of the note's glyphs, as pale paper left untouched by the charcoal. */
function rubbingSvg(seed: string): string {
  const rows = glyphRows(seed, 2, 9);
  const cell = 56;
  const pad = 14;
  const w = 9 * cell + pad * 2;
  const h = rows.length * cell + pad * 2;
  const paths = rows
    .flatMap((row, r) =>
      row.map((glyph, c) =>
        glyph
          .map((stroke) =>
            stroke
              .map(
                ([x, y], k) =>
                  `${k ? 'L' : 'M'}${(pad + (c + 0.12 + x * 0.76) * cell).toFixed(1)} ${(pad + (r + 0.12 + y * 0.76) * cell).toFixed(1)}`,
              )
              .join(''),
          )
          .join(''),
      ),
    )
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${paths}"/></svg>`;
}
