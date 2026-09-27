/**
 * Plain-data simulation state. Everything here is serializable so it can be
 * saved, restored at checkpoints and hashed for replays.
 */
import type { Dir } from './grid/units';
import type { EnemyType } from './player/tuning';

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

/** Nora's dual pistols (spec §7). */
export interface WeaponState {
  drawn: boolean;
  /** Seconds left of a draw or holster motion. */
  busy: number;
  /** Seconds until the next shot may fire. */
  cooldown: number;
  /** Locked enemy id, kept while Fire is held and it stays visible. */
  target: string | null;
  /** Hand that fires next: 0 = left, 1 = right. */
  hand: 0 | 1;
}

/**
 * The torch Nora carries (owner's request). In her left hand it lights the way
 * and leaves only the right pistol free; on her belt it keeps burning.
 */
export interface TorchState {
  /** She carries a torch. */
  has: boolean;
  /** Its flame burns. */
  lit: boolean;
  /** On her belt: put away, or stowed for a move that needs both hands. */
  stowed: boolean;
  /** Put away with the torch button: it stays on her belt until taken out again. */
  away: boolean;
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
  weapon: WeaponState;
  torch: TorchState;
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
  /** A torch's variant is 'lit' or 'unlit'. */
  kind: 'secret' | 'relic' | 'medkit' | 'torch';
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

/** A fire bowl: a burning one lights a carried torch (Action next to it). */
export interface BrazierActor {
  kind: 'brazier';
  id: string;
  cx: number;
  cz: number;
  /** Floor height under it (m). */
  y: number;
  lit: boolean;
}

/** A journal note: read with Action and never consumed, so it can be read again (see Stats.notes). */
export interface NoteActor {
  kind: 'note';
  id: string;
  cx: number;
  cz: number;
}

export type Actor =
  BlockActor | DoorActor | LeverActor | PlateActor | PickupActor | ZoneActor | NoteActor | BrazierActor;

/** Enemy behaviour states (spec §7 "Comportamiento"). */
export type EnemyMode = 'idle' | 'alert' | 'chase' | 'attack' | 'hurt' | 'flee' | 'dead';

/**
 * A living (or dead) enemy. It lives in DynamicState so checkpoints capture
 * it; respawning sends the living ones home and makes them forget Nora.
 */
export interface EnemyState {
  id: string;
  /** Key into enemyTypes (player/tuning.ts). */
  type: EnemyType;
  /** Enemies of the same pack alert each other and flank together. */
  pack: string | null;
  /** Slot in the pack (0, 1, …), for flanking. */
  slot: number;
  /** Start position and facing: where it returns and rests. */
  home: Vec3;
  homeYaw: number;
  /** Feet position (m). */
  pos: Vec3;
  /** Horizontal velocity (m/s). */
  vel: { x: number; z: number };
  /** Facing (rad), same convention as the player. */
  yaw: number;
  health: number;
  mode: EnemyMode;
  /** Seconds in the current mode. */
  modeTime: number;
  /** Mode to go back to after a stagger. */
  resume: EnemyMode;
  /** Seconds since the last stagger. */
  sinceStagger: number;
  /** Knows about Nora and hunts her. */
  aware: boolean;
  /** Cells to walk through, next first. */
  path: [number, number][];
  /** Seconds until the path may be searched again. */
  repathIn: number;
  /** Whether the last search found a way to Nora. */
  reachable: boolean;
  /** Seconds Nora has been out of reach (on a refuge). */
  outOfReach: number;
  /** Seconds during which sight alone does not alert it (after giving up). */
  calm: number;
  /** Seconds until the next bite while attacking. */
  biteIn: number;
}

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
  /** Journal notes read, by id, in reading order. Kept across deaths. */
  notes: string[];
  /** Secrets found (the count); each counts once, see secretsFound. */
  secrets: number;
  /** Ids of the secrets found, kept across deaths: a found idol stays found. */
  secretsFound: string[];
  /** Medkits picked up. */
  medkits: number;
  medkitsUsed: number;
  shots: number;
  hits: number;
  kills: number;
}

export interface DynamicState {
  player: PlayerState;
  actors: Actor[];
  enemies: EnemyState[];
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
