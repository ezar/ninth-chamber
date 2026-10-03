/**
 * The Bronze Forge (chamber VI, spec §19): the golden path by the bot with
 * every secret and no deaths, and targeted checks that each puzzle is needed
 * (spec §8 "Principios de diseño de puzles"). Camera yaw is 0: input y+ is
 * north (-Z), x+ is east (+X). Cells are given per room and converted.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/bronze_forge.level.json';
import en from '../i18n/en.json';
import { Level } from '../src/sim/grid/level';
import { validateLevel } from '../src/sim/grid/validate';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
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

const pour = (w: World, id: string) => {
  const s = w.state.mechanisms.pours.find((p) => p.id === id);
  if (!s) throw new Error(`no pour ${id}`);
  return s;
};

/** Plays the whole level; returns the bot for inspection. */
function playForge(): Bot {
  const w = createWorld(level);
  const bot = new Bot(w);
  const go = (room: string, x: number, z: number, opts: Parameters<Bot['goTo']>[2] = {}): void =>
    bot.goTo(...at(room, x, z), opts);
  const cellIs = (room: string, x: number, z: number): boolean => {
    const [cx, cz] = at(room, x, z);
    return Math.floor(w.state.player.pos.x / 2) === cx && Math.floor(w.state.player.pos.z / 2) === cz;
  };

  // 1 · The gallery of moulds: the first note and a pack of flares.
  go('moulds', 1, 3);
  bot.action();
  expect(w.stats.notes).toContain('note_seals');
  go('moulds', 7, 1);
  expect(w.state.inventory.flare).toBe(2);
  go('moulds', 4, 1);
  go('moulds', 4, 0);

  // 2 · The first pour: the lever, then across the bridge once it is dark.
  go('first_pour', 4, 8);
  go('first_pour', 1, 7);
  bot.action();
  bot.waitFor(() => bot.on('pour_first.cast'), 'the first bridge cast', 900);
  go('first_pour', 4, 6);
  go('first_pour', 4, 1);
  go('first_pour', 4, 0);

  // 3 · The bellows. First the jade idol: a flare lights the cold forge by the niche.
  go('bellows', 4, 7);
  go('bellows', 2, 4);
  bot.lightFlare();
  go('bellows', 1, 4);
  bot.waitFor(() => bot.on('forge_mould.lit'), 'the mould forge lit', 120);
  bot.wait(90);
  go('bellows', 3, 2);
  go('bellows', 2, 2);
  go('bellows', 1, 2);
  bot.action();
  expect(w.stats.secrets).toBe(1);
  // Then the bellows: east three times, north four times onto the plate.
  go('bellows', 2, 2);
  go('bellows', 3, 3);
  go('bellows', 2, 6);
  bot.push('E');
  bot.push('E');
  bot.push('E');
  go('bellows', 5, 7);
  go('bellows', 6, 7);
  bot.push('N');
  bot.push('N');
  bot.push('N');
  bot.push('N');
  expect(bot.on('forge_main.lit')).toBe(true);
  bot.wait(90);
  go('bellows', 5, 2);
  go('bellows', 4, 1);
  go('bellows', 4, 0);

  // 4 · The main channel: sluice A, sluice B, and C to the hidden ledge (the stone idol).
  go('canal', 5, 12);
  go('canal', 1, 12);
  bot.action();
  bot.waitFor(() => bot.on('pour_a.cast'), 'bridge A cast', 900);
  go('canal', 3, 11);
  go('canal', 3, 7);
  go('canal', 1, 7);
  bot.action();
  go('canal', 9, 6);
  bot.action();
  bot.waitFor(() => bot.on('pour_b.cast') && bot.on('pour_c.cast'), 'bridges B and C cast', 900);
  go('canal', 1, 6);
  go('canal', 1, 1);
  bot.action();
  expect(w.stats.secrets).toBe(2);
  go('canal', 1, 6);
  go('canal', 6, 6);
  go('canal', 6, 2);
  go('canal', 5, 1);
  go('canal', 5, 0);

  // 5 · The workshop: the second note, then the founder's key, which wakes the automaton.
  go('workshop', 5, 9);
  go('workshop', 9, 3);
  go('workshop', 9, 1);
  bot.action();
  expect(w.stats.notes).toContain('note_worker');
  go('workshop', 5, 3);
  bot.action();
  expect(w.state.inventory.founder_key).toBe(1);
  go('workshop', 5, 1);
  go('workshop', 5, 0);

  // 6 · The quench pit: up on the ledge, let it come in, flood the room.
  go('quench', 5, 9);
  go('quench', 1, 9);
  go('quench', 1, 3);
  const a1 = w.state.enemies.find((e) => e.id === 'a1');
  bot.waitFor(
    () => !!a1 && Math.floor(a1.pos.z / 2) <= at('quench', 0, 9)[1],
    'the automaton in the pit',
    1800,
  );
  bot.climb('N');
  expect(cellIs('quench', 1, 2)).toBe(true);
  go('quench', 1, 1);
  bot.waitFor(() => !!a1 && Math.floor(a1.pos.z / 2) <= at('quench', 0, 6)[1], 'the automaton below', 900);
  bot.action();
  bot.waitFor(() => bot.on('a1.dead'), 'the automaton quenched', 1800);
  bot.wait(90);
  go('quench', 5, 1);
  go('quench', 5, 0);

  // 7 · The furnaces: the gold idol up the vent first, then shade to shade between the jets.
  go('furnaces', 5, 10);
  go('furnaces', 9, 10);
  bot.climb('N');
  bot.climb('N');
  bot.climb('N');
  bot.action();
  expect(w.stats.secrets).toBe(3);
  bot.lowerAndDrop('S');
  bot.lowerAndDrop('S');
  bot.lowerAndDrop('S');
  go('furnaces', 5, 7);
  const between = (fire: string): void => {
    bot.waitFor(() => bot.on(`${fire}.burning`), `${fire} burning`, 400);
    bot.waitFor(() => !bot.on(`${fire}.burning`), `${fire} out`, 400);
  };
  between('fire_low');
  go('furnaces', 5, 4);
  between('fire_high');
  go('furnaces', 5, 1);
  go('furnaces', 5, 0);

  // 8 · The bronze bridge: wait for it to go dark, then run straight across.
  go('bridge', 4, 8);
  go('bridge', 4, 7);
  bot.waitFor(() => pour(w, 'pour_bridge').phase === 'solid', 'the bridge dark', 1800);
  go('bridge', 4, 1);
  go('bridge', 4, 0);

  // 9 · Bazûr: up on the ledge, pour the gutter on it below, twice.
  go('casting', 6, 11);
  go('casting', 1, 3);
  go('casting', 1, 2);
  bot.climb('N');
  expect(cellIs('casting', 1, 1)).toBe(true);
  const bazur = w.state.guardians[0];
  const below = (): boolean => {
    if (!bazur) return false;
    const [gx, gz] = [Math.floor(bazur.pos.x / 2), Math.floor(bazur.pos.z / 2)];
    const [lx, lz] = at('casting', 1, 2);
    return gz === lz && gx - lx <= 2 && bazur.mode !== 'stunned';
  };
  bot.waitFor(below, 'Bazûr below the ledge', 1800);
  bot.action();
  bot.waitFor(() => bot.on('bazur.phase2'), 'Bazûr cooled once', 600);
  bot.waitFor(() => !!bazur && bazur.immune <= 0 && below(), 'Bazûr below again', 2400);
  bot.action();
  bot.waitFor(() => bot.on('bazur.defeated'), 'Bazûr defeated', 600);
  bot.wait(120);
  go('casting', 6, 1);
  go('casting', 6, 0);

  // 10 · The mould: the third note, the key in the lock, the segment once it is cast.
  go('mould', 4, 7);
  go('mould', 7, 3);
  bot.action();
  expect(w.stats.notes).toContain('note_ninth');
  go('mould', 7, 6);
  go('mould', 1, 6);
  go('mould', 1, 4);
  bot.action();
  bot.waitFor(() => bot.on('pour_mould.cast'), 'the segment cast', 900);
  bot.wait(90);
  go('mould', 4, 3);
  go('mould', 4, 1);
  bot.action();
  bot.wait(240);
  return bot;
}

