/**
 * Golden path through The Antechamber with scripted input: proves the level
 * can be finished and shows the intended route. Camera yaw is 0, so input
 * y+ is north (-Z) and x+ is east (+X).
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import { Level } from '../src/sim/grid/level';
import { validateLevel } from '../src/sim/grid/validate';
import type { Dir } from '../src/sim/grid/units';
import { createWorld, stepWorld, type World } from '../src/sim/world';
import en from '../i18n/en.json';
import { frame } from './helpers';

const DIRS: Record<Dir, { x: number; y: number }> = {
  N: { x: 0, y: 1 },
  S: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

class Bot {
  constructor(readonly w: World) {}

  get p() {
    return this.w.state.player;
  }

  tick(f = frame()): void {
    stepWorld(this.w, f);
  }

  wait(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  waitMode(mode: string, max = 400): void {
    for (let i = 0; i < max && this.p.mode !== mode; i++) this.tick();
    expect(this.p.mode, `waiting for ${mode}`).toBe(mode);
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
      if (this.p.mode === 'dead') throw new Error(`died on the way to ${cx},${cz}`);
    }
    throw new Error(
      `could not reach ${cx},${cz}; at ${this.p.pos.x.toFixed(2)},${this.p.pos.z.toFixed(2)} (${this.p.mode})`,
    );
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
    expect(this.p.mode).toBe('block');
    for (let i = 0; i < 5; i++) this.tick(frame({ x: v.x, y: v.y, held: ['action'] }));
    expect(this.p.mode).toBe('push');
    for (let i = 0; i < 120 && this.p.mode !== 'block'; i++) this.tick(frame({ held: ['action'] }));
    this.tick();
    this.waitMode('ground');
  }

  /** Holds Fire (auto-aim) until every enemy of `pack` is dead, then holsters. */
  fight(pack: string, max = 900): void {
    const alive = (): number =>
      this.w.state.enemies.filter((e) => e.pack === pack && e.mode !== 'dead').length;
    this.tick(frame({ held: ['fire'], pressed: ['fire'] }));
    for (let i = 0; i < max && alive() > 0; i++) {
      this.tick(frame({ held: ['fire'] }));
      if (this.p.mode === 'dead') throw new Error('died fighting');
    }
    expect(alive(), `enemies of ${pack} left`).toBe(0);
    this.tick(frame({ pressed: ['weapons'] }));
    expect(this.p.weapon.drawn).toBe(false);
  }

  /** Runs north from the current position and jumps at `edgeZ` (metres). */
  runningJumpNorth(edgeZ: number): void {
    for (let i = 0; i < 300 && this.p.pos.z > edgeZ + 0.15; i++) this.tick(frame({ y: 1 }));
    this.tick(frame({ y: 1, pressed: ['jump'] }));
    for (let i = 0; i < 200 && this.p.mode !== 'ground'; i++) this.tick(frame({ y: 1, held: ['action'] }));
    expect(this.p.mode).toBe('ground');
  }
}

describe('The Antechamber', () => {
  it('validates without errors', () => {
    const { errors } = validateLevel(levelJson, new Set(Object.keys(en)));
    expect(errors).toEqual([]);
  });

  it('can be finished with all three secrets', () => {
    const w = createWorld(Level.parse(levelJson));
    const bot = new Bot(w);

    // Entrance: climb the terrace, detour for the jade idol.
    bot.goTo(8, 3);
    bot.climb('N');
    bot.climb('N');
    bot.action();
    expect(w.stats.secrets).toBe(1);
    bot.goTo(8, 2, { slow: true });
    bot.goTo(4, 1);
    bot.goTo(4, -1);

    // Brazier hall: a pair of jackals rests in the middle. Shoot them from the entrance side.
    bot.goTo(4, -4);
    bot.fight('hall');
    expect(w.stats.kills).toBe(2);

    // Gold idol in the north-east niche.
    bot.goTo(8, -11);
    bot.goTo(8, -13);
    bot.climb('E');
    bot.action();
    expect(w.stats.secrets).toBe(2);
    bot.goTo(8, -13, { slow: true });
    bot.goTo(8, -10);

    // Push the block against the platform, climb up and pull the lever.
    bot.goTo(3, -4);
    bot.push('W');
    bot.goTo(2, -4);
    bot.climb('W');
    bot.climb('W');
    bot.goTo(-1, -5);
    bot.action();
    bot.wait(260);
    expect(w.grid.cellFloor(4, -14)).toBe(2);
    bot.goTo(-1, -4);
    bot.goTo(3, -4);
    bot.goTo(4, -13);

    // Gallery: stone idol on the west ledges, then the running jump over the spikes.
    bot.goTo(4, -15);
    bot.goTo(0, -19);
    bot.climb('W');
    expect(w.state.player.pos.y).toBeCloseTo(4, 3);
    bot.climb('N');
    bot.action();
    expect(w.stats.secrets).toBe(3);
    bot.goTo(-1, -19, { slow: true });
    bot.goTo(0, -19, { slow: true });
    bot.goTo(1, -16);
    bot.runningJumpNorth(-44);
    expect(w.state.player.pos.y).toBe(2);
    // Sprint over the collapsing tiles.
    for (let i = 0; i < 90; i++) bot.tick(frame({ y: 1, x: 0.3 }));
    expect(w.state.player.mode).not.toBe('dead');

    // Relic chamber.
    bot.goTo(3, -30);
    bot.goTo(3, -35);
    bot.tick(frame({ y: 1, pressed: ['jump'] }));
    bot.wait(60);
    bot.goTo(3, -37);
    bot.action();
    bot.wait(200);
    expect(w.ended).toBe(true);
    expect(w.stats.deaths).toBe(0);
  });
});
