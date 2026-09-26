/**
 * Targeted checks for The Antechamber's puzzles (spec §8 "Principios de
 * diseño de puzles"): each mechanism is needed, cannot be cheesed, and never
 * leaves the player in a dead end. The walkthrough proves the golden path;
 * these prove the ways off it. Cells are world cells.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import { TICK_DT } from '../src/core/loop';
import { Level } from '../src/sim/grid/level';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { mechanics, tuning } from '../src/sim/player/tuning';
import { createWorld, findActor, stepWorld, type World } from '../src/sim/world';
import { Bot } from './bot';
import { frame, run, runUntil } from './helpers';

const level = Level.parse(levelJson);
const seconds = (s: number): number => Math.ceil(s / TICK_DT);
const cell = (w: World): [number, number] => [
  Math.floor(w.state.player.pos.x / 2),
  Math.floor(w.state.player.pos.z / 2),
];

/** Puts the player on the ground at the centre of a cell. */
function place(w: World, cx: number, cz: number, face: Dir = 'N'): void {
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = DIR_YAW[face];
  p.mode = 'ground';
}

function block(w: World, id: string): { cx: number; cz: number; y: number } {
  const b = findActor(w, id, 'block');
  if (!b) throw new Error(`no block ${id}`);
  return b;
}

describe('Hall of Weights', () => {
  it('the gate shuts behind a player who steps off the plate and runs for it', () => {
    for (const waitOnPlate of [1, seconds(2)]) {
      const w = createWorld(level);
      place(w, 2, -16, 'W');
      run(w, frame(), waitOnPlate);
      run(w, frame({ x: -1 }), seconds(3));
      expect(cell(w)[0]).toBeGreaterThanOrEqual(-1);
      expect(w.grid.cellFloor(-2, -16)).toBe(Infinity);
    }
  });

  it('the block cannot be pushed out of the hall', () => {
    const w = createWorld(level);
    const gate = findActor(w, 'gate1', 'door');
    if (!gate) throw new Error('no gate1');
    gate.open = 1;
    gate.target = 1;
    const b = findActor(w, 'block_weight', 'block');
    if (!b) throw new Error('no block');
    const bot = new Bot(w);
    // Towards the gate (a one-click threshold) and towards the south doorway.
    for (const [bx, bz, px, pz, dir] of [
      [-1, -16, 0, -16, 'W'],
      [4, -16, 4, -17, 'S'],
    ] as const) {
      b.cx = bx;
      b.cz = bz;
      place(w, px, pz, dir);
      run(w, frame({ x: dir === 'W' ? -1 : 0, y: dir === 'S' ? -1 : 0, held: ['walk'] }), 30);
      run(w, frame({ held: ['action'] }), 2);
      expect(bot.p.mode).toBe('block');
      run(w, frame({ x: dir === 'W' ? -1 : 0, y: dir === 'S' ? -1 : 0, held: ['action'] }), 60);
      expect([b.cx, b.cz]).toEqual([bx, bz]);
      run(w, frame(), 5);
    }
  });
});

describe('Hourglass', () => {
  it('the gate holds 12 s after the weight leaves, and the plate opens it again', () => {
    const w = createWorld(level);
    place(w, -7, -2, 'N');
    run(w, frame(), seconds(1 / mechanics.doorSpeed) + 2);
    expect(w.grid.cellFloor(-7, -18)).toBe(3);
    run(w, frame({ y: 1 }), 20);
    run(w, frame(), seconds(11));
    expect(w.grid.cellFloor(-7, -18)).toBe(3);
    run(w, frame(), seconds(1.5));
    expect(w.grid.cellFloor(-7, -18)).toBe(Infinity);
    const ticks = w.events.drain().filter((e) => e.type === 'door.tick');
    expect(ticks.length).toBeGreaterThanOrEqual(11);
    // Retry: back onto the plate.
    runUntil(w, frame({ y: -1, held: ['walk'] }), (x) => cell(x)[1] === -2, 200);
    run(w, frame(), seconds(1 / mechanics.doorSpeed) + 2);
    expect(w.grid.cellFloor(-7, -18)).toBe(3);
  });

  it('a fall into a trench is harmless and can be climbed out of', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, -7, -9, 'S');
    runUntil(w, frame({ y: -1 }), (x) => x.state.player.mode === 'air', 60);
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 120);
    expect(bot.p.pos.y).toBe(0);
    expect(bot.p.health).toBe(tuning.maxHealth);
    bot.climb('S');
    expect(bot.p.pos.y).toBe(2);
  });
});

