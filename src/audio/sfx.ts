/**
 * Procedural one-shot sound effects (spec §12 "Contenido"). Each function
 * builds its sound into a Strip starting at context time `t`. Levels are kept
 * well under full scale: the mix, not the individual sound, gets loud.
 */

import { clamp, rnd, type Strip } from './dsp';

export type Material = 'sand' | 'stone' | 'metal' | 'wood' | 'water';
export const MATERIALS: readonly Material[] = ['sand', 'stone', 'metal', 'wood', 'water'];

/** Per-variation pitch / colour offsets: four distinct footsteps per material. */
const VARY = [0.93, 1.0, 1.08, 0.96] as const;

export function footstep(s: Strip, t: number, material: Material, variant: number, run: boolean): void {
  const v = VARY[variant % 4] ?? 1;
  const g = (run ? 2.2 : 1.6) * (material === 'sand' || material === 'water' ? 1.4 : 1);
  switch (material) {
    case 'stone':
      s.noiseHit(t, { type: 'bandpass', f: 2100 * v, q: 1.1, gain: 0.2 * g, a: 0.002, d: 0.045 });
      s.noiseHit(t + 0.012, { buf: 'brown', type: 'lowpass', f: 750 * v, gain: 0.22 * g, a: 0.004, d: 0.07 });
      s.tone(t, { f: 96 * v, f2: 58, gain: 0.14 * g, a: 0.003, d: 0.06 });
      if (variant % 2 === 1)
        s.noiseHit(t + 0.035, { type: 'highpass', f: 3600, gain: 0.035 * g, a: 0.005, d: 0.05 });
      if (run) s.noiseHit(t + 0.05, { type: 'bandpass', f: 1400 * v, q: 0.8, gain: 0.05, a: 0.01, d: 0.06 });
      break;
    case 'sand': {
      const grains = 3 + variant;
      let at = t;
      for (let i = 0; i < grains; i++) {
        s.noiseHit(at, {
          type: 'bandpass',
          f: rnd(2600, 4200) * v,
          q: 0.9,
          gain: rnd(0.04, 0.08) * g,
          a: 0.003,
          d: rnd(0.02, 0.04),
        });
        at += rnd(0.012, 0.024);
      }
      s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 520 * v, gain: 0.18 * g, a: 0.012, d: 0.11 });
      break;
    }
    case 'metal': {
      const base = [310, 347, 289, 331][variant % 4] ?? 310;
      s.noiseHit(t, { type: 'bandpass', f: 3100 * v, q: 2, gain: 0.1 * g, a: 0.001, d: 0.03 });
      const ratios = [1, 2.76, 5.4];
      ratios.forEach((r, i) => {
        s.tone(t, { f: base * r, gain: (0.045 * g) / (i + 1), a: 0.001, d: 0.32 / (1 + i * 0.6) });
      });
      s.tone(t, { f: 118 * v, f2: 72, gain: 0.14 * g, a: 0.002, d: 0.08 });
      break;
    }
    case 'wood':
      s.noiseHit(t, { type: 'bandpass', f: 950 * v, q: 1.5, gain: 0.16 * g, a: 0.002, d: 0.05 });
      s.tone(t, { wave: 'triangle', f: 190 * v, f2: 162 * v, gain: 0.17 * g, a: 0.002, d: 0.11 });
      if (variant >= 2) {
        s.tone(t + 0.04, {
          wave: 'sawtooth',
          f: rnd(250, 300),
          f2: rnd(200, 240),
          lp: 900,
          gain: 0.018 * g,
          a: 0.03,
          d: 0.12,
        });
      }
      break;
    case 'water':
      s.noiseHit(t, { type: 'bandpass', f: 900 * v, f2: 2700 * v, q: 0.9, gain: 0.2 * g, a: 0.006, d: 0.15 });
      s.noiseHit(t + 0.02, { buf: 'brown', type: 'lowpass', f: 420, gain: 0.14 * g, a: 0.01, d: 0.1 });
      for (let i = 0; i < 2 + (variant % 2); i++) {
        const f = rnd(520, 950);
        s.tone(t + rnd(0.03, 0.13), { f, f2: f * 1.9, glide: 0.03, gain: 0.025 * g, a: 0.002, d: 0.05 });
      }
      break;
  }
}

