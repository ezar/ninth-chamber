/**
 * Synthesised music cues (spec §12 "Música" and "Secreto"). Music appears
 * only at marked moments; each cue is short and built from a few restrained
 * voices: a Karplus-Strong plucked string, FM glass bells, a warm pad, a
 * filtered brass swell and a soft timpani. Harmony leans on D phrygian
 * dominant (D Eb F# G A Bb C) for an old, subterranean colour.
 */

import { FLOOR, hz, rnd, type Strip } from './dsp';

export type CueName = 'hall' | 'relic' | 'fanfare' | 'death';

const plucks = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
const pads = new WeakMap<BaseAudioContext, PeriodicWave>();

/** Karplus-Strong plucked string, rendered once per pitch and context. */
function pluckBuffer(ctx: BaseAudioContext, freq: number): AudioBuffer {
  let cache = plucks.get(ctx);
  if (!cache) {
    cache = new Map();
    plucks.set(ctx, cache);
  }
  const key = Math.round(freq * 10);
  const hit = cache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 3.2);
  const period = sr / freq;
  // Loop delay = N (line) + 0.5 (averaging filter) + d (all-pass fractional tuning).
  let n = Math.floor(period - 0.5);
  let d = period - 0.5 - n;
  if (d < 0.1) {
    n -= 1;
    d += 1;
  }
  n = Math.max(2, n);
  const c = (1 - d) / (1 + d);
  const line = new Float32Array(n);
  // Soft, low-passed excitation: a plucked gut string rather than a bright harpsichord.
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += 0.5 * (Math.random() * 2 - 1 - lp);
    line[i] = lp;
  }
  const out = new Float32Array(len);
  const loss = Math.pow(0.5, 1 / (freq * 1.6)); // about 1.6 s half-life, pitch independent
  let idx = 0;
  let xPrev = 0;
  let apIn = 0;
  let apOut = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const x = line[idx] ?? 0;
    const avg = 0.5 * (x + xPrev) * loss;
    xPrev = x;
    const ap = c * avg + apIn - c * apOut;
    apIn = avg;
    apOut = ap;
    line[idx] = ap;
    idx = (idx + 1) % n;
    const fade = i > len - 2000 ? (len - i) / 2000 : 1;
    const v = x * fade;
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak > 0) for (let i = 0; i < len; i++) out[i] = ((out[i] ?? 0) / peak) * 0.9;
  const buf = ctx.createBuffer(1, len, sr);
  buf.copyToChannel(out, 0);
  cache.set(key, buf);
  return buf;
}

/** Warm harmonic series (1/n^1.6) for the pad: softer than a sawtooth. */
function padWave(ctx: BaseAudioContext): PeriodicWave {
  let w = pads.get(ctx);
  if (!w) {
    const n = 24;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) imag[i] = 1 / Math.pow(i, 1.6);
    w = new PeriodicWave(ctx, { real, imag });
    pads.set(ctx, w);
  }
  return w;
}

export function pluck(s: Strip, t: number, midi: number, gain: number, pan = 0): void {
  const ctx = s.ctx;
  const src = new AudioBufferSourceNode(ctx, { buffer: pluckBuffer(ctx, hz(midi)) });
  const g = new GainNode(ctx, { gain });
  const p = new StereoPannerNode(ctx, { pan });
  src.connect(g).connect(p).connect(s.input);
  src.start(t);
  src.stop(t + 3.2);
  s.own(src, t + 3.2, g, p);
}

/** FM bell: `ratio` 3.5 is glassy and inharmonic, 2 is a warmer chime. */
export function bell(
  s: Strip,
  t: number,
  midi: number,
  gain: number,
  dur: number,
  ratio = 3.5,
  pan = 0,
): void {
  const ctx = s.ctx;
  const f = hz(midi);
  const car = new OscillatorNode(ctx, { frequency: f });
  const mod = new OscillatorNode(ctx, { frequency: f * ratio });
  const idx = new GainNode(ctx, { gain: 0 });
  const env = new GainNode(ctx, { gain: 0 });
  const p = new StereoPannerNode(ctx, { pan });
  mod.connect(idx).connect(car.frequency);
  car.connect(env).connect(p).connect(s.input);
  idx.gain.setValueAtTime(f * 2.2, t);
  idx.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.6);
  const end = s.envelope(env.gain, t, gain, 0.004, 0, dur);
  car.start(t);
  mod.start(t);
  car.stop(end + 0.02);
  mod.stop(end + 0.02);
  s.own(car, end + 0.02, env, p);
  s.own(mod, end + 0.02, idx);
}

