/**
 * Dynamic state of the Temple of the Sun's mechanisms and traps. Plain data,
 * part of DynamicState: saved at checkpoints, hashed for replays. Their
 * static description (paths, sizes, timings) stays in the level file.
 */

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface PlatformState {
  id: string;
  /** Centre of the platform's top surface (m). */
  pos: Point;
  /** Waypoint it rests at, or last left. */
  from: number;
  /** Waypoint it is heading for; equal to `from` while resting. */
  to: number;
  /** Metres travelled from `from` towards `to`. */
  s: number;
  /** Seconds of rest left at `from`. */
  wait: number;
  /** Keeps going from waypoint to waypoint. */
  running: boolean;
  /** Comes to rest for good at this waypoint (after `next` or `goto`). */
  stopAt: number | null;
  /** Direction along a ping-pong path. */
  dir: 1 | -1;
  /** Blocks riding it on the current leg. */
  cargo: string[];
}

export interface TrapdoorState {
  id: string;
  /** 0 = closed (a floor), 1 = open (the pit below). */
  open: number;
  target: 0 | 1;
  /** Seconds until it closes again, or null. */
  closeIn: number | null;
}

/** Index of a mirror's facing in DIAGONALS: 0 NE, 1 SE, 2 SW, 3 NW (clockwise). */
export type Facing4 = 0 | 1 | 2 | 3;

export interface MirrorState {
  id: string;
  cx: number;
  cz: number;
  facing: Facing4;
  fixed: boolean;
}

export interface ReceiverState {
  id: string;
  cx: number;
  cz: number;
  lit: boolean;
}

/** A traced sun beam: the polyline it follows and what it touched. */
export interface BeamState {
  id: string;
  on: boolean;
  /** Where the light enters, every reflection and where it stops (m). */
  points: Point[];
  /** Mirrors and receivers it reached, in order. */
  hits: string[];
}

export interface ItemState {
  id: string;
  cx: number;
  cz: number;
  item: string;
  taken: boolean;
}

export interface SlotState {
  id: string;
  cx: number;
  cz: number;
  filled: boolean;
}

export type BoulderMode = 'idle' | 'warning' | 'rolling' | 'done';

export interface BoulderState {
  id: string;
  mode: BoulderMode;
  /** Seconds in the current mode. */
  time: number;
  /** Metres rolled along its path. */
  dist: number;
  speed: number;
  /** Centre of the ball (m). */
  pos: Point;
}

export interface BladeState {
  id: string;
  on: boolean;
  /** Seconds since the level start or the last checkpoint reset. */
  time: number;
  /** Seconds until it can hit again. */
  cooldown: number;
}

export type FirePhase = 'idle' | 'warn' | 'burn';

export interface FireState {
  id: string;
  on: boolean;
  time: number;
  phase: FirePhase;
}

export interface GlyphLockState {
  id: string;
  cx: number;
  cz: number;
  /** Glyph shown on the reading side (0..5). */
  glyph: number;
}

export type DartPhase = 'idle' | 'armed' | 'cooldown';

export interface DartState {
  id: string;
  phase: DartPhase;
  /** Seconds in the current phase. */
  time: number;
}

/** idle: never poured; warn: a repeating pour rumbles; flowing: running down the trench; hot: full and cooling; solid: a bridge. */
export type PourPhase = 'idle' | 'warn' | 'flowing' | 'hot' | 'solid';

export interface PourState {
  id: string;
  phase: PourPhase;
  /** Seconds in the current phase. */
  time: number;
  /** Cells the bronze has reached while flowing (fractional). */
  front: number;
  /** It has cooled into a bridge at least once (the bridge stays under later pours). */
  cast: boolean;
  /** A repeating pour is running, and how far it is into its period (s). */
  running: boolean;
  cycle: number;
}

export interface HeatState {
  id: string;
  on: boolean;
}

/** idle: calm; warn: the flutes rise before a gust; gust: it blows. */
export type WindPhase = 'idle' | 'warn' | 'gust';

export interface WindState {
  id: string;
  on: boolean;
  /** Seconds it has been running (its place in the cycle). */
  time: number;
  phase: WindPhase;
}

/** A dome ring's position (spec §19, chamber VIII). */
export interface RingState {
  id: string;
  pos: number;
}

export interface OculusState {
  id: string;
  on: boolean;
}

/** A tangle of roots (spec §19, chamber V). */
export interface TangleState {
  id: string;
  /** 0 shrunk back … 1 fully grown; solid and climbable from 0.5. */
  grown: number;
  /** Seconds since a torch last made it shrink. */
  idle: number;
  /** Rules: free (the torch decides), sealed (it grows whatever the torch) or parted (it stays open). */
  hold: 'free' | 'sealed' | 'parted';
}

export interface MechanismState {
  platforms: PlatformState[];
  trapdoors: TrapdoorState[];
  mirrors: MirrorState[];
  receivers: ReceiverState[];
  beams: BeamState[];
  items: ItemState[];
  slots: SlotState[];
  boulders: BoulderState[];
  blades: BladeState[];
  fires: FireState[];
  glyphs: GlyphLockState[];
  darts: DartState[];
  pours: PourState[];
  heat: HeatState[];
  winds: WindState[];
  rings: RingState[];
  oculi: OculusState[];
  tangles: TangleState[];
  /** Nora stood in open heat last tick. */
  scorched: boolean;
  /** What Nora is operating (turning a mirror, setting an item, taking one) and whether it has reacted. */
  use: { id: string; done: boolean } | null;
}
