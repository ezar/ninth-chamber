/**
 * The Temple of the Sun: the bot plays the whole level (every room, the
 * three secrets and the three journal notes, the guardian defeated, no
 * deaths), then targeted checks prove each puzzle is needed and never dead
 * ends (spec §8 "Principios de diseño de puzles"). Camera yaw is 0, so input
 * y+ is north (-Z) and x+ is east (+X). Cells are world cells: each room's
 * origin is noted where the route enters it.
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/sun_temple.level.json';
import en from '../i18n/en.json';
import { Level } from '../src/sim/grid/level';
import { validateLevel } from '../src/sim/grid/validate';
import { TICK_DT } from '../src/core/loop';
import { DIR_YAW, type Dir } from '../src/sim/grid/units';
import { signal } from '../src/sim/logic/rules';
import { bladePose } from '../src/sim/mechanisms/traps';
import type { Facing4 } from '../src/sim/mechanisms/types';
import { killPlayer } from '../src/sim/player/context';
import { createWorld, saveCheckpoint, stepWorld, type World } from '../src/sim/world';
import { Bot } from './bot';
import { recordGolden } from './golden';
import { frame, run, runUntil } from './helpers';

const level = Level.parse(levelJson);
const guardian = (w: World) => {
  const g = w.state.guardians[0];
  if (!g) throw new Error('no guardian');
  return g;
};
const cellOf = (m: number): number => Math.floor(m / 2);
const secs = (s: number): number => Math.round(s / TICK_DT);

/** Waits for the blade to sweep through the bottom of its arc, then runs to the next safe cell. */
function passBlade(bot: Bot, id: string, cx: number, cz: number): void {
  let last = bladePose(bot.w, id).angle;
  let swept = false;
  for (let i = 0; i < 300 && !swept; i++) {
    bot.tick();
    const now = bladePose(bot.w, id).angle;
    swept = Math.sign(now) !== Math.sign(last);
    last = now;
  }
  expect(swept, `a swing of ${id}`).toBe(true);
  bot.goTo(cx, cz);
}

/** Waits for a column of fire to die down, then runs across it. */
function passFire(bot: Bot, id: string, cx: number, cz: number): void {
  const phase = (): string => bot.w.state.mechanisms.fires.find((f) => f.id === id)?.phase ?? '';
  bot.waitFor(() => phase() === 'burn', `${id} to burn`);
  bot.waitFor(() => phase() === 'idle', `${id} to die down`);
  bot.goTo(cx, cz);
}