/** Slow pad chord: two slightly detuned voices per note through a gentle low-pass. */
export function pad(
  s: Strip,
  t: number,
  notes: readonly number[],
  gain: number,
  attack: number,
  hold: number,
  release: number,
  cutoff = 1100,
): void {
  const ctx = s.ctx;
  const wave = padWave(ctx);
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cutoff, Q: 0.4 });
  const env = new GainNode(ctx, { gain: 0 });
  lp.connect(env).connect(s.input);
  const end = s.envelope(env.gain, t, gain / Math.sqrt(notes.length), attack, hold, release);
  let first = true;
  notes.forEach((m, i) => {
    for (const cents of [-5, 5]) {
      const osc = new OscillatorNode(ctx, { frequency: hz(m), detune: cents + rnd(-1.5, 1.5) });
      osc.setPeriodicWave(wave);
      const p = new StereoPannerNode(ctx, { pan: (cents < 0 ? -0.35 : 0.35) * (i % 2 ? -1 : 1) });
      const g = new GainNode(ctx, { gain: 0.5 });
      osc.connect(g).connect(p).connect(lp);
      osc.start(t);
      osc.stop(end + 0.05);
      if (first) s.own(osc, end + 0.05, g, p, lp, env);
      else s.own(osc, end + 0.05, g, p);
      first = false;
    }
  });
}

/** Filtered brass swell: two saws whose low-pass opens with the note. */
export function brass(s: Strip, t: number, midi: number, gain: number, dur: number, pan = 0): void {
  const ctx = s.ctx;
  const f = hz(midi);
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300, Q: 1.2 });
  const env = new GainNode(ctx, { gain: 0 });
  const p = new StereoPannerNode(ctx, { pan });
  lp.connect(env).connect(p).connect(s.input);
  lp.frequency.setValueAtTime(260, t);
  lp.frequency.linearRampToValueAtTime(f * 5, t + 0.09);
  lp.frequency.exponentialRampToValueAtTime(f * 2.4, t + Math.min(dur, 0.6));
  const release = Math.min(0.8, dur * 0.5);
  const end = s.envelope(env.gain, t, gain, 0.05, Math.max(0, dur - 0.05 - release), release);
  let first = true;
  for (const cents of [-6, 6]) {
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f, detune: cents });
    osc.connect(lp);
    osc.start(t);
    osc.stop(end + 0.02);
    if (first) s.own(osc, end + 0.02, lp, env, p);
    else s.own(osc, end + 0.02);
    first = false;
  }
}

export function timpani(s: Strip, t: number, midi: number, gain: number): void {
  const f = hz(midi);
  s.tone(t, { f: f * 1.06, f2: f, glide: 0.08, gain, a: 0.003, d: 1.4 });
  s.tone(t, { f: f * 1.5, gain: gain * 0.25, a: 0.003, d: 0.5 });
  s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 400, gain: gain * 0.6, a: 0.002, d: 0.12 });
}

function swell(s: Strip, t: number, dur: number, gain: number): void {
  s.noiseHit(t, { type: 'highpass', f: 5500, gain, a: dur, d: 0.4 });
}

