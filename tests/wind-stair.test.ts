/**
 * The Wind Stair (chamber VII, spec §19): the golden path by the bot with
 * every secret and no deaths, and targeted checks that each puzzle is needed
 * (spec §8 "Principios de diseño de puzles"). Camera yaw is 0: input y+ is
 * north (-Z), x+ is east (+X). Cells are given per room and converted.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/wind_stair.level.json';
import { Level } from '../src/sim/grid/level';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { runActions } from '../src/sim/logic/rules';
import { createWorld, findActor, type World } from '../src/sim/world';
import { Bot } from './bot';
import { recordGolden } from './golden';

const level = Level.parse(levelJson);
const origin = new Map(
  levelJson.rooms.map((r) => [r.id, { x: r.origin[0] ?? 0, z: r.origin[1] ?? 0 }] as const),
);

/** World cell of a room-local cell. */
function at(room: string, x: number, z: number): [number, number] {
  const o = origin.get(room);
  if (!o) throw new Error(`no room ${room}`);
  return [o.x + x, o.z + z];
}

/** Puts the player on the ground at the centre of a room cell. */
function place(w: World, room: string, x: number, z: number, face: Dir = 'N'): void {
  const [cx, cz] = at(room, x, z);
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = DIR_YAW[face];
  p.mode = 'ground';
}

/** World metre of a room cell's edge: the north edge of row `z` (for running jumps north). */
const northEdge = (room: string, z: number): number => at(room, 0, z)[1] * 2;
const eastEdge = (room: string, x: number): number => (at(room, x, 0)[0] + 1) * 2;

type Step = (bot: Bot, w: World) => void;

/** Waits for a zone's next gust to begin (not one already blowing out). */
function freshGust(bot: Bot, id: string): void {
  bot.waitFor(() => !bot.on(`${id}.gust`), `a lull in ${id}`, 1200);
  bot.waitFor(() => bot.on(`${id}.gust`), `a gust of ${id}`, 1200);
}

/** Waits for a zone's gust to end (the lull begins). */
function freshLull(bot: Bot, id: string): void {
  bot.waitFor(() => bot.on(`${id}.gust`), `a gust of ${id}`, 1200);
  bot.waitFor(() => !bot.on(`${id}.gust`), `a lull in ${id}`, 1200);
}

const go =
  (room: string, x: number, z: number): Step =>
  (bot) =>
    bot.goTo(...at(room, x, z));

