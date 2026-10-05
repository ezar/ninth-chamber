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
  /**
   * Desired movement direction in world space, length ≤ 1: camera-relative input, or in classic
   * mode relative to her facing (where she turns, only forward and back; the sides turn her).
   */
  wish: { x: number; z: number; mag: number };
  /** Classic mode's tank controls (spec §5 "Esquemas de control"). */
  tank: boolean;
  /** The assists of spec §5 (coyote time, jump buffer, auto-grab): on unless in classic mode. */
  assisted: boolean;
  held(b: Button): boolean;
  pressed(b: Button): boolean;
}

/** The modes where the tank controls' sides turn her instead of moving her sideways. */
const TANK_TURNING: ReadonlySet<PlayerMode> = new Set<PlayerMode>(['ground', 'swim', 'dive']);

export function makeCtx(world: World, input: InputFrame, dt: number): Ctx {
  const p = world.state.player;
  const tank = world.classic;
  // Tank controls read the stick in her own frame: the same maths with her yaw for the camera's.
  const yaw = tank ? p.yaw : input.camYaw;
  const moveX = tank && TANK_TURNING.has(p.mode) ? 0 : input.moveX;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const x = moveX * cos - input.moveY * sin;
  const z = -moveX * sin - input.moveY * cos;
  return {
    world,
    p,
    q: world.grid,
    input,
    dt,
    wish: { x, z, mag: Math.hypot(x, z) },
    tank,
    assisted: !tank,
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

/**
 * Whether she takes hold of something within reach in the air (a ledge, a rope, a climbable face):
 * with Action held, or after a jump by the auto-grab assist (spec §5 "Ayudas"), off in classic mode.
 */
export function reachesForHold(c: Ctx): boolean {
  return c.held('action') || (c.p.jumped && c.assisted);
}

/** Tank controls: the sides turn her on the spot, in the modes where she turns. */
export function tankTurn(c: Ctx): void {
  if (!c.tank || !TANK_TURNING.has(c.p.mode)) return;
  c.p.yaw = wrapAngle(c.p.yaw - c.input.moveX * tuning.tankTurnSpeed * c.dt);
}

/** Turns the player towards the wish direction at the configured rate (not with tank controls). */
export function turnTowardsWish(c: Ctx): void {
  if (c.tank || c.wish.mag < 0.05) return;
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
