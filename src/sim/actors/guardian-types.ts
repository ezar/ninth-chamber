/** Plain-data state of the stone guardian (see guardian.ts). */

/**
 * dormant: on its pedestal until Nora enters its hall. chase: walking to
 * her (or to the spot below her refuge). windup → slam → recover: the
 * readable attack and the window in which its core can be struck. stunned:
 * reeling after a core strike. falling → fallen → climbing: dropped into a
 * pit, then dragging itself out. defeated: a heap of stone.
 */
export type GuardianMode =
  | 'dormant'
  | 'chase'
  | 'windup'
  | 'slam'
  | 'recover'
  | 'stunned'
  | 'falling'
  | 'fallen'
  | 'climbing'
  | 'defeated';

export interface GuardianState {
  id: string;
  /** Stone, or bronze (molten bronze over it is a blow). */
  kind: 'stone' | 'bronze';
  /** Seconds before molten bronze can count as another blow (one pour, one blow). */
  immune: number;
  mode: GuardianMode;
  modeTime: number;
  /** 1 until its first fall or broken core, then 2; a second blow defeats it. */
  phase: 1 | 2;
  /** Feet position (m). */
  pos: { x: number; y: number; z: number };
  vel: { x: number; z: number };
  /** Vertical speed while falling into a pit (m/s). */
  vy: number;
  yaw: number;
  home: { x: number; y: number; z: number };
  homeYaw: number;
  /** Arena bounds in world cells (inclusive min, exclusive max). */
  arena: { minX: number; minZ: number; maxX: number; maxZ: number };
  path: [number, number][];
  repathIn: number;
  /** Whether Nora herself can be reached on foot (else it heads below her refuge). */
  reachable: boolean;
  /** Seconds before it may wind up again. */
  cooldown: number;
  /** Metres walked since the last step event. */
  stride: number;
  /** The last floor cell it stood on (where it climbs back out of a pit). */
  ground: [number, number];
  /** Climbing out of a pit: from where to where. */
  climb: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } } | null;
  /** Whether the current slam was a pound at a refuge (no one in reach) — for render and audio. */
  pound: boolean;
}