/** The golden path, room by room. */
const ROOMS: Record<string, Step> = {
  // 1 · The foot: the note, the flares, then up the updraught.
  foot: (bot, w) => {
    go('foot', 7, 8)(bot, w);
    expect(w.state.inventory.flare).toBe(2);
    go('foot', 1, 5)(bot, w);
    bot.action();
    expect(w.stats.notes).toContain('note_breath');
    go('foot', 4, 4)(bot, w);
    go('foot', 4, 3)(bot, w);
    freshGust(bot, 'updraught_foot');
    bot.climb('N');
    go('foot', 4, 1)(bot, w);
    go('foot', 4, 0)(bot, w);
  },
  // 2 · The first flute's ledges: the niche first (east gust), then north on the following gust.
  ledges: (bot, w) => {
    go('ledges', 4, 8)(bot, w);
    freshGust(bot, 'gust_flute1');
    bot.runningJump('N', northEdge('ledges', 6));
    go('ledges', 4, 2)(bot, w);
    go('ledges', 4, 1)(bot, w);
    freshGust(bot, 'gust_niche');
    bot.runningJump('E', eastEdge('ledges', 7));
    go('ledges', 11, 1)(bot, w);
    bot.action();
    expect(w.stats.secrets).toBe(1);
    // Back down into the cut by the one-way step, out by the steps on the south side,
    // and across again on the following gust.
    go('ledges', 11, 2)(bot, w);
    bot.goTo(...at('ledges', 11, 3), { slow: true });
    go('ledges', 10, 4)(bot, w);
    go('ledges', 2, 5)(bot, w);
    bot.climb('W');
    bot.climb('S');
    go('ledges', 4, 8)(bot, w);
    freshGust(bot, 'gust_flute1');
    bot.runningJump('N', northEdge('ledges', 6));
    go('ledges', 4, 1)(bot, w);
    go('ledges', 4, 0)(bot, w);
  },
  // 3 · The counterweights: ride the low one up, then the high one.
  counterweights: (bot, w) => {
    go('counterweights', 5, 6)(bot, w);
    go('counterweights', 2, 5)(bot, w);
    bot.waitFor(() => bot.on('cw_low.at0'), 'the low counterweight down', 900);
    go('counterweights', 2, 4)(bot, w);
    bot.waitFor(() => bot.on('cw_low.at1'), 'the low counterweight up', 900);
    go('counterweights', 2, 3)(bot, w);
    go('counterweights', 5, 3)(bot, w);
    bot.waitFor(() => bot.on('cw_high.at1'), 'the high counterweight down', 900);
    go('counterweights', 5, 2)(bot, w);
    bot.waitFor(() => bot.on('cw_high.at0'), 'the high counterweight up', 900);
    go('counterweights', 5, 1)(bot, w);
    go('counterweights', 5, 0)(bot, w);
  },
  // 4 · The flute levers: the hidden flute first (stone idol), then close the head gust,
  //     open the following one, and jump.
  flutes: (bot, w) => {
    go('flutes', 5, 9)(bot, w);
    go('flutes', 9, 9)(bot, w);
    bot.action();
    bot.waitFor(() => bot.on('door_hidden.open'), 'the hidden flute door', 600);
    go('flutes', 2, 9)(bot, w);
    go('flutes', 1, 9)(bot, w);
    bot.action();
    expect(w.stats.secrets).toBe(2);
    go('flutes', 1, 7)(bot, w);
    bot.action();
    go('flutes', 9, 7)(bot, w);
    bot.action();
    go('flutes', 5, 8)(bot, w);
    freshGust(bot, 'gust_tail');
    bot.runningJump('N', northEdge('flutes', 6));
    go('flutes', 5, 1)(bot, w);
    go('flutes', 5, 0)(bot, w);
  },
  // 5 · The nest: the birds first, then up the ledges.
  nest: (bot, w) => {
    go('nest', 4, 8)(bot, w);
    go('nest', 4, 7)(bot, w);
    bot.fight('nest');
    go('nest', 5, 5)(bot, w);
    bot.climb('N');
    bot.climb('N');
    bot.climb('N');
    go('nest', 4, 1)(bot, w);
    go('nest', 4, 0)(bot, w);
  },
  // 6 · The hanging traverse: hang from the ledge, and shimmy east in the lulls.
  traverse: (bot, w) => {
    go('traverse', 1, 5)(bot, w);
    go('traverse', 1, 2)(bot, w);
    go('traverse', 2, 2)(bot, w);
    bot.hangFrom('N');
    freshLull(bot, 'tear_west');
    bot.shimmyTo('E', at('traverse', 5, 0)[0]);
    freshLull(bot, 'tear_east');
    bot.shimmyTo('E', at('traverse', 7, 0)[0]);
    bot.climbUp();
    go('traverse', 7, 0)(bot, w);
  },
  // 7 · The rope: pull it, ride the counterweight up.
  rope: (bot, w) => {
    go('rope', 4, 6)(bot, w);
    go('rope', 2, 4)(bot, w);
    bot.pullRope();
    bot.waitFor(() => bot.on('cw_rope.at1'), 'the counterweight down', 600);
    go('rope', 4, 2)(bot, w);
    bot.waitFor(() => bot.on('cw_rope.at0'), 'the counterweight up', 900);
    go('rope', 4, 1)(bot, w);
    go('rope', 4, 0)(bot, w);
  },
  // 8 · The great flute: the note, then tier by tier on the updraughts; the bird; the nest's idol.
  great_flute: (bot, w) => {
    go('great_flute', 5, 7)(bot, w);
    go('great_flute', 1, 6)(bot, w);
    bot.action();
    expect(w.stats.notes).toContain('note_suhal');
    go('great_flute', 5, 5)(bot, w);
    freshGust(bot, 'up_1');
    bot.climb('N');
    bot.fight('b3');
    go('great_flute', 5, 4)(bot, w);
    freshGust(bot, 'up_2');
    bot.climb('N');
    go('great_flute', 5, 2)(bot, w);
    freshGust(bot, 'up_3');
    bot.climb('N');
    go('great_flute', 4, 1)(bot, w);
    freshGust(bot, 'up_nest');
    bot.climb('W');
    go('great_flute', 1, 1)(bot, w);
    bot.action();
    expect(w.stats.secrets).toBe(3);
    go('great_flute', 3, 1)(bot, w);
    bot.lowerAndDrop('E');
    go('great_flute', 5, 1)(bot, w);
    go('great_flute', 5, 0)(bot, w);
  },
  // 9 · The storm: up the steps, across the cut on a following gust, up into the open.
  storm: (bot, w) => {
    go('storm', 4, 10)(bot, w);
    go('storm', 4, 9)(bot, w);
    bot.climb('N');
    bot.climb('N');
    go('storm', 4, 7)(bot, w);
    freshGust(bot, 'storm_jump');
    bot.runningJump('N', northEdge('storm', 6));
    go('storm', 4, 2)(bot, w);
    bot.climb('N');
    go('storm', 4, 0)(bot, w);
  },
  // 10 · The summit: the last note and the shell.
  summit: (bot, w) => {
    go('summit', 4, 4)(bot, w);
    go('summit', 7, 3)(bot, w);
    bot.action();
    expect(w.stats.notes).toContain('note_ear');
    go('summit', 4, 1)(bot, w);
    bot.action();
    bot.wait(240);
  },
};

