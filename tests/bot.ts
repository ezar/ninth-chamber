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
}
