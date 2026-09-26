/** World units (spec §4 "Unidades"). */

/** A block is 2 m wide: the design unit of the grid. */
export const BLOCK = 2;
/** A click is 0.5 m, a quarter of a block: every floor and ceiling height is a multiple of it. */
export const CLICK = 0.5;

export type Dir = 'N' | 'E' | 'S' | 'W';
export const DIRS: readonly Dir[] = ['N', 'E', 'S', 'W'];

/** Cell offset per direction. N is -Z, E is +X. */
export const DIR_VEC: Record<Dir, { x: number; z: number }> = {
  N: { x: 0, z: -1 },
  E: { x: 1, z: 0 },
  S: { x: 0, z: 1 },
  W: { x: -1, z: 0 },
};

/** Yaw (rad) that faces each direction; yaw 0 faces -Z and positive yaw turns towards -X. */
export const DIR_YAW: Record<Dir, number> = { N: 0, W: Math.PI / 2, S: Math.PI, E: -Math.PI / 2 };

export const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const LEFT_OF: Record<Dir, Dir> = { N: 'W', W: 'S', S: 'E', E: 'N' };
export const RIGHT_OF: Record<Dir, Dir> = { N: 'E', E: 'S', S: 'W', W: 'N' };

/** Facing vector for a yaw. */
export const yawVec = (yaw: number): { x: number; z: number } => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/** Closest cardinal direction to a yaw. */
export function yawToDir(yaw: number): Dir {
  const v = yawVec(yaw);
  if (Math.abs(v.x) > Math.abs(v.z)) return v.x > 0 ? 'E' : 'W';
  return v.z > 0 ? 'S' : 'N';
}

export const cellOf = (m: number): number => Math.floor(m / BLOCK);
export const cellCenter = (c: number): number => c * BLOCK + BLOCK / 2;

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
