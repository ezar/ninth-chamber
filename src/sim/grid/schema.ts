/**
 * Level file schema, v1 (spec §4 "Formato de archivo").
 *
 * Rooms are written as text rows plus a legend so levels stay hand-editable
 * and diff-friendly. Exceptions (slopes, flags, materials) go in `overrides`.
 */
import { z } from 'zod';
import { guardianEntity } from '../actors/guardian-schema';
import { mechanismEntities } from '../mechanisms/schema';
import { ENEMY_TYPES } from '../player/tuning';

export const MATERIALS = ['sand', 'stone', 'metal', 'wood', 'water'] as const;
export const SECTOR_FLAGS = [
  'climbN',
  'climbE',
  'climbS',
  'climbW',
  'death',
  'crumble',
  'noGrab',
  'shade',
] as const;
export const FACINGS = ['N', 'E', 'S', 'W'] as const;
/** The audio's reverb presets a room can name (audio/reverb.ts): an unknown one breaks the mixer. */
export const REVERBS = ['stone_small', 'stone_medium', 'hall_large', 'water_cistern'] as const;
/**
 * How the campaign can end (chamber IX, spec §19; the owner chose two endings): Nora writes her
 * name in the ninth segment and stays as its keeper, or leaves it blank as her grandmother did.
 */
export const ENDINGS = ['keeper', 'blank'] as const;
export type Ending = (typeof ENDINGS)[number];
/** How a journal note is presented: a typed expedition log, a handwritten page or a carving. */
export const NOTE_STYLES = ['diary', 'letter', 'carving'] as const;

const cell = z.tuple([z.number().int(), z.number().int()]);
const clicks = z.number().int();

/** A legend entry: "wall", "pit", a floor height in clicks, or a full sector description. */
const legendEntry = z.union([
  z.literal('wall'),
  z.literal('pit'),
  clicks,
  z
    .object({
      floor: clicks,
      ceil: clicks.optional(),
      mat: z.enum(MATERIALS).optional(),
      flags: z.array(z.enum(SECTOR_FLAGS)).optional(),
      /** Water surface in clicks (spec §4 `water`). */
      water: clicks.optional(),
    })
    .strict(),
]);

const override = z
  .object({
    at: cell,
    /** Corner heights in clicks: NW, NE, SE, SW. */
    floor: z.union([clicks, z.tuple([clicks, clicks, clicks, clicks])]).optional(),
    ceil: clicks.optional(),
    mat: z.enum(MATERIALS).optional(),
    flags: z.array(z.enum(SECTOR_FLAGS)).optional(),
    water: clicks.optional(),
  })
  .strict();

