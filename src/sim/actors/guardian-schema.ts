/**
 * Level-file entry for the stone guardian (spec §7), spread into the entity
 * union of grid/schema.ts. Only depends on zod, so the schema has no cycles.
 */
import { z } from 'zod';

const int = z.number().int();

export const guardianEntity = z
  .object({
    id: z.string().min(1),
    room: z.string().min(1),
    at: z.tuple([int, int]),
    type: z.literal('guardian'),
    /** Facing while it stands dormant on its pedestal. */
    face: z.enum(['N', 'E', 'S', 'W']).default('S'),
    /** The hall it keeps, [x, z, w, h] in room cells: it wakes when Nora enters and never leaves it. */
    arena: z.tuple([int, int, int, int]),
    /** Stone (Ubara, the Temple of the Sun) or bronze (Bazûr, the Forge): molten bronze over a bronze one costs it a phase. */
    /** Anzur (the Observatory) is the giant: rules advance its three phases and only the oculus light stops it. */
    kind: z.enum(['stone', 'bronze', 'giant']).default('stone'),
  })
  .strict();

/** Signals the guardian emits: `<id>.awake`, `<id>.phase2` (after its first fall or broken core), `<id>.defeated`. */
export const GUARDIAN_SIGNALS = ['awake', 'phase2', 'phase3', 'fell', 'burned', 'defeated'];
/** Rule actions: `<id>.wake` rouses it early; `<id>.advance` moves the giant to its next phase. */
export const GUARDIAN_ACTIONS = ['wake', 'advance'];
