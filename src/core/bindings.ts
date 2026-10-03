/**
 * Control remapping (roadmap 0.2.6): which key and which gamepad button
 * trigger each game action. The defaults are the layout of spec §13; the
 * player's changes are stored as overrides, one key and one button per
 * action, in the settings. Binding an input another action already uses
 * swaps the two, so no action is ever left without a control.
 *
 * Movement (WASD and arrows, the left stick), the camera, Escape and Start
 * stay fixed: they are how the menus themselves are driven.
 *
 * Pure (no DOM), so it is tested in Node; src/core/input.ts reads the maps.
 */
import type { Button } from './input-frame';

/** Actions the player can remap, in the order the options list them. */
export const REMAPPABLE = [
  'jump',
  'action',
  'walk',
  'roll',
  'fire',
  'weapons',
  'target',
  'torch',
  'flare',
  'medkit',
  'recenter',
] as const satisfies readonly Button[];
export type RemappableAction = (typeof REMAPPABLE)[number];

export interface BindingOverrides {
  /** KeyboardEvent.code per action. */
  keys: Partial<Record<RemappableAction, string>>;
  /** Standard-mapping button index per action. */
  pad: Partial<Record<RemappableAction, number>>;
}

export const noOverrides = (): BindingOverrides => ({ keys: {}, pad: {} });

/** The default keyboard layout (spec §13). Several keys may share an action. */
export const DEFAULT_KEYS: Readonly<Record<string, Button>> = {
  Space: 'jump',
  KeyE: 'action',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  KeyF: 'fire',
  KeyQ: 'roll',
  KeyR: 'weapons',
  KeyH: 'medkit',
  KeyG: 'flare',
  KeyT: 'torch',
  KeyI: 'inventory',
  // Spec §6 "Apuntado": Tab switches target (the inventory keeps I).
  Tab: 'target',
  Escape: 'pause',
  KeyC: 'recenter',
};

/** The default gamepad layout, Gamepad API standard mapping (spec §13). */
export const DEFAULT_PAD: readonly (readonly [number, Button])[] = [
  [0, 'jump'], // A
  [2, 'action'], // X
  [1, 'roll'], // B
  [7, 'fire'], // RT
  [6, 'walk'], // LT
  [5, 'weapons'], // RB (spec §13)
  [4, 'weapons'], // LB: draw / holster on either bumper (owner's request); Y stays the medkit
  [12, 'torch'], // d-pad up: put the torch away / take it out
  [14, 'flare'], // d-pad left: light or throw a flare
  [3, 'medkit'], // Y
  [8, 'inventory'], // Select
  [9, 'pause'], // Start
  [11, 'recenter'], // right stick click
  [15, 'target'], // d-pad right
];

/** Keys that cannot be bound: movement and the menus' own. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'Escape',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'NumpadEnter',
  'Backspace',
  'MetaLeft',
  'MetaRight',
]);
/** Buttons that cannot be bound: Start (pause). */
export const RESERVED_PAD: ReadonlySet<number> = new Set([9]);

const isRemappable = (b: Button): b is RemappableAction => (REMAPPABLE as readonly Button[]).includes(b);

/** Keyboard code → action, with the overrides applied. */
export function keyMap(o: BindingOverrides): Record<string, Button> {
  const map = new Map<string, Button>(Object.entries(DEFAULT_KEYS));
  for (const action of REMAPPABLE) {
    if (o.keys[action] === undefined) continue;
    for (const [k, b] of map) if (b === action) map.delete(k);
  }
  for (const action of REMAPPABLE) {
    const code = o.keys[action];
    if (code !== undefined) map.set(code, action);
  }
  return Object.fromEntries(map);
}

/** Gamepad button index → action, with the overrides applied. */
export function padMap(o: BindingOverrides): [number, Button][] {
  const map = new Map<number, Button>(DEFAULT_PAD.map(([i, b]) => [i, b]));
  for (const action of REMAPPABLE) {
    if (o.pad[action] === undefined) continue;
    for (const [i, b] of map) if (b === action) map.delete(i);
  }
  for (const action of REMAPPABLE) {
    const i = o.pad[action];
    if (i !== undefined) map.set(i, action);
  }
  return [...map];
}

/** The key shown for an action: its override, else its first default key. */
export function keyFor(o: BindingOverrides, action: RemappableAction): string | null {
  const map = keyMap(o);
  const own = o.keys[action];
  if (own !== undefined) return own;
  return Object.keys(map).find((k) => map[k] === action) ?? null;
}

/** The button shown for an action: its override, else its first default button. */
export function padFor(o: BindingOverrides, action: RemappableAction): number | null {
  const own = o.pad[action];
  if (own !== undefined) return own;
  return padMap(o).find(([, b]) => b === action)?.[0] ?? null;
}

/**
 * Binds a key (or button) to an action. If another remappable action used it,
 * that action takes this one's previous key, so both keep a control. Returns
 * the new overrides, or the old ones when the input is reserved.
 */
export function rebind(
  o: BindingOverrides,
  device: 'keys' | 'pad',
  action: RemappableAction,
  input: string | number,
): BindingOverrides {
  const next: BindingOverrides = { keys: { ...o.keys }, pad: { ...o.pad } };
  if (device === 'keys') {
    const code = String(input);
    if (RESERVED_KEYS.has(code)) return o;
    const other = keyMap(o)[code];
    const previous = keyFor(o, action);
    if (other && other !== action) {
      if (!isRemappable(other)) return o;
      if (previous) next.keys[other] = previous;
    }
    next.keys[action] = code;
  } else {
    const index = Number(input);
    if (!Number.isInteger(index) || index < 0 || RESERVED_PAD.has(index)) return o;
    const other = new Map(padMap(o)).get(index);
    const previous = padFor(o, action);
    if (other && other !== action) {
      if (!isRemappable(other)) return o;
      if (previous !== null) next.pad[other] = previous;
    }
    next.pad[action] = index;
  }
  return next;
}

/** Overrides read from storage, keeping only valid entries. */
export function sanitizeBindings(raw: unknown): BindingOverrides {
  const out = noOverrides();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as { keys?: unknown; pad?: unknown };
  for (const action of REMAPPABLE) {
    const k = (r.keys as Record<string, unknown> | undefined)?.[action];
    if (typeof k === 'string' && k && !RESERVED_KEYS.has(k)) out.keys[action] = k;
    const p = (r.pad as Record<string, unknown> | undefined)?.[action];
    if (typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < 32 && !RESERVED_PAD.has(p))
      out.pad[action] = p;
  }
  return out;
}

/** A short label for a key code, as printed on keyboards. */
export function keyLabel(code: string | null): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    Tab: 'Tab',
    CapsLock: 'Caps',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  return named[code] ?? code;
}

/** A short label for a standard-mapping gamepad button. */
export function padLabel(index: number | null): string {
  if (index === null) return '—';
  const names = [
    'A',
    'B',
    'X',
    'Y',
    'LB',
    'RB',
    'LT',
    'RT',
    'Select',
    'Start',
    'L3',
    'R3',
    '↑',
    '↓',
    '←',
    '→',
    'Home',
  ];
  return names[index] ?? `#${index}`;
}
