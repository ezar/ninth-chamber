/**
 * Shared helpers for the player modes (spec §5): one file per mode in
 * ./modes, each a function called once per tick while that mode is active.
 */
import { isHeld, isPressed, type Button, type InputFrame } from '../../core/input-frame';
import type { GridQuery } from '../grid/collision';
import { DIR_VEC, DIR_YAW, wrapAngle, type Dir } from '../grid/units';
import type { PlayerMode, PlayerState } from '../state';
import type { World } from '../world';
import { tuning } from './tuning';

export interface Ctx {
  world: World;
  p: PlayerState;
  q: GridQuery;
  input: InputFrame;
  dt: number;
  /** Desired movement direction in world space (camera-relative input), length ≤ 1. */
  wish: { x: number; z: number; mag: number };
  held(b: Button): boolean;
  pressed(b: Button): boolean;
}

export function makeCtx(world: World, input: InputFrame, dt: number): Ctx {
  const sin = Math.sin(input.camYaw);
  const cos = Math.cos(input.camYaw);
  const x = input.moveX * cos - input.moveY * sin;
  const z = -input.moveX * sin - input.moveY * cos;
  return {
    world,
    p: world.state.player,
    q: world.grid,
    input,
    dt,
    wish: { x, z, mag: Math.hypot(x, z) },
    held: (b) => isHeld(input, b),
    pressed: (b) => isPressed(input, b),
  };
}

export function setMode(p: PlayerState, mode: PlayerMode): void {
  p.mode = mode;
  p.modeTime = 0;
}

export function emit(c: Ctx, type: string, data: Record<string, unknown> = {}): void {
  c.world.events.emit({ type, tick: c.world.tick, ...data });
}

/** Component of the wish vector along a direction. */
export function wishAlong(c: Ctx, dir: Dir): number {
  const v = DIR_VEC[dir];
  return c.wish.x * v.x + c.wish.z * v.z;
}

/** Turns the player towards the wish direction at the configured rate. */
export function turnTowardsWish(c: Ctx): void {
  if (c.wish.mag < 0.05) return;
  const target = Math.atan2(-c.wish.x, -c.wish.z);
  const diff = wrapAngle(target - c.p.yaw);
  const max = tuning.turnSpeed * c.dt;
  c.p.yaw = wrapAngle(c.p.yaw + Math.max(-max, Math.min(max, diff)));
}

export function faceDir(p: PlayerState, dir: Dir): void {
  p.yaw = DIR_YAW[dir];
}

/** Applies damage and kills the player at zero health. */
export function hurt(c: Ctx, amount: number, cause: string): void {
  damagePlayer(c.world, amount, cause);
}

export function die(c: Ctx, cause: string): void {
  killPlayer(c.world, cause);
}

/** Damage from anywhere in the simulation (falls, enemies). */
export function damagePlayer(world: World, amount: number, cause: string): void {
  const p = world.state.player;
  if (amount <= 0 || p.mode === 'dead') return;
  p.health = Math.max(0, p.health - amount);
  world.events.emit({ type: 'player.hurt', tick: world.tick, amount, cause });
  if (p.health === 0) killPlayer(world, cause);
}

export function killPlayer(world: World, cause: string): void {
  const p = world.state.player;
  if (p.mode === 'dead') return;
  p.health = 0;
  p.vel = { x: 0, y: 0, z: 0 };
  setMode(p, 'dead');
  world.stats.deaths++;
  world.events.emit({ type: 'player.died', tick: world.tick, cause });
}
