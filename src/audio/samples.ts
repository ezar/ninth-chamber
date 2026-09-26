/**
 * Recorded sound banks (spec §12 "Producción"): Opus/WebM files under
 * public/audio, listed in samples.json by scripts/audio/build_audio.py.
 *
 * Files are fetched and decoded lazily, a whole category at a time
 * (footsteps, foley, mechanisms, ambience, ui), and only once the context
 * exists (after the unlock gesture). Until a bank is ready, or if the browser
 * cannot decode Opus, callers fall back to the procedural sounds.
 *
 * Variation: each play picks a variant other than the last one of the bank,
 * and callers apply the random pitch and gain from `vary()`.
 */

import manifest from './samples.json';

export type BankName = keyof typeof manifest.banks;
export type Category = 'footsteps' | 'foley' | 'mechanisms' | 'ambience' | 'ui';

interface BankEntry {
  category: string;
  files: string[];
  loop?: boolean;
  /** Intended loop length (s): decoders may pad the end of the last Opus frame. */
  length?: number;
  /** Decode at this sample rate to save memory (beds and rumbles have no content up high). */
  rate?: number;
}

const BANKS = manifest.banks as Record<BankName, BankEntry>;
/** At most this many files in flight while loading a category. */
const PARALLEL = 6;

export const BANK_NAMES = Object.keys(BANKS) as BankName[];

export function bankEntry(name: BankName): BankEntry {
  return BANKS[name];
}

type State = 'idle' | 'loading' | 'ready' | 'failed';

/** True when this browser can decode Opus in WebM (checked once; true outside the DOM, e.g. in tests that stub fetch). */
export function opusSupported(): boolean {
  if (typeof document === 'undefined') return true;
  const probe = document.createElement('audio');
  return probe.canPlayType('audio/webm; codecs="opus"') !== '';
}

export type Fetcher = (url: string) => Promise<ArrayBuffer>;

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
};

/** Offline contexts that decode at reduced rates, shared by every bank (they are never rendered). */
const decoders = new Map<number, BaseAudioContext>();

export class SampleBank {
  private readonly buffers = new Map<BankName, AudioBuffer[]>();
  private readonly lastPick = new Map<BankName, number>();
  private readonly state = new Map<Category, State>();
  private readonly pending = new Map<Category, Promise<void>>();
  private readonly listeners: ((c: Category) => void)[] = [];
  private readonly enabled: boolean;

  constructor(
    private readonly ctx: BaseAudioContext,
    /** URL prefix of public/audio, ending in '/'. */
    private readonly base: string,
    private readonly fetcher: Fetcher = defaultFetch,
    /** Highest decode rate (phones: 32 kHz, a third less memory than 48 kHz). */
    private readonly maxRate = Infinity,
  ) {
    this.enabled = opusSupported();
  }

  /** Called with each category once it has finished loading (some files may have failed). */
  onLoaded(fn: (c: Category) => void): void {
    this.listeners.push(fn);
  }

  isReady(c: Category): boolean {
    return this.state.get(c) === 'ready';
  }

  /** Starts (or joins) loading every bank of the given categories. Never rejects. */
  load(categories: readonly Category[]): Promise<void> {
    return Promise.all(categories.map((c) => this.loadOne(c))).then(() => undefined);
  }

  private loadOne(c: Category): Promise<void> {
    const existing = this.pending.get(c);
    if (existing) return existing;
    if (!this.enabled) {
      this.state.set(c, 'failed');
      return Promise.resolve();
    }
    this.state.set(c, 'loading');
    const jobs: { bank: BankName; index: number; url: string; rate: number | undefined }[] = [];
    for (const name of BANK_NAMES) {
      const entry = BANKS[name];
      if (entry.category !== c) continue;
      entry.files.forEach((f, index) =>
        jobs.push({ bank: name, index, url: this.base + f, rate: entry.rate }),
      );
    }
    const slots = new Map<BankName, (AudioBuffer | null)[]>();
    const run = async (): Promise<void> => {
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < jobs.length) {
          const job = jobs[next++];
          if (!job) break;
          let buf: AudioBuffer | null;
          try {
            buf = await this.decoder(job.rate).decodeAudioData(await this.fetcher(job.url));
          } catch {
            buf = null;
          }
          let list = slots.get(job.bank);
          if (!list) {
            list = [];
            slots.set(job.bank, list);
          }
          list[job.index] = buf;
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, worker));
      let any = false;
      for (const [bank, list] of slots) {
        const ok = list.filter((b): b is AudioBuffer => b !== null && b !== undefined);
        if (ok.length > 0) {
          this.buffers.set(bank, ok);
          any = true;
        }
      }
      this.state.set(c, any ? 'ready' : 'failed');
      for (const fn of this.listeners) fn(c);
    };
    const p = run();
    this.pending.set(c, p);
    return p;
  }

  /**
   * The context that decodes at `rate`: a small offline context for reduced rates (the buffers
   * play in any context, resampled on the fly), else the main one.
   */
  private decoder(wanted: number | undefined): BaseAudioContext {
    const rate = Math.min(wanted ?? this.ctx.sampleRate, this.maxRate);
    if (!rate || rate >= this.ctx.sampleRate || typeof OfflineAudioContext === 'undefined') return this.ctx;
    let d = decoders.get(rate);
    if (!d) {
      d = new OfflineAudioContext(1, 1, rate);
      decoders.set(rate, d);
    }
    return d;
  }

  has(name: BankName): boolean {
    return (this.buffers.get(name)?.length ?? 0) > 0;
  }

  /** Requests the bank's category if nothing has asked for it yet. */
  want(name: BankName): void {
    const c = BANKS[name].category as Category;
    if (!this.pending.has(c)) void this.loadOne(c);
  }

  /** A variant of the bank, never the same one twice in a row; null if not loaded (and starts loading it). */
  pick(name: BankName): AudioBuffer | null {
    const list = this.buffers.get(name);
    if (!list || list.length === 0) {
      this.want(name);
      return null;
    }
    if (list.length === 1) return list[0] ?? null;
    const prev = this.lastPick.get(name) ?? -1;
    let i: number;
    if (prev < 0) i = Math.floor(Math.random() * list.length);
    else {
      // Uniform over the other variants.
      i = Math.floor(Math.random() * (list.length - 1));
      if (i >= prev) i++;
    }
    this.lastPick.set(name, i);
    return list[i] ?? null;
  }

  /** The single buffer of a loop bank, with the loop end trimmed to the intended length. */
  loop(name: BankName): { buffer: AudioBuffer; end: number } | null {
    const buffer = this.pick(name);
    if (!buffer) return null;
    const length = BANKS[name].length;
    return { buffer, end: length !== undefined ? Math.min(length, buffer.duration) : buffer.duration };
  }
}

/** Random playback variation: ±4 % rate and ±2 dB gain around the given values. */
export function vary(
  rate = 1,
  gain = 1,
  rateSpread = 0.04,
  gainSpreadDb = 2,
): { rate: number; gain: number } {
  const r = rate * (1 + (Math.random() * 2 - 1) * rateSpread);
  const g = gain * 10 ** (((Math.random() * 2 - 1) * gainSpreadDb) / 20);
  return { rate: r, gain: g };
}
