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
});
