/**
 * Numbered save migrations (spec §9): MIGRATIONS[i] turns a save of schema
 * i + 1 into schema i + 2. Add one file per change (001.ts is the step from
 * schema 1 to 2, 002.ts from 2 to 3, and so on), append it here, and never edit a published one.
 * Schema 1 is the first layout (0.2.6).
 */
import { migrate001 } from './001';
import { migrate002 } from './002';
import { migrate003 } from './003';
import { migrate004 } from './004';
import { migrate005 } from './005';

export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

/** 001: schema 1 → 2 (0.3.0, glyph locks, darts and poison). */
/** 002: schema 2 → 3 (0.4.5, the Bronze Forge's pours and heat). */
/** 003: schema 3 → 4 (0.4.6, the guardian's kind and bronze immunity). */
/** 004: schema 4 → 5 (0.5.5, the Wind Stair's wind zones). */
/** 005: schema 5 → 6 (0.6.5, the Observatory's rings and oculus). */
export const MIGRATIONS: readonly Migration[] = [migrate001, migrate002, migrate003, migrate004, migrate005];
