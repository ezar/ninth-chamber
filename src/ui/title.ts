/**
 * Title screen and credits (spec §13 "Menús", §14 "Publicación"; Claude Design
 * artboard e, main menu over the live entrance scene): the logo lockup, the
 * menu, the version string and the copyright line.
 */
import { versionLabel } from './build-info';
import { creditRows } from './credits-data';
import { focusFirst, menuKey, menuPad, type PadEdges } from './nav';
import { sealSvg } from './seal';
import { SealEgg } from './seal-egg';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

export class TitleScreen {
  private readonly root = $('start');
  private readonly menu = $('start-menu');
  private readonly credits = $('credits');

  /**
   * `blocked` pauses the title's own keys while another layer owns them (the
   * options menu opened from the title, or the game still loading).
   */
  constructor(
    private readonly onStart: () => void,
    private readonly cue: (type: string, data?: Record<string, unknown>) => void,
    private readonly blocked: () => boolean = () => false,
  ) {
    // Decorative: the wordmark next to it already names the game.
    $('start-seal').innerHTML = sealSvg();
    new SealEgg($('start-seal'), cue);
    $('version').textContent = versionLabel;
    this.buildCredits();

    $('start-button').addEventListener('click', () => this.onStart());
    $('credits-button').addEventListener('click', () => this.openCredits());
    $('credits-back').addEventListener('click', () => this.closeCredits());
    // Hovering a menu entry focuses it, so mouse and keyboard share one highlight.
    for (const b of this.root.querySelectorAll<HTMLElement>('.title-menu button'))
      b.addEventListener('pointerenter', () => b.focus({ preventScroll: true }));

    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.repeat || this.blocked()) return;
      if (this.creditsOpen) {
        menuKey(e, this.credits, () => this.closeCredits());
        return;
      }
      if (menuKey(e, this.menu)) return;
      // Enter or Space with nothing focused (e.g. after clicking the scene) starts the game.
      const onControl = document.activeElement instanceof HTMLButtonElement;
      if (!onControl && (e.code === 'Enter' || e.code === 'Space')) this.onStart();
    });
    focusFirst(this.menu);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get creditsOpen(): boolean {
    return !this.credits.hidden;
  }

  show(): void {
    this.root.classList.remove('hidden');
    focusFirst(this.menu);
  }

  hide(): void {
    this.closeCredits();
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** Gamepad navigation while the title is up. */
  pad(p: PadEdges): void {
    if (!this.visible || this.blocked()) return;
    if (this.creditsOpen) menuPad(p, this.credits, () => this.closeCredits());
    else menuPad(p, this.menu);
  }

  private openCredits(): void {
    this.credits.hidden = false;
    requestAnimationFrame(() => this.credits.classList.add('show'));
    $('credits-back').focus({ preventScroll: true });
    this.cue('ui.credits');
  }

  private closeCredits(): void {
    if (this.credits.hidden) return;
    this.credits.classList.remove('show');
    this.credits.hidden = true;
    $('credits-button').focus({ preventScroll: true });
  }

  private buildCredits(): void {
    const list = $('credits-list');
    const row = (label: string, values: readonly string[]): void => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      for (const v of values) {
        const line = document.createElement('span');
        line.textContent = v;
        dd.append(line);
      }
      list.append(dt, dd);
    };
    for (const [label, values] of creditRows()) row(label, values);
  }
}
