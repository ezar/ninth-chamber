/**
 * Deterministic pseudo-glyphs for carved inscriptions. The same seed gives the
 * same signs on the in-world stone (render) and on the rubbing in the note
 * reader (ui). Shapes follow the art bible: bars, steps, squares and
 * trapezoids; no circles (reserved for seals and relics), no arrows.
 */

/** A polyline in a unit cell, x right and y down, both in [0, 1]. */
export type Stroke = [number, number][];
export type Glyph = Stroke[];

const PRIMITIVES: ((r: () => number) => Stroke[])[] = [
  // Vertical bar.
  (r) => {
    const x = 0.3 + r() * 0.4;
    return [
      [
        [x, 0.1],
        [x, 0.9],
      ],
    ];
  },
  // Double horizontal bars.
  () => [
    [
      [0.15, 0.35],
      [0.85, 0.35],
    ],
    [
      [0.15, 0.65],
      [0.85, 0.65],
    ],
  ],
  // Step (corbel).
  () => [
    [
      [0.1, 0.85],
      [0.1, 0.55],
      [0.45, 0.55],
      [0.45, 0.25],
      [0.85, 0.25],
    ],
  ],
  // Open square.
  () => [
    [
      [0.25, 0.3],
      [0.25, 0.75],
      [0.75, 0.75],
      [0.75, 0.3],
    ],
  ],
  // Trapezoid (a doorway).
  () => [
    [
      [0.15, 0.9],
      [0.3, 0.2],
      [0.7, 0.2],
      [0.85, 0.9],
    ],
  ],
  // Hook.
  (r) => {
    const y = 0.2 + r() * 0.2;
    return [
      [
        [0.2, y],
        [0.8, y],
        [0.8, 0.85],
      ],
    ];
  },
  // Dot pair (short ticks).
  () => [
    [
      [0.4, 0.15],
      [0.4, 0.22],
    ],
    [
      [0.6, 0.15],
      [0.6, 0.22],
    ],
  ],
];

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Rows of glyphs for a seed string (e.g. a note id). */
export function glyphRows(seed: string, rows: number, perRow: number): Glyph[][] {
  let state = hash(seed) || 1;
  const rand = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const pick = (): Glyph => {
    const n = rand() < 0.45 ? 1 : 2;
    const glyph: Glyph = [];
    for (let i = 0; i < n; i++) {
      const make = PRIMITIVES[Math.floor(rand() * PRIMITIVES.length)] ?? PRIMITIVES[0];
      if (make) glyph.push(...make(rand));
    }
    return glyph;
  };
  return Array.from({ length: rows }, () => Array.from({ length: perRow }, pick));
}
