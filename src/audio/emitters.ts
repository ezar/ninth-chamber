/**
 * Looping positional sources through HRTF panners (spec §12 "Sonido 3D"):
 * fire crackle for braziers, a low shimmering hum for relics. Sources far
 * from the listener are stopped and restarted when approached, so a level
 * full of braziers costs only the ones you can hear.
 */

import { createPanner, holdParam, rnd, setPannerPosition, type NoiseBank, type Vec3 } from './dsp';

export interface EmitterDef extends Vec3 {
  id: string;
  kind: 'brazier' | 'relic';
}

const START_DISTANCE = 30;
const STOP_DISTANCE = 34;
const FADE = 0.6;

interface Live {
  def: EmitterDef;
  panner: PannerNode;
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

const fires = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A 7 s loopable fire: flickering low roar, faint hiss, and crackles with a heavy-tailed size distribution. */
function fireBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = fires.get(ctx);
  if (cached) return cached;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 7);
  const xf = Math.floor(sr * 0.3);
  const total = len + xf;
  const data = new Float32Array(total);
  let brown = 0;
  let lp = 0;
  let hpPrev = 0;
  let flicker = 0.6;
  let flickerTarget = 0.6;
  let nextFlicker = 0;
  let crackle = 0;
  let crackleAmp = 0;
  let crackleDecay = 0;
  let pop = 0;
  let popPhase = 0;
  let popFreq = 0;
  let popDecay = 0;
  const flickerSmooth = 1 - Math.exp(-1 / (sr * 0.04));
  for (let i = 0; i < total; i++) {
    if (i >= nextFlicker) {
      flickerTarget = rnd(0.35, 1);
      nextFlicker = i + Math.floor(sr * rnd(0.05, 0.2));
    }
    flicker += (flickerTarget - flicker) * flickerSmooth;
    const w = Math.random() * 2 - 1;
    brown = (brown + 0.03 * w) * 0.995;
    lp += 0.2 * (brown - lp);
    const hiss = w - hpPrev;
    hpPrev = w;
    // Crackles: short noise bursts, many tiny and a few loud.
    if (Math.random() < 11 / sr) {
      const r = Math.random();
      crackleAmp = 0.08 + r * r * r * 0.9;
      crackleDecay = Math.exp(-1 / (sr * rnd(0.0008, 0.004)));
      crackle = 1;
    }
    crackle *= crackleDecay;
    // Pops: a damped resonance, the sound of sap bursting.
    if (Math.random() < 1.2 / sr) {
      pop = rnd(0.2, 0.5);
      popFreq = rnd(350, 900);
      popDecay = Math.exp(-1 / (sr * rnd(0.006, 0.015)));
      popPhase = 0;
    }
    pop *= popDecay;
    popPhase += (2 * Math.PI * popFreq) / sr;
    data[i] =
      lp * 0.8 * flicker + hiss * 0.012 * flicker + crackle * crackleAmp * w + pop * Math.sin(popPhase);
  }
  const out = new Float32Array(len);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    let v = data[i] ?? 0;
    if (i < xf) {
      const k = (i / xf) * (Math.PI / 2);
      v = v * Math.sin(k) + (data[len + i] ?? 0) * Math.cos(k);
    }
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak > 0) for (let i = 0; i < len; i++) out[i] = ((out[i] ?? 0) / peak) * 0.9;
  const buf = ctx.createBuffer(1, len, sr);
  buf.copyToChannel(out, 0);
  fires.set(ctx, buf);
  return buf;
}

