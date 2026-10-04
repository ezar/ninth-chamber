/**
 * Golden replays (spec §16): each chamber's golden path, recorded as the bot's
 * input frames, is played back on a fresh world and its hash compared every
 * HASH_EVERY ticks. Recording happens in each walkthrough test when
 * REPLAY_UPDATE is set (`pnpm replay:update`); tests/golden-replays.test.ts
 * plays every recording back.
 *
 * Files: tests/replays/<level>.replay.json.gz, gzipped JSON. Frames are stored
 * as runs of identical frames, each frame as "moveX moveY camYaw held pressed released".
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { InputFrame } from '../src/core/input-frame';
import type { Level } from '../src/sim/grid/level';
import { createWorld, hashWorld, stepWorld } from '../src/sim/world';
import type { Bot } from './bot';

export const HASH_EVERY = 60;
export const REPLAY_DIR = join(import.meta.dirname, 'replays');

export interface Replay {
  level: string;
  seed: number;
  ticks: number;
  /** Runs of frames: [count, "moveX moveY camYaw held pressed released"]. */
  frames: [number, string][];
  /** World hash after every HASH_EVERY ticks, and the last one after the final tick. */
  hashes: string[];
  final: string;
}

const encode = (f: InputFrame): string =>
  `${f.moveX} ${f.moveY} ${f.camYaw} ${f.held} ${f.pressed} ${f.released}`;

function decode(s: string): InputFrame {
  const [moveX = 0, moveY = 0, camYaw = 0, held = 0, pressed = 0, released = 0] = s.split(' ').map(Number);
  return { moveX, moveY, camYaw, held, pressed, released };
}

/** The frames of a replay, one per tick. */
export function* replayFrames(r: Replay): Generator<InputFrame> {
  for (const [n, s] of r.frames) {
    const f = decode(s);
    for (let i = 0; i < n; i++) yield f;
  }
}

/** Plays frames on a fresh world of the level; returns the hashes as a replay stores them. */
export function playBack(
  level: Level,
  frames: Iterable<InputFrame>,
  seed = 1,
): { hashes: string[]; final: string; ticks: number } {
  const w = createWorld(level, seed);
  const hashes: string[] = [];
  for (const f of frames) {
    stepWorld(w, f);
    if (w.tick % HASH_EVERY === 0) hashes.push(hashWorld(w));
  }
  return { hashes, final: hashWorld(w), ticks: w.tick };
}

/**
 * Called at the end of a walkthrough test: with REPLAY_UPDATE set, saves the
 * bot's frames as the level's golden replay, after checking that they alone
 * (with no other change to the world) lead to the bot's final state.
 */
export function recordGolden(bot: Bot): void {
  if (!process.env.REPLAY_UPDATE) return;
  const level = bot.w.level;
  const back = playBack(level, bot.frames);
  if (back.final !== hashWorld(bot.w))
    throw new Error(
      `the walkthrough of ${level.id} changes the world by other means than input; it cannot be a replay`,
    );
  const frames: [number, string][] = [];
  for (const f of bot.frames) {
    const s = encode(f);
    const last = frames[frames.length - 1];
    if (last && last[1] === s) last[0]++;
    else frames.push([1, s]);
  }
  const replay: Replay = {
    level: level.id,
    seed: 1,
    ticks: back.ticks,
    frames,
    hashes: back.hashes,
    final: back.final,
  };
  mkdirSync(REPLAY_DIR, { recursive: true });
  writeFileSync(
    join(REPLAY_DIR, `${level.id}.replay.json.gz`),
    gzipSync(JSON.stringify(replay), { level: 9 }),
  );
}

export function loadReplays(): Replay[] {
  let files: string[];
  try {
    files = readdirSync(REPLAY_DIR).filter((f) => f.endsWith('.replay.json.gz'));
  } catch {
    return [];
  }
  return files
    .sort()
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(REPLAY_DIR, f))).toString('utf8')) as Replay);
}