function play(rooms: string[], start?: [string, number, number]): Bot {
  const w = createWorld(level);
  const bot = new Bot(w);
  if (start) place(w, ...start);
  for (const r of rooms) {
    const step = ROOMS[r];
    if (!step) throw new Error(`no step for ${r}`);
    const h = w.state.player.health;
    step(bot, w);
    if (process.env.WIND_DEBUG) console.log(r, 'health', h, '→', w.state.player.health, 'tick', w.tick);
  }
  return bot;
}

describe('The Wind Stair', () => {
  it('can be finished through every room with all three secrets and no deaths', { timeout: 120_000 }, () => {
    const bot = play(Object.keys(ROOMS));
    recordGolden(bot);
    expect(bot.w.ended).toBe(true);
    expect(bot.w.stats.secrets).toBe(3);
    expect(bot.w.stats.deaths).toBe(0);
    expect(bot.w.stats.notes).toHaveLength(3);
  });
});

describe('every Wind Stair puzzle is needed', () => {
  const fresh = (room: string, x: number, z: number, face: Dir = 'N'): { w: World; bot: Bot } => {
    const w = createWorld(level);
    place(w, room, x, z, face);
    return { w, bot: new Bot(w) };
  };
  const floorY = (w: World): number => w.state.player.pos.y;

  it('the foot’s ledge is out of reach without the updraught', () => {
    const { w, bot } = fresh('foot', 4, 3);
    runActions(w, ['updraught_foot.off']);
    const y = floorY(w);
    bot.climb('N');
    expect(floorY(w)).toBe(y);
  });

  it('the first cut cannot be jumped in a lull', () => {
    const { w, bot } = fresh('ledges', 4, 8);
    runActions(w, ['gust_flute1.off']);
    bot.runningJump('N', northEdge('ledges', 6));
    // Down in the cut (not deadly: steps lead back out to the south).
    expect(floorY(w)).toBeLessThan((level.rooms.find((r) => r.id === 'ledges')?.originY ?? 0) - 3);
    expect(w.stats.deaths).toBe(0);
  });

  it('the niche cannot be reached without its gust', () => {
    const { w, bot } = fresh('ledges', 4, 1);
    runActions(w, ['gust_niche.off']);
    bot.runningJump('E', eastEdge('ledges', 7));
    expect(w.stats.secrets).toBe(0);
    expect(Math.floor(w.state.player.pos.x / 2)).not.toBe(at('ledges', 11, 1)[0]);
  });

  it('the counterweights’ tier cannot be climbed from the floor', () => {
    const { w, bot } = fresh('counterweights', 7, 4);
    const y = floorY(w);
    bot.climb('N');
    expect(floorY(w)).toBe(y);
  });

  it('the flute room’s cut cannot be jumped against the head gust', () => {
    const { w, bot } = fresh('flutes', 5, 8);
    runActions(w, ['gust_tail.on']);
    bot.waitFor(() => !bot.on('gust_tail.gust'), 'a lull', 900);
    bot.waitFor(() => bot.on('gust_tail.gust'), 'a gust', 900);
    expect(() => bot.runningJump('N', northEdge('flutes', 6))).toThrow(/died/);
  });

  it('the hidden flute’s door stays shut until its lever closes it', () => {
    const { w, bot } = fresh('flutes', 5, 9);
    bot.wait(240);
    expect(findActor(w, 'door_hidden', 'door')?.target).toBe(0);
  });

  it('the traverse ledge cannot be climbed onto: there is no headroom', () => {
    const { w, bot } = fresh('traverse', 2, 2);
    bot.hangFrom('N');
    bot.tick();
    for (let i = 0; i < 40; i++) bot.tick();
    expect(w.state.player.mode).toBe('hang');
  });

  it('shimmying through a gust tears her off the traverse', () => {
    const { w, bot } = fresh('traverse', 2, 2);
    bot.hangFrom('N');
    bot.waitFor(() => bot.on('tear_west.gust'), 'a gust', 900);
    expect(() => bot.shimmyTo('E', at('traverse', 5, 0)[0])).toThrow();
    expect(w.state.player.mode).not.toBe('hang');
  });

  it('the rope room’s counterweight stays up until the rope is pulled', () => {
    const { w, bot } = fresh('rope', 4, 4);
    bot.wait(600);
    expect(bot.on('cw_rope.at0')).toBe(true);
    expect(w.state.mechanisms.platforms.find((p) => p.id === 'cw_rope')?.pos.y).toBeGreaterThan(
      floorY(w) + 6,
    );
  });

  it('the great flute’s tiers are out of reach without the updraughts', () => {
    const { w, bot } = fresh('great_flute', 5, 5);
    runActions(w, ['up_1.off']);
    const y = floorY(w);
    bot.climb('N');
    expect(floorY(w)).toBe(y);
  });

  it('the storm’s cut cannot be jumped in a lull', () => {
    const { w, bot } = fresh('storm', 4, 7);
    runActions(w, ['storm_jump.off']);
    expect(() => bot.runningJump('N', northEdge('storm', 6))).toThrow(/died/);
  });
});
