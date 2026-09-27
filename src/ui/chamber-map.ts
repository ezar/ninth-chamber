/**
 * The chamber map (from the title): the nine chambers of campaign.ts in
 * order. Chambers reached can be entered; the next ones wait, IV–VIII are
 * sealed and the ninth is a mystery.
 */
import { CHAMBERS } from './campaign';
import { t, type StringKey } from './i18n';
import { focusFirst, menuKey, menuPad, type PadEdges } from './nav';
import { chamberState, type ChamberState } from './progress';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

const STATE_LABEL: Record<Exclude<ChamberState, 'open'>, StringKey> = {
  locked: 'chambers.locked',
  soon: 'end.soon',
  sealed: 'chambers.sealed',
  unknown: 'chambers.unknown',
};

export class ChamberMap {
  private readonly root = $('chambers');
  private readonly list = $('chambers-list');
  private opener: HTMLElement | null = null;

  /** `onPick` enters a level; `current` is the level loaded now. */
  constructor(
    private readonly onPick: (levelId: string) => void,
    private readonly current: string,
    private readonly cue: (type: string) => void,
  ) {
    $('chambers-back').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && !e.repeat) menuKey(e, this.root, () => this.close());
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Opens the map with the chambers reached so far and the levels this build can play. */
  open(reached: ReadonlySet<string>, playable: ReadonlySet<string>): void {
    this.build(reached, playable);
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('show'));
    focusFirst(this.root);
    this.cue('ui.credits');
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.classList.remove('show');
    this.root.hidden = true;
    this.opener?.focus({ preventScroll: true });
  }

  pad(p: PadEdges): void {
    if (this.isOpen) menuPad(p, this.root, () => this.close());
  }

  private build(reached: ReadonlySet<string>, playable: ReadonlySet<string>): void {
    this.list.replaceChildren();
    for (const c of CHAMBERS) {
      const state = chamberState(c, reached, playable);
      const li = document.createElement('li');
      li.className = `chamber ${state}`;
      if (c.level === this.current) li.classList.add('current');
      const numeral = document.createElement('span');
      numeral.className = 'chamber-numeral';
      numeral.textContent = c.numeral;
      const text = document.createElement('span');
      text.className = 'chamber-text';
      const name = document.createElement('span');
      name.className = 'chamber-name';
      name.textContent = state === 'unknown' ? '? ? ?' : t(c.name);
      const line = document.createElement('span');
      line.className = 'chamber-line';
      line.textContent = t(c.line);
      text.append(name, line);
      const level = c.level;
      if (state === 'open' && level) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.nav = '';
        b.append(numeral, text);
        const tag = document.createElement('span');
        tag.className = 'chamber-state';
        tag.textContent = t('chambers.enter');
        b.append(tag);
        b.addEventListener('click', () => {
          this.close();
          this.onPick(level);
        });
        b.addEventListener('pointerenter', () => b.focus({ preventScroll: true }));
        li.append(b);
      } else {
        const tag = document.createElement('span');
        tag.className = 'chamber-state';
        tag.textContent = t(STATE_LABEL[state === 'open' ? 'locked' : state]);
        li.append(numeral, text, tag);
      }
      this.list.append(li);
    }
  }
}