/** Builds a cue into `s` and returns its length (s). */
export function playCue(s: Strip, t: number, name: CueName): number {
  switch (name) {
    case 'hall': {
      // Entering a great hall: a low open fifth, then a slow rising and falling line on a plucked string.
      pad(s, t, [38, 45, 50], 0.13, 2.5, 3.5, 3.5, 900);
      const line: [number, number, number][] = [
        [0.7, 62, 0.16],
        [1.25, 63, 0.14],
        [1.8, 66, 0.15],
        [2.8, 69, 0.18],
        [4.3, 67, 0.13],
        [4.85, 66, 0.12],
        [5.4, 63, 0.12],
        [6.6, 62, 0.15],
      ];
      for (const [at, m, g] of line) pluck(s, t + at, m, g, rnd(-0.2, 0.2));
      bell(s, t + 2.8, 81, 0.035, 3, 3.5, 0.3);
      bell(s, t + 6.6, 86, 0.022, 3.5, 3.5, -0.3);
      return 10;
    }
    case 'relic': {
      // Mysterious: a clustered minor second that resolves, glass bells, a distant heartbeat.
      pad(s, t, [50, 57, 63], 0.12, 3, 1.8, 2.2, 1000);
      pad(s, t + 4.2, [50, 57, 62, 69], 0.12, 2.2, 1.8, 3, 1300);
      timpani(s, t + 0.2, 26, 0.18);
      timpani(s, t + 0.75, 26, 0.12);
      timpani(s, t + 5, 26, 0.12);
      const bells: [number, number, number][] = [
        [1.0, 82, 0.03],
        [2.3, 81, 0.03],
        [3.1, 87, 0.018],
        [5.2, 86, 0.028],
        [6.8, 81, 0.022],
      ];
      for (const [at, m, g] of bells) bell(s, t + at, m, g, 2.6, 3.5, rnd(-0.5, 0.5));
      return 10;
    }
    case 'fanfare': {
      // Level complete: a short rising call over timpani that opens into a major chord.
      timpani(s, t, 38, 0.28);
      timpani(s, t + 0.17, 38, 0.2);
      swell(s, t + 0.05, 0.62, 0.03);
      brass(s, t, 62, 0.07, 0.34, -0.1);
      brass(s, t + 0.34, 69, 0.07, 0.34, 0.1);
      brass(s, t + 0.68, 74, 0.075, 2.4);
      brass(s, t + 0.68, 69, 0.05, 2.4, -0.3);
      brass(s, t + 0.68, 66, 0.05, 2.4, 0.3);
      brass(s, t + 0.68, 62, 0.05, 2.4);
      timpani(s, t + 0.68, 38, 0.32);
      pad(s, t + 0.68, [38, 45], 0.1, 0.4, 1.6, 2, 700);
      bell(s, t + 1.1, 86, 0.025, 2.2, 2, 0.4);
      pluck(s, t + 1.4, 74, 0.1, -0.3);
      pluck(s, t + 1.55, 78, 0.1, 0);
      pluck(s, t + 1.7, 81, 0.1, 0.3);
      return 5;
    }
    case 'death':
      pad(s, t, [38, 45, 51], 0.12, 0.8, 0.8, 2.6, 600);
      timpani(s, t, 26, 0.2);
      return 4.5;
  }
}

/**
 * The secret motif: A4, E5, D5, A5, a glass-bell open fifth that turns back
 * a step before landing on the octave, over a soft sus chord. Deliberately
 * unlike the familiar rising "puzzle solved" jingles.
 */
export function secretMotif(s: Strip, t: number): void {
  const notes: [number, number][] = [
    [0, 69],
    [0.17, 76],
    [0.34, 74],
    [0.6, 81],
  ];
  notes.forEach(([at, m], i) => {
    bell(s, t + at, m, i === 3 ? 0.075 : 0.06, i === 3 ? 2.4 : 1.4, 2, (i - 1.5) * 0.25);
    bell(s, t + at, m + 12, 0.012, 0.5, 3.5, (i - 1.5) * 0.25);
  });
  pad(s, t + 0.55, [57, 62, 64, 69], 0.07, 0.5, 0.6, 1.8, 1600);
}

/** A glittering upward spray when the relic is lifted. */
export function relicShimmer(s: Strip, t: number): void {
  const spray = [74, 81, 86, 88, 93, 98, 100];
  spray.forEach((m, i) => bell(s, t + i * 0.13 + rnd(0, 0.03), m, 0.028, 2, 3.5, rnd(-0.6, 0.6)));
  pad(s, t, [38, 45, 50], 0.09, 1, 0.5, 2.2, 700);
  s.noiseHit(t, { type: 'highpass', f: 6500, gain: 0.025, a: 0.6, d: 1.5 });
}

export function chime(s: Strip, t: number, notes: readonly number[], gain: number, gap: number): void {
  notes.forEach((m, i) => bell(s, t + i * gap, m, gain * Math.pow(0.8, i), 1.2, 2));
}

/** Fades a playing cue out over `seconds`. */
export function fadeOut(s: Strip, seconds: number): void {
  const g = s.input.gain;
  const t = s.ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.exponentialRampToValueAtTime(FLOOR, t + seconds);
  g.setValueAtTime(0, t + seconds + 0.01);
}
