/**
 * The Clay Archive (chamber IV, spec §19): the golden path by the bot with
 * every secret and no deaths, and targeted checks that each puzzle is needed
 * (spec §8 "Principios de diseño de puzles"). Camera yaw is 0: input y+ is
 * north (-Z), x+ is east (+X). Cells are given per room and converted.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/clay_archive.level.json';
import en from '../i18n/en.json';
import { Level } from '../src/sim/grid/level';
import { validateLevel } from '../src/sim/grid/validate';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { createWorld, findActor, type World } from '../src/sim/world';
import { Bot } from './bot';
import { recordGolden } from './golden';
import { frame } from './helpers';
import { damageEnemy } from '../src/sim/actors/enemies';
import { clayGuardian } from '../src/sim/player/tuning';

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

/** Plays the whole level; returns the bot for inspection. */
function playArchive(): Bot {
  const w = createWorld(level);
  const bot = new Bot(w);
  const go = (room: string, x: number, z: number, opts: Parameters<Bot['goTo']>[2] = {}): void =>
    bot.goTo(...at(room, x, z), opts);

  // 1 · Shaft: down from the temple.
  go('shaft', 3, 1);

  // 2 · Reading room: the torch, then the lock (water) from its east side.
  go('reading', 5, 7);
  go('reading', 1, 2);
  go('reading', 1, 1);
  bot.action();
  expect(w.stats.notes).toContain('note_tamrit');
  go('reading', 9, 6);
  bot.action();
  expect(w.state.player.torch.has).toBe(true);
  go('reading', 9, 2);
  bot.action(); // light it at the brazier
  go('reading', 4, 3);
  go('reading', 3, 3);
  bot.turnMirror('W', 2);
  expect(bot.on('lock_reading.set')).toBe(true);
  bot.wait(60);
  go('reading', 5, 1);
  go('reading', 5, 0);

  // 3 · Stacks: pull the shelf from the niche (the jade idol), then push the one in the gap twice.
  go('stacks', 7, 9);
  go('stacks', 3, 6);
  bot.pull('W');
  // The pulled shelf now stands between her and the niche: round it.
  go('stacks', 4, 5);
  go('stacks', 2, 5);
  go('stacks', 2, 6);
  go('stacks', 1, 6);
  bot.action();
  expect(w.stats.secrets).toBe(1);
  go('stacks', 2, 6);
  go('stacks', 2, 5);
  go('stacks', 11, 5);
  go('stacks', 11, 5);
  bot.push('N');
  bot.push('N');
  go('stacks', 12, 3);
  go('stacks', 13, 1);
  go('stacks', 12, 1);
  go('stacks', 12, 0);

  // 4 · Dark gallery: run over each painted slab without stopping; read the names.
  go('gallery', 3, 12);
  go('gallery', 2, 11);
  go('gallery', 2, 10);
  const health = w.state.player.health;
  go('gallery', 2, 7);
  go('gallery', 1, 6);
  bot.action();
  expect(w.stats.notes).toContain('note_names');
  go('gallery', 2, 6);
  go('gallery', 2, 1);
  expect(w.state.player.health).toBe(health);
  go('gallery', 2, 0);

  // 5 · Kiln: the block onto the plate, then the two cylinders (star, reed).
  go('kiln', 6, 9);
  go('kiln', 8, 9);
  bot.push('N');
  bot.push('N');
  expect(findActor(w, 'kiln_plate', 'plate')?.pressed).toBe(true);
  bot.wait(90);
  go('kiln', 7, 6);
  go('kiln', 5, 4);
  go('kiln', 5, 2);
  go('kiln', 2, 2);
  bot.turnMirror('N', 4);
  go('kiln', 8, 2);
  bot.turnMirror('N', 2);
  expect(bot.on('lock_first.set') && bot.on('lock_scribe.set')).toBe(true);
  bot.wait(60);
  go('kiln', 5, 1);
  go('kiln', 5, 0);

  // 6 · Scriptorium: climb to the ledge for the gold idol.
  go('scriptorium', 8, 11);
  go('scriptorium', 11, 4);
  bot.climb('N');
  bot.climb('E');
  go('scriptorium', 13, 2);
  bot.action();
  expect(w.stats.secrets).toBe(2);
  go('scriptorium', 12, 3, { walk: true });
  bot.lowerAndDrop('S');
  go('scriptorium', 2, 1);
  go('scriptorium', 2, 0);

  // 7 · Index: the flood and the fire (water, sun).
  go('index', 4, 7);
  go('index', 3, 3);
  bot.turnMirror('W', 4);
  go('index', 5, 3);
  bot.turnMirror('E', 3);
  expect(bot.on('lock_flood.set') && bot.on('lock_fire.set')).toBe(true);
  bot.wait(60);
  go('index', 4, 1);
  go('index', 4, 0);

  // 8 · Canal: the sluice across the water.
  go('canal', 6, 7);
  go('canal', 7, 5);
  go('canal', 7, 2);
  go('canal', 7, 1);
  go('canal', 7, 6);
  go('canal', 1, 6);
  go('canal', 0, 6);

  // 9 · Tamrit's hall: the low niche first (the stone idol), then up to the ledge and the lever.
  go('tamrit', 11, 11);
  go('tamrit', 11, 3);
  go('tamrit', 11, 2);
  bot.action();
  expect(w.stats.secrets).toBe(3);
  bot.climb('S');
  go('tamrit', 7, 3);
  bot.climb('N');
  bot.climb('W');
  go('tamrit', 2, 1);
  go('tamrit', 1, 1);
  bot.action();
  bot.waitFor(() => bot.on('tamrit.dead'), 'Tamrit dissolved', 2400);
  go('tamrit', 5, 1);
  bot.action();
  expect(w.stats.notes).toContain('note_word');
  go('tamrit', 3, 1);
  bot.wait(120);
  go('tamrit', 3, 0);

  // 10 · Hall of the Name: where to look, when, which way (star, water, sun).
  go('name', 5, 9);
  go('name', 2, 6);
  bot.turnMirror('N', 4);
  go('name', 5, 6);
  bot.turnMirror('N', 1);
  go('name', 8, 6);
  bot.turnMirror('N', 4);
  bot.wait(90);
  go('name', 6, 4);
  go('name', 5, 3);
  go('name', 5, 2);
  go('name', 5, 1);
  bot.action();
  bot.wait(240);
  return bot;
}

