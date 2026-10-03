/**
 * The level's grabbable edges, for the high-contrast mode (spec §13
 * "Accesibilidad"): every lip that `ledgeAhead` (collision.ts) would let Nora
 * grab from the floor next to it, or hang from when she lowers herself off it.
 * Static geometry only: pushable blocks and doors move and are left out.
 */
import { BLOCK } from './units';
import type { Level, Sector } from './level';

export interface GrabEdge {
  room: string;
  /** Endpoints of the lip, in metres. */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Height of the lip (m). */
  y: number;
  /** Outward normal of the lip, towards the lower side. */
  nx: number;
  nz: number;
}

/** Same thresholds as ledgeAhead: hands need 0.6 m above the lip, and the lip is 0.75 m or more above the floor below. */
const HEADROOM = 0.6;
const RISE = 0.75;

const flatTop = (s: Sector): number | null => {
  const [a, b, c, d] = s.floor;
  return a === b && b === c && c === d ? a : null;
};

export function grabEdges(level: Level): GrabEdge[] {
  const out: GrabEdge[] = [];
  const sides = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ];
  for (const top of level.allSectors()) {
    if (top.wall || top.pit || top.flags.has('noGrab')) continue;
    const y = flatTop(top);
    if (y === null || top.ceil - y < HEADROOM) continue;
    for (const { dx, dz } of sides) {
      const low = level.sector(top.cx + dx, top.cz + dz);
      if (!low || low.wall) continue;
      const below = low.pit ? low.pitFloor : Math.max(...low.floor);
      if (y - below < RISE) continue;
      // The lip runs along the shared side of the two cells.
      const ex = dx > 0 ? top.cx + 1 : dx < 0 ? top.cx : null;
      const ez = dz > 0 ? top.cz + 1 : dz < 0 ? top.cz : null;
      const [x1, z1, x2, z2] =
        ex !== null
          ? [ex * BLOCK, top.cz * BLOCK, ex * BLOCK, (top.cz + 1) * BLOCK]
          : [top.cx * BLOCK, (ez ?? 0) * BLOCK, (top.cx + 1) * BLOCK, (ez ?? 0) * BLOCK];
      out.push({ room: top.room, x1, z1, x2, z2, y, nx: dx, nz: dz });
    }
  }
  return out;
}
