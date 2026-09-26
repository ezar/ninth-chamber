/**
 * Menu navigation shared by the title, credits, note reader and end screens:
 * gamepad edges and keyboard focus movement. The keyboard device prevents the
 * default action of game keys (Space, arrows, Tab), so menus handle them here.
 */
import { buttonBit, type RawInput } from '../core/input-frame';

export interface PadEdges {
  /** A or X. */
  confirm: boolean;
  /** B or Start. */
  back: boolean;
  up: boolean;
  down: boolean;
  /** Any button pressed this frame. */
  any: boolean;
}

const CONFIRM = buttonBit('jump') | buttonBit('action');
const BACK = buttonBit('roll') | buttonBit('pause');

/** Turns gamepad samples into menu edges (stick and d-pad presses, with no auto-repeat). */
export class PadEdgeReader {
  private prevHeld = 0;
  private prevDir = 0;

  next(raw: RawInput): PadEdges {
    const pressed = raw.held & ~this.prevHeld;
    this.prevHeld = raw.held;
    const dir = raw.moveY > 0.6 ? 1 : raw.moveY < -0.6 ? -1 : 0;
    const moved = dir !== 0 && dir !== this.prevDir ? dir : 0;
    this.prevDir = dir;
    return {
      confirm: (pressed & CONFIRM) !== 0,
      back: (pressed & BACK) !== 0,
      up: moved === 1,
      down: moved === -1,
      any: pressed !== 0,
    };
  }
}

const focusable = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')].filter(
    (el) => el.offsetParent !== null,
  );

/** Moves focus to the next (1) or previous (-1) control inside `root`. */
export function moveFocus(root: HTMLElement, step: 1 | -1): void {
  const items = focusable(root);
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length;
  items[next]?.focus();
}

/** Focuses the first control of `root` (menus open with a visible focus). */
export function focusFirst(root: HTMLElement): void {
  focusable(root)[0]?.focus({ preventScroll: true });
}

/**
 * Keyboard handling for a menu: arrows and Tab move focus, Space activates
 * (Enter activates natively), Escape and Backspace go back. Returns true when
 * the key was used.
 */
export function menuKey(e: KeyboardEvent, root: HTMLElement, back?: () => void): boolean {
  switch (e.code) {
    case 'ArrowDown':
    case 'ArrowRight':
      moveFocus(root, 1);
      return true;
    case 'ArrowUp':
    case 'ArrowLeft':
      moveFocus(root, -1);
      return true;
    case 'Tab':
      e.preventDefault();
      moveFocus(root, e.shiftKey ? -1 : 1);
      return true;
    case 'Space': {
      const el = document.activeElement;
      if (el instanceof HTMLElement && root.contains(el)) {
        e.preventDefault();
        el.click();
        return true;
      }
      return false;
    }
    case 'Escape':
    case 'Backspace':
      if (!back) return false;
      back();
      return true;
    default:
      return false;
  }
}

/** Pad navigation for a menu: up and down move focus, confirm clicks the focused control. */
export function menuPad(pad: PadEdges, root: HTMLElement, back?: () => void): void {
  if (pad.down) moveFocus(root, 1);
  if (pad.up) moveFocus(root, -1);
  if (pad.confirm) {
    const el = document.activeElement;
    if (el instanceof HTMLElement && root.contains(el)) el.click();
    else focusFirst(root);
  }
  if (pad.back) back?.();
}