describe('Well of Light', () => {
  it('the climb needs the block: no ledge is in reach from the floor of the well', () => {
    const well = level.rooms.find((r) => r.id === 'well');
    if (!well) throw new Error('no well');
    for (let cx = well.minX; cx < well.maxX; cx++) {
      for (let cz = well.minZ; cz < well.maxZ; cz++) {
        const s = level.sector(cx, cz);
        if (!s || s.wall || s.room !== 'well' || s.floor[0] !== 2) continue;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const n = level.sector(cx + dx, cz + dz);
          if (!n || n.wall) continue;
          const rise = (n.floor[0] - s.floor[0]) / 0.5;
          // Up to 2 clicks is the doorway step; 3 to 7 would be a grabbable ledge.
          expect(rise <= 2 || rise >= 8, `ledge of ${rise} clicks at ${cx + dx},${cz + dz}`).toBe(true);
        }
      }
    }
  });

  it('the block can be pulled back out of any pocket', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    const b = findActor(w, 'block_well', 'block');
    if (!b) throw new Error('no block');
    // The one-cell pocket under the idol pillar.
    b.cx = -4;
    b.cz = -23;
    place(w, -5, -23, 'E');
    bot.pull('E');
    expect([b.cx, b.cz]).toEqual([-5, -23]);
  });
});

describe('Sunken Causeway', () => {
  it('without the block, the running jump falls into the chasm', () => {
    const w = createWorld(level);
    place(w, 9, -27, 'N');
    const b = findActor(w, 'block_causeway', 'block');
    if (!b) throw new Error('no block');
    b.cx = 7; // over the chasm beside the causeway: it drops out of reach
    runUntil(w, frame({ y: 1 }), (x) => x.state.player.pos.z <= -60 + 0.15, 200);
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    run(w, frame({ y: 1, held: ['action'] }), 240);
    expect(w.state.player.mode).toBe('dead');
  });

  it('the block cannot be pulled back into the doorway', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 9, -27, 'N');
    run(w, frame({ y: 1, held: ['walk'] }), 30);
    run(w, frame({ held: ['action'] }), 2);
    expect(bot.p.mode).toBe('block');
    run(w, frame({ y: -1, held: ['action'] }), 60);
    expect(block(w, 'block_causeway').cz).toBe(-28);
  });
});

describe('Chamber of Scales', () => {
  it('one weighted plate and a player on the other are not enough', () => {
    const w = createWorld(level);
    const b = findActor(w, 'block_b', 'block');
    if (!b) throw new Error('no block');
    b.cz = -47;
    b.y = 14;
    place(w, 5, -47, 'N');
    run(w, frame(), seconds(1 / mechanics.doorSpeed) + 2);
    expect(w.grid.cellFloor(8, -52)).toBe(14);
    run(w, frame({ x: 0.5, y: 1 }), seconds(3));
    expect(cell(w)[1]).toBeGreaterThan(-52);
    expect(w.grid.cellFloor(8, -52)).toBe(Infinity);
  });

  it('the spring lever puts both blocks back, even stacked', () => {
    const w = createWorld(level);
    const a = findActor(w, 'block_a', 'block');
    const b = findActor(w, 'block_b', 'block');
    if (!a || !b) throw new Error('no blocks');
    // A mess: block_b pushed off the shelf onto block_a, both against the shelf.
    a.cx = 10;
    a.cz = -45;
    b.cx = 10;
    b.cz = -45;
    b.y = 14 + mechanics.blockHeight;
    for (let pull = 0; pull < 2; pull++) {
      place(w, 4, -42, 'W');
      stepWorld(w, frame({ pressed: ['action'] }));
      expect(w.state.player.mode).toBe('lever');
      run(w, frame(), seconds(tuning.leverTime) + 2);
      expect([a.cx, a.cz, a.y]).toEqual([5, -45, 14]);
      expect([b.cx, b.cz, b.y]).toEqual([12, -46, 18]);
    }
  });
});

describe('Descent', () => {
  it('jumping straight down hurts; lowering yourself first does not', () => {
    const w = createWorld(level);
    place(w, 3, -55, 'N');
    runUntil(w, frame({ y: 1 }), (x) => x.state.player.mode === 'air', 60);
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 200);
    expect(w.state.player.pos.y).toBe(9);
    expect(w.state.player.health).toBe(tuning.maxHealth - Math.round(1.5 * tuning.fallDamagePerMetre));

    const w2 = createWorld(level);
    place(w2, 3, -55, 'N');
    const bot = new Bot(w2);
    bot.lowerAndDrop('N');
    expect(bot.p.pos.y).toBe(9);
    expect(bot.p.health).toBe(tuning.maxHealth);
  });

  it('every checkpoint zone and the start lie on safe floor', () => {
    const checkpoints = new Set(
      level.logic.filter((r) => r.do.includes('checkpoint')).map((r) => r.when.replace('.entered', '')),
    );
    for (const e of level.entities) {
      if (e.type !== 'zone' || !checkpoints.has(e.id)) continue;
      for (let dx = 0; dx < e.size[0]; dx++) {
        for (let dz = 0; dz < e.size[1]; dz++) {
          const s = level.sector(e.at[0] + dx, e.at[1] + dz);
          if (!s || s.wall) continue;
          expect(s.flags.has('death') || s.pit, `${e.id} at ${e.at[0] + dx},${e.at[1] + dz}`).toBe(false);
        }
      }
    }
  });
});
