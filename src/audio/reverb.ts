/**
 * Generated impulse responses for the four room presets (spec §12 "Mezclador").
 *
 * Each IR is stereo decorrelated noise with an RT60-style exponential decay,
 * a time-varying low-pass (air and stone absorb highs first), a cluster of
 * discrete early reflections and, for the cistern, long-ringing room modes
 * and a faint flutter echo off the water.
 */

export type ReverbPreset = 'stone_small' | 'stone_medium' | 'hall_large' | 'water_cistern';

interface IrSpec {
  /** Time to decay 60 dB (s). */
  rt60: number;
  predelay: number;
  /** Early reflections: count and time spread after the pre-delay (s). */
  early: number;
  earlySpread: number;
  /** Low-pass cutoff at the start and at rt60 (Hz). */
  brightStart: number;
  brightEnd: number;
  /** Onset ramp of the diffuse tail (s). */
  buildUp: number;
  modes?: readonly number[];
  flutter?: number;
  /** Output gain of the wet signal for this preset. */
  wet: number;
}

const SPECS: Record<ReverbPreset, IrSpec> = {
  stone_small: {
    rt60: 0.7,
    predelay: 0.004,
    early: 10,
    earlySpread: 0.03,
    brightStart: 7000,
    brightEnd: 1400,
    buildUp: 0.006,
    wet: 0.55,
  },
  stone_medium: {
    rt60: 1.5,
    predelay: 0.011,
    early: 12,
    earlySpread: 0.05,
    brightStart: 6000,
    brightEnd: 1000,
    buildUp: 0.015,
    wet: 0.62,
  },
  hall_large: {
    rt60: 3.4,
    predelay: 0.028,
    early: 14,
    earlySpread: 0.09,
    brightStart: 4800,
    brightEnd: 700,
    buildUp: 0.04,
    wet: 0.7,
  },
  water_cistern: {
    rt60: 4.2,
    predelay: 0.022,
    early: 16,
    earlySpread: 0.07,
    brightStart: 7500,
    brightEnd: 1700,
    buildUp: 0.03,
    modes: [97, 143.5, 211, 318, 447],
    flutter: 0.041,
    wet: 0.62,
  },
};

export function reverbWet(preset: ReverbPreset): number {
  return SPECS[preset].wet;
}

export function generateImpulse(ctx: BaseAudioContext, preset: ReverbPreset): AudioBuffer {
  const s = SPECS[preset];
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (s.predelay + s.rt60 * 1.05));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(s.predelay * sr);
  const hpCoef = Math.exp((-2 * Math.PI * 110) / sr);

  // Shared early-reflection pattern, jittered per channel.
  const early: { t: number; a: number }[] = [];
  for (let i = 0; i < s.early; i++) {
    const t = s.predelay + Math.pow(Math.random(), 1.4) * s.earlySpread;
    early.push({ t, a: (Math.random() < 0.5 ? -1 : 1) * (0.9 - (0.6 * (t - s.predelay)) / s.earlySpread) });
  }

  for (let ch = 0; ch < 2; ch++) {
    const data = new Float32Array(len);
    let lp = 0;
    let hpIn = 0;
    let hpOut = 0;
    const phases = (s.modes ?? []).map(() => Math.random() * Math.PI * 2);
    for (let block = pre; block < len; block += 64) {
      const t = (block - pre) / sr;
      const amp = Math.exp((-6.91 * t) / s.rt60);
      const cutoff = s.brightStart * Math.pow(s.brightEnd / s.brightStart, Math.min(1, t / s.rt60));
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
      const build = t < s.buildUp ? t / s.buildUp : 1;
      const stop = Math.min(len, block + 64);
      for (let n = block; n < stop; n++) {
        lp += a * (Math.random() * 2 - 1 - lp);
        // One-pole high-pass keeps the tail from getting muddy under the 55 Hz drone.
        hpOut = hpCoef * (hpOut + lp - hpIn);
        hpIn = lp;
        data[n] = hpOut * amp * build;
      }
    }
    if (s.modes) {
      for (let m = 0; m < s.modes.length; m++) {
        const f = (s.modes[m] ?? 100) * (1 + (ch === 0 ? -0.002 : 0.002));
        const w = (2 * Math.PI * f) / sr;
        const ph = phases[m] ?? 0;
        const decay = s.rt60 * 0.8;
        for (let n = pre; n < len; n++) {
          const t = (n - pre) / sr;
          data[n] =
            (data[n] ?? 0) +
            0.035 * Math.sin(w * n + ph) * Math.exp((-6.91 * t) / decay) * Math.min(1, t / 0.05);
        }
      }
    }
    if (s.flutter) {
      const step = Math.floor(s.flutter * sr);
      for (let k = 1; k * step + pre < len && k < 24; k++) {
        const n = pre + k * step + (ch === 0 ? 0 : 7);
        if (n < len) data[n] = (data[n] ?? 0) + 0.25 * Math.pow(0.8, k) * (k % 2 ? 1 : -1);
      }
    }
    for (const e of early) {
      const n = Math.floor((e.t + (ch === 0 ? 0 : rndSym(0.0015))) * sr);
      if (n >= 0 && n < len) data[n] = (data[n] ?? 0) + e.a * (ch === 0 ? 1 : 0.85);
    }
    // Normalise energy so presets differ in length and colour, not in loudness.
    let energy = 0;
    for (let n = 0; n < len; n++) energy += (data[n] ?? 0) ** 2;
    const k = energy > 0 ? 0.5 / Math.sqrt(energy) : 0;
    for (let n = 0; n < len; n++) data[n] = (data[n] ?? 0) * k;
    buf.copyToChannel(data, ch);
  }
  return buf;
}

function rndSym(r: number): number {
  return (Math.random() * 2 - 1) * r;
}
