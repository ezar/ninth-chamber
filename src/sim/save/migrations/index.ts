/**
 * Numbered save migrations (spec §9): MIGRATIONS[i] turns a save of schema
 * i + 1 into schema i + 2. Add one file per change (001.ts is the step from
 * schema 1 to 2, 002.ts from 2 to 3, and so on), append it here, and never edit a published one.
 * Schema 1 is the first layout (0.2.6).
 */
import { migrate001 } from './001';
import { migrate002 } from './002';

export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

/** 001: schema 1 → 2 (0.3.0, glyph locks, darts and poison). */
/** 002: schema 2 → 3 (0.4.5, the Bronze Forge's pours and heat). */
export const MIGRATIONS: readonly Migration[] = [migrate001, migrate002];
