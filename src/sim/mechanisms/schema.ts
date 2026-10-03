/**
 * Level-file entries for the mechanisms and traps (spec §8): moving
 * platforms, trapdoors, sun beams with mirrors and receivers, key items with
 * their slots, rolling boulders, pendulum blades and fire floors (the Temple
 * of the Sun), and glyph locks and dart traps (the Clay Archive, spec §19).
 * They are spread into the entity union of grid/schema.ts. This module only
 * depends on zod so the schema has no import cycles.
 *
 * Heights are in clicks relative to the room origin, like the room legend;
 * cells are room cells, like every other entity.
 */
import { z } from 'zod';

const FACING = z.enum(['N', 'E', 'S', 'W']);
/** A mirror's reflecting face points along a diagonal. */
export const DIAGONALS = ['NE', 'SE', 'SW', 'NW'] as const;
export type Diagonal = (typeof DIAGONALS)[number];

const int = z.number().int();
const cell = z.tuple([int, int]);
const base = { id: z.string().min(1), room: z.string().min(1), at: cell };

export const mechanismEntities = [
  z
    .object({
      ...base,
      type: z.literal('platform'),
      /**
       * Waypoints [x, z, h]: a room cell and the platform's top in clicks. The
       * first one is `at`. Legs run straight along X or Z, and may rise or fall.
       */
      path: z.array(z.tuple([int, int, int])).min(2),
      /** Travel speed (m/s). */
      speed: z.number().positive().default(1.5),
      /** Rest at each waypoint (s). */
      pause: z.number().nonnegative().default(1),
      /** pingpong: to the end and back; cycle: round to the first again; once: to the end and stay. */
      loop: z.enum(['pingpong', 'cycle', 'once']).default('pingpong'),
      /** Moves from the start; otherwise it waits for `<id>.start`, `<id>.next` or `<id>.goto N`. */
      running: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('trapdoor'),
      /** Size in blocks (x, z) from `at`. The sectors under it are usually pits. */
      size: cell.default([1, 1]),
      /** Top of the closed leaves in clicks. */
      h: int,
      open: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('sunbeam'),
      /** Direction the beam travels from `at`. */
      dir: FACING,
      /** Height of the beam in clicks. */
      y: int,
      /** wall: through a slit in the wall behind `at`; sky: down an oculus onto a bronze deflector in `at`. */
      from: z.enum(['wall', 'sky']).default('wall'),
      on: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('mirror'),
      /** Diagonal the polished face looks towards. Each turn moves it 90° clockwise. */
      facing: z.enum(DIAGONALS),
      /** A fixed mirror cannot be turned by hand (rules may still turn it). */
      fixed: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('receiver'),
      /** The sun disc faces this way: it lights when the beam comes from that side. */
      face: FACING,
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('item'),
      /** Key item id, as stored in the inventory and named in slots (`item.<id>` in i18n). */
      item: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('slot'),
      /** The slot is set in this wall of its sector, like a lever. */
      wall: FACING,
      /** Key item it takes. */
      accepts: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('boulder'),
      /** Cells it rolls through, `at` first; legs run straight along X or Z. */
      path: z.array(cell).min(2),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('blade'),
      /** Axis the blade swings along: across the corridor. */
      axis: z.enum(['x', 'z']),
      /** Offset in the 2.4 s cycle (0..1), to stagger blades. */
      phase: z.number().min(0).max(1).default(0),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('fire'),
      /** Size in blocks (x, z) from `at`. */
      size: cell.default([1, 1]),
      /** Cycle length (s), burning time within it (s) and start offset (s). */
      period: z.number().positive().default(3),
      burn: z.number().positive().default(1.2),
      offset: z.number().default(0),
      on: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('pour'),
      /**
       * Cells of the trench the bronze runs along, room-relative, `at` first;
       * legs run straight along X or Z. `at` is where it leaves the crucible.
       */
      path: z.array(cell).min(1),
      /** Top of the cast bronze in clicks (room-relative): usually the trench's lip, so it cools into a bridge. */
      h: int,
      /** Cells per second; seconds from full to cool; a repeating pour runs again every `period` seconds. */
      speed: z.number().positive().optional(),
      cool: z.number().positive().optional(),
      period: z.number().positive().optional(),
      /** Starts at load (a repeating pour); otherwise it waits for `<id>.pour`. */
      running: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('heat'),
      /** Size in blocks (x, z) from `at`. Sectors flagged `shade` inside it are safe. */
      size: cell.default([1, 1]),
      on: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('wind'),
      /** Size in blocks (x, z) from `at`. */
      size: z.tuple([int.min(1), int.min(1)]).default([1, 1]),
      /** Where it blows: along the floor towards a side, or up the shaft. */
      dir: z.enum(['N', 'E', 'S', 'W', 'up']),
      /**
       * Cycle length (s), gust length within it (s) and start offset (s). With no
       * period it blows steadily while on.
       */
      period: z.number().positive().optional(),
      blow: z.number().positive().optional(),
      offset: z.number().default(0),
      /** Horizontal speed (m/s) or, blowing up, the fraction of gravity it takes away; tuning by default. */
      strength: z.number().positive().optional(),
      /** Hanging Nora is torn off the ledge by a gust that blows on her long enough. */
      tear: z.boolean().default(false),
      on: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('ring'),
      /**
       * One of the Observatory dome's rings (spec §19, chamber VIII): what it carries (the sky's
       * stars, the moon's phases, the horizon's sun) and, for the look, its radius in metres
       * around `at`, the cell under the dome's centre.
       */
      kind: z.enum(['sky', 'moon', 'horizon']),
      radius: z.number().positive().optional(),
      /** Positions round the dome, where it starts, and where it is aligned (`<id>.set`). */
      positions: int.min(3).max(12).default(9),
      start: int.min(0).default(0),
      target: int.min(0).default(8),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('oculus'),
      /** The pool of light under the dome's oculus: size in blocks (x, z) from `at`. */
      size: z.tuple([int.min(1), int.min(1)]).default([1, 1]),
      on: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('glyphlock'),
      /** The side its glyph is read from (and turned from): the face shown points this way. */
      facing: FACING,
      /** Glyph shown at the start (0..5, see GLYPHS). */
      glyph: int.min(0).max(5).default(0),
      /** Glyph that sets the lock (`<id>.set`). */
      target: int.min(0).max(5),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('darts'),
      /** The painted slab is `at`; the darts fly from the wall on this side, across `at`, to the far wall. */
      from: FACING,
      /** Darts in a volley (only for the look). */
      count: int.min(1).max(5).default(3),
    })
    .strict(),
] as const;

