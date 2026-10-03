import { describe, expect, it } from 'vitest';
import { InputFramer, buttonBit, isHeld, isPressed, isReleased } from '../src/core/input-frame';

const J = buttonBit('jump');

describe('InputFramer', () => {
  it('computes press and release edges', () => {
    const f = new InputFramer();
    const a = f.next({ moveX: 0, moveY: 0, held: J }, 0, 0);
    expect(isPressed(a, 'jump') && isHeld(a, 'jump')).toBe(true);
    const b = f.next({ moveX: 0, moveY: 0, held: J }, 0, 0);
    expect(isPressed(b, 'jump')).toBe(false);
    expect(isHeld(b, 'jump')).toBe(true);
    const c = f.next({ moveX: 0, moveY: 0, held: 0 }, 0, 0);
    expect(isReleased(c, 'jump')).toBe(true);
  });

  it('does not lose a quick tap between two ticks', () => {
    const f = new InputFramer();
    const a = f.next({ moveX: 0, moveY: 0, held: 0 }, J, 0);
    expect(isPressed(a, 'jump')).toBe(true);
  });

  it('normalizes the diagonal to length 1', () => {
    const f = new InputFramer();
    const a = f.next({ moveX: 1, moveY: 1, held: 0 }, 0, 0);
    expect(Math.hypot(a.moveX, a.moveY)).toBeCloseTo(1, 9);
  });

  it('latches a toggle button on one press and lets go on the next', () => {
    const A = buttonBit('action');
    const f = new InputFramer();
    f.setToggles(A);
    const none = { moveX: 0, moveY: 0, held: 0 };
    const down = { moveX: 0, moveY: 0, held: A };
    const a = f.next(down, A, 0);
    expect(isPressed(a, 'action') && isHeld(a, 'action')).toBe(true);
    // Let go of the key: still held.
    expect(isHeld(f.next(none, 0, 0), 'action')).toBe(true);
    expect(isHeld(f.next(none, 0, 0), 'action')).toBe(true);
    // Press again: released, and that press does not reach the sim as a new press.
    const d = f.next(down, A, 0);
    expect(isHeld(d, 'action')).toBe(false);
    expect(isPressed(d, 'action')).toBe(false);
    expect(isReleased(d, 'action')).toBe(true);
    expect(isHeld(f.next(none, 0, 0), 'action')).toBe(false);
    // Other buttons are untouched.
    const j = f.next({ moveX: 0, moveY: 0, held: J }, 0, 0);
    expect(isHeld(j, 'jump')).toBe(true);
    expect(isHeld(f.next(none, 0, 0), 'jump')).toBe(false);
  });

  it('a quick tap between two ticks also flips a toggle', () => {
    const W = buttonBit('walk');
    const f = new InputFramer();
    f.setToggles(W);
    expect(isHeld(f.next({ moveX: 0, moveY: 0, held: 0 }, W, 0), 'walk')).toBe(true);
    expect(isHeld(f.next({ moveX: 0, moveY: 0, held: 0 }, W, 0), 'walk')).toBe(false);
  });
});
