/**
 * Plays the adaptive score on Web Audio (the MusicSink of director.ts).
 *
 * - Streams (title, intros, exploration, relic, fanfares) play through
 *   <audio> elements into the music bus: nothing large is decoded. Offline
 *   contexts (the render checks) decode them instead.
 * - Loops (tension, combat, chase, boss) are decoded, at a reduced rate, and
 *   loop sample-accurately. Each runs through a vertical-layering chain: a
 *   low-pass that opens with intensity (a dark drone at 0, the full bed at 1)
 *   and a synthesised percussion layer locked to the loop's bar grid that
 *   comes in above 0.6. Switches between loops wait for the next bar.
 * - Stingers are decoded and play over the bed, which ducks under them.
 * - The low-health heartbeat and the muffling low-pass sit on the output.
 *
 * Everything is lazy: loops and stingers load when the level starts (prefetch)
 * or when first asked for; nothing blocks the start of the game.
 *
 * Phones (`lite`): streams do not go through Web Audio at all. On Chrome for
 * Android a MediaElementAudioSourceNode makes the real-time audio thread pull
 * from the media pipeline; when that stalls (a busy main thread, a slow
 * network) the whole context glitches. There the <audio> element plays
 * directly and its volume follows the fades, the music volume and the ducking
 * from update(). Loops and stingers also decode at lower rates.
 */

import type { MusicSink, PlayOpts } from './director';
import { DuckEnvelope, holdParam, type Strip } from './dsp';
import { chime, secretMotif, timpani } from './music';
import { cueInfo, type Motif } from './score';

interface Voice {
  cue: string;
  gain: GainNode;
  /** Loops: when the loop started (context time) and its bar length (0: free time). */
  start: number;
  bar: number;
  src: AudioBufferSourceNode | null;
  el: HTMLAudioElement | null;
  node: AudioNode | null;
  filter: BiquadFilterNode | null;
  stopped: boolean;
  /** Streams: the browser refused to start it (autoplay); the next request retries. */
  blocked?: boolean;
  /** Streams: the browser paused it (audio focus, background); a gesture or visibility resumes it. */
  interrupted?: boolean;
  /** Direct streams (lite): the fade, applied to el.volume every frame. */
  fade?: { from: number; to: number; t0: number; t1: number };
}

const DUCK_ATTACK = 0.12;
const DUCK_RELEASE = 1.6;
/** Intensity → low-pass cutoff of a loop (Hz): 0 is a dark drone, 1 fully open. */
const cutoff = (v: number): number => 280 * Math.pow(2, v * 6.2);

export interface ScorePlayerOptions {
  /** URL of public/audio/ (ending in '/'). */
  base: string;
  /** A one-shot strip on the music bus, for the synthesised layers and motifs. */
  strip: () => Strip | null;
  fetcher?: (url: string) => Promise<ArrayBuffer>;
  /** Called with a cue that cannot play (no Opus/WebM, a failed file), for a synthesised stand-in. */
  fallback?: (cue: string) => void;
  /** Phones: direct streams, lower decode rates, no prefetch of chase and boss. */
  lite?: boolean;
  /** Linear music level after the options volume and mute (direct streams only). */
  musicLevel?: () => number;
}

const decoders = new Map<number, BaseAudioContext>();

