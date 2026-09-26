/**
 * Plain-data simulation state. Everything here is serializable so it can be
 * saved, restored at checkpoints and hashed for replays.
 */
import type { Dir } from './grid/units';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PlayerMode =
  'ground' | 'air' | 'hang' | 'climb' | 'block' | 'push' | 'pull' | 'lever' | 'pickup' | 'dead';

export interface Ledge {
  dir: Dir;
  /** Cell that holds the ledge top. */
  cx: number;
  cz: number;
  /** Ledge top height (m). */
  y: number;
}

/** A timed move from one position to another (climb, push, pull). */
export interface Move {
  from: Vec3;
  to: Vec3;
  duration: number;
}

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  /** Facing (rad), 0 = looking towards -Z. */
  yaw: number;
  mode: PlayerMode;
  /** Seconds spent in the current mode. */
  modeTime: number;
  /** Seconds of continuous running, for running jumps. */
  runTime: number;
  /** Seconds since last on the ground (coyote time). */
  sinceGround: number;
  /** Seconds since jump was last pressed. */
  sinceJumpPressed: number;
  /** Seconds since the player let go of a ledge. */
  sinceRelease: number;
  /** True when the current airborne phase started with a jump. */
  jumped: boolean;
  /** Highest feet height in the current airborne phase. */
  fallFrom: number;
  /** Horizontal speed cap in the air: air control steers but never adds range. */
  airSpeedCap: number;
  health: number;
  ledge: Ledge | null;
  move: Move | null;
  /** Actor the player is interacting with (block, lever, pickup). */
  target: string | null;
  /** Direction of the current interaction. */
  dir: Dir | null;
}

export interface BlockActor {
  kind: 'block';
  id: string;
  cx: number;
  cz: number;
  /** Bottom height (m). */
  y: number;
  /** Target bottom height while falling. */
  fallTo: number | null;
  /** Previous cell while being pushed or pulled. */
  from: { cx: number; cz: number } | null;
  /** Progress [0, 1] of the current push or pull. */
  t: number;
}

export interface DoorActor {
  kind: 'door';
  id: string;
  cx: number;
  cz: number;
  height: number;
  /** 0 = closed, 1 = open. */
  open: number;
  target: 0 | 1;
  /** Seconds until it closes again, or null. */
  closeIn: number | null;
}

export interface LeverActor {
  kind: 'lever';
  id: string;
  cx: number;
  cz: number;
  wall: Dir;
  used: boolean;
  /** Returns to rest after each pull, so it can be pulled again. */
  spring: boolean;
}

export interface PlateActor {
  kind: 'plate';
  id: string;
  cx: number;
  cz: number;
  pressed: boolean;
}

export interface PickupActor {
  kind: 'secret' | 'relic' | 'medkit';
  id: string;
  cx: number;
  cz: number;
  taken: boolean;
  variant: string;
}

export interface ZoneActor {
  kind: 'zone';
  id: string;
  cx: number;
  cz: number;
  w: number;
  h: number;
  inside: boolean;
}

export type Actor = BlockActor | DoorActor | LeverActor | PlateActor | PickupActor | ZoneActor;

export interface TileState {
  /** Seconds since it cracked; null while intact. */
  cracked: number | null;
  fallen: boolean;
}

/** A queued rule action waiting on `wait`. */
export interface PendingActions {
  delay: number;
  actions: string[];
}

export interface Stats {
  time: number;
  distance: number;
  deaths: number;
  secrets: number;
  medkits: number;
}

export interface DynamicState {
  player: PlayerState;
  actors: Actor[];
  tiles: Record<string, TileState>;
  signals: Record<string, boolean>;
  flags: string[];
  fired: number[];
  pending: PendingActions[];
  inventory: Record<string, number>;
}

export interface Checkpoint {
  state: DynamicState;
}
