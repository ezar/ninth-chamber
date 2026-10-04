/**
 * The Cisterns (level 2): the golden path by the bot with every secret and
 * no deaths, and targeted checks that each water puzzle is needed and never
 * leaves the player in a dead end (spec §8 "Principios de diseño de
 * puzles"). Camera yaw is 0: input y+ is north (-Z), x+ is east (+X).
 * Cells are given per room (local) and converted to world cells.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/cisterns.level.json';
import en from '../i18n/en.json';
import { waterDepth, waterSurface } from '../src/sim/actors/water';
import { Level } from '../src/sim/grid/level';
import { validateLevel } from '../src/sim/grid/validate';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { swimming } from '../src/sim/player/tuning';
import { createWorld, findActor, type World } from '../src/sim/world';
import { Bot } from './bot';
import { recordGolden } from './golden';
import { frame, run, runUntil } from './helpers';

const level = Level.parse(levelJson);
const origin = new Map(
  levelJson.rooms.map(
    (r) => [r.id, { x: r.origin[0] ?? 0, z: r.origin[1] ?? 0, y: r.origin[2] ?? 0 }] as const,
  ),
);

/** World cell of a room-local cell. */
function at(room: string, x: number, z: number): [number, number] {
  const o = origin.get(room);
  if (!o) throw new Error(`no room ${room}`);
  return [o.x + x, o.z + z];
}

/** A height in metres from a room-relative click count. */
function h(room: string, clicks: number): number {
  const o = origin.get(room);
  if (!o) throw new Error(`no room ${room}`);
  return (o.y + clicks) * 0.5;
}

/** A waypoint for Bot.dive: a room cell and the feet height (m) to swim at. */
const wp = (room: string, x: number, z: number, y: number): [number, number, number] => [
  ...at(room, x, z),
  y,
];

/** Feet height for swimming through a drowned arch whose floor and ceiling are given in clicks. */
const tunnel = (room: string, floor: number, ceil: number): number =>
  (h(room, floor) - swimming.bodyLow + h(room, ceil) - swimming.bodyHigh) / 2;

/** Puts the player on the ground at the centre of a room cell. */
function place(w: World, room: string, x: number, z: number, face: Dir = 'N'): void {
  const [cx, cz] = at(room, x, z);
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = DIR_YAW[face];
  p.mode = 'ground';
}

