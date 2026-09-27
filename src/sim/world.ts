/**
 * The single simulation state (spec §3 "Estado único"): level geometry,
 * dynamic actors, logic signals and the player. Advanced by stepWorld at 60 Hz.
 */
import { clone } from '../core/clone';
import { EventQueue } from '../core/events';
import type { InputFrame } from '../core/input-frame';
import { TICK_DT } from '../core/loop';
import { Rng } from '../core/rng';
import type { GridQuery } from './grid/collision';
import { Level, sectorTop } from './grid/level';
import { BLOCK, DIR_YAW, cellCenter } from './grid/units';
import { compileRules, runLogic, type CompiledRule } from './logic/rules';
import { createEnemies, resetEnemies, updateEnemies } from './actors/enemies';
import { updateActors } from './actors/update';
import { stepPlayer } from './player/controller';
import { newTorch } from './player/torch';
import { mechanics, tuning } from './player/tuning';
import type { Actor, BlockActor, DoorActor, DynamicState, PlayerState, Stats } from './state';

export type { Vec3 } from './state';

export interface World {
  tick: number;
  rng: Rng;
  level: Level;
  events: EventQueue;
  state: DynamicState;
  /** Dynamic state saved at the last checkpoint. */
  checkpoint: DynamicState;
  rules: CompiledRule[];
  stats: Stats;
  ended: boolean;
  grid: GridQuery;
}

const tileKey = (cx: number, cz: number): string => `${cx},${cz}`;

function createActors(level: Level): Actor[] {
  const actors: Actor[] = [];
  for (const e of level.entities) {
    const [cx, cz] = e.at;
    const floor = level.sector(cx, cz);
    const y = floor ? sectorTop(floor) : 0;
    switch (e.type) {
      case 'block':
        actors.push({ kind: 'block', id: e.id, cx, cz, y, fallTo: null, from: null, t: 0 });
        break;
      case 'door':
        actors.push({
          kind: 'door',
          id: e.id,
          cx,
          cz,
          height: e.height * 0.5,
          open: e.open ? 1 : 0,
          target: e.open ? 1 : 0,
          closeIn: null,
        });
        break;
      case 'lever':
        actors.push({ kind: 'lever', id: e.id, cx, cz, wall: e.wall, used: false, spring: e.spring });
        break;
      case 'plate':
        actors.push({ kind: 'plate', id: e.id, cx, cz, pressed: false });
        break;
      case 'secret':
        actors.push({ kind: 'secret', id: e.id, cx, cz, taken: false, variant: e.idol });
        break;
      case 'relic':
        actors.push({ kind: 'relic', id: e.id, cx, cz, taken: false, variant: 'amber' });
        break;
      case 'medkit':
        actors.push({ kind: 'medkit', id: e.id, cx, cz, taken: false, variant: e.size });
        break;
      case 'note':
        actors.push({ kind: 'note', id: e.id, cx, cz });
        break;
      case 'zone':
        actors.push({ kind: 'zone', id: e.id, cx, cz, w: e.size[0], h: e.size[1], inside: false });
        break;
      case 'brazier':
        actors.push({ kind: 'brazier', id: e.id, cx, cz, y, lit: e.lit });
        break;
      case 'torch':
        actors.push({ kind: 'torch', id: e.id, cx, cz, taken: false, variant: e.lit ? 'lit' : 'unlit' });
        break;
      case 'enemy':
        break;
    }
  }
  return actors;
}

function createPlayer(level: Level): PlayerState {
  const { x, z, dir } = level.start;
  const px = cellCenter(x);
  const pz = cellCenter(z);
  return {
    pos: { x: px, y: level.floorAt(px, pz), z: pz },
    vel: { x: 0, y: 0, z: 0 },
    yaw: DIR_YAW[dir],
    mode: 'ground',
    modeTime: 0,
    runTime: 0,
    sinceGround: 0,
    sinceJumpPressed: Infinity,
    sinceRelease: Infinity,
    jumped: false,
    fallFrom: 0,
    airSpeedCap: 0,
    health: tuning.maxHealth,
    ledge: null,
    move: null,
    target: null,
    dir: null,
    weapon: { drawn: false, busy: 0, cooldown: 0, target: null, hand: 1 },
    torch: newTorch(),
  };
}

export function createWorld(level: Level, seed = 1): World {
  const state: DynamicState = {
    player: createPlayer(level),
    actors: createActors(level),
    enemies: createEnemies(level),
    tiles: {},
    signals: {},
    flags: [],
    fired: [],
    pending: [],
    inventory: {},
  };
  const world: World = {
    tick: 0,
    rng: new Rng(seed),
    level,
    events: new EventQueue(),
    state,
    checkpoint: clone(state),
    rules: compileRules(level.logic),
    stats: {
      time: 0,
      distance: 0,
      deaths: 0,
      notes: [],
      secrets: 0,
      secretsFound: [],
      medkits: 0,
      medkitsUsed: 0,
      shots: 0,
      hits: 0,
      kills: 0,
    },
    ended: false,
    grid: null as unknown as GridQuery,
  };
  world.grid = makeGrid(world);
  return world;
}

