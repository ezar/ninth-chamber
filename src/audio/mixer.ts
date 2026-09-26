/**
 * The mixer (spec §12 "Mezclador"): five buses, a room reverb fed by per-bus
 * sends and crossfaded between presets, music ducking, a gentle master
 * compressor and a soft safety clipper so nothing ever reaches full scale.
 *
 *   bus ─┬───────────────────────────────► masterIn ─► compressor ─► clipper ─► mute ─► out
 *        └─► send ─► reverbIn ─► convolver A/B ─► wet ─┘
 *   music ─► duck ─► (dry + stereo echo) ─► masterIn
 */

import { dbToGain, DuckEnvelope, holdParam } from './dsp';
import { generateImpulse, reverbWet, type ReverbPreset } from './reverb';

export type BusName = 'music' | 'ambience' | 'sfx' | 'ui' | 'voice';

const BUS_LEVEL: Record<BusName, number> = { music: 0.55, ambience: 0.8, sfx: 0.9, ui: 0.6, voice: 1 };
const REVERB_SEND: Record<BusName, number> = { music: 0.35, ambience: 0.45, sfx: 0.4, ui: 0.25, voice: 0.3 };
const ROOM_FADE = 0.45;
const DUCK_DB = -6;

interface ReverbSlot {
  conv: ConvolverNode | null;
  out: GainNode;
  preset: ReverbPreset | null;
}

export class Mixer {
  /** Where sounds for each bus are connected. */
  readonly bus: Record<BusName, GainNode>;
  private readonly userGain: Record<BusName, GainNode>;
  private readonly masterIn: GainNode;
  private readonly mute: GainNode;
  private readonly duckGain: GainNode;
  private readonly ducker: DuckEnvelope;
  private readonly reverbIn: GainNode;
  private readonly slots: [ReverbSlot, ReverbSlot];
  private active: 0 | 1 = 0;
  private room: ReverbPreset | null = null;
  private readonly irCache = new Map<ReverbPreset, AudioBuffer>();

