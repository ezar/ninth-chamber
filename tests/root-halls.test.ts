/**
 * The Root Halls (chamber V, spec §19): the golden path by the bot with every
 * secret and no deaths, and checks that each puzzle is needed. Camera yaw is
 * 0: input y+ is north (-Z), x+ is east (+X). Cells are given per room
 * (local) and converted to world cells.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/root_halls.level.json';
import { Level } from '../src/sim/grid/level';
import { reachableCells, key } from '../src/sim/grid/reach';
import { validateLevel } from '../src/sim/grid/validate';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { swimming, tangle as T } from '../src/sim/player/tuning';
import { createWorld, type World } from '../src/sim/world';
import { Bot } from './bot';
import { recordGolden } from './golden';
import { frame, run } from './helpers';

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

/** Puts the player on the ground at the centre of a room cell. */
function place(w: World, room: string, x: number, z: number, face: Dir = 'N'): void {
  const [cx, cz] = at(room, x, z);
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = DIR_YAW[face];
  p.mode = 'ground';
}

const tangleOf = (w: World, id: string) => {
  const t = w.state.mechanisms.tangles.find((x) => x.id === id);
  if (!t) throw new Error(`no tangle ${id}`);
  return t;
};

/** Plays the whole level; returns the bot for inspection. */
function playRootHalls(): Bot {
  const w = createWorld(level);
  const bot = new Bot(w);
  const go = (room: string, x: number, z: number, opts: Parameters<Bot['goTo']>[2] = {}): void =>
    bot.goTo(...at(room, x, z), opts);
  const heal = (): void => {
    if (bot.p.health < 60 || bot.p.poison > 0) bot.tick(frame({ pressed: ['medkit'] }));
  };

  // The rift: take the burning torch, read the first note, round the giant root.
  go('rift', 3, 7);
  bot.action();
  expect(bot.p.torch.has && bot.p.torch.lit).toBe(true);
  go('rift', 1, 5);
  bot.action();
  expect(w.stats.notes).toContain('note_buried');
  go('rift', 1, 7);
  go('rift', 8, 7);
  go('rift', 8, 1);
  go('rift', 8, 0);

  // The first wall: climb the roots to the top.
  go('first_wall', 4, 5);
  bot.getOnWall('N');
  bot.climbWall('N');
  expect(bot.p.pos.y).toBeCloseTo(h('first_wall', 10), 3);
  go('first_wall', 4, 1);
  go('first_wall', 4, 0);

  // The gallery of tangles: the jade idol under the mat of roots, then the torch opens the way.
  go('tangles', 7, 4);
  bot.wait(Math.ceil(T.shrinkTime * 60) + 10);
  expect(tangleOf(w, 'tg_hole').grown).toBe(0);
  go('tangles', 7, 3);
  bot.action();
  expect(w.stats.secrets).toBe(1);
  bot.getOnWall('W');
  bot.climbWall('W');
  go('tangles', 4, 3);
  go('tangles', 4, 2);
  bot.wait(Math.ceil(T.shrinkTime * 60) + 10);
  expect(w.state.signals['tg_gate.open']).toBe(true);
  go('tangles', 4, 1);
  go('tangles', 4, 0);

  // The scorpions' nest: fight the pack, cross the strip of root floor at a run.
  go('nest', 5, 7);
  bot.fight('nest');
  heal();
  go('nest', 5, 5);
  go('nest', 5, 2);
  go('nest', 5, 0);

  // The pool: through the drowned tunnel to the chamber under it (gold idol), then under the wall.
  go('pool', 2, 8);
  go('pool', 2, 7);
  bot.wadeIn('N');
  const gap = (h('pool', -8) - swimming.bodyLow + h('pool', -4) - swimming.bodyHigh) / 2;
  bot.dive([wp('pool', 3, 6, gap), wp('pool', 4, 6, gap), wp('pool', 5, 6, gap), wp('pool', 6, 6, gap)]);
  bot.surface();
  bot.climbOut('N');
  bot.action();
  expect(w.stats.secrets).toBe(2);
  bot.wadeIn('S');
  bot.dive([
    wp('pool', 6, 6, gap),
    wp('pool', 5, 6, gap),
    wp('pool', 4, 6, gap),
    wp('pool', 2, 6, gap),
    wp('pool', 2, 5, gap),
    wp('pool', 2, 4, gap),
    wp('pool', 2, 3, gap),
  ]);
  bot.surface();
  bot.climbOut('N');
  go('pool', 6, 1);
  bot.action();
  expect(bot.p.torch.lit).toBe(true);
  go('pool', 4, 1);
  go('pool', 4, 0);

  // The split hall: torch away, up the pillar of roots, torch out by the tangle above.
  go('split', 4, 7);
  bot.toggleTorch();
  expect(bot.p.torch.stowed).toBe(true);
  go('split', 2, 6);
  bot.getOnWall('N');
  bot.climbWall('N');
  go('split', 2, 4);
  go('split', 4, 3);
  bot.toggleTorch();
  go('split', 4, 2);
  bot.wait(Math.ceil(T.shrinkTime * 60) + 10);
  expect(w.state.signals['tg_split.open']).toBe(true);
  go('split', 4, 1);
  go('split', 4, 0);

  // The root bridge: along its face over the thorns, and up the last of it.
  go('bridge', 1, 4);
  go('bridge', 1, 2);
  bot.getOnWall('N');
  bot.wallAlong('E', at('bridge', 9, 0)[0]);
  bot.climbWall('N');
  go('bridge', 9, 0);

  // The forest vault: the pack, the second note, and up the curtain of roots to the stone idol.
  go('vault', 9, 8);
  bot.fight('vault');
  heal();
  go('vault', 1, 4);
  bot.action();
  expect(w.stats.notes).toContain('note_erreth');
  bot.toggleTorch();
  go('vault', 11, 3);
  bot.getOnWall('N');
  bot.climbWall('N');
  bot.getOnWall('N');
  bot.climbWall('N');
  bot.action();
  expect(w.stats.secrets).toBe(3);
  // Down again: hang from each edge before letting go.
  bot.lowerAndDrop('S');
  bot.lowerAndDrop('S');
  heal();
  go('vault', 6, 1);
  go('vault', 6, 0);

  // Erreth's trunk: the long climb while the roots close below.
  go('trunk', 1, 6);
  go('trunk', 3, 4);
  bot.getOnWall('N');
  bot.climbWall('N');
  expect(bot.p.pos.y).toBeCloseTo(h('trunk', 32), 3);
  go('trunk', 3, 1);
  go('trunk', 3, 0);

  // The heart of the tree: the Stone Seed.
  go('heart', 4, 2);
  go('heart', 4, 1);
  bot.action();
  return bot;
}