const room = z
  .object({
    id: z.string().min(1),
    /** Room origin in blocks (x, z) and clicks (y). */
    origin: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    ceil: clicks,
    mat: z.enum(MATERIALS).default('stone'),
    /** Floor height of "pit" sectors, in clicks relative to the room origin. */
    pitDepth: clicks.default(-16),
    legend: z.record(z.string().length(1), legendEntry),
    rows: z.array(z.string()).min(1),
    overrides: z.array(override).default([]),
    /** Water surface in clicks for the whole room: every sector whose floor lies under it is wet. */
    water: clicks.optional(),
    look: z.string().optional(),
    reverb: z.enum(REVERBS).optional(),
    music: z.string().optional(),
    /**
     * How the camera frames the room (the Wind Stair's shaft, spec §19): a preferred pitch in
     * degrees (negative looks up, positive down), a distance (m), and an optional fixed shot,
     * the camera standing at [x, z, h] (room cell and height in clicks) and watching her.
     */
    camera: z
      .object({
        pitch: z.number().min(-60).max(80).optional(),
        distance: z.number().min(2).max(14).optional(),
        shot: z.tuple([z.number(), z.number(), z.number()]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const entityBase = {
  id: z.string().min(1),
  room: z.string().min(1),
  at: cell,
};

const entity = z.discriminatedUnion('type', [
  z
    .object({
      ...entityBase,
      type: z.literal('block'),
      /** What the block is drawn as: a stone block, or the Forge's bellows (which wake a forge from its plate). */
      look: z.enum(['stone', 'bellows']).default('stone'),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('lever'),
      wall: z.enum(FACINGS),
      /** A spring lever returns to rest after each pull and can be pulled again (reset levers). */
      spring: z.boolean().default(false),
      /** i18n key of what Action does here, when it is not pulling a lever (the seal's ninth segment). */
      prompt: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('rope'),
      /** Height of the rope's lower end in clicks (room-relative): she jumps up to it and pulls (spec §8). */
      h: clicks,
      /** A spring rope rises again after each pull and can be pulled again. */
      spring: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('door'),
      /** Door leaf height in clicks. */
      height: clicks.default(12),
      open: z.boolean().default(false),
    })
    .strict(),
  z.object({ ...entityBase, type: z.literal('plate') }).strict(),
  z.object({ ...entityBase, type: z.literal('secret'), idol: z.enum(['gold', 'jade', 'stone']) }).strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('note'),
      /** i18n key prefix: `<text>.meta`, `<text>.title` and `<text>.body` hold the note. */
      text: z.string().min(1),
      style: z.enum(NOTE_STYLES),
      /** The note lies against this wall of its sector (carvings on a wall, pages in a corner). */
      wall: z.enum(FACINGS).optional(),
    })
    .strict(),
  z.object({ ...entityBase, type: z.literal('relic') }).strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('statue'),
      /**
       * One of the eight keepers in stone (chamber IX), holding its chamber's relic: 1 to 8 in
       * campaign order; 9 is the empty pedestal. The cell is solid.
       */
      relic: z.number().int().min(1).max(9),
      face: z.enum(FACINGS).default('S'),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('seal'),
      /** The great seal of the nine, carved on this wall of its sector (chamber IX). */
      wall: z.enum(FACINGS),
      /** The lever (Action at the ninth segment) whose use carves the ninth segment. */
      lever: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ ...entityBase, type: z.literal('medkit'), size: z.enum(['small', 'large']) }).strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('brazier'),
      /** A cold brazier gives no light and cannot light the torch until a burning flare held or thrown close to it lights it (signal `<id>.lit`). */
      lit: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('torch'),
      /** Found burning (it can also be lit at a brazier). */
      lit: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('watergate'),
      /** The wall the sluice is set in (for its view). */
      wall: z.enum(FACINGS),
      /** Rooms whose water it moves (default: its own). */
      rooms: z.array(z.string().min(1)).min(1).optional(),
      /** Water surface when lowered and raised, in clicks relative to the gate's room origin. */
      low: clicks,
      high: clicks,
      raised: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('flares'),
      /** Flares in the pack. */
      count: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('enemy'),
      /** Enemy type: its stats and behaviour live in enemyTypes (sim/player/tuning.ts). */
      enemy: z.enum(ENEMY_TYPES),
      face: z.enum(FACINGS).default('S'),
      /** Enemies sharing a pack id alert each other and hunt together. */
      pack: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('zone'),
      /** Size in blocks (x, z), starting at `at`. */
      size: cell.default([1, 1]),
    })
    .strict(),
  ...mechanismEntities,
  guardianEntity,
]);

const rule = z
  .object({
    when: z.string().min(1),
    do: z.array(z.string().min(1)).min(1),
    once: z.boolean().default(true),
  })
  .strict();

export const levelSchema = z
  .object({
    schema: z.literal(1),
    id: z.string().min(1),
    /** Key into i18n/*.json for the level name. */
    name: z.string().min(1),
    /** Par time in seconds for the end-of-level rating. */
    par: z.number().positive().optional(),
    start: z.object({ room: z.string(), at: cell, face: z.enum(FACINGS) }).strict(),
    rooms: z.array(room).min(1),
    entities: z.array(entity).default([]),
    logic: z.array(rule).default([]),
  })
  .strict();

export type LevelFile = z.infer<typeof levelSchema>;
export type LevelFileInput = z.input<typeof levelSchema>;
export type RoomFile = LevelFile['rooms'][number];
export type EntityFile = LevelFile['entities'][number];
export type RuleFile = LevelFile['logic'][number];
export type Material = (typeof MATERIALS)[number];
export type SectorFlag = (typeof SECTOR_FLAGS)[number];
export type Facing = (typeof FACINGS)[number];
export type NoteStyle = (typeof NOTE_STYLES)[number];