/** Grid heights with dynamic objects layered over the static level. */
function makeGrid(world: World): GridQuery {
  const { level } = world;
  return {
    cellFloor: (cx, cz) => floorWith(world, cx, cz, null),
    cellCeil: (cx, cz) => {
      const s = level.sector(cx, cz);
      return !s || s.wall ? -Infinity : s.ceil;
    },
    floorAt: (x, z) => {
      const cx = Math.floor(x / BLOCK);
      const cz = Math.floor(z / BLOCK);
      const s = level.sector(cx, cz);
      if (!s || s.wall) return Infinity;
      const f = floorWith(world, cx, cz, null);
      // Slopes only apply to the bare static floor.
      return f === sectorTop(s) ? level.floorAt(x, z) : f;
    },
    grabbable: (cx, cz) => !level.sector(cx, cz)?.flags.has('noGrab'),
  };
}

/** Effective floor top of a cell, optionally ignoring one block (the one being moved). */
export function floorWith(world: World, cx: number, cz: number, excludeBlock: string | null): number {
  const s = world.level.sector(cx, cz);
  if (!s || s.wall) return Infinity;
  for (const a of world.state.actors) {
    if (a.kind === 'door' && a.cx === cx && a.cz === cz && a.open < mechanics.doorPassable) return Infinity;
  }
  let h = sectorTop(s);
  if (world.state.tiles[tileKey(cx, cz)]?.fallen) h = s.pitFloor;
  for (const a of world.state.actors) {
    if (a.kind !== 'block' || a.id === excludeBlock) continue;
    if ((a.cx === cx && a.cz === cz) || (a.from && a.from.cx === cx && a.from.cz === cz)) {
      h = Math.max(h, a.y + mechanics.blockHeight);
    }
  }
  return h;
}

export function findActor<K extends Actor['kind']>(
  world: World,
  id: string,
  kind?: K,
): Extract<Actor, { kind: K }> | undefined {
  return world.state.actors.find((a) => a.id === id && (!kind || a.kind === kind)) as
    Extract<Actor, { kind: K }> | undefined;
}

export function blockAt(world: World, cx: number, cz: number): BlockActor | undefined {
  return world.state.actors.find(
    (a): a is BlockActor =>
      a.kind === 'block' && a.cx === cx && a.cz === cz && a.from === null && a.fallTo === null,
  );
}

/**
 * Puts a block back where the level placed it (spec §8: a reset lever keeps
 * block puzzles from dead ends). Skipped while the player holds the block or
 * stands in its start cell, or another block sits there.
 */
export function resetBlock(world: World, id: string): boolean {
  const b = findActor(world, id, 'block');
  const start = world.level.entities.find((e) => e.id === id && e.type === 'block');
  if (!b || !start) return false;
  const [cx, cz] = start.at;
  const p = world.state.player;
  if (p.target === id) return false;
  if (Math.floor(p.pos.x / BLOCK) === cx && Math.floor(p.pos.z / BLOCK) === cz) return false;
  const other = blockAt(world, cx, cz);
  if (other && other.id !== id) return false;
  const s = world.level.sector(cx, cz);
  b.cx = cx;
  b.cz = cz;
  b.y = s ? sectorTop(s) : 0;
  b.from = null;
  b.fallTo = null;
  b.t = 0;
  world.events.emit({ type: 'block.reset', tick: world.tick, id });
  return true;
}

export function doorAt(world: World, cx: number, cz: number): DoorActor | undefined {
  return world.state.actors.find((a): a is DoorActor => a.kind === 'door' && a.cx === cx && a.cz === cz);
}

export function tileState(world: World, cx: number, cz: number): { cracked: number | null; fallen: boolean } {
  const k = tileKey(cx, cz);
  return (world.state.tiles[k] ??= { cracked: null, fallen: false });
}

/** Saves the dynamic state as the respawn point. */
export function saveCheckpoint(world: World): void {
  world.checkpoint = clone(world.state);
  world.events.emit({ type: 'checkpoint', tick: world.tick });
}

/**
 * Restores the last checkpoint after a death. Enemies alive then go back to
 * their start and forget Nora (spec §7).
 */
export function respawn(world: World): void {
  world.state = clone(world.checkpoint);
  const p = world.state.player;
  p.mode = 'ground';
  p.modeTime = 0;
  p.vel = { x: 0, y: 0, z: 0 };
  p.health = Math.max(p.health, tuning.maxHealth / 2);
  p.weapon.target = null;
  p.weapon.cooldown = 0;
  p.weapon.busy = 0;
  resetEnemies(world);
  // Secrets found since the checkpoint stay found (they count once, like journal notes).
  for (const a of world.state.actors) {
    if (a.kind === 'secret' && world.stats.secretsFound.includes(a.id)) {
      a.taken = true;
      world.state.signals[`${a.id}.taken`] = true;
    }
  }
  world.events.emit({ type: 'player.respawned', tick: world.tick });
}

/** Advances the simulation by one 1/60 s tick. */
export function stepWorld(world: World, input: InputFrame, dt = TICK_DT): void {
  if (!world.ended) {
    const before = { ...world.state.player.pos };
    stepPlayer(world, input, dt);
    updateActors(world, dt);
    updateEnemies(world, dt);
    runLogic(world, dt);
    const p = world.state.player.pos;
    world.stats.distance += Math.hypot(p.x - before.x, p.z - before.z);
    world.stats.time += dt;
  }
  world.tick++;
}

/** Serializable World snapshot (for saves, tests and replays). */
export function snapshot(world: World): object {
  return { tick: world.tick, rng: world.rng.state, state: world.state };
}

/** FNV-1a hash of the snapshot, for comparing golden replays. */
export function hashWorld(world: World): string {
  const s = JSON.stringify(snapshot(world));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
