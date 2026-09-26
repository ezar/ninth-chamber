/**
 * Menu navigation (spec §13 "Menús": everything works with keyboard and
 * gamepad, with visible focus). Menus read the pad's standard mapping
 * directly: they need buttons the game's InputDevice leaves unmapped (the
 * D-pad, B as back).
 */

/** Standard-mapping button indices. */
export const PAD = {
  A: 0,
  B: 1,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export interface PadSnapshot {
  connected: boolean;
  /** Bit i set: button i is down. */
  held: number;
  /** Bit i set: button i went down since the previous read. */
  pressed: number;
  /** Left stick. */
  x: number;
  y: number;
}

export const padHas = (mask: number, button: number): boolean => (mask & (1 << button)) !== 0;

export class PadReader {
  private prev = 0;

  read(): PadSnapshot {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads.find((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
    if (!pad) {
      this.prev = 0;
      return { connected: false, held: 0, pressed: 0, x: 0, y: 0 };
    }
    let held = 0;
    pad.buttons.forEach((b, i) => {
      if (i < 31 && (b.pressed || b.value > 0.5)) held |= 1 << i;
    });
    const pressed = held & ~this.prev;
    this.prev = held;
    return { connected: true, held, pressed, x: pad.axes[0] ?? 0, y: pad.axes[1] ?? 0 };
  }
}

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/** Direction held on the D-pad or the left stick (dominant axis past a firm threshold). */
export function padDirection(s: PadSnapshot): NavDirection | null {
  if (padHas(s.held, PAD.UP)) return 'up';
  if (padHas(s.held, PAD.DOWN)) return 'down';
  if (padHas(s.held, PAD.LEFT)) return 'left';
  if (padHas(s.held, PAD.RIGHT)) return 'right';
  const ax = Math.abs(s.x);
  const ay = Math.abs(s.y);
  if (Math.max(ax, ay) < 0.6) return null;
  if (ay >= ax) return s.y < 0 ? 'up' : 'down';
  return s.x < 0 ? 'left' : 'right';
}

/** Auto-repeat for a held direction: fires at once, then after a pause at a steady rate. */
export class DirectionRepeat {
  private current: NavDirection | null = null;
  private wait = 0;

  constructor(
    private readonly delay = 0.38,
    private readonly rate = 0.11,
  ) {}

  update(dir: NavDirection | null, dt: number): NavDirection | null {
    if (dir !== this.current) {
      this.current = dir;
      this.wait = this.delay;
      return dir;
    }
    if (!dir) return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    this.wait = this.rate;
    return dir;
  }

  reset(): void {
    this.current = null;
  }
}

/** Focusable items of a menu panel, in DOM order. */
export function navItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-nav]')].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

/** Moves focus by `delta` items within `root`, wrapping around. */
export function moveFocus(root: ParentNode, delta: number): void {
  const items = navItems(root);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = i < 0 ? (delta > 0 ? 0 : items.length - 1) : (i + delta + items.length) % items.length;
  focusItem(items[next]);
}

export function focusItem(el: HTMLElement | undefined): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}

/** Event an option row listens to for left/right changes from any device. */
export const ADJUST_EVENT = 'nav-adjust';

export function adjust(el: Element | null, step: -1 | 1): void {
  el?.dispatchEvent(new CustomEvent<number>(ADJUST_EVENT, { detail: step }));
}