/** Plays the whole level; returns the bot for inspection. */
function playCisterns(): Bot {
  const w = createWorld(level);
  const bot = new Bot(w);
  const go = (room: string, x: number, z: number, opts: Parameters<Bot['goTo']>[2] = {}): void =>
    bot.goTo(...at(room, x, z), opts);
  const swim = (room: string, x: number, z: number): void => bot.swimTo(...at(room, x, z));

  // Stair: down from the tomb.
  go('stair', 2, 1);
  go('stair', 2, 0);

  // Camp: wade through the shallows to Ferrand's camp and read his log.
  go('camp', 5, 7);
  go('camp', 3, 3);
  go('camp', 3, 1);
  go('camp', 1, 1);
  bot.action();
  expect(w.stats.notes).toContain('note_ferrand');
  go('camp', 3, 1);
  go('camp', 4, 0);

  // First cistern: swim across; the jade idol waits on a ledge off the east pool.
  go('cistern', 5, 9);
  bot.wadeIn('N');
  swim('cistern', 9, 5);
  bot.climbOut('E');
  bot.climb('E');
  bot.action();
  expect(w.stats.secrets).toBe(1);
  go('cistern', 10, 5, { slow: true });
  bot.wadeIn('W');
  swim('cistern', 5, 2);
  bot.climbOut('N');

  // Passage: the first dive, under the drowned arch.
  go('passage', 2, 7);
  bot.wadeIn('N');
  const arch = tunnel('passage', -10, -3);
  bot.dive([wp('passage', 2, 6, arch), wp('passage', 2, 4, arch), wp('passage', 2, 2, arch)]);
  bot.surface();
  bot.climbOut('N');

  // Drowned gallery: a long dive with an air pocket, and the grotto of the gold idol.
  go('passage', 2, 0);
  go('drowned', 10, 16);
  bot.wadeIn('N');
  const low = tunnel('drowned', -10, -3);
  bot.dive([wp('drowned', 10, 15, low), wp('drowned', 9, 14, low), wp('drowned', 9, 9, low)]);
  bot.surface();
  bot.dive([
    wp('drowned', 9, 8, low),
    wp('drowned', 9, 6, low),
    wp('drowned', 5, 6, low),
    wp('drowned', 5, 8, low),
    wp('drowned', 2, 8, low),
  ]);
  bot.surface();
  bot.climbOut('N');
  bot.action();
  expect(w.stats.secrets).toBe(2);
  bot.wadeIn('S');
  bot.dive([
    wp('drowned', 2, 8, low),
    wp('drowned', 5, 8, low),
    wp('drowned', 5, 6, low),
    wp('drowned', 9, 6, low),
    wp('drowned', 9, 4, low),
    wp('drowned', 9, 3, low),
  ]);
  bot.surface();
  bot.climbOut('N');

  // Sluice: lower the water, pull the door lever on the basin, raise it again and swim to the door.
  go('drowned', 9, 0);
  go('sluice', 6, 9);
  go('sluice', 3, 9);
  bot.action();
  bot.waitWater('sluice');
  expect(waterSurface(w, ...at('sluice', 5, 5))).toBeCloseTo(h('sluice', -9), 5);
  go('sluice', 4, 8);
  bot.wadeIn('N', true);
  swim('sluice', 3, 5);
  bot.climbOut('W');
  go('sluice', 1, 5);
  bot.action();
  go('sluice', 1, 4);
  bot.action();
  bot.waitMode('swim', 900);
  bot.waitWater('sluice');
  swim('sluice', 6, 2);
  bot.climbOut('N');
  go('sluice', 6, 0);

  // Aqueduct: two jackals, then Ferrand's flares.
  go('aqueduct', 12, 8);
  go('aqueduct', 11, 6);
  bot.fight('aq');
  go('aqueduct', 1, 1);
  expect(w.state.inventory.flare).toBe(4);
  go('aqueduct', 1, 0);

  // The dark: light the three cold braziers with flares; the grate opens.
  go('dark', 5, 10);
  go('dark', 4, 10);
  go('dark', 2, 9);
  bot.lightFlare();
  bot.wadeIn('N');
  swim('dark', 1, 3);
  bot.climbOut('N');
  go('dark', 2, 2);
  expect(findActor(w, 'cold1', 'brazier')?.lit).toBe(true);
  go('dark', 2, 1);
  bot.wadeIn('E');
  swim('dark', 8, 2);
  bot.climbOut('E');
  expect(findActor(w, 'cold2', 'brazier')?.lit).toBe(true);
  // The stone idol sits in a niche above a ledge on the east wall.
  go('dark', 9, 1);
  bot.wadeIn('S');
  swim('dark', 9, 4);
  bot.climbOut('E');
  bot.climb('E');
  bot.action();
  expect(w.stats.secrets).toBe(3);
  go('dark', 10, 4, { slow: true });
  bot.wadeIn('W');
  swim('dark', 7, 3);
  swim('dark', 5, 3);
  swim('dark', 5, 4);
  if (!bot.holdingFlare) bot.lightFlare();
  bot.climbOut('S');
  expect(findActor(w, 'cold3', 'brazier')?.lit).toBe(true);
  bot.wait(200);
  expect(w.grid.cellFloor(...at('dark', 6, 0))).toBe(h('dark', 0));
  bot.wadeIn('N');
  swim('dark', 6, 2);
  bot.climbOut('N');
  go('dark', 6, 0);

  // Landing: Elena's letter by the stair.
  go('landing', 3, 5);
  go('landing', 1, 2);
  bot.action();
  expect(w.stats.notes).toContain('note_elena');
  go('landing', 4, 2);
  go('landing', 6, 2);

  // Tide chamber: jump into the low water, dive through the arch to the tide lever, ride the tide up to the relic.
  go('tide', 1, 5);
  bot.wadeIn('E', true);
  if (!bot.holdingFlare) bot.lightFlare();
  swim('tide', 3, 1);
  const deep = tunnel('tide', -18, -12);
  bot.dive([wp('tide', 3, 1, deep), wp('tide', 3, 0, deep), wp('cave', 3, 5, deep), wp('cave', 3, 3, deep)]);
  bot.surface();
  swim('cave', 2, 3);
  bot.climbOut('N');
  go('cave', 1, 1);
  bot.action();
  bot.waitMode('swim', 900);
  bot.waitWater('tide');
  expect(waterSurface(w, ...at('tide', 3, 3))).toBeCloseTo(h('tide', -1), 5);
  const back = tunnel('tide', -18, -12);
  bot.dive([wp('cave', 3, 3, back), wp('cave', 3, 5, back), wp('tide', 3, 0, back), wp('tide', 3, 2, back)]);
  bot.surface();
  swim('tide', 4, 5);
  bot.climbOut('E');
  bot.climb('E');
  bot.action();
  bot.wait(240);
  return bot;
}