/** The six glyphs of the Clay Archive's locks, by index: each has its own shape and colour. */
export const GLYPHS = ['sun', 'water', 'reed', 'eye', 'star', 'mountain'] as const;
export type Glyph = (typeof GLYPHS)[number];

/** Signals each mechanism type emits, by suffix; platforms also emit `at<N>` for waypoint N. */
export const MECHANISM_SIGNALS: Record<string, string[]> = {
  platform: ['moving'],
  trapdoor: ['open'],
  receiver: ['lit'],
  item: ['taken'],
  slot: ['filled'],
  boulder: ['rolling', 'done'],
  fire: ['burning'],
  sunbeam: ['on'],
  glyphlock: ['set'],
  darts: ['fired'],
  pour: ['molten', 'solid', 'cast'],
  wind: ['gust'],
  ring: ['set'],
  oculus: ['on'],
};

/** Rule actions each mechanism type accepts (`<id>.<action> [args]`). */
export const MECHANISM_ACTIONS: Record<string, string[]> = {
  platform: ['start', 'stop', 'toggle', 'next', 'goto'],
  trapdoor: ['open', 'close', 'toggle'],
  sunbeam: ['on', 'off', 'toggle'],
  mirror: ['turn'],
  boulder: ['release', 'reset'],
  blade: ['start', 'stop'],
  fire: ['on', 'off'],
  glyphlock: ['turn'],
  pour: ['pour', 'start', 'stop'],
  heat: ['on', 'off'],
  wind: ['on', 'off', 'toggle'],
  ring: ['turn', 'back'],
  oculus: ['on', 'off', 'toggle'],
};

/** Whether `<entity of type>.<suffix>` is a signal a mechanism emits. */
export function isMechanismSignal(type: string, suffix: string): boolean {
  if ((type === 'platform' || type === 'ring') && /^at\d+$/.test(suffix)) return true;
  return (MECHANISM_SIGNALS[type] ?? []).includes(suffix);
}
