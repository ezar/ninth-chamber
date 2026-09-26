/**
 * Quality tiers (spec §11 "Niveles de calidad", §14 "Técnicas"): what each
 * tier renders, how the first run picks one (a ~3 s benchmark with a device
 * heuristic as fallback) and dynamic resolution scaling.
 *
 * Pure logic with no DOM or Three.js, so it runs (and is tested) in Node.
 */

export type QualityTier = 'high' | 'medium' | 'mobile';

export const QUALITY_TIERS: readonly QualityTier[] = ['high', 'medium', 'mobile'];

export const isQualityTier = (v: unknown): v is QualityTier =>
  typeof v === 'string' && (QUALITY_TIERS as readonly string[]).includes(v);

export interface QualityProfile {
  tier: QualityTier;
  /** Upper bound applied to devicePixelRatio. */
  pixelRatioCap: number;
  /** Lowest scene render scale dynamic resolution may reach. */
  minRenderScale: number;
  sun: {
    /** Shadow map size (px). */
    size: number;
    /** PCF filter radius (texels): softer edges on bigger maps. */
    radius: number;
    /**
     * Live: re-rendered every frame with Nora in it. Otherwise the map is
     * refreshed about once a second without Nora (a runtime "bake" of the
     * static room; Nora gets a contact shadow instead).
     */
    live: boolean;
  };
  /** How many of the nearest fire lights cast shadows, and their cube map size. */
  fireShadows: number;
  fireShadowSize: number;
  /** At most one shadow map is re-rendered per frame: the sun where it shines, otherwise the nearest fire. */
  singleShadow: boolean;
  /** Ground-truth ambient occlusion (GTAO). */
  ambientOcclusion: boolean;
  antialias: 'smaa' | 'fxaa';
  bloom: boolean;
  /** Depth of field during camera focus shots. */
  depthOfField: boolean;
  /** Volumetric sun shafts; otherwise light shafts are modelled cones (spec §11 "Medio"). */
  godrays: boolean;
  /** Maximum anisotropic filtering for the scanned surfaces. */
  anisotropy: number;
  /** Fraction of the full particle counts (dust in sun shafts, brazier embers). */
  particles: number;
  /** A soft blob under Nora in place of her dynamic shadow. */
  contactShadow: boolean;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  // Desktop with a dedicated GPU: everything the spec lists that the engine has so far.
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    minRenderScale: 0.7,
    sun: { size: 2048, radius: 3, live: true },
    fireShadows: 2,
    fireShadowSize: 512,
    singleShadow: false,
    ambientOcclusion: true,
    antialias: 'smaa',
    bloom: true,
    depthOfField: true,
    godrays: true,
    anisotropy: 16,
    particles: 1,
    contactShadow: false,
  },
  // Laptop with integrated graphics: one live shadow, bloom and SMAA.
  medium: {
    tier: 'medium',
    pixelRatioCap: 1.5,
    minRenderScale: 0.6,
    sun: { size: 1024, radius: 2, live: true },
    fireShadows: 1,
    fireShadowSize: 256,
    singleShadow: true,
    ambientOcclusion: false,
    antialias: 'smaa',
    bloom: true,
    depthOfField: false,
    godrays: false,
    anisotropy: 8,
    particles: 0.6,
    contactShadow: false,
  },
  // Phones and tablets: no dynamic shadows except Nora's contact blob, no AO, FXAA.
  mobile: {
    tier: 'mobile',
    pixelRatioCap: 1.25,
    minRenderScale: 0.5,
    sun: { size: 1024, radius: 1, live: false },
    fireShadows: 0,
    fireShadowSize: 256,
    singleShadow: true,
    ambientOcclusion: false,
    antialias: 'fxaa',
    bloom: true,
    depthOfField: false,
    godrays: false,
    anisotropy: 4,
    particles: 0.35,
    contactShadow: true,
  },
};

/** The tier one step below (mobile stays mobile). */
export function lowerTier(t: QualityTier): QualityTier {
  return t === 'high' ? 'medium' : 'mobile';
}

// ───────────────────────────── First-run detection ─────────────────────────────

export interface DeviceHints {
  userAgent: string;
  /** matchMedia('(pointer: coarse)'): the primary pointer is a finger. */
  coarsePointer: boolean;
  /** matchMedia('(any-pointer: fine)'): a mouse or trackpad is available. */
  finePointer: boolean;
  /** navigator.hardwareConcurrency, when known. */
  cores?: number;
  /** navigator.deviceMemory (GB), when known. */
  memoryGb?: number;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i;

/** Fallback when the benchmark cannot run: phones and tablets get mobile, small machines medium. */
export function heuristicTier(h: DeviceHints): QualityTier {
  if (MOBILE_UA.test(h.userAgent) || (h.coarsePointer && !h.finePointer)) return 'mobile';
  if ((h.cores !== undefined && h.cores <= 4) || (h.memoryGb !== undefined && h.memoryGb <= 4)) {
    return 'medium';
  }
  return 'high';
}

const percentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] ?? 0;

