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
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
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

export function createPanner(ctx: BaseAudioContext, refDistance: number, rolloff: number): PannerNode {
  return new PannerNode(ctx, {
    panningModel: 'HRTF',
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

/**
 * A one-shot sound under construction: a gain input (optionally spatialised)
 * that frees itself once every source added to it has ended.
 */
export class Strip {
  readonly input: GainNode;
  private readonly panner: PannerNode | null;
  private pending = 0;
  private sealed = false;
  private disposed = false;
  /** Latest end time of any source (context time). */
  end = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly noise: NoiseBank,
    dest: AudioNode,
    at: Vec3 | null,
    private readonly onDone: () => void,
  ) {
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

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.disconnect();
    this.panner?.disconnect();
    this.onDone();
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
