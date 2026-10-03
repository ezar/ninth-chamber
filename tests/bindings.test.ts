import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYS,
  keyFor,
  keyLabel,
  keyMap,
  noOverrides,
  padFor,
  padLabel,
  padMap,
  rebind,
  sanitizeBindings,
} from '../src/core/bindings';

describe('control remapping', () => {
  it('starts from the spec layout, flare on the d-pad included', () => {
    expect(keyMap(noOverrides())).toEqual(DEFAULT_KEYS);
    const pad = new Map(padMap(noOverrides()));
    expect(pad.get(0)).toBe('jump');
    expect(pad.get(14)).toBe('flare');
    expect(pad.get(12)).toBe('torch');
  });

  it('moves an action to a free key and drops its old keys', () => {
    const o = rebind(noOverrides(), 'keys', 'walk', 'KeyZ');
    const map = keyMap(o);
    expect(map.KeyZ).toBe('walk');
    expect(map.ShiftLeft).toBeUndefined();
    expect(map.ShiftRight).toBeUndefined();
    expect(keyFor(o, 'walk')).toBe('KeyZ');
  });

  it('swaps when the key belongs to another action', () => {
    const o = rebind(noOverrides(), 'keys', 'action', 'Space');
    const map = keyMap(o);
    expect(map.Space).toBe('action');
    expect(map.KeyE).toBe('jump');
    expect(keyFor(o, 'jump')).toBe('KeyE');
  });

  it('never binds movement, Escape or Start, nor steals a fixed action', () => {
    const o = noOverrides();
    expect(rebind(o, 'keys', 'jump', 'KeyW')).toBe(o);
    expect(rebind(o, 'keys', 'jump', 'Escape')).toBe(o);
    expect(rebind(o, 'pad', 'jump', 9)).toBe(o);
    // I opens the inventory, which cannot be remapped: it is not taken.
    expect(rebind(o, 'keys', 'jump', 'KeyI')).toBe(o);
  });

  it('remaps and swaps gamepad buttons', () => {
    const o = rebind(noOverrides(), 'pad', 'action', 0);
    const pad = new Map(padMap(o));
    expect(pad.get(0)).toBe('action');
    expect(pad.get(2)).toBe('jump');
    expect(padFor(o, 'jump')).toBe(2);
  });

  it('keeps only valid entries from storage', () => {
    const o = sanitizeBindings({
      keys: { jump: 'KeyZ', walk: 'KeyW', nope: 'KeyX' },
      pad: { fire: 3.5, roll: 4 },
    });
    expect(o).toEqual({ keys: { jump: 'KeyZ' }, pad: { roll: 4 } });
    expect(sanitizeBindings('junk')).toEqual(noOverrides());
  });

  it('labels keys and buttons as printed', () => {
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('Digit3')).toBe('3');
    expect(padLabel(0)).toBe('A');
    expect(padLabel(14)).toBe('←');
  });
});
