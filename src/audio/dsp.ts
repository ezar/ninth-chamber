/**
 * Small synthesis toolkit shared by every procedural sound (spec §12).
 *
 * Audio is presentation only, so it may use Math.random freely.
 * CPU rules: noise lives in a few buffers generated once per context and is
 * replayed from random offsets; every one-shot node is stopped and
 * disconnected when its sound ends.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Envelope floor: about -80 dB, the target of exponential ramps. */
export const FLOOR = 0.0001;

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Equal-tempered MIDI note to Hz (A4 = 69 = 440 Hz). */
export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
export const dbToGain = (db: number): number => 10 ** (db / 20);

/** Stops an automation at `t` keeping its current value, so a new ramp starts without a jump. */
export function holdParam(param: AudioParam, t: number): void {
  // Not cancelAndHoldAtTime: engines disagree on it around setTargetAtTime curves, and it is
  // missing in some. Cancel and restart from the current value instead.
  const v = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(v, t);
}

/**
 * A duck (dip and release) on a gain, known in JS at any time: `value(t)` is
 * exact even while the node is idle, and the AudioParam gets plain linear
 * ramps that always land on their values.
 */
export class DuckEnvelope {
  private from = 1;
  private depth = 1;
  private t0 = 0;
  private attackEnd = 0;
  private holdEnd = 0;
  private releaseEnd = 0;

  constructor(private readonly param: AudioParam) {}

  value(t: number): number {
    if (t >= this.releaseEnd) return 1;
    if (t <= this.t0) return this.from;
    if (t < this.attackEnd)
      return this.from + ((this.depth - this.from) * (t - this.t0)) / (this.attackEnd - this.t0);
    if (t < this.holdEnd) return this.depth;
    return this.depth + ((1 - this.depth) * (t - this.holdEnd)) / (this.releaseEnd - this.holdEnd);
  }

  /** Dips to `gain` over `attack`, holds until `until` (extending a duck in progress), releases over `release`. */
  duck(t: number, gain: number, attack: number, until: number, release: number): void {
    const from = this.value(t);
    const depth = t < this.releaseEnd ? Math.min(gain, this.depth) : gain;
    const holdEnd = Math.max(until, t < this.releaseEnd ? this.holdEnd : 0, t + attack);
    this.from = from;
    this.depth = depth;
    this.t0 = t;
    this.attackEnd = t + attack;
    this.holdEnd = holdEnd;
    this.releaseEnd = holdEnd + release;
    this.apply(t);
  }

  /** Re-schedules the param from the envelope (also the watchdog's repair). */
  apply(t: number): void {
    const p = this.param;
    p.cancelScheduledValues(0);
    p.setValueAtTime(this.value(t), t);
    if (t < this.attackEnd) p.linearRampToValueAtTime(this.depth, this.attackEnd);
    if (t < this.holdEnd) p.setValueAtTime(this.depth, this.holdEnd);
    if (t < this.releaseEnd) p.linearRampToValueAtTime(1, this.releaseEnd);
  }

  get busy(): boolean {
    return this.releaseEnd > 0;
  }

  get end(): number {
    return this.releaseEnd;
  }
}

/** Crossfades the tail of `data` (the last `xf` samples) into its head so it loops without a click. */
function makeLoopable(data: Float32Array, len: number, xf: number): Float32Array {
  const out = new Float32Array(len);
  out.set(data.subarray(0, len));
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    const head = data[i] ?? 0;
    const tail = data[len + i] ?? 0;
    out[i] = head * Math.sin((k * Math.PI) / 2) + tail * Math.cos((k * Math.PI) / 2);
  }
  return out;
}

function normalizePeak(data: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < data.length; i++) max = Math.max(max, Math.abs(data[i] ?? 0));
  if (max <= 0) return;
  const k = peak / max;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] ?? 0) * k;
}

function bufferFrom(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return buf;
}

export type NoiseKind = 'white' | 'pink' | 'brown' | 'grind';

/**
 * Noise buffers generated once per AudioContext. `pink` is long and loopable
 * (ambience beds); `grind` is a stick-slip stone-on-stone texture.
 */
export class NoiseBank {
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  readonly grind: AudioBuffer;

