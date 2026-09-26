import { buttonBit, emptyFrame, type Button, type InputFrame } from '../src/core/input-frame';
import { Level } from '../src/sim/grid/level';
import type { LevelFileInput } from '../src/sim/grid/schema';
import { createWorld, stepWorld, type World } from '../src/sim/world';

/** Builds an InputFrame from axes and held / pressed buttons. */
export function frame(
  opts: { x?: number; y?: number; held?: Button[]; pressed?: Button[]; yaw?: number } = {},
): InputFrame {
  const f = emptyFrame();
  f.moveX = opts.x ?? 0;
  f.moveY = opts.y ?? 0;
  f.camYaw = opts.yaw ?? 0;
  for (const b of opts.held ?? []) f.held |= buttonBit(b);
  for (const b of opts.pressed ?? []) {
    f.pressed |= buttonBit(b);
    f.held |= buttonBit(b);
  }
  return f;
}

export function run(world: World, input: InputFrame | ((i: number) => InputFrame), ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, typeof input === 'function' ? input(i) : input);
}

/** Runs until `done` or `max` ticks; returns the ticks run. */
export function runUntil(world: World, input: InputFrame, done: (w: World) => boolean, max = 600): number {
  for (let i = 0; i < max; i++) {
    if (done(world)) return i;
    stepWorld(world, input);
  }
  return max;
}

/**
 * A one-room test level. Default legend: '#' wall, '.' floor 0, '_' pit,
 * digits 1-9 floor in clicks, 'S' start (floor 0). Camera yaw 0 means
 * "forward" is north (-Z), so rows read top = far.
 */
export function testLevel(
  rows: string[],
  extra: Partial<Pick<LevelFileInput, 'entities' | 'logic'>> & {
    legend?: Record<string, unknown>;
    ceil?: number;
    face?: 'N' | 'E' | 'S' | 'W';
  } = {},
): World {
  let start: [number, number] = [1, 1];
  rows.forEach((r, z) => {
    const x = r.indexOf('S');
    if (x >= 0) start = [x, z];
  });
  const legend: Record<string, unknown> = { '#': 'wall', '.': 0, S: 0, _: 'pit' };
  for (let d = 1; d <= 9; d++) legend[String(d)] = d;
  const file = {
    schema: 1,
    id: 'test',
    name: 'test',
    start: { room: 'r', at: start, face: extra.face ?? 'N' },
    rooms: [
      { id: 'r', origin: [0, 0, 0], ceil: extra.ceil ?? 24, legend: { ...legend, ...extra.legend }, rows },
    ],
    entities: extra.entities ?? [],
    logic: extra.logic ?? [],
  };
  return createWorld(Level.parse(file));
}

export const cellX = (w: World): number => Math.floor(w.state.player.pos.x / 2);
export const cellZ = (w: World): number => Math.floor(w.state.player.pos.z / 2);
