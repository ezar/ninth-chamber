/**
 * Golden path through The Antechamber with scripted input: proves the level
 * can be finished through every room with every secret and no deaths, and
 * shows the intended route. Camera yaw is 0, so input y+ is north (-Z) and
 * x+ is east (+X). Cells below are world cells (room origin + position).
 */
import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import { Level } from '../src/sim/grid/level';
import { validateLevel } from '../src/sim/grid/validate';
import { createWorld, findActor } from '../src/sim/world';
import en from '../i18n/en.json';
import { Bot } from './bot';
import { frame } from './helpers';

/** Plays the whole level; returns the bot for inspection. */
function playAntechamber(): Bot {
  const w = createWorld(Level.parse(levelJson));
  const bot = new Bot(w);
  const pressed = (id: string): boolean => findActor(w, id, 'plate')?.pressed === true;

  // Entrance: climb the terrace, detour for the jade idol.
  bot.goTo(8, 3);
  bot.climb('N');
  bot.climb('N');
  bot.action();
  expect(w.stats.secrets).toBe(1);
  bot.goTo(8, 2, { slow: true });
  bot.goTo(4, 1);
  bot.goTo(4, -1);

  // Brazier hall: gold idol in the north-east niche.
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

  // Hall of Weights: the plate holds the gate only under weight, so the block goes on it.
  bot.goTo(4, -17);
  bot.goTo(4, -20);
  bot.goTo(2, -20);
  bot.push('S');
  bot.push('S');
  bot.push('S');
  expect(pressed('plate1')).toBe(true);
  bot.wait(130);
  bot.goTo(-1, -16);
  bot.goTo(-3, -16);

  // Hourglass: learn the course southwards, then the timed run back north.
  bot.goTo(-4, -16);
  bot.goTo(-7, -14);
  bot.standingJump('S');
  bot.goTo(-7, -10);
  bot.runningJump('S', -16);
  bot.goTo(-7, -2);
  expect(pressed('plate2')).toBe(true);
  bot.wait(140);
  const released = w.tick;
  bot.runningJump('N', -12);
  bot.runningJump('N', -22);
  for (let i = 0; i < 200 && bot.p.pos.z > -29.2; i++) bot.tick(frame({ y: 1 }));
  bot.tick(frame({ y: 1, pressed: ['jump'] }));
  for (let i = 0; i < 100 && bot.p.mode !== 'ground'; i++) bot.tick(frame({ y: 1 }));
  for (let i = 0; i < 200 && bot.p.pos.z > -37; i++) bot.tick(frame({ y: 1 }));
  // Through the gate with seconds to spare out of twelve.
  expect(w.level.roomAt(-7, Math.floor(bot.p.pos.z / 2))?.id).toBe('well');
  expect((w.tick - released) / 60).toBeLessThan(9);

  // Well of Light: the block is the first step; the spiral climbs to the sun.
  bot.goTo(-7, -20);
  bot.goTo(-7, -21);
  bot.goTo(-4, -21);
  bot.goTo(-4, -20);
  bot.push('W');
  bot.push('W');
  bot.climb('W');
  bot.climb('W');
  bot.goTo(-9, -20, { walk: true });
  bot.climb('N');
  bot.goTo(-9, -22, { walk: true });
  bot.standingJump('N');
  bot.climb('N');
  bot.goTo(-8, -25, { walk: true });
  bot.climb('E');
  expect(bot.p.pos.y).toBe(14);
  // The stone idol waits on a lone pillar in the light: a standing jump there and back.
  bot.goTo(-4, -25, { walk: true });
  bot.goTo(-4, -24, { walk: true });
  bot.standingJump('S');
  bot.action();
  expect(w.stats.secrets).toBe(3);
  bot.standingJump('N');
  bot.goTo(-4, -25, { walk: true });

  // The terrace high above the Hall of Weights, to the doorway.
  bot.goTo(-2, -25, { walk: true });
  bot.goTo(9, -25);
  bot.goTo(9, -26, { walk: true });
  bot.goTo(9, -27, { walk: true });

  // Sunken Causeway: the block fills the socket, then a running jump over the chasm.
  bot.push('N');
  bot.push('N');
  bot.push('N');
  bot.wait(30);
  expect(w.grid.cellFloor(9, -31)).toBe(14);
  bot.goTo(9, -27, { walk: true });
  bot.runningJump('N', -62);
  bot.goTo(9, -38);
  bot.goTo(9, -41);

  // Chamber of Scales: block_a is first the step to the shelf, then the weight on plate_a.
  bot.goTo(4, -44);
  bot.goTo(4, -45);
  for (let i = 0; i < 5; i++) bot.push('E');
  bot.climb('E');
  bot.climb('E');
  bot.goTo(12, -45, { walk: true });
  bot.push('N');
  bot.wait(40);
  expect(pressed('plate_b')).toBe(true);
  bot.goTo(11, -45, { walk: true });
  bot.goTo(10, -45, { slow: true });
  bot.goTo(9, -45, { slow: true });
  for (let i = 0; i < 5; i++) bot.pull('E');
  bot.goTo(4, -44);
  bot.goTo(5, -44);
  bot.push('N');
  bot.push('N');
  expect(pressed('plate_a')).toBe(true);
  bot.wait(130);
  bot.goTo(8, -50);
  bot.goTo(8, -53);

  // Descent: lower yourself twice instead of jumping down.
  bot.goTo(3, -55, { walk: true });
  const health = bot.p.health;
  bot.lowerAndDrop('N');
  bot.goTo(3, -58, { walk: true });
  bot.lowerAndDrop('N');
  expect(bot.p.health).toBe(health);
  bot.goTo(3, -60);
  bot.goTo(4, -61);
  bot.goTo(4, -63);

  // Gallery: the running jump over the spikes, then sprint over the collapsing tiles.
  bot.goTo(1, -64);
  bot.runningJump('N', -140);
  expect(bot.p.pos.y).toBe(2);
  for (let i = 0; i < 90; i++) bot.tick(frame({ y: 1, x: 0.3 }));

  // Relic chamber.
  bot.goTo(3, -78);
  bot.goTo(3, -83);
  bot.tick(frame({ y: 1, pressed: ['jump'] }));
  bot.wait(60);
  bot.goTo(3, -85);
  bot.action();
  bot.wait(200);
  return bot;
}

describe('The Antechamber', () => {
  it('validates without errors', () => {
    const { errors } = validateLevel(levelJson, new Set(Object.keys(en)));
    expect(errors).toEqual([]);
  });

  // About 13 000 simulated ticks: allow more than the default 5 s on a busy machine.
  it('can be finished through every room with all three secrets and no deaths', { timeout: 30_000 }, () => {
    const bot = playAntechamber();
    const w = bot.w;
    expect(w.ended).toBe(true);
    expect(w.stats.deaths).toBe(0);
    expect(w.stats.secrets).toBe(3);
    expect([...bot.rooms].sort()).toEqual(w.level.rooms.map((r) => r.id).sort());
    // The scripted route is ~3.7 minutes of game time; people take about four times longer.
    expect(w.tick).toBeGreaterThan(12000);
    expect(w.tick).toBeLessThan(15000);
  });
});
