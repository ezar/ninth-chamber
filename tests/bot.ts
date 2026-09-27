/**
 * A scripted player for level tests: steers with InputFrames only, like a
 * person with a keyboard. Camera yaw is 0, so input y+ is north (-Z) and x+
 * is east (+X). Cells are world cells (room origin + position in the room).
 */
import { expect } from 'vitest';
import type { Dir } from '../src/sim/grid/units';
import { stepWorld, type World } from '../src/sim/world';
import { frame } from './helpers';

const DIRS: Record<Dir, { x: number; y: number }> = {
  N: { x: 0, y: 1 },
  S: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

export class Bot {
  readonly rooms = new Set<string>();

  constructor(readonly w: World) {}

  get p() {
    return this.w.state.player;
  }

  where(): string {
    const { pos, mode } = this.p;
    return `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)} (${mode}, tick ${this.w.tick})`;
  }

  tick(f = frame()): void {
    stepWorld(this.w, f);
    if (this.p.mode === 'dead') throw new Error(`died at ${this.where()}`);
    const room = this.w.level.roomAt(Math.floor(this.p.pos.x / 2), Math.floor(this.p.pos.z / 2));
    if (room) this.rooms.add(room.id);
  }

  wait(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  waitMode(mode: string, max = 400): void {
    for (let i = 0; i < max && this.p.mode !== mode; i++) this.tick();
    expect(this.p.mode, `waiting for ${mode} at ${this.where()}`).toBe(mode);
  }

  /** Holds Fire (auto-aim) until every enemy of `pack` is dead, then holsters. */
  fight(pack: string, max = 900): void {
    const alive = (): number =>
      this.w.state.enemies.filter((e) => e.pack === pack && e.mode !== 'dead').length;
    this.tick(frame({ held: ['fire'], pressed: ['fire'] }));
    for (let i = 0; i < max && alive() > 0; i++) this.tick(frame({ held: ['fire'] }));
    expect(alive(), `enemies of ${pack} left at ${this.where()}`).toBe(0);
    this.tick(frame({ pressed: ['weapons'] }));
    expect(this.p.weapon.drawn).toBe(false);
  }

  /** Steers to the centre of a world cell on the ground. */
  goTo(cx: number, cz: number, opts: { walk?: boolean; slow?: boolean; max?: number } = {}): void {
    const tx = cx * 2 + 1;
    const tz = cz * 2 + 1;
    for (let i = 0; i < (opts.max ?? 900); i++) {
      const dx = tx - this.p.pos.x;
      const dz = tz - this.p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.12 && this.p.mode === 'ground') {
        this.wait(20);
        return;
      }
      const s = Math.min(opts.slow ? 0.4 : 1, d / 0.8);
      this.tick(frame({ x: (dx / d) * s, y: (-dz / d) * s, held: opts.walk ? ['walk'] : [] }));
    }
    throw new Error(`could not reach ${cx},${cz}; at ${this.where()}`);
  }

  /** Walks into the wall in `dir`, jumps, grabs and climbs onto the ledge. */
  climb(dir: Dir): void {
    const v = DIRS[dir];
    for (let i = 0; i < 30; i++) this.tick(frame({ x: v.x, y: v.y, held: ['walk'] }));
    this.tick(frame({ pressed: ['jump'] }));
    for (let i = 0; i < 90 && this.p.mode !== 'hang' && this.p.mode !== 'climb'; i++)
      this.tick(frame({ held: ['action'] }));
    if (this.p.mode === 'hang') for (let i = 0; i < 20; i++) this.tick(frame({ x: v.x, y: v.y }));
    this.waitMode('ground');
  }

  action(): void {
    this.tick(frame({ pressed: ['action'] }));
    this.waitMode('ground');
  }

  /** Grabs the block in `dir` and pushes it one sector. */
  push(dir: Dir): void {
    const v = DIRS[dir];
    for (let i = 0; i < 30; i++) this.tick(frame({ x: v.x, y: v.y, held: ['walk'] }));
    this.tick(frame({ held: ['action'] }));
    expect(this.p.mode, `grab at ${this.where()}`).toBe('block');
    for (let i = 0; i < 5; i++) this.tick(frame({ x: v.x, y: v.y, held: ['action'] }));
    expect(this.p.mode, `push at ${this.where()}`).toBe('push');
    for (let i = 0; i < 120 && this.p.mode !== 'block' && this.p.mode !== 'ground'; i++)
      this.tick(frame({ held: ['action'] }));
    this.tick();
    this.waitMode('ground');
  }

  /** Grabs the block in `dir` and pulls it one sector, backing away from it. */
  pull(dir: Dir): void {
    const v = DIRS[dir];
    for (let i = 0; i < 30; i++) this.tick(frame({ x: v.x, y: v.y, held: ['walk'] }));
    this.tick(frame({ held: ['action'] }));
    expect(this.p.mode, `grab at ${this.where()}`).toBe('block');
    for (let i = 0; i < 5; i++) this.tick(frame({ x: -v.x, y: -v.y, held: ['action'] }));
    expect(this.p.mode, `pull at ${this.where()}`).toBe('pull');
    for (let i = 0; i < 120 && this.p.mode !== 'block'; i++) this.tick(frame({ held: ['action'] }));
    this.tick();
    this.waitMode('ground');
  }

  /** Walks to the edge in `dir` (walking never falls off), then jumps across a one-block gap. */
  standingJump(dir: Dir): void {
    const v = DIRS[dir];
    for (let i = 0; i < 90; i++) this.tick(frame({ x: v.x, y: v.y, held: ['walk'] }));
    this.tick(frame({ x: v.x, y: v.y, pressed: ['jump'] }));
    for (let i = 0; i < 200 && this.p.mode !== 'ground'; i++)
      this.tick(frame({ x: v.x, y: v.y, held: ['action'] }));
    this.waitMode('ground');
  }

  /** Runs in `dir` and jumps just before the edge at `at` metres (x for E/W, z for N/S). */
  runningJump(dir: Dir, at: number): void {
    const v = DIRS[dir];
    const along = (): number => (v.x !== 0 ? this.p.pos.x * v.x : -this.p.pos.z * v.y);
    const edge = v.x !== 0 ? at * v.x : -at * v.y;
    for (let i = 0; i < 300 && along() < edge - 0.15; i++) this.tick(frame({ x: v.x, y: v.y }));
    this.tick(frame({ x: v.x, y: v.y, pressed: ['jump'] }));
    for (let i = 0; i < 200 && this.p.mode !== 'ground'; i++)
      this.tick(frame({ x: v.x, y: v.y, held: ['action'] }));
    this.waitMode('ground');
  }

  /** Waits (no input) until `done`, like a player watching for the right moment. */
  waitFor(done: () => boolean, label: string, max = 1500): void {
    for (let i = 0; i < max && !done(); i++) this.tick();
    expect(done(), `waiting for ${label} at ${this.where()}`).toBe(true);
  }

  /** Whether a level signal or flag is up. */
  on(name: string): boolean {
    return this.w.state.signals[name] === true || this.w.state.flags.includes(name);
  }

  /** Presses against the mirror drum in `dir` and turns it `times` quarter turns with Action. */
  turnMirror(dir: Dir, times: number): void {
    const v = DIRS[dir];
    // Walk up against the drum (it is solid), wherever in the cell she stands.
    for (let i = 0; i < 40; i++) {
      const before = { ...this.p.pos };
      this.tick(frame({ x: v.x, y: v.y, held: ['walk'] }));
      if (i > 5 && Math.hypot(this.p.pos.x - before.x, this.p.pos.z - before.z) < 1e-3) break;
    }
    for (let n = 0; n < times; n++) {
      this.tick(frame({ pressed: ['action'] }));
      expect(this.p.mode, `turning a mirror at ${this.where()}`).toBe('lever');
      this.waitMode('ground');
    }
  }

  /** Backs off the edge in `dir` with Walk and Action into a hang (spec §5.5), then lets go. */
  lowerAndDrop(dir: Dir): void {
    const v = DIRS[dir];
    for (let i = 0; i < 12; i++) this.tick(frame({ x: -v.x * 0.3, y: -v.y * 0.3, held: ['walk'] }));
    for (let i = 0; i < 200 && this.p.mode !== 'hang'; i++)
      this.tick(frame({ x: v.x, y: v.y, held: ['walk', 'action'] }));
    expect(this.p.mode, `hang at ${this.where()}`).toBe('hang');
    this.wait(20);
    this.tick(frame({ pressed: ['action'] }));
    this.waitMode('ground');
  }

  // ───────────────────────────── Water (spec §5.10) and flares (§7) ─────────────────────────────

  /** Walks (or runs) in `dir` until Nora is in the water, then waits until she floats at the surface. */
  wadeIn(dir: Dir, run = false): void {
    const v = DIRS[dir];
    for (let i = 0; i < 400 && this.p.mode !== 'swim' && this.p.mode !== 'dive'; i++)
      this.tick(frame({ x: v.x, y: v.y, held: run ? [] : ['walk'] }));
    this.waitMode('swim', 600);
  }

  /** Swims at the surface to the centre of a world cell. */
  swimTo(cx: number, cz: number, max = 1200): void {
    const tx = cx * 2 + 1;
    const tz = cz * 2 + 1;
    for (let i = 0; i < max; i++) {
      const dx = tx - this.p.pos.x;
      const dz = tz - this.p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3 && this.p.mode === 'swim') return;
      expect(this.p.mode, `swimming to ${cx},${cz} at ${this.where()}`).toBe('swim');
      const s = Math.min(1, d / 0.6);
      this.tick(frame({ x: (dx / d) * s, y: (-dz / d) * s }));
    }
    throw new Error(`could not swim to ${cx},${cz}; at ${this.where()}`);
  }

  /** Swims to the edge in `dir` and climbs out onto it with Jump. */
  climbOut(dir: Dir): void {
    const v = DIRS[dir];
    for (let i = 0; i < 300 && this.p.mode === 'swim'; i++)
      this.tick(frame({ x: v.x, y: v.y, ...(i % 8 === 7 ? { pressed: ['jump'] as const } : {}) }));
    expect(this.p.mode, `climbing out ${dir} at ${this.where()}`).toBe('climb');
    this.waitMode('ground');
  }

  /**
   * Dives (from the surface) and swims underwater through waypoints: world
   * cells with the feet height (m) to keep there, Jump to rise and Walk to sink.
   */
  dive(path: readonly (readonly [number, number, number])[]): void {
    if (this.p.mode === 'swim') this.tick(frame({ pressed: ['walk'], held: ['walk'] }));
    for (const [cx, cz, y] of path) {
      const tx = cx * 2 + 1;
      const tz = cz * 2 + 1;
      let reached = false;
      for (let i = 0; i < 900; i++) {
        const dx = tx - this.p.pos.x;
        const dz = tz - this.p.pos.z;
        const d = Math.hypot(dx, dz);
        const dy = y - this.p.pos.y;
        if (d < 0.45 && Math.abs(dy) < 0.5) {
          reached = true;
          break;
        }
        if (this.p.mode === 'swim') {
          this.tick(frame({ pressed: ['walk'], held: ['walk'] }));
          continue;
        }
        expect(this.p.mode, `diving to ${cx},${cz} at ${this.where()}`).toBe('dive');
        // Get to depth before going far sideways, so tunnels are entered level.
        const s = Math.abs(dy) > 1 ? 0.25 : Math.min(1, d / 0.6);
        const held = dy > 0.25 ? (['jump'] as const) : dy < -0.25 ? (['walk'] as const) : [];
        this.tick(
          frame({ x: d > 0.01 ? (dx / d) * s : 0, y: d > 0.01 ? (-dz / d) * s : 0, held: [...held] }),
        );
      }
      if (!reached) throw new Error(`could not dive to ${cx},${cz},${y}; at ${this.where()}`);
    }
  }

  /** Swims straight up until Nora surfaces. */
  surface(): void {
    for (let i = 0; i < 600 && this.p.mode === 'dive'; i++) this.tick(frame({ held: ['jump'] }));
    expect(this.p.mode, `surfacing at ${this.where()}`).toBe('swim');
  }

  /** Lights a flare (one must be in the inventory and none held). */
  lightFlare(): void {
    const before = this.w.state.flares.length;
    this.tick(frame({ pressed: ['flare'] }));
    expect(this.w.state.flares.length, `lighting a flare at ${this.where()}`).toBeGreaterThan(
      Math.min(before, 3),
    );
  }

  /** True while Nora holds a burning flare. */
  get holdingFlare(): boolean {
    return this.w.state.flares.some((f) => f.held);
  }

  /** Waits until a room's water is still (a gate finished moving it). */
  waitWater(room: string, max = 1200): void {
    for (let i = 0; i < max; i++) {
      const w = this.w.state.water[room];
      if (!w || w.y === w.target) return;
      this.tick();
    }
    throw new Error(`water in ${room} still moving at ${this.where()}`);
  }
}