describe('The Bronze Forge', () => {
  it('validates without errors', () => {
    const { errors } = validateLevel(levelJson, new Set(Object.keys(en)));
    expect(errors).toEqual([]);
  });

  it('can be finished through every room with all three secrets and no deaths', { timeout: 120_000 }, () => {
    const bot = playForge();
    expect(bot.w.ended).toBe(true);
    expect(bot.w.stats.secrets).toBe(3);
    expect(bot.w.stats.deaths).toBe(0);
    expect(bot.w.stats.notes).toHaveLength(3);
  });
});

describe('every Bronze Forge puzzle is needed', () => {
  it('the first cut cannot be crossed before the pour', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'first_pour', 4, 6);
    expect(() => bot.goTo(...at('first_pour', 4, 2), { max: 300 })).toThrow();
  });

  it('the bellows door stays shut until the forge is lit', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'bellows', 4, 3);
    bot.wait(120);
    expect(findActor(w, 'door_bellows', 'door')?.target).toBe(0);
  });

  it('the quench pit door opens only when the automaton is gone', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'quench', 1, 3);
    bot.climb('N');
    bot.wait(240);
    expect(findActor(w, 'door_quench', 'door')?.target).toBe(0);
  });

  it('the casting hall door stays shut while Bazûr stands', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'casting', 6, 11);
    bot.wait(240);
    expect(findActor(w, 'door_casting', 'door')?.target).toBe(0);
  });

  it('the mould gate opens only once the segment is cast', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'mould', 4, 4);
    bot.wait(240);
    expect(findActor(w, 'gate_mould', 'door')?.target).toBe(0);
  });
});
