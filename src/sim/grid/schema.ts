/**
 * Level file schema, v1 (spec §4 "Formato de archivo").
 *
 * Rooms are written as text rows plus a legend so levels stay hand-editable
 * and diff-friendly. Exceptions (slopes, flags, materials) go in `overrides`.
 */
import { z } from 'zod';
import { ENEMY_TYPES } from '../player/tuning';

export const MATERIALS = ['sand', 'stone', 'metal', 'wood', 'water'] as const;
export const SECTOR_FLAGS = ['climbN', 'climbE', 'climbS', 'climbW', 'death', 'crumble', 'noGrab'] as const;
export const FACINGS = ['N', 'E', 'S', 'W'] as const;

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
    look: z.string().optional(),
    reverb: z.string().optional(),
    music: z.string().optional(),
  })
  .strict();

const entityBase = {
  id: z.string().min(1),
  room: z.string().min(1),
  at: cell,
};

const entity = z.discriminatedUnion('type', [
  z.object({ ...entityBase, type: z.literal('block') }).strict(),
  z
    .object({
      ...entityBase,
      type: z.literal('lever'),
      wall: z.enum(FACINGS),
      /** A spring lever returns to rest after each pull and can be pulled again (reset levers). */
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
  z.object({ ...entityBase, type: z.literal('relic') }).strict(),
  z.object({ ...entityBase, type: z.literal('medkit'), size: z.enum(['small', 'large']) }).strict(),
  z.object({ ...entityBase, type: z.literal('brazier') }).strict(),
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
