/**
 * The Ninth Chamber (chamber IX, spec §19): the golden path by the bot to
 * each ending with every secret and no deaths, the conjunction timer's run
 * and its checkpoints, and checks that each puzzle is needed. Camera yaw is
 * 0: input y+ is north (-Z), x+ is east (+X). Cells are given per room
 * (local) and converted to world cells.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/ninth_chamber.level.json';
import { TICK_DT } from '../src/core/loop';
import { Level } from '../src/sim/grid/level';
import { reachableCells, key } from '../src/sim/grid/reach';
import { validateLevel } from '../src/sim/grid/validate';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { runActions } from '../src/sim/logic/rules';
import { tangle as T } from '../src/sim/player/tuning';
import { createWorld, findActor, respawn, type World } from '../src/sim/world';
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

/** Puts the player on the ground at the centre of a room cell. */
function place(w: World, room: string, x: number, z: number, face: Dir = 'N'): void {
  const [cx, cz] = at(room, x, z);
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = DIR_YAW[face];
  p.mode = 'ground';
}

const seconds = (s: number): number => Math.ceil(s / TICK_DT);

/** Plays from the start to the seal room; returns the bot standing before the seal. */
function playToSeal(): Bot {
  const w = createWorld(level);
  const bot = new Bot(w);
  const go = (room: string, x: number, z: number, opts: Parameters<Bot['goTo']>[2] = {}): void =>
    bot.goTo(...at(room, x, z), opts);
  const heal = (): void => {
    if (bot.p.health < 60 || bot.p.poison > 0) bot.tick(frame({ pressed: ['medkit'] }));
  };

  // 1 · The crack of the ray: the five keys.
  // The name written with light: the mirror sends the ray to the disc.
  go('ray', 6, 5);
  bot.turnMirror('N', 3);
  bot.waitFor(() => bot.on('disc_name.lit'), 'the disc of the name', 300);
  // The bronze segment: the lever pours it into its mould.
  go('ray', 6, 8);
  go('ray', 9, 8);
  bot.action();
  go('ray', 6, 8);
  // The shell's note.
  go('ray', 1, 2);
  bot.action();
  // The astrolabe's moment: two pulls set the ring to its mark.
  go('ray', 1, 6);
  bot.action();
  bot.action();
  bot.waitFor(() => bot.on('pour_segment.cast'), 'the segment cast', 900);
  // The seed parts the roots.
  bot.waitFor(() => bot.on('tg_door.open'), 'the roots parted', seconds(T.shrinkTime) + 60);
  go('ray', 5, 1);
  go('ray', 5, 0);

  // 2 · The antechamber of the eight: the promise and Elena's letter.
  go('eight', 5, 9);
  go('eight', 1, 5);
  bot.action();
  expect(w.stats.notes).toContain('note_promise');
  go('eight', 5, 7);
  go('eight', 5, 6);
  bot.action();
  expect(w.stats.notes).toContain('note_letter');
  go('eight', 4, 6);
  go('eight', 4, 1);
  go('eight', 5, 1);
  go('eight', 5, 0);

  // 3 · The dome: two pulls set the ring.
  go('dome', 4, 6);
  go('dome', 7, 5);
  bot.action();
  bot.action();
  bot.waitFor(() => bot.on('door_dome.open'), 'the dome door', 600);
  go('dome', 4, 1);
  go('dome', 4, 0);

  // 4 · The wind: up the step on the updraught.
  go('wind', 4, 5);
  go('wind', 4, 3);
  bot.climb('N');
  go('wind', 4, 1);
  go('wind', 4, 0);

  // 5 · The bronze: pour the bridge and cross it.
  go('bronze', 4, 6);
  go('bronze', 1, 6);
  bot.action();
  bot.waitFor(() => bot.on('pour_bridge.cast'), 'the bridge cast', 900);
  go('bronze', 4, 5);
  go('bronze', 4, 1);
  go('bronze', 4, 0);

  // 6 · The roots: the burning torch, up the wall, the tangle gives way to it.
  go('roots', 2, 6);
  bot.action();
  expect(bot.p.torch.has && bot.p.torch.lit).toBe(true);
  go('roots', 4, 4);
  bot.getOnWall('N');
  bot.climbWall('N');
  go('roots', 4, 2);
  bot.wait(seconds(T.shrinkTime) + 10);
  expect(w.state.signals['tg_roots.open']).toBe(true);
  go('roots', 4, 1);
  go('roots', 4, 0);

  // 7 · The glyphs: run the slabs, then the lock.
  go('glyphs', 4, 10);
  const health = bot.p.health;
  go('glyphs', 4, 3);
  expect(bot.p.health).toBe(health);
  go('glyphs', 3, 2);
  bot.turnMirror('W', 3);
  bot.waitFor(() => bot.on('door_glyphs.open'), 'the glyph door', 600);
  go('glyphs', 4, 1);
  go('glyphs', 4, 0);

  // 8 · The mirrors: the timer starts. Two turns open the niche (stone idol), one more the door.
  go('mirrors', 5, 6);
  expect(w.state.timer).not.toBeNull();
  go('mirrors', 5, 3);
  bot.turnMirror('W', 2);
  bot.waitFor(() => bot.on('door_niche.open'), 'the niche', 600);
  go('mirrors', 8, 6);
  go('mirrors', 10, 6);
  bot.action();
  expect(w.stats.secrets).toBe(1);
  go('mirrors', 5, 3);
  bot.turnMirror('W', 1);
  bot.waitFor(() => bot.on('door_mirrors.open'), 'the mirror door', 600);
  go('mirrors', 6, 2);
  go('mirrors', 5, 1);
  go('mirrors', 5, 0);

  // 9 · The water: the sluice floods the hall; the ledge (jade idol), then the way out.
  go('water', 4, 6);
  go('water', 2, 6);
  bot.action();
  bot.waitMode('swim', 1500);
  bot.waitWater('water', 1500);
  bot.swimTo(...at('water', 7, 2));
  bot.climbOut('E');
  bot.action();
  expect(w.stats.secrets).toBe(2);
  bot.wadeIn('W');
  bot.swimTo(...at('water', 4, 1));
  bot.climbOut('N');
  go('water', 4, 0);

  // 10 · The sand: the jackals, the block onto the plate, the niche (gold idol), the floor at a run.
  go('sand', 5, 9);
  bot.fight('sand');
  heal();
  go('sand', 3, 9);
  bot.push('N');
  bot.push('N');
  bot.waitFor(() => bot.on('door_sand.open'), 'the sand door', 600);
  go('sand', 1, 7);
  bot.climb('W');
  bot.action();
  expect(w.stats.secrets).toBe(3);
  go('sand', 1, 7);
  go('sand', 5, 5);
  go('sand', 5, 1);
  go('sand', 5, 0);

  // 11 · The seal.
  go('seal', 6, 8);
  expect(w.state.timer).toBeNull();
  go('seal', 6, 2);
  return bot;
}

