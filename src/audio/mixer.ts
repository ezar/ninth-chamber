/**
 * The mixer (spec §12 "Mezclador"): five buses, a room reverb fed by per-bus
 * sends and crossfaded between presets, music ducking, a gentle master
 * compressor and a soft safety clipper so nothing ever reaches full scale.
 *
 *   bus ─┬───────────────────────────────► masterIn ─► compressor ─► clipper ─► mute ─► out
 *        └─► send ─► reverbIn ─► convolver A/B ─► wet ─┘
 *   music ─► duck ─► (dry + stereo echo) ─► masterIn
 */

import { dbToGain, holdParam } from './dsp';
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
  private readonly reverbIn: GainNode;
  private readonly slots: [ReverbSlot, ReverbSlot];
  private active: 0 | 1 = 0;
  private room: ReverbPreset | null = null;
  private duckEnd = 0;
  private readonly irCache = new Map<ReverbPreset, AudioBuffer>();

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode = ctx.destination,
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
      ir = generateImpulse(this.ctx, preset);
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
      if (typeof setTimeout === 'function') setTimeout(release, ROOM_FADE * 6000);
    }
    this.active = nextIndex;
  }

  /** Lowers the music 6 dB for `seconds` (extends an ongoing duck). */
  duck(seconds: number): void {
    const t = this.ctx.currentTime;
    const end = Math.max(this.duckEnd, t + seconds);
    const g = this.duckGain.gain;
    holdParam(g, t);
    if (this.duckEnd <= t) g.setTargetAtTime(dbToGain(DUCK_DB), t, 0.05);
    g.setTargetAtTime(1, end, 0.5);
    this.duckEnd = end;
  }

  setBusVolume(bus: BusName, v: number): void {
    const g = this.userGain[bus].gain;
    const t = this.ctx.currentTime;
    holdParam(g, t);
    g.setTargetAtTime(Math.min(1, Math.max(0, v)), t, 0.05);
  }

  setMuted(muted: boolean): void {
    const g = this.mute.gain;
    const t = this.ctx.currentTime;
    holdParam(g, t);
    g.setTargetAtTime(muted ? 0 : 1, t, 0.08);
  }
}

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
