/**
 * The Observatory (chamber VIII, spec §19): the golden path by the bot with
 * every secret and no deaths, and targeted checks that each puzzle is needed
 * (spec §8 "Principios de diseño de puzles"). Camera yaw is 0: input y+ is
 * north (-Z), x+ is east (+X). Cells are given per room and converted.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/observatory.level.json';
import { Level } from '../src/sim/grid/level';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { runActions } from '../src/sim/logic/rules';
import { createWorld, findActor, type World } from '../src/sim/world';
import { Bot } from './bot';

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

type Step = (bot: Bot, w: World) => void;

/** Waits for a zone's next gust to begin (not one already blowing out). */
function freshGust(bot: Bot, id: string): void {
  bot.waitFor(() => !bot.on(`${id}.gust`), `a lull in ${id}`, 1200);
  bot.waitFor(() => bot.on(`${id}.gust`), `a gust of ${id}`, 1200);
}

const go =
  (room: string, x: number, z: number): Step =>
  (bot) =>
    bot.goTo(...at(room, x, z));

/** The golden path, room by room. */
const ROOMS: Record<string, Step> = {
  // 1 · The terrace: the jackals, the first note, the idol on the dome's outer ledge.
  terrace: (bot, w) => {
    bot.fight('terrace');
    go('terrace', 1, 6)(bot, w);
    bot.action();
    expect(w.stats.notes).toContain('note_watcher');
    go('terrace', 9, 3)(bot, w);
    go('terrace', 9, 2)(bot, w);
    freshGust(bot, 'up_terrace');
    bot.climb('N');
    bot.action();
    expect(w.stats.secrets).toBe(1);
    bot.lowerAndDrop('S');
    go('terrace', 7, 1)(bot, w);
    go('terrace', 7, 0)(bot, w);
  },
  // 2 · The gallery: the keeper's name on the three locks.
  gallery: (bot, w) => {
    go('gallery', 4, 8)(bot, w);
    go('gallery', 2, 3)(bot, w);
    bot.turnMirror('W', 3);
    go('gallery', 2, 5)(bot, w);
    bot.turnMirror('W', 4);
    go('gallery', 2, 7)(bot, w);
    bot.turnMirror('W', 5);
    bot.waitFor(() => bot.on('door_gallery.open'), 'the gallery door', 600);
    go('gallery', 4, 1)(bot, w);
    go('gallery', 4, 0)(bot, w);
  },
  // 3 · The first ring: one pull opens the niche by mistake, four more align it.
  first_ring: (bot, w) => {
    go('first_ring', 4, 6)(bot, w);
    go('first_ring', 7, 4)(bot, w);
    bot.action();
    bot.waitFor(() => bot.on('door_niche.open'), 'the niche', 600);
    go('first_ring', 1, 5)(bot, w);
    go('first_ring', 0, 5)(bot, w);
    bot.action();
    expect(w.stats.secrets).toBe(2);
    go('first_ring', 7, 4)(bot, w);
    for (let i = 0; i < 4; i++) bot.action();
    bot.waitFor(() => bot.on('door_first.open'), 'the first ring door', 600);
    go('first_ring', 4, 1)(bot, w);
    go('first_ring', 4, 0)(bot, w);
  },
  // 4 · The hall of moons: the block onto the new moon.
  moons: (bot, w) => {
    go('moons', 4, 6)(bot, w);
    go('moons', 3, 4)(bot, w);
    bot.push('E');
    bot.push('E');
    go('moons', 6, 5)(bot, w);
    bot.push('N');
    bot.push('N');
    bot.waitFor(() => bot.on('door_moons.open'), 'the moons door', 600);
    go('moons', 4, 1)(bot, w);
    go('moons', 4, 0)(bot, w);
  },
  // 5 · The hall of the horizon: turn the mirror onto the sun disc.
  horizon: (bot, w) => {
    go('horizon', 4, 5)(bot, w);
    go('horizon', 5, 4)(bot, w);
    bot.turnMirror('N', 3);
    bot.waitFor(() => bot.on('door_horizon.open'), 'the horizon door', 600);
    go('horizon', 4, 1)(bot, w);
    go('horizon', 4, 0)(bot, w);
  },
  // 6 · The stairs: the jackal, then up the tiers.
  stairs: (bot, w) => {
    go('stairs', 4, 6)(bot, w);
    bot.fight('j3');
    go('stairs', 5, 4)(bot, w);
    bot.climb('N');
    bot.climb('N');
    bot.climb('N');
    go('stairs', 4, 1)(bot, w);
    go('stairs', 4, 0)(bot, w);
  },
  // 7 · Under the dome: the second note.
  dome_hall: (bot, w) => {
    go('dome_hall', 4, 3)(bot, w);
    go('dome_hall', 1, 2)(bot, w);
    bot.action();
    expect(w.stats.notes).toContain('note_three');
    go('dome_hall', 10, 1)(bot, w);
    go('dome_hall', 10, 0)(bot, w);
  },
  // 8 · Anzur: up onto the rim, the sky ring (phase 2: the seat opens), the idol, the moon ring
  //     (phase 3), the horizon ring (the light), then down to the dais beyond the light.
  arena: (bot, w) => {
    const log = (m: string): void => {
      if (process.env.OBS_DEBUG) {
        const g = w.state.guardians[0];
        console.log(
          m,
          bot.where(),
          'hp',
          w.state.player.health,
          'anzur',
          g?.mode,
          g?.phase,
          g?.pos.x.toFixed(1),
          g?.pos.z.toFixed(1),
        );
      }
    };
    go('arena', 11, 11)(bot, w);
    log('entered');
    bot.climb('N');
    log('rim');
    go('arena', 11, 2)(bot, w);
    log('ne');
    go('arena', 3, 2)(bot, w);
    go('arena', 3, 1)(bot, w);
    log('sky lever');
    bot.action();
    bot.action();
    log('sky set');
    bot.waitFor(() => bot.on('anzur.phase2'), 'phase 2', 300);
    bot.waitFor(() => bot.on('gate_seat.open'), 'the seat gate', 600);
    go('arena', 6, 2)(bot, w);
    go('arena', 6, 1)(bot, w);
    go('arena', 6, 0)(bot, w);
    bot.action();
    expect(w.stats.secrets).toBe(3);
    go('arena', 6, 2)(bot, w);
    go('arena', 9, 2)(bot, w);
    go('arena', 9, 1)(bot, w);
    bot.action();
    bot.action();
    bot.action();
    bot.waitFor(() => bot.on('anzur.phase3'), 'phase 3', 300);
    go('arena', 11, 2)(bot, w);
    go('arena', 11, 3)(bot, w);
    bot.action();
    bot.waitFor(() => bot.on('oculus_arena.on'), 'the oculus light', 300);
    // Along the rim and the ledge behind the dais, then down onto it: he must come through the light.
    go('arena', 11, 9)(bot, w);
    go('arena', 11, 10)(bot, w);
    go('arena', 6, 10)(bot, w);
    bot.goTo(...at('arena', 6, 9), { slow: true });
    log('on the dais');
    bot.waitFor(() => bot.on('anzur.defeated'), 'Anzur stopped by the light', 2400);
    bot.waitFor(() => bot.on('door_arena.open'), 'the way on', 600);
    bot.climb('S');
    go('arena', 11, 10)(bot, w);
    go('arena', 11, 1)(bot, w);
    go('arena', 11, 0)(bot, w);
  },
  // 9 · The oculus: up the tiers.
  oculus: (bot, w) => {
    go('oculus', 4, 4)(bot, w);
    go('oculus', 2, 3)(bot, w);
    bot.climb('N');
    bot.climb('N');
    go('oculus', 4, 1)(bot, w);
    go('oculus', 4, 0)(bot, w);
  },
  // 10 · The astrolabe: the last note and the relic.
  astrolabe: (bot, w) => {
    go('astrolabe', 4, 4)(bot, w);
    go('astrolabe', 7, 3)(bot, w);
    bot.action();
    expect(w.stats.notes).toContain('note_warning');
    go('astrolabe', 4, 1)(bot, w);
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
    if (process.env.OBS_DEBUG) console.log(r, 'health', h, '→', w.state.player.health, 'tick', w.tick);
  }
  return bot;
}