export class ScorePlayer implements MusicSink {
  private readonly out: GainNode;
  private readonly muffler: BiquadFilterNode;
  private readonly duckGain: GainNode;
  private readonly ducker: DuckEnvelope;
  private main: Voice | null = null;
  private wanted: { cue: string | null; o: PlayOpts } | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loading = new Map<string, Promise<AudioBuffer | null>>();
  private readonly failed = new Set<string>();
  private readonly streams: boolean;
  private readonly lite: boolean;
  /** Stream elements alive (playing or fading), for the diagnostics and the leak guard. */
  private readonly elements = new Set<HTMLAudioElement>();
  private level = 0;
  private beatBpm = 0;
  private nextBeat = 0;
  private beatCount = 0;
  private heartBpm = 0;
  /** Direct streams fading out after release. */
  private readonly fading = new Set<Voice>();
  private nextHeart = 0;
  private paused = false;
  private readonly fetcher: (url: string) => Promise<ArrayBuffer>;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly opts: ScorePlayerOptions,
  ) {
    this.duckGain = new GainNode(ctx, { gain: 1 });
    this.ducker = new DuckEnvelope(this.duckGain.gain);
    this.muffler = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.4 });
    this.out = new GainNode(ctx, { gain: 1 });
    this.duckGain.connect(this.muffler).connect(this.out).connect(dest);
    this.fetcher =
      opts.fetcher ??
      (async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
    this.lite = opts.lite === true;
    // Streaming needs a live context and Opus in WebM; offline, streams are decoded like loops.
    this.streams =
      typeof AudioContext !== 'undefined' &&
      ctx instanceof AudioContext &&
      typeof Audio !== 'undefined' &&
      new Audio().canPlayType('audio/webm; codecs="opus"') !== '';
  }

  // ───────────────────────── Loading ─────────────────────────

  private decoder(wanted: number | undefined): BaseAudioContext {
    // Phones: loops and stingers at 22.05 kHz at most (a 30 s stereo loop: 5 MB instead of 11).
    const rate = this.lite ? Math.min(wanted ?? this.ctx.sampleRate, 22050) : wanted;
    if (!rate || rate >= this.ctx.sampleRate || typeof OfflineAudioContext === 'undefined') return this.ctx;
    let d = decoders.get(rate);
    if (!d) {
      d = new OfflineAudioContext(2, 1, rate);
      decoders.set(rate, d);
    }
    return d;
  }

  /** Decodes a cue (loops, stingers, or streams when offline); null if it cannot be loaded. */
  load(cue: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(cue);
    if (have) return Promise.resolve(have);
    const pending = this.loading.get(cue);
    if (pending) return pending;
    const info = cueInfo(cue);
    if (!info || this.failed.has(cue)) return Promise.resolve(null);
    const p = (async (): Promise<AudioBuffer | null> => {
      try {
        const data = await this.fetcher(this.opts.base + info.file);
        const buf = await this.decoder(info.rate).decodeAudioData(data);
        this.buffers.set(cue, buf);
        return buf;
      } catch {
        this.failed.add(cue);
        return null;
      } finally {
        this.loading.delete(cue);
      }
    })();
    this.loading.set(cue, p);
    return p;
  }

  prefetch(cues: readonly string[]): void {
    // One at a time, so prefetching never competes with what the player needs now.
    // Phones load the chase and boss loops only when a level asks for them.
    const queue = cues.filter(
      (c) => cueInfo(c)?.kind !== 'stream' && !(this.lite && (c === 'chase' || c === 'boss')),
    );
    const next = (): void => {
      const c = queue.shift();
      if (c) void this.load(c).then(next);
    };
    next();
  }

  // ───────────────────────── Main slot ─────────────────────────

  play(cue: string | null, o: PlayOpts): void {
    this.wanted = { cue, o };
    const info = cue ? cueInfo(cue) : undefined;
    if (cue && !info) return this.play(null, o);
    const now = this.ctx.currentTime;
    // Switch on the next bar of the current loop when asked (horizontal re-sequencing).
    let at = now + 0.02;
    const cur = this.main;
    if (o.sync && cur && cur.bar > 0 && !cur.stopped) {
      const since = now - cur.start;
      at = cur.start + Math.ceil((since + 0.05) / cur.bar) * cur.bar;
      if (at - now > 4) at = now + 0.02;
    }
    if (cur && cur.cue === cue && !cur.stopped) {
      // The same cue again, usually from a fresh gesture: retry a stream autoplay refused.
      if (cur.el && cur.blocked && !this.paused) this.retryStream(cur);
      return;
    }
    if (cur) this.release(cur, at, o.fadeOut);
    this.main = null;
    this.beatBpm = 0;
    if (!cue || !info) return;
    if (info.kind === 'stream' && this.streams) {
      this.main = this.startStream(cue, at, o);
      return;
    }
    const buf = this.buffers.get(cue);
    if (buf) {
      this.main = this.startBuffer(cue, buf, Math.max(at, this.ctx.currentTime + 0.02), o);
      return;
    }
    // Not decoded yet: start it when it arrives, if it is still wanted.
    void this.load(cue).then((b) => {
      if (this.wanted?.cue !== cue || this.main?.cue === cue) return;
      if (!b) {
        this.opts.fallback?.(cue);
        return;
      }
      this.main = this.startBuffer(cue, b, this.ctx.currentTime + 0.05, o);
    });
  }

  private startStream(cue: string, at: number, o: PlayOpts): Voice {
    const info = cueInfo(cue);
    const ctx = this.ctx as AudioContext;
    // Chrome for Android copes badly with several media elements: never more than the two of a crossfade.
    for (const old of [...this.elements].slice(0, Math.max(0, this.elements.size - 1))) this.dropElement(old);
    const el = new Audio();
    el.preload = 'auto';
    el.loop = o.loop;
    el.src = this.opts.base + (info?.file ?? '');
    this.elements.add(el);
    const gain = new GainNode(ctx, { gain: 0 });
    const t = ctx.currentTime;
    const v: Voice = {
      cue,
      gain,
      start: at,
      bar: 0,
      src: null,
      el,
      node: null,
      filter: null,
      stopped: false,
    };
    if (this.lite) {
      el.volume = 0;
      v.fade = { from: 0, to: 1, t0: at, t1: at + Math.max(0.05, o.fadeIn) };
    } else {
      const node = ctx.createMediaElementSource(el);
      node.connect(gain).connect(this.duckGain);
      v.node = node;
      gain.gain.setValueAtTime(0, t);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + Math.max(0.05, o.fadeIn));
    }
    const begin = (): void => {
      if (v.stopped || this.paused) return;
      el.play().catch((err: unknown) => {
        // An autoplay refusal leaves this cue silent (the next gesture brings music back);
        // a broken file or format gets the synthesised stand-in.
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError') v.blocked = true;
        if (!v.stopped && name !== 'NotAllowedError' && name !== 'AbortError') this.opts.fallback?.(cue);
      });
    };
    el.addEventListener('error', () => {
      if (!v.stopped) this.opts.fallback?.(cue);
    });
    // Paused by the browser (audio focus, a stall, the tab in the background), not by us.
    el.addEventListener('pause', () => {
      if (!v.stopped && !this.paused && !el.ended) v.interrupted = true;
    });
    el.addEventListener('playing', () => {
      v.interrupted = false;
      v.blocked = false;
    });
    el.addEventListener('ended', () => {
      if (!el.loop) this.dropElement(el);
    });
    const delay = at - t;
    if (delay > 0.03) setTimeout(begin, delay * 1000);
    else begin();
    return v;
  }

  /** Stops and frees a stream element (its node too). */
  private dropElement(el: HTMLAudioElement): void {
    if (!this.elements.delete(el)) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
    if (this.main?.el === el) this.main.stopped = true;
  }

  private retryStream(v: Voice): void {
    const el = v.el;
    if (!el) return;
    v.blocked = false;
    el.play().catch((err: unknown) => {
      if (err instanceof Error && err.name === 'NotAllowedError') v.blocked = true;
    });
  }

  private startBuffer(cue: string, buffer: AudioBuffer, at: number, o: PlayOpts): Voice {
    const info = cueInfo(cue);
    const ctx = this.ctx;
    const loop = info?.kind === 'loop';
    const src = new AudioBufferSourceNode(ctx, { buffer, loop: loop || o.loop });
    if (loop && info?.length) {
      src.loopStart = 0;
      src.loopEnd = Math.min(info.length, buffer.duration);
    }
    const gain = new GainNode(ctx, { gain: 0 });
    let filter: BiquadFilterNode | null = null;
    if (loop) {
      filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cutoff(this.level), Q: 0.5 });
      src.connect(filter).connect(gain);
    } else {
      src.connect(gain);
    }
    gain.connect(this.duckGain);
    const bar = loop && info?.bpm ? (4 * 60) / info.bpm : 0;
    const v: Voice = { cue, gain, start: at, bar, src, el: null, node: null, filter, stopped: false };
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(this.loopGain(loop), at + Math.max(0.03, o.fadeIn));
    src.start(at);
    src.onended = () => {
      src.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
    if (loop) {
      this.beatBpm = info?.bpm ?? 0;
      this.nextBeat = at;
      this.beatCount = 0;
    }
    return v;
  }

  /** A loop's level follows intensity too: a quiet drone at 0, full at 1. */
  private loopGain(loop: boolean): number {
    return loop ? 0.6 + 0.4 * this.level : 1;
  }

  private release(v: Voice, at: number, fade: number): void {
    if (v.stopped) return;
    v.stopped = true;
    const now = this.ctx.currentTime;
    if (v.fade && v.el) {
      const el = v.el;
      const start = Math.max(now, at);
      v.fade = { from: this.fadeValue(v, start), to: 0, t0: start, t1: start + Math.max(0.05, fade) };
      this.fading.add(v);
      setTimeout(
        () => {
          this.fading.delete(v);
          this.dropElement(el);
        },
        (v.fade.t1 - now + 0.1) * 1000,
      );
      return;
    }
    const g = v.gain.gain;
    holdParam(g, now);
    g.setValueAtTime(g.value, Math.max(now, at));
    const end = Math.max(now, at) + Math.max(0.05, fade);
    g.linearRampToValueAtTime(0, end);
    if (v.src) {
      v.src.stop(end + 0.05);
    } else if (v.el) {
      const el = v.el;
      const done = (): void => {
        this.dropElement(el);
        v.node?.disconnect();
        v.gain.disconnect();
      };
      setTimeout(done, (end - now + 0.1) * 1000);
    }
  }

  intensity(v: number): void {
    this.level = Math.min(1, Math.max(0, v));
    const m = this.main;
    if (!m || !m.filter) return;
    const t = this.ctx.currentTime;
    holdParam(m.filter.frequency, t);
    m.filter.frequency.setTargetAtTime(cutoff(this.level), t, 0.8);
    holdParam(m.gain.gain, t);
    m.gain.gain.setTargetAtTime(this.loopGain(true), t, 0.8);
  }

  // ───────────────────────── Over the bed ─────────────────────────

  sting(cue: string | Motif, duck: number): void {
    if (cue === 'motif.checkpoint' || cue === 'motif.secret') {
      const s = this.opts.strip();
      if (!s) return;
      const t = this.ctx.currentTime + 0.02;
      if (cue === 'motif.checkpoint') chime(s, t, [62, 69], 0.05, 0.14);
      else secretMotif(s, t);
      s.seal();
      this.duck(duck, 1.5);
      return;
    }
    const buf = this.buffers.get(cue);
    if (!buf) {
      // Load it for next time; a stinger that arrives late would land on the wrong moment.
      void this.load(cue);
      if (cue.startsWith('sting.death')) this.opts.fallback?.(cue);
      return;
    }
    const t = this.ctx.currentTime + 0.02;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf });
    const g = new GainNode(this.ctx, { gain: 1 });
    src.connect(g).connect(this.muffler);
    src.start(t);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    this.duck(duck, Math.min(buf.duration, 6));
  }

  private duck(db: number, seconds: number): void {
    if (db >= 0) return;
    const t = this.ctx.currentTime;
    this.ducker.duck(t, Math.pow(10, db / 20), DUCK_ATTACK, t + seconds, DUCK_RELEASE);
  }

  heartbeat(bpm: number): void {
    if (bpm > 0 && this.heartBpm === 0) this.nextHeart = this.ctx.currentTime + 0.1;
    this.heartBpm = bpm;
  }

  muffle(v: number): void {
    const f = v <= 0 ? 20000 : 20000 * Math.pow(900 / 20000, Math.min(1, v));
    const t = this.ctx.currentTime;
    holdParam(this.muffler.frequency, t);
    this.muffler.frequency.setTargetAtTime(f, t, 0.4);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const el of this.elements) {
      if (paused) el.pause();
      else if (!el.ended) void el.play().catch(() => undefined);
    }
  }

  /** A user gesture or the page coming back: restart a stream the browser refused or paused. */
  kick(): void {
    const m = this.main;
    if (this.paused || !m?.el || m.stopped) return;
    if (m.blocked || m.interrupted || (m.el.paused && !m.el.ended)) this.retryStream(m);
  }

  /** Watchdog: a duck that never released. Returns what it fixed. */
  recover(): string[] {
    const t = this.ctx.currentTime;
    // Only while something plays into the duck (an idle node's value is stale, not stuck).
    const active = (this.main && !this.main.stopped && !this.main.fade) || this.fading.size > 0;
    if (active && t > this.ducker.end + 3 && this.duckGain.gain.value < 0.5) {
      this.ducker.apply(t);
      return ['musicStingDuck'];
    }
    return [];
  }

  snapshot(): Record<string, unknown> {
    const m = this.main;
    return {
      cue: m?.cue ?? null,
      elements: this.elements.size,
      streamPaused: m?.el ? m.el.paused : null,
      streamTime: m?.el ? Math.round(m.el.currentTime * 10) / 10 : null,
      duck: Math.round(this.ducker.value(this.ctx.currentTime) * 100) / 100,
      muffle: Math.round(this.muffler.frequency.value),
      decoded: this.buffers.size,
    };
  }

  private fadeValue(v: Voice, t: number): number {
    const f = v.fade;
    if (!f) return 1;
    if (t <= f.t0) return f.from;
    if (t >= f.t1) return f.to;
    return f.from + ((f.to - f.from) * (t - f.t0)) / (f.t1 - f.t0);
  }

  /** Direct streams: fade × music volume × ducking, applied to the element. */
  private applyDirect(v: Voice, now: number): void {
    if (!v.el || !v.fade) return;
    const level = this.opts.musicLevel?.() ?? 1;
    // Direct streams skip the muffling low-pass: at low health they dip instead.
    const muffle = Math.min(1, this.muffler.frequency.value / 20000);
    const vol = this.fadeValue(v, now) * level * this.ducker.value(now) * (0.55 + 0.45 * Math.sqrt(muffle));
    v.el.volume = Math.min(1, Math.max(0, vol));
  }

  /** Per frame: schedules the percussion layer and the heartbeat a little ahead; drives direct streams. */
  update(): void {
    const now = this.ctx.currentTime;
    if (this.main?.fade) this.applyDirect(this.main, now);
    for (const v of this.fading) this.applyDirect(v, now);
    const ahead = now + 0.15;
    if (this.beatBpm > 0 && this.level > 0.6 && this.main?.filter && !this.main.stopped) {
      const beat = 60 / this.beatBpm;
      // Fast tempos are felt in half time.
      const step = beat < 0.45 ? beat * 2 : beat;
      if (this.nextBeat < now - step) {
        this.nextBeat = this.main.start + Math.ceil((now - this.main.start) / step) * step;
      }
      while (this.nextBeat < ahead) {
        if (this.nextBeat >= now)
          this.drum(this.nextBeat, this.beatCount % 4 === 0, (this.level - 0.6) / 0.4);
        this.nextBeat += step;
        this.beatCount++;
      }
    }
    if (this.heartBpm > 0) {
      const period = 60 / this.heartBpm;
      if (this.nextHeart < now) this.nextHeart = now + 0.02;
      while (this.nextHeart < ahead) {
        this.heart(this.nextHeart);
        this.nextHeart += period;
      }
    }
  }

  /** Percussion layer: a low war drum, accented on the bar. */
  private drum(t: number, accent: boolean, k: number): void {
    const s = this.opts.strip();
    if (!s) return;
    timpani(s, t, accent ? 26 : 31, (accent ? 0.2 : 0.12) * Math.min(1, k + 0.3));
    s.seal();
  }

  /** Heartbeat: lub-dub, felt more than heard. */
  private heart(t: number): void {
    const s = this.opts.strip();
    if (!s) return;
    s.tone(t, { f: 58, f2: 38, gain: 0.32, a: 0.004, d: 0.16 });
    s.tone(t + 0.16, { f: 52, f2: 34, gain: 0.22, a: 0.004, d: 0.14 });
    s.seal();
  }

  /** Output level for the render checks. */
  get output(): AudioNode {
    return this.out;
  }
}
