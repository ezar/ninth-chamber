/**
 * Saved games (spec §9 "Guardado", roadmap 0.2.6): one automatic save, written
 * at every checkpoint and when the page goes to the background, and resumed
 * with Continue on the title screen.
 *
 * A save holds the level, the checkpoint the player respawns at, the point to
 * resume from (the live state when the page went to the background with Nora
 * standing safely, otherwise the checkpoint), the stats, the tick and the
 * random generator. Saves carry a schema number; older ones go through the
 * numbered migrations in ./migrations before use, so updates never break them.
 * A save whose level has changed so much that its actors no longer match is
 * dropped rather than loaded wrong.
 *
 * Pure data and logic: the browser storage lives in src/ui/save-store.ts.
 */
import { clone } from '../../core/clone';
import type { Level } from '../grid/level';
import type { DynamicState, Stats } from '../state';
import { createWorld, respawn, type World } from '../world';
import { MIGRATIONS } from './migrations';

/** The current save layout. Bump it with a new migration in ./migrations. */
export const SAVE_SCHEMA = MIGRATIONS.length + 1;

export interface SaveData {
  schema: number;
  /** Game version that wrote it (package.json), for the record. */
  version: string;
  level: string;
  /** ISO time it was written. */
  savedAt: string;
  /**
   * Null: start the level from its beginning (a chamber was finished and the
   * next one is waiting).
   */
  game: {
    tick: number;
    rng: number;
    checkpoint: DynamicState;
    resume: DynamicState;
    stats: Stats;
  } | null;
}

/** Whether the live state is a safe place to resume from: standing, alive, out of water, nothing chasing. */
export function safeToResume(world: World): boolean {
  const s = world.state;
  const p = s.player;
  if (world.ended || p.health <= 0 || p.mode !== 'ground') return false;
  if (s.mechanisms.use !== null) return false;
  if (
    s.enemies.some(
      (e) => e.mode === 'alert' || e.mode === 'chase' || e.mode === 'attack' || e.mode === 'hurt',
    )
  )
    return false;
  if (s.guardians.some((g) => g.mode !== 'dormant' && g.mode !== 'defeated')) return false;
  return true;
}

/** The save for a world in play. `live`: resume from now if it is safe, else from the checkpoint. */
export function snapshot(world: World, version: string, savedAt: string, live: boolean): SaveData {
  return {
    schema: SAVE_SCHEMA,
    version,
    level: world.level.id,
    savedAt,
    game: {
      tick: world.tick,
      rng: world.rng.state,
      checkpoint: clone(world.checkpoint),
      resume: clone(live && safeToResume(world) ? world.state : world.checkpoint),
      stats: clone(world.stats),
    },
  };
}

/** A save that starts a level from its beginning (the next chamber after one is finished). */
export function levelStart(level: string, version: string, savedAt: string): SaveData {
  return { schema: SAVE_SCHEMA, version, level, savedAt, game: null };
}

/** A stored value as a current save, migrated from older schemas; null if it is not one. */
export function migrate(raw: unknown, migrations = MIGRATIONS): SaveData | null {
  if (raw === null || typeof raw !== 'object') return null;
  let data = raw as Record<string, unknown>;
  let schema = typeof data.schema === 'number' ? data.schema : 0;
  const current = migrations.length + 1;
  if (schema < 1 || schema > current) return null;
  while (schema < current) {
    const step = migrations[schema - 1];
    if (!step) return null;
    data = step(data);
    schema++;
    data.schema = schema;
  }
  if (typeof data.level !== 'string') return null;
  return data as unknown as SaveData;
}

/** Actor ids and kinds, sorted, to tell whether a save still fits its level. */
const signature = (state: DynamicState): string =>
  state.actors
    .map((a) => `${a.kind}:${a.id}`)
    .sort()
    .join('|');

/**
 * A world for the save, or null when the save is for another level or no
 * longer fits it. A save with no game starts the level fresh.
 */
export function restore(level: Level, data: SaveData, seed = 1): World | null {
  if (data.level !== level.id) return null;
  const world = createWorld(level, seed);
  const game = data.game;
  if (!game) return world;
  const fresh = signature(world.state);
  if (signature(game.checkpoint) !== fresh || signature(game.resume) !== fresh) return null;
  world.tick = game.tick;
  world.rng.state = game.rng >>> 0;
  world.stats = clone(game.stats);
  // The resume point goes through the respawn, which settles the player and the mechanisms.
  world.checkpoint = clone(game.resume);
  respawn(world);
  world.checkpoint = clone(game.checkpoint);
  world.events.drain();
  return world;
}