export class EmitterSet {
  private defs = new Map<string, EmitterDef>();
  private live = new Map<string, Live>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly noise: NoiseBank,
    private readonly dest: AudioNode,
  ) {}

  set(list: readonly EmitterDef[]): void {
    const next = new Map<string, EmitterDef>();
    for (const e of list) next.set(e.id, { ...e });
    for (const [id, l] of this.live) {
      const def = next.get(id);
      if (!def || def.kind !== l.def.kind) this.stop(id);
      else {
        l.def = def;
        setPannerPosition(l.panner, def, this.ctx.currentTime, 0.05);
      }
    }
    this.defs = next;
  }

  /** Starts sources that came into range and stops those that left it. */
  update(listener: Vec3): void {
    for (const [id, def] of this.defs) {
      const d = Math.hypot(def.x - listener.x, def.y - listener.y, def.z - listener.z);
      const on = this.live.has(id);
      if (!on && d < START_DISTANCE) this.start(def);
      else if (on && d > STOP_DISTANCE) this.stop(id);
    }
  }

  private start(def: EmitterDef): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const brazier = def.kind === 'brazier';
    const panner = createPanner(ctx, brazier ? 1.5 : 1.2, brazier ? 1.1 : 1.4);
    setPannerPosition(panner, def, t);
    const gain = new GainNode(ctx, { gain: 0 });
    gain.connect(panner).connect(this.dest);
    const level = brazier ? 0.32 : 0.12;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + FADE * 2);
    const live: Live = { def, panner, gain, sources: [], nodes: [] };
    if (brazier) this.buildFire(live, t);
    else this.buildRelic(live, t);
    this.live.set(def.id, live);
  }

  private buildFire(l: Live, t: number): void {
    const ctx = this.ctx;
    const buf = fireBuffer(ctx);
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true, playbackRate: rnd(0.93, 1.07) });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 70, Q: 0.5 });
    src.connect(hp).connect(l.gain);
    src.start(t, Math.random() * buf.duration);
    // A breathy low "whoomph" layer from the shared brown noise, flickering slowly.
    const roar = new AudioBufferSourceNode(ctx, { buffer: this.noise.brown, loop: true });
    const roarLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 260, Q: 0.6 });
    const roarGain = new GainNode(ctx, { gain: 0.35 });
    const lfo = new OscillatorNode(ctx, { frequency: rnd(0.2, 0.35) });
    const lfoDepth = new GainNode(ctx, { gain: 0.12 });
    lfo.connect(lfoDepth).connect(roarGain.gain);
    roar.connect(roarLp).connect(roarGain).connect(l.gain);
    roar.start(t, Math.random() * this.noise.brown.duration);
    lfo.start(t);
    l.sources.push(src, roar, lfo);
    l.nodes.push(hp, roarLp, roarGain, lfoDepth);
  }

  /** Relic hum: a warm A2 fifth with a slow beat, and a faint high shimmer with tremolo. */
  private buildRelic(l: Live, t: number): void {
    const ctx = this.ctx;
    const partials: [number, number][] = [
      [110, 0.5],
      [110.6, 0.3],
      [165, 0.22],
      [220.4, 0.12],
      [1318.5, 0.025],
      [1760.9, 0.018],
    ];
    const low = new GainNode(ctx, { gain: 1 });
    const high = new GainNode(ctx, { gain: 1 });
    low.connect(l.gain);
    high.connect(l.gain);
    for (const [f, g] of partials) {
      const osc = new OscillatorNode(ctx, { frequency: f });
      const og = new GainNode(ctx, { gain: g });
      osc.connect(og).connect(f > 1000 ? high : low);
      osc.start(t);
      l.sources.push(osc);
      l.nodes.push(og);
    }
    const breathe = new OscillatorNode(ctx, { frequency: 0.19 });
    const breatheDepth = new GainNode(ctx, { gain: 0.25 });
    breathe.connect(breatheDepth).connect(low.gain);
    const trem = new OscillatorNode(ctx, { frequency: 4.7 });
    const tremDepth = new GainNode(ctx, { gain: 0.6 });
    trem.connect(tremDepth).connect(high.gain);
    breathe.start(t);
    trem.start(t);
    l.sources.push(breathe, trem);
    l.nodes.push(low, high, breatheDepth, tremDepth);
  }

  private stop(id: string): void {
    const l = this.live.get(id);
    if (!l) return;
    this.live.delete(id);
    const t = this.ctx.currentTime;
    holdParam(l.gain.gain, t);
    l.gain.gain.linearRampToValueAtTime(0, t + FADE);
    const end = t + FADE + 0.05;
    let pending = l.sources.length;
    for (const s of l.sources) {
      s.onended = () => {
        s.disconnect();
        if (--pending === 0) {
          for (const n of l.nodes) n.disconnect();
          l.gain.disconnect();
          l.panner.disconnect();
        }
      };
      s.stop(end);
    }
  }

  stopAll(): void {
    for (const id of [...this.live.keys()]) this.stop(id);
  }
}
