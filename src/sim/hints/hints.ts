/**
 * Nora's ideas (spec §15 "En el juego: el diario de Nora", offline mode):
 * three graded hints per puzzle, pregenerated and reviewed by hand, in
 * levels/<id>.hints.json with their text in i18n. After three minutes in a
 * room without progress (no new signal, flag, item or cell reached), Nora
 * offers an idea for the room's first unsolved puzzle; the player asks for
 * each level of hint (observation, direction, solution) in turn.
 *
 * Pure (no DOM): the tracker reads the world, the pause menu shows the text.
 */
import { z } from 'zod';
import { BLOCK } from '../grid/units';
import { evalExpr, exprNames, parseExpr, type Expr } from '../logic/expr';
import { signal } from '../logic/rules';
import { hints as hintTuning } from '../player/tuning';
import type { World } from '../world';

export const hintFileSchema = z.object({
  level: z.string(),
  puzzles: z
    .array(
      z.object({
        id: z.string(),
        /** Rooms where Nora can offer these hints. */
        rooms: z.array(z.string()).min(1),
        /** Rule expression (as in `when`) that is true once the puzzle is solved. */
        solved: z.string(),
        /** i18n keys: observation, direction, solution. */
        hints: z.tuple([z.string(), z.string(), z.string()]),
      }),
    )
    .min(1),
});
export type HintFile = z.infer<typeof hintFileSchema>;
export type Puzzle = HintFile['puzzles'][number];

/** Problems in a hint file against its level's rooms, signal names and the i18n keys. */
export function validateHints(
  file: unknown,
  rooms: ReadonlySet<string>,
  names: ReadonlySet<string>,
  i18n: ReadonlySet<string>,
): string[] {
  const parsed = hintFileSchema.safeParse(file);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const p of parsed.data.puzzles) {
    if (ids.has(p.id)) errors.push(`puzzle ${p.id}: duplicate id`);
    ids.add(p.id);
    for (const r of p.rooms) if (!rooms.has(r)) errors.push(`puzzle ${p.id}: unknown room ${r}`);
    let expr: Expr | null = null;
    try {
      expr = parseExpr(p.solved);
    } catch (e) {
      errors.push(`puzzle ${p.id}: bad solved expression (${String(e)})`);
    }
    if (expr)
      for (const n of exprNames(expr)) if (!names.has(n)) errors.push(`puzzle ${p.id}: unknown signal ${n}`);
    for (const k of p.hints) if (!i18n.has(k)) errors.push(`puzzle ${p.id}: missing i18n key ${k}`);
  }
  return errors;
}

/** One hint to show: its i18n key, its level (1–3) and whether another follows. */
export interface HintStep {
  puzzle: string;
  key: string;
  level: number;
  more: boolean;
}

export class HintTracker {
  private readonly solved: Expr[];
  private readonly asked = new Map<string, number>();
  private readonly offered = new Set<string>();
  private readonly visited = new Set<string>();
  private signature = '';
  /** Seconds since the last progress. */
  idle = 0;

  constructor(private readonly puzzles: readonly Puzzle[]) {
    this.solved = puzzles.map((p) => parseExpr(p.solved));
  }

  /** Call every frame of play. */
  update(world: World, dt: number): void {
    const s = world.state;
    const p = s.player;
    this.visited.add(`${Math.floor(p.pos.x / BLOCK)},${Math.floor(p.pos.z / BLOCK)}`);
    const signals = Object.keys(s.signals).filter((k) => s.signals[k]).length;
    const items = Object.values(s.inventory).reduce((a, b) => a + b, 0);
    const sig = `${signals}|${s.flags.length}|${items}|${this.visited.size}`;
    if (sig !== this.signature) {
      this.signature = sig;
      this.idle = 0;
    } else {
      this.idle += dt;
    }
  }

  private isSolved(world: World, i: number): boolean {
    const e = this.solved[i];
    return e !== undefined && evalExpr(e, (n) => signal(world, n));
  }

  /** The room's first unsolved puzzle, or null. */
  private puzzleIn(world: World): number {
    const p = world.state.player.pos;
    const room = world.level.roomAt(Math.floor(p.x / BLOCK), Math.floor(p.z / BLOCK))?.id;
    if (!room) return -1;
    return this.puzzles.findIndex((pz, i) => pz.rooms.includes(room) && !this.isSolved(world, i));
  }

  /**
   * The puzzle Nora has an idea about now: the room's first unsolved one, once
   * she has gone three minutes without progress or the player has already
   * asked about it. Null otherwise.
   */
  available(world: World): Puzzle | null {
    const i = this.puzzleIn(world);
    const pz = this.puzzles[i];
    if (!pz) return null;
    return this.idle >= hintTuning.idle || (this.asked.get(pz.id) ?? 0) > 0 ? pz : null;
  }

  /** True once per puzzle, the first time an idea becomes available (for the HUD's notice). */
  takeOffer(world: World): boolean {
    const pz = this.available(world);
    if (!pz || this.offered.has(pz.id)) return false;
    this.offered.add(pz.id);
    return true;
  }

  /** The next hint for the available puzzle (the last one again once all three are out). */
  next(world: World): HintStep | null {
    const pz = this.available(world);
    if (!pz) return null;
    const n = Math.min(3, (this.asked.get(pz.id) ?? 0) + 1);
    this.asked.set(pz.id, n);
    return { puzzle: pz.id, key: pz.hints[n - 1] ?? pz.hints[2], level: n, more: n < 3 };
  }
}