  /** Output meter, created on first use (diagnostics only). */
  private meter: AnalyserNode | null = null;
  private meterData: Float32Array<ArrayBuffer> | null = null;
  private readonly volume: Record<BusName, number> = { music: 1, ambience: 1, sfx: 1, ui: 1, voice: 1 };
  private muted = false;
  private readonly suspects = new Set<StuckGain>();

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode = ctx.destination,
    /** Longest reverb tail (s); mobile uses a short one. */
    private readonly maxReverb = Infinity,
  ) {
    this.masterIn = new GainNode(ctx, { gain: 0.85 });
    const comp = new DynamicsCompressorNode(ctx, {
      threshold: -16,
      knee: 12,
      ratio: 3,
      attack: 0.004,
      release: 0.25,
    });
    const clip = new WaveShaperNode(ctx, { curve: softClipCurve(), oversample: '2x' });
    this.mute = new GainNode(ctx, { gain: 1 });
    this.masterIn.connect(comp).connect(clip).connect(this.mute).connect(destination);

    this.reverbIn = new GainNode(ctx, { gain: 1 });
    this.slots = [this.makeSlot(), this.makeSlot()];

    this.duckGain = new GainNode(ctx, { gain: 1 });
    this.ducker = new DuckEnvelope(this.duckGain.gain);
    this.duckGain.connect(this.masterIn);
    this.buildMusicEcho();

    const names: BusName[] = ['music', 'ambience', 'sfx', 'ui', 'voice'];
    const bus = {} as Record<BusName, GainNode>;
    const user = {} as Record<BusName, GainNode>;
    for (const name of names) {
      const input = new GainNode(ctx, { gain: BUS_LEVEL[name] });
      const vol = new GainNode(ctx, { gain: 1 });
      const send = new GainNode(ctx, { gain: REVERB_SEND[name] });
      input.connect(vol);
      vol.connect(name === 'music' ? this.duckGain : this.masterIn);
      vol.connect(send).connect(this.reverbIn);
      bus[name] = input;
      user[name] = vol;
    }
    this.bus = bus;
    this.userGain = user;
  }

  private makeSlot(): ReverbSlot {
    const out = new GainNode(this.ctx, { gain: 0 });
    out.connect(this.masterIn);
    return { conv: null, out, preset: null };
  }

  /** A short stereo echo that gives music cues space even in dry rooms. */
  private buildMusicEcho(): void {
    const ctx = this.ctx;
    const wet = new GainNode(ctx, { gain: 0.18 });
    wet.connect(this.masterIn);
    const taps: [number, number][] = [
      [0.37, -0.55],
      [0.53, 0.55],
    ];
    for (const [time, pan] of taps) {
      const delay = new DelayNode(ctx, { delayTime: time, maxDelayTime: 1 });
      const fb = new GainNode(ctx, { gain: 0.32 });
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400, Q: 0.3 });
      const p = new StereoPannerNode(ctx, { pan });
      this.duckGain.connect(delay);
      delay.connect(lp).connect(fb).connect(delay);
      lp.connect(p).connect(wet);
    }
  }

  private impulse(preset: ReverbPreset): AudioBuffer {
    let ir = this.irCache.get(preset);
    if (!ir) {
      ir = generateImpulse(this.ctx, preset, this.maxReverb);
      this.irCache.set(preset, ir);
    }
    return ir;
  }

  /** Pre-generates impulse responses so the first room change does not stall a frame. */
  warm(presets: readonly ReverbPreset[]): void {
    for (const p of presets) this.impulse(p);
  }

  get currentRoom(): ReverbPreset | null {
    return this.room;
  }

  /** Input of the room reverb, for per-sound sends on top of the bus sends. */
  get reverbSend(): AudioNode {
    return this.reverbIn;
  }

  setRoom(preset: ReverbPreset | null): void {
    if (preset === this.room) return;
    this.room = preset;
    const t = this.ctx.currentTime;
    const current = this.slots[this.active];
    if (preset === null) {
      holdParam(current.out.gain, t);
      current.out.gain.setTargetAtTime(0, t, ROOM_FADE);
      return;
    }
    const nextIndex: 0 | 1 = this.active === 0 ? 1 : 0;
    const next = this.slots[nextIndex];
    // A fresh convolver per change: some browsers refuse to swap a live buffer.
    if (next.conv) {
      this.reverbIn.disconnect(next.conv);
      next.conv.disconnect();
    }
    const conv = new ConvolverNode(this.ctx, { disableNormalization: true });
    conv.buffer = this.impulse(preset);
    this.reverbIn.connect(conv);
    conv.connect(next.out);
    next.conv = conv;
    next.preset = preset;
    holdParam(next.out.gain, t);
    next.out.gain.setTargetAtTime(reverbWet(preset), t, ROOM_FADE);
    holdParam(current.out.gain, t);
    current.out.gain.setTargetAtTime(0, t, ROOM_FADE);
    const old = current.conv;
    if (old) {
      // Release the old convolver once it has faded out.
      const release = (): void => {
        if (current.conv === old) {
          this.reverbIn.disconnect(old);
          old.disconnect();
          current.conv = null;
          current.preset = null;
        }
      };
      // Released once faded (about four time constants): a live convolver costs even at gain 0.
      if (typeof setTimeout === 'function') setTimeout(release, ROOM_FADE * 4500);
    }
    this.active = nextIndex;
  }

  /** Lowers the music 6 dB for `seconds` (extends an ongoing duck). */
  duck(seconds: number): void {
    const t = this.ctx.currentTime;
    this.ducker.duck(t, dbToGain(DUCK_DB), 0.15, t + seconds, 1.5);
  }

  /** The music duck now (exact in JS; for music that plays outside Web Audio). */
  duckLevel(): number {
    return this.ducker.value(this.ctx.currentTime);
  }

  setBusVolume(bus: BusName, v: number): void {
    this.volume[bus] = Math.min(1, Math.max(0, v));
    const g = this.userGain[bus].gain;
    const t = this.ctx.currentTime;
    holdParam(g, t);
    g.setTargetAtTime(Math.min(1, Math.max(0, v)), t, 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const g = this.mute.gain;
    const t = this.ctx.currentTime;
    holdParam(g, t);
    g.setTargetAtTime(muted ? 0 : 1, t, 0.08);
  }

  /**
   * Self-healing (the audio watchdog, every second): a gain that should be
   * open but sits near 0 with no automation reason (a duck that never
   * released, a mute that never lifted, a bus volume lost to a cancelled
   * ramp) is snapped back. Returns what it fixed.
   */
  recover(): StuckGain[] {
    const t = this.ctx.currentTime;
    const fixed: StuckGain[] = [];
    // A param reads stale while its node is idle, so a gain must look wrong twice in a row.
    const suspect = (name: StuckGain, wrong: boolean): boolean => {
      const again = wrong && this.suspects.has(name);
      if (wrong) this.suspects.add(name);
      else this.suspects.delete(name);
      if (again) this.suspects.delete(name);
      return again;
    };
    const reset = (p: AudioParam, v: number): void => {
      p.cancelScheduledValues(0);
      p.setValueAtTime(v, t);
    };
    if (suspect('mute', !this.muted && this.mute.gain.value < 0.5)) {
      reset(this.mute.gain, 1);
      fixed.push('mute');
    }
    if (suspect('duck', t > this.ducker.end + 3 && this.duckGain.gain.value < 0.5)) {
      this.ducker.apply(t);
      fixed.push('duck');
    }
    for (const bus of Object.keys(this.volume) as BusName[]) {
      const want = this.volume[bus];
      if (suspect(bus, want > 0.05 && this.userGain[bus].gain.value < want * 0.5)) {
        reset(this.userGain[bus].gain, want);
        fixed.push(bus);
      }
    }
    return fixed;
  }

  /** Linear level a bus reaches the output at (options volume, bus level, master, mute, duck): for direct media. */
  outputLevel(bus: BusName): number {
    const duck = bus === 'music' ? this.duckLevel() : 1;
    return this.muted ? 0 : this.volume[bus] * BUS_LEVEL[bus] * 0.85 * duck;
  }

  /** Diagnostics: the current gains of the master chain and the buses. */
  gains(): Record<string, number> {
    const out: Record<string, number> = {
      master: this.masterIn.gain.value,
      mute: this.mute.gain.value,
      musicDuck: this.duckGain.gain.value,
    };
    for (const bus of Object.keys(this.userGain) as BusName[]) out[bus] = this.userGain[bus].gain.value;
    return out;
  }

  /** Diagnostics: RMS level of everything going into the master (dBFS). */
  level(): number {
    if (!this.meter) {
      this.meter = new AnalyserNode(this.ctx, { fftSize: 2048 });
      this.meterData = new Float32Array(new ArrayBuffer(2048 * 4));
      this.masterIn.connect(this.meter);
    }
    const d = this.meterData as Float32Array<ArrayBuffer>;
    this.meter.getFloatTimeDomainData(d);
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += (d[i] ?? 0) ** 2;
    return 10 * Math.log10(sum / d.length + 1e-12);
  }
}

/** Gains the watchdog found stuck, and reset (see Mixer.recover). */
export type StuckGain = 'mute' | 'duck' | BusName;

/** Linear up to 0.6, then a tanh knee that never exceeds 0.98. */
function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax < 0.6 ? ax : 0.6 + 0.38 * Math.tanh((ax - 0.6) / 0.38);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