export function landing(s: Strip, t: number, fall: number, hard: boolean): void {
  const k = clamp(fall / 4, 0.25, 1.3);
  s.tone(t, { f: 78, f2: 42, gain: 0.3 * k, a: 0.004, d: 0.2 + 0.1 * k });
  s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 420, gain: 0.32 * k, a: 0.003, d: 0.18 });
  s.noiseHit(t + 0.01, { type: 'bandpass', f: 1300, q: 0.9, gain: 0.1 * k, a: 0.004, d: 0.09 });
  if (hard) {
    s.tone(t, { f: 54, f2: 28, gain: 0.45, a: 0.003, d: 0.55 });
    s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 230, gain: 0.4, a: 0.002, d: 0.42 });
    s.noiseHit(t + 0.03, { buf: 'pink', type: 'bandpass', f: 620, q: 0.7, gain: 0.09, a: 0.02, d: 0.22 });
    s.debris(t + 0.04, t + 0.4, 6, 0.07);
  }
}

export function jump(s: Strip, t: number, kind: string): void {
  s.noiseHit(t, { type: 'bandpass', f: 1500, q: 1, gain: 0.14, a: 0.003, d: 0.05 });
  s.noiseHit(t + 0.02, {
    buf: 'pink',
    type: 'bandpass',
    f: 350,
    f2: 1100,
    q: 1.2,
    gain: kind === 'running' ? 0.16 : 0.11,
    a: 0.06,
    d: 0.18,
  });
}

export function grab(s: Strip, t: number): void {
  s.noiseHit(t, { type: 'bandpass', f: 1100, q: 1.2, gain: 0.13, a: 0.001, d: 0.05 });
  s.tone(t, { f: 140, f2: 90, gain: 0.08, a: 0.002, d: 0.05 });
  s.debris(t + 0.02, t + 0.25, 3, 0.04);
}

export function climbing(s: Strip, t: number, climbTime: number): void {
  s.noiseHit(t, { buf: 'pink', type: 'bandpass', f: 600, f2: 900, q: 1.4, gain: 0.07, a: 0.12, d: 0.35 });
  s.noiseHit(t + 0.3, { type: 'bandpass', f: 2000, q: 0.7, gain: 0.025, a: 0.05, d: 0.2 });
  s.tone(t + climbTime * 0.6, { f: 110, f2: 70, gain: 0.09, a: 0.003, d: 0.07 });
  s.debris(t + 0.1, t + climbTime, 3, 0.03);
}

export function letGo(s: Strip, t: number): void {
  s.noiseHit(t, { buf: 'pink', type: 'bandpass', f: 900, f2: 400, q: 1, gain: 0.13, a: 0.02, d: 0.15 });
}

export function hurt(s: Strip, t: number, amount: number): void {
  const k = clamp(amount / 30, 0.3, 1.2);
  s.tone(t, { f: 92, f2: 50, gain: 0.28 * k, a: 0.002, d: 0.15 });
  s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 900, gain: 0.2 * k, a: 0.002, d: 0.12 });
  s.noiseHit(t + 0.015, { type: 'bandpass', f: 700, q: 0.8, gain: 0.06 * k, a: 0.01, d: 0.12 });
}

export function death(s: Strip, t: number, cause: string): void {
  if (cause === 'spikes') {
    [1870, 2953, 4410].forEach((f, i) => s.tone(t, { f, gain: 0.04 / (i + 1), a: 0.001, d: 0.5 - i * 0.1 }));
    s.noiseHit(t, { type: 'highpass', f: 2500, gain: 0.1, a: 0.001, d: 0.05 });
    s.tone(t + 0.02, { f: 85, f2: 45, gain: 0.3, a: 0.003, d: 0.2 });
    s.noiseHit(t + 0.02, { buf: 'brown', type: 'lowpass', f: 600, gain: 0.25, a: 0.004, d: 0.18 });
  } else if (cause === 'void') {
    s.noiseHit(t, {
      buf: 'pink',
      type: 'bandpass',
      f: 1300,
      f2: 140,
      q: 0.8,
      gain: 0.1,
      a: 0.35,
      hold: 0.4,
      d: 1.6,
    });
    s.tone(t, { f: 70, f2: 35, gain: 0.08, a: 0.5, d: 1.8 });
  } else {
    landing(s, t, 8, true);
    s.tone(t, { f: 40, f2: 24, gain: 0.3, a: 0.004, d: 0.9 });
  }
}

export function respawn(s: Strip, t: number): void {
  s.noiseHit(t, { buf: 'pink', type: 'bandpass', f: 400, f2: 2400, q: 1.2, gain: 0.035, a: 0.6, d: 0.7 });
  s.tone(t + 0.35, { f: 587.33, gain: 0.03, a: 0.3, d: 1.2 });
  s.tone(t + 0.35, { f: 880, gain: 0.018, a: 0.4, d: 1.1 });
}

