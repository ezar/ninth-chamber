/**
 * Level-validator checks for the temple's mechanisms, traps and guardian
 * (spec §16 "Validador de niveles"): paths that run straight and clear of
 * walls, platforms that never sink into the floor and leave Nora headroom,
 * slots against a wall with a key that exists, and so on.
 */
import type { Level } from '../grid/level';
import { sectorTop } from '../grid/level';
import { DIR_VEC, OPPOSITE } from '../grid/units';
import { guardianTuning, tuning, wind as windTuning } from '../player/tuning';

type Cell = [number, number];

/** Every cell on a straight leg from a to b (inclusive); null if the leg is not along X or Z. */
function legCells(a: Cell, b: Cell): Cell[] | null {
  if (a[0] !== b[0] && a[1] !== b[1]) return null;
  const out: Cell[] = [];
  const sx = Math.sign(b[0] - a[0]);
  const sz = Math.sign(b[1] - a[1]);
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let i = 0; i <= n; i++) out.push([a[0] + sx * i, a[1] + sz * i]);
  return out;
}

export function validateMechanisms(
  level: Level,
  i18nKeys: ReadonlySet<string> | undefined,
  errors: string[],
  warnings: string[],
): void {
  const items = new Set<string>();
  for (const e of level.entities) if (e.type === 'item') items.add(e.item);
  const room = (id: string): { x: number; z: number; y: number; w: number; h: number } | null => {
    const r = level.rooms.find((x) => x.id === id);
    return r ? { x: r.minX, z: r.minZ, y: r.originY, w: r.maxX - r.minX, h: r.maxZ - r.minZ } : null;
  };
  const open = (cx: number, cz: number): boolean => {
    const s = level.sector(cx, cz);
    return !!s && !s.wall;
  };

  for (const e of level.entities) {
    const [cx, cz] = e.at;
    const r = room(e.room);
    if (!r) continue;
    switch (e.type) {
      case 'platform': {
        const way = e.path.map(([x, z, h]): [number, number, number] => [r.x + x, r.z + z, r.y + h * 0.5]);
        const first = way[0];
        if (!first || first[0] !== cx || first[1] !== cz)
          errors.push(`platform '${e.id}' must start at its 'at' cell`);
        const legs = e.loop === 'cycle' ? [...way, way[0] as [number, number, number]] : way;
        for (let i = 1; i < legs.length; i++) {
          const a = legs[i - 1] as [number, number, number];
          const b = legs[i] as [number, number, number];
          const cells = legCells([a[0], a[1]], [b[0], b[1]]);
          if (!cells) {
            errors.push(`platform '${e.id}': leg ${i - 1}→${i} is not straight along X or Z`);
            continue;
          }
          const low = Math.min(a[2], b[2]);
          const high = Math.max(a[2], b[2]);
          for (const [x, z] of cells) {
            const s = level.sector(x, z);
            if (!s || s.wall) {
              errors.push(`platform '${e.id}': its path crosses a wall at ${x},${z}`);
              continue;
            }
            if (sectorTop(s) > low + 1e-6)
              errors.push(`platform '${e.id}': it would sink into the floor at ${x},${z}`);
            if (s.ceil - high < tuning.height)
              warnings.push(`platform '${e.id}': less than Nora's height of headroom at ${x},${z}`);
          }
        }
        break;
      }
      case 'trapdoor':
        for (let x = cx; x < cx + e.size[0]; x++)
          for (let z = cz; z < cz + e.size[1]; z++)
            if (!open(x, z)) errors.push(`trapdoor '${e.id}' covers a wall at ${x},${z}`);
        break;
      case 'sunbeam': {
        const s = level.sector(cx, cz);
        const y = r.y + e.y * 0.5;
        if (!s || s.wall) errors.push(`sunbeam '${e.id}' must start on a floor sector`);
        else if (y <= sectorTop(s) || y >= s.ceil)
          errors.push(`sunbeam '${e.id}' is not between its sector's floor and ceiling`);
        if (e.from === 'wall') {
          const v = DIR_VEC[OPPOSITE[e.dir]];
          if (open(cx + v.x, cz + v.z))
            warnings.push(`sunbeam '${e.id}' enters through a wall that is not there`);
        }
        break;
      }
      case 'receiver': {
        const v = DIR_VEC[e.face];
        if (!open(cx + v.x, cz + v.z)) errors.push(`receiver '${e.id}' faces a wall`);
        break;
      }
      case 'slot': {
        const v = DIR_VEC[e.wall];
        if (open(cx + v.x, cz + v.z))
          errors.push(`slot '${e.id}' is not against a wall on its ${e.wall} side`);
        if (!items.has(e.accepts)) errors.push(`slot '${e.id}' takes '${e.accepts}', which no item provides`);
        if (i18nKeys && !i18nKeys.has(`item.${e.accepts}`))
          errors.push(`missing i18n key 'item.${e.accepts}'`);
        break;
      }
      case 'boulder': {
        const cells = e.path.map(([x, z]): Cell => [r.x + x, r.z + z]);
        if (cells[0]?.[0] !== cx || cells[0]?.[1] !== cz)
          errors.push(`boulder '${e.id}' must start at its 'at' cell`);
        for (let i = 1; i < cells.length; i++) {
          const leg = legCells(cells[i - 1] as Cell, cells[i] as Cell);
          if (!leg) errors.push(`boulder '${e.id}': leg ${i - 1}→${i} is not straight along X or Z`);
          else
            for (const [x, z] of leg)
              if (!open(x, z)) errors.push(`boulder '${e.id}': its path crosses a wall at ${x},${z}`);
        }
        break;
      }
      case 'blade': {
        const s = level.sector(cx, cz);
        if (s && !s.wall && s.ceil - sectorTop(s) < 4)
          warnings.push(`blade '${e.id}' has less than 4 m to swing in`);
        break;
      }
      case 'fire':
        for (let x = cx; x < cx + e.size[0]; x++)
          for (let z = cz; z < cz + e.size[1]; z++)
            if (!open(x, z)) errors.push(`fire '${e.id}' covers a wall at ${x},${z}`);
        break;
      case 'wind': {
        if (cx - r.x + e.size[0] > r.w || cz - r.z + e.size[1] > r.h)
          errors.push(`wind '${e.id}' leaves its room`);
        if (e.period !== undefined) {
          const blow = e.blow ?? Math.min(windTuning.blow, e.period);
          if (blow >= e.period)
            errors.push(`wind '${e.id}': its gust lasts the whole period (leave out the period)`);
          else if (e.period - blow < windTuning.warning)
            warnings.push(`wind '${e.id}': the lull is shorter than the flutes' warning`);
        } else if (e.blow !== undefined)
          warnings.push(`wind '${e.id}': 'blow' without a period does nothing`);
        if (e.dir === 'up' && (e.strength ?? 0) >= 0.9)
          errors.push(`wind '${e.id}': an updraught takes at most 0.9 of gravity`);
        break;
      }
      case 'guardian': {
        const [ax, az, aw, ah] = e.arena;
        if (ax < 0 || az < 0 || ax + aw > r.w || az + ah > r.h)
          errors.push(`guardian '${e.id}': its arena leaves its room`);
        const hx = cx - r.x;
        const hz = cz - r.z;
        if (hx < ax || hz < az || hx >= ax + aw || hz >= az + ah)
          errors.push(`guardian '${e.id}' starts outside its arena`);
        const s = level.sector(cx, cz);
        if (s && !s.wall && s.ceil - sectorTop(s) < guardianTuning.height)
          errors.push(`guardian '${e.id}' has no headroom`);
        break;
      }
      case 'item':
        if (i18nKeys && !i18nKeys.has(`item.${e.item}`)) errors.push(`missing i18n key 'item.${e.item}'`);
        break;
      case 'glyphlock': {
        const v = DIR_VEC[e.facing];
        if (!open(cx + v.x, cz + v.z)) errors.push(`glyph lock '${e.id}' is read from a wall`);
        if (e.glyph === e.target) warnings.push(`glyph lock '${e.id}' starts already set`);
        break;
      }
      case 'darts': {
        const v = DIR_VEC[e.from];
        let x = cx;
        let z = cz;
        while (open(x + v.x, z + v.z)) {
          x += v.x;
          z += v.z;
        }
        const wall = level.sector(x + v.x, z + v.z);
        if (!wall?.wall) errors.push(`darts '${e.id}' have no wall to fly from on their ${e.from} side`);
        break;
      }
      default:
        break;
    }
  }
}
