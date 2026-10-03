/**
 * The labels of remapped controls on screen (the Action prompt, the note
 * reader's close key). Main keeps them in step with Options → Keyboard and
 * Gamepad.
 */
import { keyFor, keyLabel, noOverrides, padFor, padLabel, type BindingOverrides } from '../core/bindings';
import type { Device } from './hud';

let current: BindingOverrides = noOverrides();

export function setLabelBindings(o: BindingOverrides): void {
  current = o;
}

/** The Action control as the player sees it on the device in use. */
export function actionLabel(device: Device): string {
  if (device === 'touch') return '◉';
  return device === 'gamepad' ? padLabel(padFor(current, 'action')) : keyLabel(keyFor(current, 'action'));
}

/** The key code bound to Action. */
export const actionKey = (): string | null => keyFor(current, 'action');
