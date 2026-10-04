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

/** The offset a button is drawn with (its CSS translate), [0, 0] when none. */
export function parseOffset(translate: string): [number, number] {
  // A zero second value is dropped when read back ("-742px 0px" reads "-742px").
  const m = /^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?$/.exec(translate.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [0, 0];
}

/**
 * Keeps the layout clamped as buttons come and go: a button drawn again after being hidden
 * (the note reader closes, the torch is found, play starts) changes size, and is clamped
 * then to the screen it shows on.
 */
export function watchTouchLayout(root: HTMLElement, layout: () => TouchLayout): void {
  if (typeof ResizeObserver === 'undefined') return;
  const seen = new ResizeObserver(() => applyTouchLayout(root, layout()));
  for (const el of root.querySelectorAll<HTMLElement>('.tbtn[data-button]')) seen.observe(el);
}

/** The part of an offset that keeps a button (its box at its own place) wholly on screen. */
export function clampOffset(
  home: { left: number; top: number; right: number; bottom: number },
  o: readonly [number, number],
  width: number,
  height: number,
): [number, number] {
  const x = Math.min(width - home.right, Math.max(-home.left, o[0]));
  const y = Math.min(height - home.bottom, Math.max(-home.top, o[1]));
  return [Math.round(x), Math.round(y)];
}

/**
 * Draws each button where the layout puts it, as far as the screen allows: a layout made
 * on another screen, in the other orientation or with smaller buttons stays on screen. The
 * saved layout is not changed. Buttons not drawn now (outside play) are clamped next time.
 */
export function applyTouchLayout(root: HTMLElement, layout: TouchLayout): void {
  for (const el of root.querySelectorAll<HTMLElement>('.tbtn[data-button]')) {
    const b = el.dataset.button;
    const o = isTouchButton(b) ? layout[b] : undefined;
    if (!o) {
      el.style.translate = '';
      continue;
    }
    el.style.translate = `${o[0]}px ${o[1]}px`;
    const box = el.getBoundingClientRect();
    if (box.width === 0) continue;
    const home = {
      left: box.left - o[0],
      top: box.top - o[1],
      right: box.right - o[0],
      bottom: box.bottom - o[1],
    };
    const [x, y] = clampOffset(home, o, window.innerWidth, window.innerHeight);
    el.style.translate = `${x}px ${y}px`;
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
    // Capture phase on the window, and stopImmediatePropagation: while the editor is open no key
    // reaches the menu or the game underneath (Escape would back out of Options too). Enter, Space
    // and Tab still work the editor's own buttons.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.open) return;
        e.stopImmediatePropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          this.finish();
        }
      },
      { capture: true },
    );
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
    // From where the button is drawn: a saved offset may have been clamped to this screen.
    const from = parseOffset(el.style.translate);
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
