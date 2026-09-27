/**
 * Which brazier each pooled fire light serves, and how bright, frame by frame.
 *
 * Pure logic (no Three.js), so it runs and is tested in Node. The renderer
 * owns two fixed pools of point lights: plain ones and shadow casters. Their
 * number and their castShadow flags never change after creation (a shadow
 * map disposed while a render still binds it floods WebGPU with validation
 * errors), so the lights move between braziers instead.
 *
 * Nothing pops:
 * - each brazier's light fades in and out (weight), by distance and rank;
 * - a light only moves to another brazier once it has faded to zero;
 * - the braziers of the current and neighbouring rooms rank first;
 * - a brazier casting shadows hands over to a plain light by crossfading
 *   (share), and a caster only changes brazier when another is clearly
 *   closer (hysteresis), after its share has faded out.
 */

export interface FireSpot {
  x: number;
  y: number;
  z: number;
  /** Room the brazier stands in. */
  room: string | null;
  /** A cold brazier (not lit yet): it gets no light, and its light fades in once lit. */
  off?: boolean;
}

export interface FirePoolSize {
  /** Plain (shadowless) lights. */
  plain: number;
  /** Shadow-casting lights. */
  casters: number;
}

export interface FireLevels {
  /** Per light: the brazier it serves (-1: none) and its level 0..1. */
  plain: { fire: number; level: number }[];
  casters: { fire: number; level: number }[];
}

/** Distance (m) inside which a brazier's light is at full weight, and where it has faded out. */
export const FIRE_FULL = 14;
export const FIRE_REACH = 24;
/** Ranking bonus (m) for braziers in the current or a neighbouring room. */
export const ROOM_BONUS = 8;
/** How much closer (m) another brazier must be before a shadow caster moves to it. */
export const CASTER_HYSTERESIS = 3;
/** Fade rates (per second): a brazier's light, and the shadow handover. */
export const FADE_RATE = 1 / 0.8;
export const SHARE_RATE = 1 / 0.6;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const approach = (v: number, target: number, step: number): number =>
  v < target ? Math.min(target, v + step) : Math.max(target, v - step);

export class FireLightScheduler {
  private weight: number[] = [];
  private share: number[] = [];
  private slotOf: number[] = [];
  private readonly plainOwner: number[];
  private readonly casterOwner: number[];
  readonly levels: FireLevels;

  constructor(readonly size: FirePoolSize) {
    this.plainOwner = Array.from({ length: size.plain }, () => -1);
    this.casterOwner = Array.from({ length: size.casters }, () => -1);
    this.levels = {
      plain: this.plainOwner.map(() => ({ fire: -1, level: 0 })),
      casters: this.casterOwner.map(() => ({ fire: -1, level: 0 })),
    };
  }

  /** Starts over for another level's braziers. */
  reset(count: number): void {
    this.weight = Array.from({ length: count }, () => 0);
    this.share = Array.from({ length: count }, () => 0);
    this.slotOf = Array.from({ length: count }, () => -1);
    this.plainOwner.fill(-1);
    this.casterOwner.fill(-1);
  }

  /**
   * `active`: how many braziers may be lit at once (the tier's budget, at most
   * the plain pool). `casters`: how many shadow casters may be used now.
   * `preferred`: the current and neighbouring rooms.
   */
  update(
    fires: readonly FireSpot[],
    eye: { x: number; y: number; z: number },
    preferred: ReadonlySet<string>,
    active: number,
    casters: number,
    dt: number,
  ): FireLevels {
    if (fires.length !== this.weight.length) this.reset(fires.length);
    const n = fires.length;
    const dist: number[] = [];
    const score: number[] = [];
    for (const f of fires) {
      const d = Math.hypot(f.x - eye.x, f.y - eye.y, f.z - eye.z);
      dist.push(d);
      score.push(d - (f.room !== null && preferred.has(f.room) ? ROOM_BONUS : 0));
    }
    const ranked = [...Array(n).keys()]
      .filter((i) => (dist[i] ?? Infinity) < FIRE_REACH && !fires[i]?.off)
      .sort((a, b) => (score[a] ?? 0) - (score[b] ?? 0));
    const lit = new Set(ranked.slice(0, Math.min(active, this.plainOwner.length)));

    // Weights: fade towards the distance-based target; a light needs a slot to rise.
    for (let i = 0; i < n; i++) {
      const target = lit.has(i) ? 1 - smoothstep(FIRE_FULL, FIRE_REACH, dist[i] ?? Infinity) : 0;
      if (target > 0 && this.slotOf[i] === -1) {
        const free = this.plainOwner.indexOf(-1);
        if (free !== -1) {
          this.plainOwner[free] = i;
          this.slotOf[i] = free;
        }
      }
      if (this.slotOf[i] === -1) continue;
      this.weight[i] = approach(this.weight[i] ?? 0, target, FADE_RATE * dt);
      // A slot is given up only once its light has faded out (and no caster holds the brazier).
      if (this.weight[i] === 0 && target === 0 && !this.casterOwner.includes(i)) {
        this.plainOwner[this.slotOf[i] ?? -1] = -1;
        this.slotOf[i] = -1;
      }
    }

    // Shadow casters: the best-ranked lit braziers, with hysteresis.
    const allowed = Math.min(casters, this.casterOwner.length);
    const candidates = ranked.filter((i) => lit.has(i) && (this.weight[i] ?? 0) > 0);
    const wanted: number[] = [];
    for (let c = 0; c < this.casterOwner.length; c++) {
      const owner = this.casterOwner[c] ?? -1;
      if (c >= allowed) {
        wanted.push(-1);
        continue;
      }
      const taken = new Set([...this.casterOwner, ...wanted].filter((o) => o !== -1 && o !== owner));
      const best = candidates.find((i) => !taken.has(i)) ?? -1;
      const keep =
        owner !== -1 &&
        lit.has(owner) &&
        (best === -1 || best === owner || (score[best] ?? 0) > (score[owner] ?? 0) - CASTER_HYSTERESIS);
      wanted.push(keep ? owner : best);
    }
    for (let c = 0; c < this.casterOwner.length; c++) {
      const owner = this.casterOwner[c] ?? -1;
      const want = wanted[c] ?? -1;
      if (owner !== -1 && owner !== want) {
        // Hand the brazier back to its plain light before moving.
        this.share[owner] = approach(this.share[owner] ?? 0, 0, SHARE_RATE * dt);
        if (this.share[owner] === 0) this.casterOwner[c] = -1;
      } else if (owner === -1 && want !== -1) {
        this.casterOwner[c] = want;
        this.share[want] = 0;
      } else if (owner !== -1) {
        this.share[owner] = approach(this.share[owner] ?? 0, 1, SHARE_RATE * dt);
      }
    }

    this.plainOwner.forEach((o, s) => {
      const out = this.levels.plain[s];
      if (!out) return;
      out.fire = o;
      out.level = o === -1 ? 0 : (this.weight[o] ?? 0) * (1 - (this.share[o] ?? 0));
    });
    this.casterOwner.forEach((o, c) => {
      const out = this.levels.casters[c];
      if (!out) return;
      out.fire = o;
      out.level = o === -1 ? 0 : (this.weight[o] ?? 0) * (this.share[o] ?? 0);
    });
    return this.levels;
  }

  /** Total light on a brazier (plain plus caster), for tests and debugging. */
  total(fire: number): number {
    return this.weight[fire] ?? 0;
  }
}