describe('The Root Halls', () => {
  it('names only reverb presets the audio has (an unknown one broke the mixer)', () => {
    const bad = {
      ...levelJson,
      rooms: levelJson.rooms.map((r, i) => (i === 0 ? { ...r, reverb: 'water_cave' } : r)),
    };
    expect(() => Level.parse(bad)).toThrow();
  });

  it('passes the level validator, reachability included', () => {
    const { errors } = validateLevel(levelJson);
    expect(errors).toEqual([]);
  });

  it('is played from start to relic with every secret and no deaths', () => {
    const bot = playRootHalls();
    recordGolden(bot);
    const w = bot.w;
    expect(w.stats.secrets).toBe(3);
    expect(w.stats.deaths).toBe(0);
    expect(w.state.actors.find((a) => a.id === 'seed' && a.kind === 'relic')).toMatchObject({ taken: true });
    run(w, frame(), 240);
    expect(w.ended).toBe(true);
  });

  it('the first wall cannot be jumped: it has to be climbed', () => {
    const lv = Level.parse({
      ...levelJson,
      rooms: levelJson.rooms.map((r) =>
        r.id === 'first_wall' ? { ...r, legend: { ...r.legend, C: 10 } } : r,
      ),
    });
    expect(reachableCells(lv).has(key(...at('tangles', 4, 4)))).toBe(false);
  });

  it('the gallery is closed until the torch opens the tangle', () => {
    const w = createWorld(level);
    w.state.player.torch = { has: true, lit: false, stowed: false, away: false };
    place(w, 'tangles', 4, 2);
    run(w, frame(), 240);
    expect(w.state.signals['tg_gate.open']).not.toBe(true);
    w.state.player.torch.lit = true;
    run(w, frame(), 60);
    expect(w.state.signals['tg_gate.open']).toBe(true);
  });

  it('in the split hall a torch in hand takes the pillar away, and it grows back', () => {
    const w = createWorld(level);
    w.state.player.torch = { has: true, lit: true, stowed: false, away: false };
    place(w, 'split', 2, 6);
    run(w, frame(), 60);
    expect(tangleOf(w, 'tg_pillar').grown).toBe(0);
    place(w, 'split', 6, 7);
    run(w, frame(), Math.ceil((T.regrowDelay + T.regrowTime) * 60) + 30);
    expect(tangleOf(w, 'tg_pillar').grown).toBe(1);
  });

  it('the roots of the trunk close below her, never on her', () => {
    const w = createWorld(level);
    place(w, 'trunk', 3, 6);
    run(w, frame(), 30);
    place(w, 'trunk', 3, 5);
    // Standing still inside their footprint: the first never grows onto her.
    run(w, frame(), 60 * 30);
    expect(tangleOf(w, 'tg_rise0').hold).toBe('sealed');
    expect(tangleOf(w, 'tg_rise0').grown).toBe(0);
    expect(w.state.player.mode).toBe('ground');
  });
});