describe('The Cisterns', () => {
  it('validates without errors', () => {
    const { errors } = validateLevel(levelJson, new Set(Object.keys(en)));
    expect(errors).toEqual([]);
  });

  it('has 10 to 12 rooms, three secrets, three journal notes and a relic', () => {
    expect(level.rooms.length).toBeGreaterThanOrEqual(10);
    expect(level.rooms.length).toBeLessThanOrEqual(12);
    const count = (t: string): number => level.entities.filter((e) => e.type === t).length;
    expect(count('secret')).toBe(3);
    expect(count('note')).toBe(3);
    expect(count('relic')).toBe(1);
  });

  it('marks its moments for the score, and every tension is released', () => {
    const music = levelJson.logic
      .flatMap((r) => r.do)
      .filter((a) => a.startsWith('music '))
      .map((a) => a.slice('music '.length));
    expect(music).toEqual(expect.arrayContaining(['vista', 'tension', 'calm', 'hall', 'relic', 'fanfare']));
    const count = (name: string): number => music.filter((m) => m === name).length;
    expect(count('calm')).toBeGreaterThanOrEqual(count('tension'));
  });

  it('can be finished through every room with every secret and no deaths', { timeout: 60_000 }, () => {
    const bot = playCisterns();
    recordGolden(bot);
    const w = bot.w;
    expect(w.ended).toBe(true);
    expect(w.stats.deaths).toBe(0);
    expect(w.stats.secrets).toBe(3);
    expect([...bot.rooms].sort()).toEqual(level.rooms.map((r) => r.id).sort());
  });
});

describe('puzzles', () => {
  it('the sluice door stays shut without the lever on the basin', () => {
    const w = createWorld(level);
    place(w, 'sluice', 6, 1, 'N');
    run(w, frame({ y: 1 }), 120);
    expect(w.grid.cellFloor(...at('sluice', 6, 0))).toBe(Infinity);
    expect(w.state.player.pos.z).toBeGreaterThan(at('sluice', 6, 0)[1] * 2 + 2);
  });

  it('the basin lever cannot be reached while the sluice is high', () => {
    const w = createWorld(level);
    // Under 3.5 m of water: Nora swims over it.
    expect(waterDepth(w, ...at('sluice', 1, 5))).toBeGreaterThan(swimming.swimDepth);
  });

  it('from low water in the sluice there is always a way up', () => {
    const w = createWorld(level);
    const gate = findActor(w, 'sluice_gate', 'watergate');
    if (!gate) throw new Error('no gate');
    gate.raised = false;
    const water = w.state.water.sluice;
    if (!water) throw new Error('no sluice water');
    water.y = water.target = gate.low;
    place(w, 'sluice', 1, 4, 'W');
    const bot = new Bot(w);
    bot.action();
    bot.waitMode('swim', 900);
    bot.waitWater('sluice');
    expect(w.state.water.sluice?.y).toBe(gate.high);
  });

  it('the dark grate needs all three braziers', () => {
    const w = createWorld(level);
    for (const id of ['cold1', 'cold2']) {
      const b = findActor(w, id, 'brazier');
      if (b) b.lit = true;
      w.state.signals[`${id}.lit`] = true;
    }
    run(w, frame(), 300);
    expect(w.grid.cellFloor(...at('dark', 6, 0))).toBe(Infinity);
  });

  it('the island is out of reach at low tide, even with a running jump from the balcony', () => {
    const w = createWorld(level);
    place(w, 'tide', 0, 5, 'E');
    const edge = (at('tide', 1, 5)[0] + 1) * 2;
    runUntil(w, frame({ x: 1 }), (x) => x.state.player.pos.x > edge - 0.15, 120);
    run(w, frame({ x: 1, pressed: ['jump'] }), 1);
    runUntil(w, frame({ x: 1, held: ['action'] }), (x) => x.state.player.mode !== 'air', 300);
    // She lands in the water, not on the island.
    expect(['swim', 'dive']).toContain(w.state.player.mode);
  });

  it('the island is nine clicks above the low tide and one above the high', () => {
    const w = createWorld(level);
    const island = w.grid.cellFloor(...at('tide', 5, 5));
    const low = waterSurface(w, ...at('tide', 3, 3)) ?? 0;
    expect(island - low).toBeCloseTo(4.5, 5);
    const tide = findActor(w, 'tide_gate', 'watergate');
    expect((tide?.high ?? 0) + swimming.climbOutAbove).toBeCloseTo(island, 5);
  });

  it('every flooded room can be left from the water', () => {
    // From the middle of each pool, some edge is at most one click above the surface.
    const w = createWorld(level);
    for (const [room, x, z] of [
      ['cistern', 5, 5],
      ['passage', 2, 6],
      ['drowned', 9, 3],
      ['sluice', 5, 5],
      ['dark', 5, 7],
      ['tide', 3, 3],
      ['cave', 4, 3],
    ] as const) {
      const [cx, cz] = at(room, x, z);
      const surface = waterSurface(w, cx, cz);
      expect(surface, room).not.toBeNull();
      let exit = false;
      const r = level.rooms.find((rr) => rr.id === room);
      if (!r) continue;
      for (let ix = r.minX; ix < r.maxX; ix++) {
        for (let iz = r.minZ; iz < r.maxZ; iz++) {
          const f = w.grid.cellFloor(ix, iz);
          if (Number.isFinite(f) && f > (surface ?? 0) && f <= (surface ?? 0) + swimming.climbOutAbove + 1e-6)
            exit = true;
        }
      }
      expect(exit, room).toBe(true);
    }
  });
});