export function playSunTemple(): Bot {
  const w = createWorld(level);
  const bot = new Bot(w);

  // 1 · Sun Court (origin 0, 0). The gold idol on the high ledge in the north-east corner.
  bot.goTo(12, 4);
  bot.climb('N');
  bot.climb('N');
  bot.goTo(12, 1, { walk: true });
  bot.action();
  expect(w.stats.secrets).toBe(1);
  bot.goTo(12, 2, { walk: true });
  bot.goTo(12, 3, { slow: true });
  bot.goTo(12, 4, { slow: true });
  bot.goTo(11, 6);
  bot.goTo(1, 8);
  bot.goTo(-1, 8);

  // 2 · Hall of Mirrors (origin -14, 2). The first mirror: three quarter turns send the sun to the disc over gate A.
  bot.goTo(-3, 7);
  bot.goTo(-3, 6);
  bot.action(); // the carving on the mirror's plinth
  bot.goTo(-4, 7);
  bot.turnMirror('N', 3);
  expect(bot.on('disc_a.lit')).toBe(true);
  bot.waitFor(() => bot.on('gate_a.open'), 'gate A');
  bot.goTo(-8, 7);
  // Two mirrors pass the sky beam to the disc by gate B.
  bot.goTo(-10, 11);
  bot.turnMirror('S', 2);
  bot.goTo(-10, 5);
  bot.turnMirror('N', 2);
  expect(bot.on('disc_b.lit')).toBe(true);
  // Elena's letter, tucked behind the last drum.
  bot.goTo(-9, 5);
  bot.goTo(-9, 3);
  bot.goTo(-10, 3);
  bot.action();
  bot.goTo(-9, 3);
  bot.goTo(-9, 5);
  bot.goTo(-12, 5);
  bot.waitFor(() => bot.on('gate_b.open'), 'gate B');
  bot.goTo(-12, 3);
  bot.goTo(-12, 1);

  // 3 · The Lift Well (origin -14, -10). The ferry's middle stop is the way to the jade idol.
  bot.goTo(-12, 0);
  bot.goTo(-5, -1);
  bot.waitFor(() => bot.on('ferry.at0'), 'the ferry');
  bot.goTo(-5, -2, { walk: true });
  bot.waitFor(() => bot.on('ferry.at1'), 'the ferry mid-way');
  bot.climb('E');
  bot.action();
  expect(w.stats.secrets).toBe(2);
  bot.lowerAndDrop('S');
  bot.climb('S');
  bot.goTo(-5, -1);
  bot.waitFor(() => bot.on('ferry.at0'), 'the ferry back');
  bot.goTo(-5, -2, { walk: true });
  bot.waitFor(() => bot.on('ferry.at2'), 'the far side');
  bot.goTo(-5, -5, { walk: true });
  // The lift up to the gallery.
  bot.goTo(-8, -6);
  bot.waitFor(() => bot.on('lift.at0'), 'the lift');
  bot.goTo(-8, -7, { walk: true });
  bot.waitFor(() => bot.on('lift.at1'), 'the top');
  bot.goTo(-8, -8, { walk: true });
  bot.goTo(-13, -9);
  bot.goTo(-15, -9);

  // 4 · Vault of the Ray (origin -24, -12).
  bot.goTo(-20, -8);
  bot.action();
  expect(w.state.inventory.bronze_ray).toBe(1);
  bot.goTo(-20, -11);

  // 5 · Boulder Ramp (origin -22, -27): run from the boulder and duck into the alcove at the end.
  bot.goTo(-20, -13);
  bot.goTo(-20, -25);
  bot.goTo(-21, -25);
  expect(
    bot.on('boulder.rolling') || bot.on('boulder.done') || w.state.mechanisms.boulders[0]?.mode === 'warning',
  ).toBe(true);
  bot.waitFor(() => bot.on('boulder.done'), 'the boulder to crash');
  bot.goTo(-21, -27);

  // 6 · Hall of Blades (origin -23, -42): one blade at a time.
  bot.goTo(-21, -31);
  bot.goTo(-21, -33);
  passBlade(bot, 'blade_1', -21, -35);
  passBlade(bot, 'blade_2', -21, -37);
  passBlade(bot, 'blade_3', -21, -39);
  bot.goTo(-21, -40);
  bot.goTo(-16, -40);

  // 7 · Court of Embers (origin -15, -50): across the fire to the slot, and back to the Sun Door.
  bot.goTo(-13, -40);
  passFire(bot, 'fire_1', -9, -40);
  passFire(bot, 'fire_2', -6, -40);
  passFire(bot, 'fire_3', -3, -40);
  bot.goTo(-2, -44);
  bot.action();
  expect(bot.on('slot_sun.filled')).toBe(true);
  bot.goTo(-3, -40);
  passFire(bot, 'fire_3', -6, -40);
  passFire(bot, 'fire_2', -9, -40);
  passFire(bot, 'fire_1', -12, -40);
  bot.waitFor(() => bot.on('sun_door.open'), 'the Sun Door');
  bot.goTo(-13, -39);
  bot.goTo(-13, -37);

  // 8 · Court of Rays (origin -15, -37): ride the shuttle and turn both mirrors from it.
  bot.goTo(-13, -27);
  bot.waitFor(() => bot.on('shuttle.at0'), 'the shuttle');
  bot.goTo(-12, -27, { walk: true });
  bot.waitFor(() => bot.on('shuttle.at1'), 'the north mirror stop');
  bot.turnMirror('N', 1);
  bot.waitFor(() => bot.on('shuttle.at2'), 'the south mirror stop');
  bot.turnMirror('S', 3);
  bot.waitFor(() => bot.on('disc_north.lit') && bot.on('disc_south.lit'), 'both discs');
  bot.waitFor(() => bot.on('shuttle.at3'), 'the east stop');
  bot.goTo(-3, -27, { walk: true });
  // The stone idol: a running jump to the ledge in the north-east corner, and back.
  bot.goTo(-3, -29);
  bot.runningJump('N', -64);
  bot.goTo(-2, -36);
  bot.action();
  expect(w.stats.secrets).toBe(3);
  bot.goTo(-3, -36);
  for (let i = 0; i < 20; i++) bot.tick(frame({ y: 1, held: ['walk'] }));
  bot.runningJump('S', -68);
  bot.goTo(-3, -27);
  bot.waitFor(() => bot.on('gate_rays.open'), 'the gate');
  bot.goTo(-1, -27);

  // 9 · Hall of the Guardian (origin 0, -30).
  bot.goTo(1, -27);
  bot.goTo(1, -24);
  // It crosses the bridge towards the lever and winds up on it: pull.
  bot.waitFor(() => guardian(w).mode === 'windup', 'the guardian to wind up');
  expect(cellOf(guardian(w).pos.x)).toBe(1);
  bot.action();
  bot.waitFor(
    () => guardian(w).mode === 'chase' && guardian(w).phase === 2,
    'the guardian back from the pit',
  );
  // Draw it east along the far side, then run back over the bridge and up to the balcony.
  bot.goTo(12, -25);
  bot.waitFor(() => cellOf(guardian(w).pos.x) >= 11, 'the guardian to follow');
  bot.goTo(1, -25);
  bot.goTo(1, -21);
  bot.goTo(2, -20);
  bot.climb('S');
  bot.climb('S');
  bot.goTo(5, -18, { walk: true });
  bot.waitFor(() => guardian(w).mode === 'recover' && guardian(w).pound, 'the guardian to pound the wall');
  for (let i = 0; i < 25; i++) bot.tick(frame({ y: 0.8 }));
  for (let i = 0; i < 120 && bot.p.mode !== 'ground'; i++) bot.tick();
  bot.waitMode('ground');
  expect(guardian(w).mode).toBe('defeated');
  // Its pedestal carving, then back up to the open door.
  bot.goTo(6, -20);
  bot.action();
  bot.goTo(2, -20);
  bot.climb('S');
  bot.climb('S');
  bot.waitFor(() => bot.on('gate_sanctum.open'), 'the sanctuary door');
  bot.goTo(6, -18, { walk: true });
  bot.goTo(6, -16);

  // 10 · Sanctuary of the Sun (origin 3, -16): the Sun Disc on its dais.
  bot.goTo(6, -7);
  bot.goTo(6, -6);
  bot.climb('S');
  bot.goTo(6, -5, { walk: true });
  bot.action();
  bot.wait(240);
  return bot;
}