/** Stone dragged over stone for `dur` seconds (push or pull). */
export function grind(s: Strip, t: number, dur: number, rate: number, gain: number, heavy = false): void {
  const a = Math.min(0.15, dur * 0.2);
  const d = Math.min(0.25, dur * 0.3);
  const hold = Math.max(0, dur - a - d);
  s.noiseHit(t, {
    buf: 'grind',
    type: 'bandpass',
    f: heavy ? 190 : 330,
    q: 0.7,
    lp: heavy ? 900 : 1800,
    rate: rate * rnd(0.95, 1.05),
    gain,
    a,
    hold,
    d,
  });
  s.noiseHit(t, {
    buf: 'brown',
    type: 'lowpass',
    f: heavy ? 95 : 140,
    gain: gain * (heavy ? 0.8 : 0.5),
    a,
    hold,
    d: d + 0.1,
  });
  s.debris(t + a, t + dur, Math.round(dur * (heavy ? 5 : 7)), gain * 0.18, 1200, 3500);
}

export function blockMoving(s: Strip, t: number, dur: number, mode: string): void {
  grind(s, t, dur, mode === 'pull' ? 0.88 : 1, 0.42);
}

export function settle(s: Strip, t: number, weight: number): void {
  s.tone(t, { f: 82, f2: 52, gain: 0.26 * weight, a: 0.003, d: 0.15 + 0.1 * weight });
  s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 320, gain: 0.22 * weight, a: 0.003, d: 0.13 });
  s.debris(t + 0.01, t + 0.2, 3, 0.04 * weight);
}

export function blockFalling(s: Strip, t: number): void {
  grind(s, t, 0.3, 1.3, 0.3);
  s.noiseHit(t + 0.1, {
    buf: 'pink',
    type: 'bandpass',
    f: 500,
    f2: 250,
    q: 0.9,
    gain: 0.05,
    a: 0.1,
    d: 0.35,
  });
}

export function heavyImpact(s: Strip, t: number, gain: number): void {
  s.tone(t, { f: 50, f2: 30, gain: 0.5 * gain, a: 0.003, d: 0.8 });
  s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 190, gain: 0.45 * gain, a: 0.002, d: 0.6 });
  s.noiseHit(t, { type: 'bandpass', f: 900, q: 0.8, gain: 0.12 * gain, a: 0.002, d: 0.08 });
  s.debris(t + 0.02, t + 0.6, 8, 0.08 * gain);
  s.noiseHit(t + 0.05, { buf: 'brown', type: 'lowpass', f: 90, gain: 0.18 * gain, a: 0.05, d: 1.2 });
}

export function lever(s: Strip, t: number): void {
  for (let i = 0; i < 3; i++) {
    const at = t + i * rnd(0.06, 0.075);
    s.noiseHit(at, { type: 'bandpass', f: 3200, q: 3, gain: 0.09, a: 0.0008, d: 0.015 });
    s.tone(at, { f: 1450 + i * 60, gain: 0.015, a: 0.001, d: 0.02 });
  }
  const c = t + 0.25;
  s.tone(c, { wave: 'triangle', f: 135, f2: 74, gain: 0.28, a: 0.002, d: 0.12 });
  s.noiseHit(c, { type: 'bandpass', f: 520, q: 1, gain: 0.24, a: 0.002, d: 0.1 });
  s.tone(c, { f: 870, gain: 0.025, a: 0.001, d: 0.25 });
  // The hidden mechanism answers from inside the wall.
  grind(s, c + 0.18, 1.0, 0.7, 0.14, true);
}

export function door(s: Strip, t: number, dur: number, closing: boolean): void {
  grind(s, t, dur, closing ? 0.66 : 0.6, 0.42, true);
  s.tone(t, { f: 36, gain: 0.16, a: 0.3, hold: Math.max(0, dur - 0.6), d: 0.3 });
  s.tone(t, { f: 54.5, gain: 0.05, a: 0.4, hold: Math.max(0, dur - 0.7), d: 0.3 });
}

export function doorStop(s: Strip, t: number, slam: boolean): void {
  if (slam) heavyImpact(s, t, 1);
  else {
    s.tone(t, { f: 56, f2: 36, gain: 0.4, a: 0.003, d: 0.5 });
    s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 210, gain: 0.32, a: 0.002, d: 0.35 });
  }
  // Dust settling.
  s.noiseHit(t + 0.05, { type: 'highpass', f: 2600, gain: 0.025, a: 0.08, d: 0.9 });
}

