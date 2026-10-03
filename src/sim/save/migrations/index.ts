/**
 * Numbered save migrations (spec §9): MIGRATIONS[i] turns a save of schema
 * i + 1 into schema i + 2. Add one file per change (002.ts for the step from
 * schema 2 to 3, and so on), append it here, and never edit a published one.
 * Schema 1 is the first layout (0.2.6), so there are none yet.
 */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: readonly Migration[] = [];