describe('The Temple of the Sun', () => {
  it('validates without errors or warnings', () => {
    const { errors, warnings } = validateLevel(levelJson, new Set(Object.keys(en)));
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('can be finished through every room with every secret and note, the guardian defeated and no deaths', () => {
    const bot = playSunTemple();
    recordGolden(bot);
    const w = bot.w;
    expect(w.ended).toBe(true);
    expect(w.stats.deaths).toBe(0);
    expect(w.stats.secrets).toBe(3);
    expect(w.stats.notes).toHaveLength(3);
    expect(guardian(w).mode).toBe('defeated');
    expect([...bot.rooms].sort()).toEqual(level.rooms.map((r) => r.id).sort());

    // The score follows the run (docs/audio.md): a vista at the mirrors, the
    // chase for the boulder, tension through the traps, the boss fight, and
    // calm after each; a checkpoint comes before every trap and the guardian.
    const cue: string[] = [];
    for (const e of w.events.drain()) {
      if (e.type === 'music') cue.push(String(e.name));
      if (e.type === 'boulder.warning') cue.push('(boulder)');
      if (e.type === 'guardian.woke') cue.push('(guardian)');
      if (e.type === 'checkpoint') cue.push('checkpoint');
    }
    const musicOnly = cue.filter((c) => c !== 'checkpoint' && !c.startsWith('('));
    expect(musicOnly).toEqual([
      'vista',
      'chase',
      'calm',
      'tension',
      'tension',
      'calm',
      'boss',
      'calm',
      'hall',
      'relic',
      'fanfare',
    ]);
    const before = (marker: string): string | undefined => {
      const at = cue.indexOf(marker);
      return cue
        .slice(0, at)
        .filter((c) => c === 'checkpoint' || !c.startsWith('('))
        .pop();
    };
    expect(before('(boulder)')).toBe('checkpoint');
    expect(before('(guardian)')).toBe('checkpoint');
    expect(before('tension')).toBe('checkpoint');
  }, 60_000);

  it('hides Elena’s 1989 letter behind a mirror and keeps the journal keys', () => {
    const notes = level.entities.filter((e) => e.type === 'note');
    expect(notes.map((n) => (n.type === 'note' ? n.text : '')).sort()).toEqual([
      'journal.sun_temple.1',
      'journal.sun_temple.2',
      'journal.sun_temple.3',
    ]);
    const letter = notes.find((n) => n.type === 'note' && n.text === 'journal.sun_temple.3');
    expect(letter?.type === 'note' && letter.style).toBe('letter');
    const mirrors = level.entities.filter((e) => e.type === 'mirror' && e.room === letter?.room);
    const [lx, lz] = letter?.at ?? [0, 0];
    expect(mirrors.some((m) => Math.abs(m.at[0] - lx) + Math.abs(m.at[1] - lz) === 1)).toBe(true);
  });
});

/** Puts Nora on the ground at the centre of a world cell. */
function place(w: World, cx: number, cz: number, face: Dir = 'N'): void {
  const p = w.state.player;
  p.pos = { x: cx * 2 + 1, y: w.grid.cellFloor(cx, cz), z: cz * 2 + 1 };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = DIR_YAW[face];
  p.mode = 'ground';
}

function setMirror(w: World, id: string, facing: number): void {
  const m = w.state.mechanisms.mirrors.find((x) => x.id === id);
  if (!m) throw new Error(`no mirror ${id}`);
  m.facing = facing as Facing4;
}

const FACINGS = [0, 1, 2, 3] as const;

describe('The Temple of the Sun: every puzzle is needed and none dead-ends', () => {
  it('each gate of the Hall of Mirrors opens for one arrangement of its mirrors only', () => {
    const w = createWorld(level);
    run(w, frame(), 2);
    expect(signal(w, 'disc_a.lit') || signal(w, 'disc_b.lit')).toBe(false);
    expect(w.grid.cellFloor(-8, 7)).toBe(Infinity);
    const litA = FACINGS.filter((f) => {
      setMirror(w, 'mirror_a', f);
      run(w, frame(), 1);
      return signal(w, 'disc_a.lit');
    });
    expect(litA).toEqual([3]); // NW
    const litB: string[] = [];
    for (const b of FACINGS)
      for (const c of FACINGS) {
        setMirror(w, 'mirror_b', b);
        setMirror(w, 'mirror_c', c);
        run(w, frame(), 1);
        if (signal(w, 'disc_b.lit')) litB.push(`${b},${c}`);
      }
    expect(litB).toEqual(['3,2']); // NW, SW
  });

  it('the ferry pit is too wide to jump, and falling in only costs a climb', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, -10, 0);
    bot.runningJump('N', -2);
    expect(bot.p.pos.y).toBeCloseTo(-1.5, 5);
    expect(w.stats.deaths).toBe(0);
    bot.goTo(-10, -4);
    bot.climb('N');
    expect(bot.p.pos.y).toBe(0);
    expect(Math.floor(bot.p.pos.z / 2)).toBe(-5);
  });

  it('only the lift reaches the gallery, and it comes back down for her', () => {
    const w = createWorld(level);
    for (let x = -13; x <= -7; x++) {
      for (const [dx, dz] of [
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const f = w.grid.cellFloor(x + dx, -8 + dz);
        const lift = x + dx === -8 && -8 + dz === -7;
        if (!lift && Number.isFinite(f)) expect(f, `${x + dx},${-8 + dz}`).toBeGreaterThanOrEqual(6 - 1e-9);
      }
    }
    // While the lift is up its shaft is closed off below (the slab's column is solid): she waits for it.
    const bot = new Bot(w);
    bot.waitFor(() => signal(w, 'lift.at1'), 'the lift at the top');
    place(w, -8, -6);
    for (let i = 0; i < 60; i++) bot.tick(frame({ y: 1 }));
    expect(Math.floor(bot.p.pos.z / 2)).toBe(-6);
    bot.waitFor(() => signal(w, 'lift.at0'), 'the lift back down', 900);
    bot.goTo(-8, -7, { walk: true });
    bot.waitFor(() => signal(w, 'lift.at1'), 'the ride up', 900);
    expect(bot.p.pos.y).toBeCloseTo(6, 5);
  });

  it('the Sun Door takes the bronze ray and nothing else', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, -2, -44, 'E');
    w.events.drain();
    bot.tick(frame({ pressed: ['action'] }));
    expect(w.events.drain().map((e) => e.type)).toContain('slot.denied');
    bot.wait(120);
    expect(signal(w, 'sun_door.open')).toBe(false);
    w.state.inventory.bronze_ray = 1;
    bot.action();
    bot.wait(260);
    expect(signal(w, 'sun_door.open')).toBe(true);
  });

  it('the gate of the Court of Rays needs both sun discs at once', () => {
    const w = createWorld(level);
    const both: string[] = [];
    for (const n of FACINGS)
      for (const s of FACINGS) {
        setMirror(w, 'mirror_north', n);
        setMirror(w, 'mirror_south', s);
        run(w, frame(), 2);
        if (signal(w, 'disc_north.lit') && signal(w, 'disc_south.lit')) both.push(`${n},${s}`);
      }
    expect(both).toEqual(['0,1']); // NE, SE
    // One disc alone leaves the gate shut.
    const v = createWorld(level);
    setMirror(v, 'mirror_north', 0);
    run(v, frame(), secs(3));
    expect(signal(v, 'disc_north.lit')).toBe(true);
    expect(signal(v, 'gate_rays.open')).toBe(false);
  });

  it('the boulder crushes whoever stays in the ramp, and is back in its niche after a respawn', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, -20, -12, 'N');
    run(w, frame(), 2);
    saveCheckpoint(w);
    for (let i = 0; i < 90; i++) stepWorld(w, frame({ y: 1 }));
    expect(w.state.mechanisms.boulders[0]?.mode).not.toBe('idle');
    runUntil(w, frame(), (x) => x.state.player.mode === 'dead', secs(8));
    expect(w.state.player.mode).toBe('dead');
    run(w, frame(), secs(3));
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.mechanisms.boulders[0]?.mode).toBe('idle');
    // The trigger is armed again: the next run can make it to the alcove.
    bot.goTo(-20, -13);
    bot.goTo(-20, -25);
    bot.goTo(-21, -25);
    bot.waitFor(() => signal(w, 'boulder.done'), 'the boulder');
    expect(w.state.player.mode).toBe('ground');
  });

  it('a pull on the bridge lever too early costs nothing: the bridge shuts again and the next pull drops it', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 1, -24, 'W');
    bot.action();
    expect(signal(w, 'bridge.open')).toBe(true);
    bot.wait(secs(3.6));
    expect(signal(w, 'bridge.open')).toBe(false);
    bot.waitFor(() => guardian(w).mode === 'windup', 'the guardian on the bridge');
    bot.action();
    bot.waitFor(() => guardian(w).phase === 2 && guardian(w).mode === 'chase', 'the guardian out of the pit');
    expect(w.stats.deaths).toBe(0);
    // It does not trust the bridge again: from the south side it cannot reach her.
    bot.wait(secs(6));
    expect(Math.floor(guardian(w).pos.z / 2)).toBeGreaterThanOrEqual(-21);
    expect(w.state.player.health).toBe(100);
  });

  it('a death after the first blow keeps the blow: the guardian goes back to its pedestal in phase 2', () => {
    const w = createWorld(level);
    const bot = new Bot(w);
    place(w, 1, -24, 'W');
    bot.waitFor(() => guardian(w).mode === 'windup', 'the guardian on the bridge');
    bot.action();
    bot.waitFor(() => guardian(w).phase === 2, 'the fall');
    bot.wait(5);
    killPlayer(w, 'test');
    run(w, frame(), secs(3));
    expect(w.state.player.mode).toBe('ground');
    expect(guardian(w).phase).toBe(2);
    expect(Math.hypot(guardian(w).pos.x - 13, guardian(w).pos.z + 39)).toBeLessThan(0.5);
  });

  it('pistols do not hurt the guardian', () => {
    const w = createWorld(level);
    place(w, 3, -26, 'S');
    run(w, frame(), 30);
    run(w, frame({ held: ['fire'], pressed: ['fire'] }), 1);
    run(w, frame({ held: ['fire'] }), secs(2));
    expect(w.stats.hits).toBe(0);
    expect(guardian(w).phase).toBe(1);
  });
});