/**
 * Picks a tier from frame times (ms) measured while rendering `measured`.
 * Frames are vsync-bound, so only "keeps 60 fps" is observable: a tier that
 * cannot hold it steps down, and a frame time up to about twice the budget
 * means the next tier (roughly half the GPU cost) will.
 */
export function tierFromFrameTimes(frameMs: readonly number[], measured: QualityTier): QualityTier {
  if (measured === 'mobile' || frameMs.length === 0) return measured;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  if (median <= 18.5 && p90 <= 28) return measured;
  if (measured === 'high' && median <= 34) return 'medium';
  return 'mobile';
}

/**
 * The ~3 s first-run benchmark (spec §11): feed it render frame intervals
 * while the title scene renders at the tier being measured.
 */
export class TierBenchmark {
  private warm = 0;
  private measuredTime = 0;
  private stalled = 0;
  private readonly samples: number[] = [];

  constructor(
    readonly measured: QualityTier,
    /** Seconds discarded at the start (shader compilation, texture uploads). */
    private readonly warmup = 0.6,
    private readonly duration = 3,
    /** Seconds of stalls (a hidden or throttled tab) after which it gives up. */
    private readonly patience = 5,
  ) {}

  /** Feeds one frame interval (s). Returns true once the benchmark is complete. */
  add(dt: number): boolean {
    if (this.done) return true;
    if (this.warm < this.warmup) {
      this.warm += dt;
    } else if (dt > 0 && dt < 0.25) {
      this.measuredTime += dt;
      this.samples.push(dt * 1000);
    } else {
      // Intervals over 0.25 s are stalls (tab switch, late compile), not frame cost.
      this.stalled += Math.max(0, dt);
    }
    return this.done;
  }

  get done(): boolean {
    return (this.warm >= this.warmup && this.measuredTime >= this.duration) || this.stalled >= this.patience;
  }

  get progress(): number {
    if (this.done) return 1;
    return Math.min(
      1,
      0.15 * Math.min(1, this.warm / this.warmup) + 0.85 * (this.measuredTime / this.duration),
    );
  }

  /** The chosen tier, or null when too few frames were seen to judge (e.g. a hidden tab). */
  result(): QualityTier | null {
    if (this.samples.length < 20) return null;
    return tierFromFrameTimes(this.samples, this.measured);
  }
}

// ───────────────────────────── Dynamic resolution ─────────────────────────────

export type ResolutionChange = 'down' | 'up' | 'floor' | null;

/**
 * Dynamic resolution (spec §14): when frames stay over the budget (18 ms)
 * for a second the scene render scale drops a step; it creeps back up after
 * a calm stretch, waiting twice as long after every drop so it does not
 * oscillate. 'floor' reports sustained overload at the minimum scale, the
 * cue to lower the quality tier.
 */
export class DynamicResolution {
  scale = 1;
  private smoothed: number | null = null;
  private over = 0;
  private calm = 0;
  private recoverDelay: number;

  constructor(
    private minScale: number,
    readonly budgetMs = 18,
    private readonly baseRecoverDelay = 4,
    private readonly maxRecoverDelay = 32,
    readonly stepDown = 0.1,
    readonly stepUp = 0.05,
  ) {
    this.recoverDelay = baseRecoverDelay;
  }

  /** Starts over at full scale (after a tier change). */
  reset(minScale = this.minScale): void {
    this.minScale = minScale;
    this.scale = 1;
    this.smoothed = null;
    this.over = 0;
    this.calm = 0;
    this.recoverDelay = this.baseRecoverDelay;
  }

  /** Feeds a frame interval (s); returns what changed. */
  update(dt: number): ResolutionChange {
    // Stalls (tab switches, shader compiles) say nothing about steady cost.
    if (!(dt > 0) || dt > 0.25) return null;
    const ms = dt * 1000;
    this.smoothed = this.smoothed === null ? ms : this.smoothed + (ms - this.smoothed) * 0.15;
    if (this.smoothed > this.budgetMs) {
      this.calm = 0;
      this.over += dt;
      if (this.over < 1) return null;
      this.over = 0;
      if (this.scale > this.minScale + 1e-6) {
        this.scale = Math.max(this.minScale, round2(this.scale - this.stepDown));
        this.recoverDelay = Math.min(this.maxRecoverDelay, this.recoverDelay * 2);
        return 'down';
      }
      return 'floor';
    }
    this.over = 0;
    // Vsync caps what can be observed: at or under ~17.5 ms the frame made its slot.
    if (this.smoothed <= this.budgetMs - 0.5 && this.scale < 1) {
      this.calm += dt;
      if (this.calm >= this.recoverDelay) {
        this.calm = 0;
        this.scale = Math.min(1, round2(this.scale + this.stepUp));
        return 'up';
      }
    } else {
      this.calm = 0;
    }
    return null;
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
