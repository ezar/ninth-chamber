/**
 * Movable touch buttons (spec §13 "Accesibilidad", left from 0.3.5): each
 * button keeps an offset in px from its own place, drawn with the CSS
 * `translate` property so it composes with the press animation. Options →
 * Accessibility → Arrange touch buttons opens the editor: the buttons show
 * over a veil, a drag moves one (kept on screen), Reset puts them all back
 * and Done keeps the layout.
 */
import { t } from './i18n';
import { TOUCH_BUTTONS, type TouchButton, type TouchLayout } from './settings';

const isTouchButton = (b: string | undefined): b is TouchButton =>
  b !== undefined && (TOUCH_BUTTONS as readonly string[]).includes(b);

/** Draws each button where the layout puts it. */
export function applyTouchLayout(root: HTMLElement, layout: TouchLayout): void {
  for (const el of root.querySelectorAll<HTMLElement>('.tbtn[data-button]')) {
    const b = el.dataset.button;
    const o = isTouchButton(b) ? layout[b] : undefined;
    el.style.translate = o ? `${o[0]}px ${o[1]}px` : '';
  }
}

export class TouchLayoutEditor {
  private layout: TouchLayout = {};
  private bar: HTMLElement | null = null;
  private drag: {
    id: number;
    button: TouchButton;
    el: HTMLElement;
    start: { x: number; y: number };
    from: [number, number];
    /** The button's box with no offset. */
    home: DOMRect;
  } | null = null;
  private onDone: (layout: TouchLayout) => void = () => {};

  constructor(private readonly root: HTMLElement) {
    // Capture phase: the editor takes the pointer before the touch controls see it.
    root.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    root.addEventListener('pointermove', (e) => this.move(e), { capture: true });
    root.addEventListener('pointerup', (e) => this.up(e), { capture: true });
    root.addEventListener('pointercancel', (e) => this.up(e), { capture: true });
    window.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.finish();
      }
    });
  }

  get open(): boolean {
    return this.bar !== null;
  }

  show(layout: TouchLayout, onDone: (layout: TouchLayout) => void): void {
    this.layout = structuredClone(layout);
    this.onDone = onDone;
    document.body.classList.add('touch-edit');
    applyTouchLayout(this.root, this.layout);
    const bar = document.createElement('div');
    bar.id = 'touch-edit-bar';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', t('options.touchLayout'));
    const hint = document.createElement('p');
    hint.textContent = t('options.touchLayout.drag');
    const reset = document.createElement('button');
    reset.className = 'ghost';
    reset.textContent = t('options.touchLayout.reset');
    reset.addEventListener('click', () => {
      this.layout = {};
      applyTouchLayout(this.root, this.layout);
    });
    const done = document.createElement('button');
    done.className = 'ghost';
    done.textContent = t('options.touchLayout.done');
    done.addEventListener('click', () => this.finish());
    bar.append(hint, reset, done);
    document.body.append(bar);
    this.bar = bar;
    done.focus();
  }

  private finish(): void {
    if (!this.bar) return;
    this.bar.remove();
    this.bar = null;
    this.drag = null;
    document.body.classList.remove('touch-edit');
    this.onDone(this.layout);
  }

  private down(e: PointerEvent): void {
    if (!this.open) return;
    e.stopPropagation();
    e.preventDefault();
    const el = (e.target as Element | null)?.closest<HTMLElement>('.tbtn[data-button]');
    const button = el?.dataset.button;
    if (!el || !isTouchButton(button) || this.drag) return;
    const from = this.layout[button] ?? [0, 0];
    const box = el.getBoundingClientRect();
    this.drag = {
      id: e.pointerId,
      button,
      el,
      start: { x: e.clientX, y: e.clientY },
      from,
      home: new DOMRect(box.x - from[0], box.y - from[1], box.width, box.height),
    };
    this.root.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!this.open || !d || e.pointerId !== d.id) return;
    e.stopPropagation();
    e.preventDefault();
    // Kept wholly on screen.
    const x = Math.min(
      window.innerWidth - d.home.right,
      Math.max(-d.home.left, d.from[0] + e.clientX - d.start.x),
    );
    const y = Math.min(
      window.innerHeight - d.home.bottom,
      Math.max(-d.home.top, d.from[1] + e.clientY - d.start.y),
    );
    const o: [number, number] = [Math.round(x), Math.round(y)];
    this.layout = { ...this.layout, [d.button]: o };
    if (o[0] === 0 && o[1] === 0)
      this.layout = Object.fromEntries(Object.entries(this.layout).filter(([k]) => k !== d.button));
    d.el.style.translate = `${o[0]}px ${o[1]}px`;
  }

  private up(e: PointerEvent): void {
    if (!this.open) return;
    e.stopPropagation();
    if (this.drag?.id === e.pointerId) this.drag = null;
  }
}
