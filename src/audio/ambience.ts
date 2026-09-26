/**
 * Continuous, discreet ambience (spec §12 "Ambiente por sala"): a low drone
 * around 55 Hz that breathes slowly, plus two bands of filtered air drifting
 * across the stereo field. Cisterns add sparse water drips. Everything is a
 * handful of long-lived nodes modulated by very slow LFOs: no per-frame work
 * except scheduling the occasional drip.
 */

import { clamp, holdParam, rnd, type NoiseBank, type Strip } from './dsp';
import type { ReverbPreset } from './reverb';
import { drip } from './sfx';

interface RoomColour {
  drone: number;
  air: number;
  airFreq: number;
  drips: boolean;
}

const ROOM: Record<ReverbPreset | 'none', RoomColour> = {
  none: { drone: 1, air: 1, airFreq: 420, drips: false },
  stone_small: { drone: 1.1, air: 0.6, airFreq: 520, drips: false },
  stone_medium: { drone: 1, air: 0.9, airFreq: 440, drips: false },
  hall_large: { drone: 0.9, air: 1.3, airFreq: 360, drips: false },
  water_cistern: { drone: 0.8, air: 0.7, airFreq: 600, drips: true },
};

const DRONE_LEVEL = 0.05;
const AIR_LEVEL = 0.035;

export class Ambience {
  private readonly out: GainNode;
  private readonly droneGain: GainNode;
  private readonly airGain: GainNode;
  private readonly airFilters: BiquadFilterNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private drips = false;
  private nextDrip = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    noise: NoiseBank,
    dest: AudioNode,
    private readonly strip: () => Strip | null,
  ) {
    this.out = new GainNode(ctx, { gain: 0 });
    this.out.connect(dest);

    // Drone: two 55 Hz sines beating slowly, a quiet octave and fifth for small speakers.
    this.droneGain = new GainNode(ctx, { gain: DRONE_LEVEL });
    const droneLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 240, Q: 0.5 });
    droneLp.connect(this.droneGain).connect(this.out);
    const partials: [OscillatorType, number, number][] = [
      ['sine', 55, 0.5],
      ['sine', 55.21, 0.45],
      ['triangle', 110.37, 0.12],
      ['sine', 82.6, 0.1],
    ];
    for (const [type, f, g] of partials) {
      const osc = new OscillatorNode(ctx, { type, frequency: f });
      const gain = new GainNode(ctx, { gain: g });
      osc.connect(gain).connect(droneLp);
      this.sources.push(osc);
    }
    this.lfo(0.043, DRONE_LEVEL * 0.3, this.droneGain.gain);
    this.lfo(0.023, 70, droneLp.frequency);

    // Air: two independent pink-noise bands, slowly sweeping and gusting, left and right.
    this.airGain = new GainNode(ctx, { gain: AIR_LEVEL });
    this.airGain.connect(this.out);
    const bands: [number, number, number][] = [
      [-0.7, 0.061, 0.083],
      [0.7, 0.047, 0.071],
    ];
    for (const [pan, sweepRate, gustRate] of bands) {
      const src = new AudioBufferSourceNode(ctx, { buffer: noise.pink, loop: true });
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 420, Q: 0.8 });
      const gust = new GainNode(ctx, { gain: 0.6 });
      const p = new StereoPannerNode(ctx, { pan });
      src.connect(bp).connect(gust).connect(p).connect(this.airGain);
      this.lfo(sweepRate, 170, bp.frequency);
      this.lfo(gustRate, 0.35, gust.gain);
      this.airFilters.push(bp);
      this.sources.push(src);
    }
    // A very low rumble bed under the air.
    const bed = new AudioBufferSourceNode(ctx, { buffer: noise.brown, loop: true });
    const bedLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 90, Q: 0.5 });
    const bedGain = new GainNode(ctx, { gain: 0.25 });
    bed.connect(bedLp).connect(bedGain).connect(this.airGain);
    this.sources.push(bed);
  }

  private lfo(rate: number, depth: number, param: AudioParam): void {
    const osc = new OscillatorNode(this.ctx, { frequency: rate * rnd(0.9, 1.1) });
    const g = new GainNode(this.ctx, { gain: depth });
    osc.connect(g).connect(param);
    this.sources.push(osc);
  }

  start(fadeIn = 4): void {
    const t = this.ctx.currentTime;
    for (const s of this.sources) {
      if (s instanceof AudioBufferSourceNode && s.buffer) s.start(t, Math.random() * s.buffer.duration);
      else s.start(t);
    }
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(1, t + fadeIn);
  }

  setRoom(preset: ReverbPreset | null): void {
    const c = ROOM[preset ?? 'none'];
    const t = this.ctx.currentTime;
    holdParam(this.droneGain.gain, t);
    this.droneGain.gain.setTargetAtTime(DRONE_LEVEL * c.drone, t, 1.2);
    holdParam(this.airGain.gain, t);
    this.airGain.gain.setTargetAtTime(AIR_LEVEL * c.air, t, 1.2);
    for (const f of this.airFilters) {
      holdParam(f.frequency, t);
      f.frequency.setTargetAtTime(c.airFreq, t, 1.5);
    }
    if (c.drips && !this.drips) this.nextDrip = t + rnd(0.8, 2.5);
    this.drips = c.drips;
  }

  update(): void {
    if (!this.drips) return;
    const now = this.ctx.currentTime;
    if (now < this.nextDrip) return;
    const s = this.strip();
    if (s) {
      const pan = rnd(-0.85, 0.85);
      const gain = rnd(0.02, 0.05);
      drip(s, now + 0.02, pan, gain);
      if (Math.random() < 0.25) drip(s, now + rnd(0.12, 0.3), clamp(pan + rnd(-0.1, 0.1), -1, 1), gain * 0.6);
      s.seal();
    }
    this.nextDrip = now + rnd(0.9, 4.5);
  }
}