  constructor(ctx: BaseAudioContext) {
    const sr = ctx.sampleRate;
    const xf = Math.floor(sr * 0.25);

    const white = new Float32Array(Math.floor(sr * 3));
    for (let i = 0; i < white.length; i++) white[i] = Math.random() * 2 - 1;
    this.white = bufferFrom(ctx, white);

    // Pink (Paul Kellet's economy filter), 12 s so the ambience loop never sounds repetitive.
    const pinkLen = Math.floor(sr * 12);
    const pink = new Float32Array(pinkLen + xf);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < pink.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      pink[i] = b0 + b1 + b2 + w * 0.1848;
    }
    const pinkLoop = makeLoopable(pink, pinkLen, xf);
    normalizePeak(pinkLoop, 0.9);
    this.pink = bufferFrom(ctx, pinkLoop);

    // Brown (leaky integrator), loopable too.
    const brownLen = Math.floor(sr * 6);
    const brown = new Float32Array(brownLen + xf);
    let acc = 0;
    for (let i = 0; i < brown.length; i++) {
      acc = (acc + 0.02 * (Math.random() * 2 - 1)) * 0.998;
      brown[i] = acc;
    }
    const brownLoop = makeLoopable(brown, brownLen, xf);
    normalizePeak(brownLoop, 0.9);
    this.brown = bufferFrom(ctx, brownLoop);

    // Grind: brown-ish body whose amplitude jumps in small stick-slip steps, plus grit ticks.
    const grindLen = Math.floor(sr * 4);
    const grind = new Float32Array(grindLen + xf);
    let body = 0;
    let amp = 0.5;
    let target = 0.5;
    let nextStep = 0;
    const smooth = 1 - Math.exp(-1 / (sr * 0.004));
    for (let i = 0; i < grind.length; i++) {
      if (i >= nextStep) {
        const r = Math.random();
        target = 0.25 + r * r * 0.9;
        nextStep = i + Math.floor(sr * rnd(0.004, 0.018));
      }
      amp += (target - amp) * smooth;
      body = (body + 0.08 * (Math.random() * 2 - 1)) * 0.985;
      let v = body * amp;
      if (Math.random() < 30 / sr) v += (Math.random() * 2 - 1) * 0.6;
      grind[i] = v;
    }
    const grindLoop = makeLoopable(grind, grindLen, xf);
    normalizePeak(grindLoop, 0.9);
    this.grind = bufferFrom(ctx, grindLoop);
  }

  get(kind: NoiseKind): AudioBuffer {
    return this[kind];
  }
}

const banks = new WeakMap<BaseAudioContext, NoiseBank>();

export function noiseBank(ctx: BaseAudioContext): NoiseBank {
  let bank = banks.get(ctx);
  if (!bank) {
    bank = new NoiseBank(ctx);
    banks.set(ctx, bank);
  }
  return bank;
}

export function setPannerPosition(p: PannerNode, v: Vec3, t: number, smooth = 0): void {
  if (p.positionX) {
    if (smooth > 0) {
      p.positionX.setTargetAtTime(v.x, t, smooth);
      p.positionY.setTargetAtTime(v.y, t, smooth);
      p.positionZ.setTargetAtTime(v.z, t, smooth);
    } else {
      p.positionX.setValueAtTime(v.x, t);
      p.positionY.setValueAtTime(v.y, t);
      p.positionZ.setValueAtTime(v.z, t);
    }
  } else {
    p.setPosition(v.x, v.y, v.z);
  }
}

let panningModel: PanningModelType = 'HRTF';

/**
 * HRTF (two convolutions per voice) or equal-power panning. Phones use
 * equal-power: a dozen HRTF voices is enough to overload a mobile audio thread.
 */
export function setPanningModel(model: PanningModelType): void {
  panningModel = model;
}

export function createPanner(ctx: BaseAudioContext, refDistance: number, rolloff: number): PannerNode {
  return new PannerNode(ctx, {
    panningModel,
    distanceModel: 'inverse',
    refDistance,
    maxDistance: 60,
    rolloffFactor: rolloff,
  });
}

export interface NoiseOpts {
  buf?: NoiseKind;
  /** Main filter. */
  type?: BiquadFilterType;
  f: number;
  /** Sweep the filter to this frequency over the sound. */
  f2?: number;
  q?: number;
  /** Optional extra low-pass (Hz). */
  lp?: number;
  gain: number;
  /** Attack, hold and decay (s). */
  a: number;
  hold?: number;
  d: number;
  rate?: number;
  pan?: number;
}