/** One tick of a timed door: a dry stone click, higher and doubled in the last seconds. */
export function tick(s: Strip, t: number, urgent: boolean): void {
  s.noiseHit(t, { type: 'bandpass', f: urgent ? 4200 : 3100, q: 6, gain: 0.13, a: 0.0005, d: 0.018 });
  s.tone(t, { wave: 'triangle', f: urgent ? 1180 : 880, gain: 0.05, a: 0.001, d: 0.06 });
  if (urgent) {
    s.noiseHit(t + 0.12, { type: 'bandpass', f: 3600, q: 6, gain: 0.08, a: 0.0005, d: 0.015 });
  }
}

export function plate(s: Strip, t: number, pressed: boolean): void {
  if (pressed) {
    s.tone(t, { f: 160, f2: 90, gain: 0.14, a: 0.002, d: 0.06 });
    s.noiseHit(t, { type: 'bandpass', f: 900, q: 1.5, gain: 0.11, a: 0.002, d: 0.04 });
    s.noiseHit(t + 0.08, { type: 'bandpass', f: 2500, q: 4, gain: 0.055, a: 0.001, d: 0.02 });
    s.tone(t + 0.08, { f: 62, gain: 0.1, a: 0.004, d: 0.22 });
  } else {
    s.tone(t, { f: 120, f2: 165, gain: 0.08, a: 0.002, d: 0.05 });
    s.noiseHit(t + 0.03, { type: 'bandpass', f: 2300, q: 4, gain: 0.045, a: 0.001, d: 0.02 });
  }
}

/** Sharp crackle across the whole warning window before a tile gives way. */
export function tileCrack(s: Strip, t: number, warning: number): void {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const at = t + warning * Math.pow(i / n, 0.75);
    s.noiseHit(at, {
      type: 'bandpass',
      f: rnd(2600, 6200),
      q: rnd(3, 6),
      gain: rnd(0.08, 0.2),
      a: 0.0005,
      d: rnd(0.006, 0.022),
      pan: rnd(-0.3, 0.3),
    });
  }
  s.noiseHit(t, { type: 'highpass', f: 1800, gain: 0.12, a: 0.0005, d: 0.03 });
  s.tone(t, { wave: 'sawtooth', f: 190, f2: 118, lp: 800, gain: 0.03, a: 0.08, d: warning });
  s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 220, gain: 0.12, a: 0.15, d: warning });
}

export function tileFall(s: Strip, t: number): void {
  s.debris(t, t + 0.7, 18, 0.11, 800, 3200);
  s.noiseHit(t, { buf: 'brown', type: 'lowpass', f: 360, gain: 0.38, a: 0.01, d: 0.6 });
  s.tone(t, { f: 72, f2: 40, gain: 0.26, a: 0.004, d: 0.32 });
  // Landing far below, muffled.
  const far = t + rnd(0.75, 0.95);
  s.tone(far, { f: 55, f2: 34, gain: 0.16, a: 0.004, d: 0.5 });
  s.noiseHit(far, { buf: 'brown', type: 'lowpass', f: 150, gain: 0.22, a: 0.004, d: 0.4 });
}

export function rumble(s: Strip, t: number, dur: number): void {
  s.tone(t, { f: 32, gain: 0.2, a: 0.4, hold: Math.max(0, dur - 1.4), d: 1 });
  s.noiseHit(t, {
    buf: 'brown',
    type: 'lowpass',
    f: 110,
    gain: 0.35,
    a: 0.5,
    hold: Math.max(0, dur - 1.7),
    d: 1.2,
  });
  grind(s, t + 0.2, dur - 0.4, 0.5, 0.14, true);
  s.debris(t + 0.3, t + dur, 12, 0.05, 1000, 3000);
}

export function pickup(s: Strip, t: number): void {
  s.noiseHit(t, { type: 'bandpass', f: 2500, q: 0.8, gain: 0.045, a: 0.02, d: 0.12 });
  s.noiseHit(t + 0.11, { type: 'bandpass', f: 2100, q: 0.8, gain: 0.035, a: 0.02, d: 0.1 });
}

export function reveal(s: Strip, t: number): void {
  s.noiseHit(t, { buf: 'brown', type: 'bandpass', f: 180, f2: 480, q: 0.7, gain: 0.08, a: 0.6, d: 0.9 });
}

/** A single water drip in a cistern: the rising "plink" of a bursting bubble. */
export function drip(s: Strip, t: number, pan: number, gain: number): void {
  const f = rnd(850, 1600);
  s.tone(t, { f, f2: f * rnd(1.8, 2.4), glide: 0.028, gain, a: 0.002, d: 0.07, pan });
  s.noiseHit(t, { type: 'bandpass', f: 3000, q: 2, gain: gain * 0.3, a: 0.0008, d: 0.01, pan });
}
