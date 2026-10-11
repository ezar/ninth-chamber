/**
 * The iPhone Home Screen app fix (src/ui/standalone-viewport.ts): the viewport
 * height the page is missing when it starts under a translucent status bar.
 */
import { describe, expect, it } from 'vitest';
import { standaloneGap } from '../src/ui/standalone-viewport';

describe('standalone viewport gap', () => {
  it('is the status bar the viewport is short by, in portrait (the owner’s iPhone)', () => {
    // A 393 × 852 screen, a viewport 59 short, a 59 px safe area at the top.
    expect(standaloneGap(393, 852, 393, 793, 59)).toBe(59);
  });

  it('is 0 when the viewport fills the screen', () => {
    expect(standaloneGap(393, 852, 393, 852, 59)).toBe(0);
  });

  it('is 0 when the page starts below an opaque status bar (no safe area at the top)', () => {
    expect(standaloneGap(393, 852, 393, 793, 0)).toBe(0);
  });

  it('reads the screen in the right orientation in landscape', () => {
    // iOS reports the screen in portrait; in landscape the height is its short side.
    expect(standaloneGap(393, 852, 852, 393, 20)).toBe(0);
    expect(standaloneGap(393, 852, 852, 373, 20)).toBe(20);
  });

  it('leaves a much larger gap alone (a keyboard, a split view)', () => {
    expect(standaloneGap(393, 852, 393, 500, 59)).toBe(0);
  });
});