describe('The Observatory', () => {
  it('can be finished through every room with all three secrets and no deaths', { timeout: 120_000 }, () => {
    const bot = play(Object.keys(ROOMS));
    expect(bot.w.ended).toBe(true);
    expect(bot.w.stats.secrets).toBe(3);
    expect(bot.w.stats.deaths).toBe(0);
    expect(bot.w.stats.notes).toHaveLength(3);
  });
});

describe('every Observatory puzzle is needed', () => {
  const fresh = (room: string, x: number, z: number, face: Dir = 'N'): { w: World; bot: Bot } => {
    const w = createWorld(level);
    place(w, room, x, z, face);
    return { w, bot: new Bot(w) };
  };
  const doorTarget = (w: World, id: string): number | undefined => findActor(w, id, 'door')?.target;

  it('the dome’s outer ledge is out of reach without the updraught', () => {
    const { w, bot } = fresh('terrace', 9, 2);
    runActions(w, ['up_terrace.off']);
    const y = w.state.player.pos.y;
    bot.climb('N');
    expect(w.state.player.pos.y).toBe(y);
  });

  it('the gallery door needs all three letters of the name', () => {
    const { w, bot } = fresh('gallery', 2, 3);
    bot.turnMirror('W', 3);
    go('gallery', 2, 5)(bot, w);
    bot.turnMirror('W', 4);
    bot.wait(120);
    expect(doorTarget(w, 'door_gallery')).toBe(0);
  });

  it('the first ring’s door opens only when it is aligned, the niche only on the wrong star', () => {
    const { w, bot } = fresh('first_ring', 7, 4);
    bot.wait(60);
    expect(doorTarget(w, 'door_niche')).toBe(0);
    for (let i = 0; i < 3; i++) runActions(w, ['ring_first.turn']);
    bot.wait(60);
    expect(doorTarget(w, 'door_first')).toBe(0);
  });

  it('a block on a full or half moon opens nothing', () => {
    const { w, bot } = fresh('moons', 4, 5);
    bot.push('N');
    bot.push('N');
    bot.wait(120);
    expect(bot.on('plate_half.pressed')).toBe(true);
    expect(doorTarget(w, 'door_moons')).toBe(0);
  });

  it('the horizon’s door stays shut until the mirror sends the ray to the disc', () => {
    const { w, bot } = fresh('horizon', 5, 4);
    bot.wait(120);
    expect(bot.on('disc_horizon.lit')).toBe(false);
    expect(doorTarget(w, 'door_horizon')).toBe(0);
  });

  it('Anzur’s seat is shut in his first phase', () => {
    const { w, bot } = fresh('arena', 11, 2);
    bot.wait(240);
    expect(doorTarget(w, 'gate_seat')).toBe(0);
  });

  it('the oculus stays dark until all three rings are aligned', () => {
    const { w, bot } = fresh('arena', 11, 2);
    runActions(w, ['ring_sky.turn', 'ring_sky.turn', 'ring_moon.turn', 'ring_moon.turn', 'ring_moon.turn']);
    bot.wait(30);
    expect(bot.on('oculus_arena.on')).toBe(false);
    runActions(w, ['ring_horizon.turn']);
    bot.wait(30);
    expect(bot.on('oculus_arena.on')).toBe(true);
  });

  it('the way on stays shut while Anzur stands', () => {
    const { w, bot } = fresh('arena', 11, 2);
    bot.wait(600);
    expect(doorTarget(w, 'door_arena')).toBe(0);
  });
});
