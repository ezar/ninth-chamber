/**
 * Movable touch buttons (ui/touch-layout.ts): a saved offset is drawn only as
 * far as the screen allows, so a layout made in landscape, or with smaller
 * buttons, never leaves a button off screen after a rotation or a resize.
 */
import { describe, expect, it } from 'vitest';
import { clampOffset, parseOffset } from '../src/ui/touch-layout';

describe('touch button offsets', () => {
  // A 60 px button whose own place is the bottom right corner of an 844 × 390 screen.
  const home = { left: 770, top: 316, right: 830, bottom: 376 };

  it('keeps an offset that stays on screen', () => {
    expect(clampOffset(home, [-300, -100], 844, 390)).toEqual([-300, -100]);
  });

  it('pulls a button back on screen after the screen turns', () => {
    // Moved 600 px left in landscape; the portrait screen is 390 wide, and the place moves too.
    const portrait = { left: 316, top: 770, right: 376, bottom: 830 };
    expect(clampOffset(portrait, [-600, 0], 390, 844)).toEqual([-316, 0]);
    expect(clampOffset(home, [0, -500], 844, 390)).toEqual([0, -316]);
    expect(clampOffset(home, [100, 100], 844, 390)).toEqual([14, 14]);
  });

  it('reads back the offset a button is drawn with, for the editor to drag from', () => {
    expect(parseOffset('-316px 12px')).toEqual([-316, 12]);
    // Browsers drop a zero second value: "-742px 0px" reads back as "-742px".
    expect(parseOffset('-742px')).toEqual([-742, 0]);
    expect(parseOffset('')).toEqual([0, 0]);
    expect(parseOffset('none')).toEqual([0, 0]);
  });
});
