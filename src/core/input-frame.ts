/**
 * InputFrame: one tick of input as plain data (spec §3).
 * Recording the list of InputFrames records a playthrough.
 */

export const BUTTONS = [
  'jump',
  'action',
  'walk',
  'fire',
  'roll',
  'weapons',
  'medkit',
  'flare',
  'inventory',
  'pause',
  'recenter',
  /** Cycles the locked target while aiming. */
  'target',
] as const;

export type Button = (typeof BUTTONS)[number];

/** Bit mask: one bit per button, in BUTTONS order. */
export type ButtonMask = number;

export const buttonBit = (b: Button): number => 1 << BUTTONS.indexOf(b);

export interface InputFrame {
  /** Movement axis, x = right, y = forward, length ≤ 1. */
  moveX: number;
  moveY: number;
  /**
   * Camera yaw (radians) on this tick. Movement is camera-relative, so the yaw
   * is part of the input to keep replays deterministic.
   */
  camYaw: number;
  held: ButtonMask;
  pressed: ButtonMask;
  released: ButtonMask;
}

export const emptyFrame = (): InputFrame => ({
  moveX: 0,
  moveY: 0,
  camYaw: 0,
  held: 0,
  pressed: 0,
  released: 0,
});

export const isHeld = (f: InputFrame, b: Button): boolean => (f.held & buttonBit(b)) !== 0;
export const isPressed = (f: InputFrame, b: Button): boolean => (f.pressed & buttonBit(b)) !== 0;
export const isReleased = (f: InputFrame, b: Button): boolean => (f.released & buttonBit(b)) !== 0;

/** Raw state a device reports at a given instant. */
export interface RawInput {
  moveX: number;
  moveY: number;
  held: ButtonMask;
}

/**
 * Turns raw samples (merged from all devices) into InputFrames, computing
 * press and release edges between consecutive ticks.
 *
 * A press and release that both happen between two ticks is not lost: devices
 * accumulate `tapped`, which is merged here as pressed.
 */
export class InputFramer {
  private prevHeld: ButtonMask = 0;

  next(raw: RawInput, tapped: ButtonMask, camYaw: number): InputFrame {
    let { moveX, moveY } = raw;
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    const held = raw.held;
    const pressed = ((held & ~this.prevHeld) | tapped) >>> 0;
    const released = (this.prevHeld & ~held) >>> 0;
    this.prevHeld = held;
    return { moveX, moveY, camYaw, held, pressed, released };
  }
}