describe('The Ninth Chamber', () => {
  it('passes the level validator, reachability included', () => {
    const { errors, warnings } = validateLevel(levelJson);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('carving her name at the seal ends the campaign as its keeper, with every secret and no deaths', () => {
    const bot = playToSeal();
    const w = bot.w;
    expect(w.stats.secrets).toBe(3);
    expect(w.stats.deaths).toBe(0);
    bot.goTo(...at('seal', 6, 1));
    bot.action();
    expect(w.state.signals['seal_ninth.used']).toBe(true);
    bot.wait(seconds(4));
    recordGolden(bot);
    expect(w.ended).toBe(true);
    expect(w.ending).toBe('keeper');
  });

  it('walking out leaves the segment blank, as her grandmother did', () => {
    const bot = playToSeal();
    const w = bot.w;
    bot.goTo(...at('seal', 11, 5));
    bot.goTo(...at('seal', 15, 5));
    run(w, frame(), seconds(3));
    expect(w.ended).toBe(true);
    expect(w.ending).toBe('blank');
  });

  it('the way on from the crack stays shut until all five keys are given', () => {
    const w = createWorld(level);
    // Four of the five: the ring is left one turn short of its mark.
    runActions(w, [
      'pour_segment.pour',
      'wind_voice.on',
      'ring_moment.turn',
      'mirror_name.turn',
      'mirror_name.turn',
      'mirror_name.turn',
    ]);
    w.state.signals['lever_voice.used'] = true;
    place(w, 'ray', 5, 3);
    run(w, frame(), seconds(12));
    expect(w.state.signals['disc_name.lit']).toBe(true);
    expect(w.state.signals['pour_segment.cast']).toBe(true);
    expect(w.state.signals['tg_door.open']).not.toBe(true);
    runActions(w, ['ring_moment.turn']);
    run(w, frame(), seconds(T.shrinkTime) + 30);
    expect(w.state.signals['tg_door.open']).toBe(true);
  });

  it('the wind room’s step is out of reach without the updraught', () => {
    const lv = Level.parse({
      ...levelJson,
      entities: levelJson.entities.filter((e) => e.id !== 'updraught'),
    });
    expect(reachableCells(lv).has(key(...at('bronze', 4, 6)))).toBe(false);
  });

  it('the bronze trench cannot be crossed without its bridge', () => {
    const lv = Level.parse({
      ...levelJson,
      entities: levelJson.entities.filter((e) => e.id !== 'pour_bridge'),
    });
    expect(reachableCells(lv).has(key(...at('roots', 4, 6)))).toBe(false);
  });

  it('the way out of the water hall is out of reach without the flood', () => {
    const lv = Level.parse({
      ...levelJson,
      entities: levelJson.entities.filter((e) => e.id !== 'gate_water'),
    });
    expect(reachableCells(lv).has(key(...at('sand', 5, 9)))).toBe(false);
  });

  it('the sand door stays shut until the block is on the plate', () => {
    const w = createWorld(level);
    place(w, 'sand', 3, 7);
    run(w, frame(), 120);
    expect(findActor(w, 'door_sand', 'door')?.target).toBe(0);
  });

  it('when the timer runs out she goes back to the last checkpoint, with time to finish', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 'mirrors', 5, 6);
    run(w, frame(), 2);
    expect(w.state.timer).not.toBeNull();
    place(w, 'mirrors', 2, 2);
    for (let i = 0; i < seconds(250) && w.state.player.mode !== 'dead'; i++) run(w, frame(), 1);
    expect(w.state.player.mode).toBe('dead');
    respawn(w);
    expect(w.state.timer?.left).toBeGreaterThanOrEqual(60);
    expect(bot.where()).toContain(String(at('mirrors', 5, 6)[0]));
  });
});