describe('The Clay Archive', () => {
  it('validates without errors', () => {
    const { errors } = validateLevel(levelJson, new Set(Object.keys(en)));
    expect(errors).toEqual([]);
  });

  it('can be finished through every room with all three secrets and no deaths', { timeout: 60_000 }, () => {
    const bot = playArchive();
    recordGolden(bot);
    expect(bot.w.ended).toBe(true);
    expect(bot.w.stats.secrets).toBe(3);
    expect(bot.w.stats.deaths).toBe(0);
    expect(bot.w.stats.notes).toHaveLength(3);
  });
});

describe('every Clay Archive puzzle is needed', () => {
  it('the reading-room door stays shut until its cylinder shows water', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'reading', 3, 3, 'W');
    bot.turnMirror('W', 1);
    bot.wait(120);
    const door = findActor(w, 'door_reading', 'door');
    expect(door?.target).toBe(0);
    bot.turnMirror('W', 1);
    bot.wait(120);
    expect(findActor(w, 'door_reading', 'door')?.target).toBe(1);
  });

  it('the kiln mouth needs the block on the plate', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'kiln', 8, 6);
    bot.wait(60);
    expect(findActor(w, 'kiln_mouth', 'door')?.target).toBe(1);
    place(w, 'kiln', 5, 5);
    bot.wait(120);
    expect(findActor(w, 'kiln_mouth', 'door')?.target).toBe(0);
  });

  it('Tamrit reforms after gunfire and only the flood ends him', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    // Safe on the ledge, in Tamrit's sight.
    place(w, 'tamrit', 4, 2, 'S');
    bot.wait(240);
    const t = w.state.enemies.find((e) => e.id === 'tamrit');
    expect(t?.aware).toBe(true);
    // Shot to pieces, he rises again.
    if (t) damageEnemy(w, t, 99);
    expect(t?.mode).toBe('dead');
    bot.wait(Math.ceil(clayGuardian.reform * 60) + 30);
    expect(t?.mode).not.toBe('dead');
    // Lever not pulled: the door to the Hall of the Name stays shut.
    expect(findActor(w, 'door_tamrit', 'door')?.target).toBe(0);
    for (let i = 0; i < 600 && t && !t.dissolved; i++) bot.tick(frame());
    expect(t?.dissolved).not.toBe(true);
  });

  it('the Tablet of the Name stays behind its gate until all three cylinders are set', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'name', 2, 6);
    bot.turnMirror('N', 4);
    place(w, 'name', 5, 6);
    bot.turnMirror('N', 1);
    bot.wait(120);
    expect(findActor(w, 'gate_name', 'door')?.target).toBe(0);
  });
});