export interface ToneOpts {
  wave?: OscillatorType;
  f: number;
  /** Glide to this frequency over `glide` seconds (default: the whole sound). */
  f2?: number;
  glide?: number;
  gain: number;
  a: number;
  hold?: number;
  d: number;
  /** Optional low-pass (Hz), for sawtooth or square sources. */
  lp?: number;
  detune?: number;
  pan?: number;
}

export interface SampleOpts {
  /** Playback rate (1 = original pitch and speed). */
  rate?: number | undefined;
  gain?: number | undefined;
  pan?: number | undefined;
  /** Where to start in the buffer (s). */
  offset?: number | undefined;
  /** Cut the sound after this long (s), with `fadeOut`; loops need it. */
  duration?: number | undefined;
  fadeOut?: number | undefined;
  /** Optional fade-in (s), for loops and cut-in starts. */
  fadeIn?: number | undefined;
  /** Optional low-pass (Hz): distance, muffling. */
  lp?: number | undefined;
  /** Loop the buffer between 0 and this time (s) for `duration`. */
  loopEnd?: number | undefined;
}

/**
 * A one-shot sound under construction: a gain input (optionally spatialised)
 * that frees itself once every source added to it has ended.
 */
export class Strip {
  readonly input: GainNode;
  private readonly panner: PannerNode | null;
  private readonly sends: GainNode[] = [];
  private pending = 0;
  private sealed = false;
  private disposed = false;
  /** Latest end time of any source (context time). */
  end = 0;
  /** Context time when the strip was made. */
  readonly born: number;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly noise: NoiseBank,
    dest: AudioNode,
    at: Vec3 | null,
    private readonly onDone: () => void,
  ) {
    this.born = ctx.currentTime;
    this.input = new GainNode(ctx, { gain: 1 });
    if (at) {
      this.panner = createPanner(ctx, 3, 1);
      setPannerPosition(this.panner, at, ctx.currentTime);
      this.input.connect(this.panner).connect(dest);
    } else {
      this.panner = null;
      this.input.connect(dest);
    }
  }

  /** Registers a source; `nodes` are disconnected when it ends. */
  own(src: AudioScheduledSourceNode, stopAt: number, ...nodes: AudioNode[]): void {
    this.pending++;
    this.end = Math.max(this.end, stopAt);
    src.onended = () => {
      src.disconnect();
      for (const n of nodes) n.disconnect();
      this.pending--;
      if (this.sealed && this.pending === 0) this.dispose();
    };
  }

  /** Call after adding every source. */
  seal(): void {
    this.sealed = true;
    if (this.pending === 0) this.dispose();
  }

  get done(): boolean {
    return this.disposed;
  }

  /**
   * Frees the strip even if some source never reported its end (a lost
   * `ended` event would otherwise hold its voice forever). Used by the voice
   * reaper for strips long past their scheduled end.
   */
  forceDispose(): void {
    this.sealed = true;
    this.dispose();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.disconnect();
    this.panner?.disconnect();
    for (const s of this.sends) s.disconnect();
    this.onDone();
  }

  /** An extra, per-sound send (post-panner) to `dest`, e.g. more room reverb for footsteps. */
  send(dest: AudioNode, amount: number): void {
    const g = new GainNode(this.ctx, { gain: amount });
    (this.panner ?? this.input).connect(g).connect(dest);
    this.sends.push(g);
  }

  /** Plays a recorded buffer into the strip; returns the end time. */
  sample(t: number, buffer: AudioBuffer, o: SampleOpts = {}, out: AudioNode = this.input): number {
    const ctx = this.ctx;
    const rate = o.rate ?? 1;
    const offset = Math.min(o.offset ?? 0, Math.max(0, buffer.duration - 0.01));
    const loop = o.loopEnd !== undefined && o.duration !== undefined;
    const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate, loop });
    if (loop) {
      src.loopStart = 0;
      src.loopEnd = o.loopEnd ?? buffer.duration;
    }
    const gain = o.gain ?? 1;
    const g = new GainNode(ctx, { gain });
    const chain: AudioNode[] = [g];
    let head: AudioNode = src;
    if (o.lp !== undefined) {
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.lp, Q: 0.5 });
      head.connect(lp);
      head = lp;
      chain.push(lp);
    }
    head.connect(g);
    chain.push(...this.tail(g, o.pan, out));
    const natural = t + (buffer.duration - offset) / rate;
    let end = natural;
    if (o.fadeIn !== undefined && o.fadeIn > 0) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + o.fadeIn);
    }
    if (o.duration !== undefined && (loop || t + o.duration < natural)) {
      const fade = o.fadeOut ?? 0.08;
      const cut = t + Math.max(o.duration, (o.fadeIn ?? 0) + 0.005);
      end = cut + fade;
      g.gain.setValueAtTime(gain, cut);
      g.gain.linearRampToValueAtTime(0, end);
    }
    src.start(t, offset);
    src.stop(end + 0.02);
    this.own(src, end + 0.02, ...chain);
    return end;
  }

  /** Applies an attack / hold / exponential decay envelope; returns the end time. */
  envelope(param: AudioParam, t: number, peak: number, a: number, hold: number, d: number): number {
    const top = Math.max(peak, FLOOR * 2);
    param.setValueAtTime(FLOOR, t);
    param.linearRampToValueAtTime(top, t + Math.max(a, 0.001));
    if (hold > 0) param.setValueAtTime(top, t + a + hold);
    const end = t + a + hold + d;
    param.exponentialRampToValueAtTime(FLOOR, end);
    param.setValueAtTime(0, end + 0.001);
    return end;
  }

  private tail(node: AudioNode, pan: number | undefined, out: AudioNode): AudioNode[] {
    if (pan === undefined || pan === 0) {
      node.connect(out);
      return [];
    }
    const p = new StereoPannerNode(this.ctx, { pan: clamp(pan, -1, 1) });
    node.connect(p).connect(out);
    return [p];
  }

  noiseHit(t: number, o: NoiseOpts, out: AudioNode = this.input): number {
    const ctx = this.ctx;
    const buf = this.noise.get(o.buf ?? 'white');
    const hold = o.hold ?? 0;
    const dur = o.a + hold + o.d;
    const rate = o.rate ?? 1;
    const src = new AudioBufferSourceNode(ctx, {
      buffer: buf,
      playbackRate: rate,
      loop: dur * rate > buf.duration - 0.1,
    });
    const filter = new BiquadFilterNode(ctx, { type: o.type ?? 'bandpass', frequency: o.f, Q: o.q ?? 0.7 });
    if (o.f2 !== undefined) {
      filter.frequency.setValueAtTime(o.f, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    }
    const env = new GainNode(ctx, { gain: 0 });
    const chain: AudioNode[] = [filter, env];
    let last: AudioNode = filter;
    src.connect(filter);
    if (o.lp !== undefined) {
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.lp, Q: 0.5 });
      last.connect(lp);
      last = lp;
      chain.push(lp);
    }
    last.connect(env);
    chain.push(...this.tail(env, o.pan, out));
    const end = this.envelope(env.gain, t, o.gain, o.a, hold, o.d);
    const maxOffset = Math.max(0, buf.duration - dur * rate - 0.05);
    src.start(t, Math.random() * maxOffset);
    src.stop(end + 0.02);
    this.own(src, end + 0.02, ...chain);
    return end;
  }

  tone(t: number, o: ToneOpts, out: AudioNode = this.input): number {
    const ctx = this.ctx;
    const hold = o.hold ?? 0;
    const dur = o.a + hold + o.d;
    const osc = new OscillatorNode(ctx, { type: o.wave ?? 'sine', frequency: o.f, detune: o.detune ?? 0 });
    if (o.f2 !== undefined) {
      osc.frequency.setValueAtTime(o.f, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.glide ?? dur));
    }
    const env = new GainNode(ctx, { gain: 0 });
    const chain: AudioNode[] = [env];
    if (o.lp !== undefined) {
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.lp, Q: 0.6 });
      osc.connect(lp).connect(env);
      chain.push(lp);
    } else {
      osc.connect(env);
    }
    chain.push(...this.tail(env, o.pan, out));
    const end = this.envelope(env.gain, t, o.gain, o.a, hold, o.d);
    osc.start(t);
    osc.stop(end + 0.02);
    this.own(osc, end + 0.02, ...chain);
    return end;
  }

  /** A scatter of tiny grit / debris ticks between t0 and t1. */
  debris(t0: number, t1: number, count: number, gain: number, fLo = 1500, fHi = 4500): void {
    for (let i = 0; i < count; i++) {
      const r = Math.random();
      this.noiseHit(t0 + Math.random() * (t1 - t0), {
        type: 'bandpass',
        f: rnd(fLo, fHi),
        q: rnd(1.5, 4),
        gain: gain * (0.3 + r * r),
        a: 0.0008,
        d: rnd(0.008, 0.035),
        pan: rnd(-0.4, 0.4),
      });
    }
  }
}
