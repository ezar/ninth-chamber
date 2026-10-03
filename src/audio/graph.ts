/**
 * The audio graph on a given context: mixer, ambience, emitters, music, and
 * the mapping from simulation events to sounds. It works on any
 * BaseAudioContext, so the same code renders offline for checks.
 *
 * Every event plays recorded samples (samples.ts) when their bank is loaded
 * and falls back to the procedural sound (sfx.ts, music.ts) otherwise, so
 * the game is never silent while files load or where Opus is unsupported.
 *
 * The player's own sounds (steps, jumps, grabs) are 2D, with a slight
 * left/right alternation; world sounds (mechanisms) are positioned where
 * they happen.
 */

import type { SimEvent } from '../core/events';
import { mechanics, tuning, wind } from '../sim/player/tuning';
import { Ambience } from './ambience';
import { clamp, noiseBank, setPanningModel, Strip, type NoiseBank, type Vec3 } from './dsp';
import { EmitterSet, type EmitterDef } from './emitters';
import { Mixer, type BusName } from './mixer';
import { MusicDirector, PolledClock } from './director';
import { chime, fadeOut, playCue, relicShimmer, secretMotif, type CueName } from './music';
import type { ReverbPreset } from './reverb';
import { SampleBank, vary, type BankName, type Category, type Fetcher } from './samples';
import * as sfx from './sfx';
import { ScorePlayer } from './score-player';

export interface ListenerPose extends Vec3 {
  /** 0 looks towards -Z; positive yaw turns towards -X. */
  yaw: number;
}

/**
 * Caps on simultaneous one-shot sounds, all buses and per bus; beyond them new
 * ones are dropped. Phones get a smaller budget (the audio thread is the
 * first thing to crackle and drop out under load).
 */
const VOICES = {
  full: { total: 40, sfx: 24, music: 8, ambience: 6, ui: 6, voice: 4 },
  lite: { total: 22, sfx: 12, music: 5, ambience: 3, ui: 4, voice: 2 },
} as const;
/** Footsteps are the most frequent sound: at most this many at once (their tails overlap). */
const STEP_VOICES = { full: 4, lite: 2 } as const;
/** A strip still alive this long after its scheduled end lost an `ended` event: reap it. */
const REAP_AFTER = 2;
/** Minimum spacing between two sounds of the same event type (s). */
const MIN_GAP: Record<string, number> = {
  footstep: 0.07,
  'player.landed': 0.1,
  'player.hurt': 0.15,
  'weapon.fired': 0.05,
  'enemy.alerted': 0.35,
};
const DEFAULT_GAP = 0.03;

/** The flutes sing higher up the shaft: a pentatonic note a step every eight metres from A3. */
const FLUTE_STEPS = [0, 2, 4, 7, 9];
function fluteNote(y: number): number {
  const step = Math.max(0, Math.round(y / 8));
  const semis = 12 * Math.floor(step / 5) + (FLUTE_STEPS[step % 5] ?? 0);
  return 220 * 2 ** (Math.min(semis, 36) / 12);
}
/** Scheduling lead, so every node starts on a clean sample in the future. */
const LEAD = 0.01;
/** Growls vary in length (s). */
const growlLength = (): number => 0.7 + Math.random() * 0.5;

/** Level of the player's 2D sounds relative to the positional originals heard from the camera. */
const PLAYER = 0.7;

/**
 * Mix levels of the recorded banks (linear gain). The files are levelled to
 * about -18 LUFS (sfx) and -20 LUFS (loops); these balance them against each
 * other, checked on offline renders (max momentary loudness at the output):
 * running on stone about -28 LUFS, walking -31, sand about 3 dB softer;
 * the body's own foley (jumps, grabs, climbs) at or under the steps;
 * mechanisms and warnings well above them (-25 to -17), the ambience bed
 * around -31 LUFS integrated.
 */
const LEVEL = {
  step: {
    stone: { walk: 0.5, run: 0.72 },
    sand: { walk: 0.2, run: 0.3 },
  },
  cloth: { walk: 0.16, run: 0.24 },
  jump: 0.3,
  land: 1.1,
  bodyFall: 0.55,
  hand: 0.36,
  clothMove: 0.3,
  leather: 0.22,
  scrape: 0.32,
  scuff: 0.3,
  hurt: 0.8,
  pickup: 0.9,
  drag: 0.7,
  impact: 1.8,
  knock: 0.8,
  debris: 0.5,
  shift: 0.7,
  door: 0.85,
  lever: 1.6,
  crack: 1.8,
  rumble: 0.85,
  tick: 0.9,
  bowl: 0.55,
  ui: { click: 0.6, hover: 0.4, confirm: 0.7 },
} as const;

/** The synthesised cue that stands in for a recorded one that cannot play (no Opus/WebM, a failed file). */
const FALLBACK_CUE: Record<string, CueName> = {
  title: 'hall',
  intro: 'hall',
  explore: 'hall',
  relic: 'relic',
  fanfare: 'fanfare',
  death: 'death',
};

type Material = sfx.Material;
type Gait = 'walk' | 'run';

const str = (e: SimEvent, key: string): string => {
  const v = e[key];
  return typeof v === 'string' ? v : '';
};
const num = (e: SimEvent, key: string, fallback = 0): number => {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
/** Where an event happened, when it says so (enemies: x, y, z; a shot's target: tx, ty, tz). */
const where = (e: SimEvent, prefix = ''): Vec3 | null => {
  const x = num(e, `${prefix}x`, NaN);
  const y = num(e, `${prefix}y`, NaN);
  const z = num(e, `${prefix}z`, NaN);
  return Number.isFinite(x + y + z) ? { x, y: y + 0.4, z } : null;
};

export interface GraphOptions {
  /** Phones and tablets: fewer voices, equal-power panning, shorter reverbs, lighter decoding. */
  lite?: boolean;
  ambience?: boolean;
  destination?: AudioNode;
  /** URL of public/audio/ (ending in '/'); null disables recorded sounds. */
  samples?: string | null;
  fetcher?: Fetcher;
}

interface LayerOpts {
  delay?: number;
  gain?: number;
  rate?: number;
  pan?: number;
  duration?: number;
  fadeOut?: number;
  fadeIn?: number;
  lp?: number;
  offset?: number;
  /** Variation (defaults: ±4 % rate, ±2 dB gain). */
  rateSpread?: number;
  gainSpread?: number;
}

export class AudioGraph {
  readonly noise: NoiseBank;
  readonly mixer: Mixer;
  readonly samples: SampleBank | null;
  readonly score: ScorePlayer;
  readonly director: MusicDirector;
  private readonly musicClock = new PolledClock();
  private readonly ambience: Ambience | null;
  private readonly emitters: EmitterSet;
  private readonly live = new Set<Strip>();
  private readonly busStrips = new Map<BusName, number>();
  private readonly steps: Strip[] = [];
  readonly lite: boolean;
  private readonly last = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();
  private cue: { name: CueName; strip: Strip; at: number } | null = null;
  /** Surface under the player, from the last footstep (jumps and landings reuse it). */
  private material: Material = 'stone';
  private side = 1;

  constructor(
    readonly ctx: BaseAudioContext,
    opts: GraphOptions = {},
  ) {
    this.lite = opts.lite === true;
    this.noise = noiseBank(ctx);
    this.mixer = new Mixer(ctx, opts.destination, this.lite ? 1.6 : Infinity);
    setPanningModel(this.lite ? 'equalpower' : 'HRTF');
    this.samples = opts.samples
      ? new SampleBank(ctx, opts.samples, opts.fetcher, this.lite ? 32000 : Infinity)
      : null;
    this.score = new ScorePlayer(ctx, this.mixer.bus.music, {
      base: opts.samples ?? '',
      strip: () => this.strip('music', null),
      fallback: (cue) => this.fallbackCue(cue),
      lite: this.lite,
      musicLevel: () => this.mixer.outputLevel('music'),
      ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
    });
    this.director = new MusicDirector(this.score, this.musicClock);
    this.emitters = new EmitterSet(ctx, this.noise, this.mixer.bus.ambience, this.lite ? 3 : 8);
    this.ambience =
      opts.ambience === false
        ? null
        : new Ambience(
            ctx,
            this.noise,
            this.mixer.bus.ambience,
            () => this.strip('ambience', null),
            this.lite,
          );
    this.samples?.onLoaded((c) => this.loaded(c));
  }

  /** Starts the continuous layers (call once the context is running). */
  start(): void {
    this.ambience?.start();
  }

  /** Fetches and decodes recorded banks, most urgent first. Resolves when all have settled. */
  async loadSamples(order: readonly (readonly Category[])[] = DEFAULT_LOAD_ORDER): Promise<void> {
    if (!this.samples) return;
    for (const group of order) await this.samples.load(group);
  }

  private loaded(c: Category): void {
    if (c !== 'ambience' || !this.samples) return;
    const fire = this.samples.loop('fire');
    if (fire) this.emitters.setFire(fire.buffer, fire.end);
    const air = this.samples.loop('amb.air');
    const wind = this.samples.loop('amb.wind');
    this.ambience?.useBeds(air, wind, () => this.samples?.pick('drip') ?? null);
  }

  /** A new one-shot on `bus`, spatialised at `at` when given; null when a voice cap is reached. */
  strip(bus: BusName, at: Vec3 | null, gain = 1): Strip | null {
    const caps = VOICES[this.lite ? 'lite' : 'full'];
    const onBus = this.busStrips.get(bus) ?? 0;
    if (this.live.size >= caps.total || onBus >= caps[bus]) return null;
    this.busStrips.set(bus, onBus + 1);
    const s = new Strip(this.ctx, this.noise, this.mixer.bus[bus], at, () => {
      this.live.delete(s);
      this.busStrips.set(bus, (this.busStrips.get(bus) ?? 1) - 1);
    });
    this.live.add(s);
    s.input.gain.value = gain;
    return s;
  }

  /** Frees strips long past their end whose sources never reported `ended`. Returns how many. */
  reap(): number {
    const now = this.ctx.currentTime;
    let n = 0;
    for (const s of [...this.live]) {
      const end = Math.max(s.end, s.born);
      if (now > end + REAP_AFTER) {
        s.forceDispose();
        n++;
      }
    }
    return n;
  }

  get activeStrips(): number {
    return this.live.size;
  }

  setRoom(preset: ReverbPreset | null): void {
    this.mixer.setRoom(preset);
    this.ambience?.setRoom(preset);
  }

  setEmitters(list: readonly EmitterDef[]): void {
    this.emitters.set(list);
  }

  update(l: ListenerPose): void {
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    const fx = -Math.sin(l.yaw);
    const fz = -Math.cos(l.yaw);
    if (L.positionX) {
      L.positionX.setTargetAtTime(l.x, t, 0.02);
      L.positionY.setTargetAtTime(l.y, t, 0.02);
      L.positionZ.setTargetAtTime(l.z, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02);
      L.forwardY.setTargetAtTime(0, t, 0.02);
      L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setValueAtTime(0, t);
      L.upY.setValueAtTime(1, t);
      L.upZ.setValueAtTime(0, t);
    } else {
      L.setPosition(l.x, l.y, l.z);
      L.setOrientation(fx, 0, fz, 0, 1, 0);
    }
    this.emitters.update(l);
    this.ambience?.update();
    this.tickMusic();
  }

  /** Advances the music clock and the score's scheduled layers (also works without a listener update). */
  tickMusic(): void {
    this.musicClock.tick(this.ctx.currentTime);
    this.score.update();
  }

  private allow(type: string): boolean {
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[type] ?? DEFAULT_GAP;
    const prev = this.last.get(type);
    if (prev !== undefined && now - prev < gap) return false;
    this.last.set(type, now);
    return true;
  }

  /** Procedural variant index (0..3), never the same twice in a row per key. */
  private variant(key: string): number {
    const prev = this.lastVariant.get(key) ?? -1;
    let v = Math.floor(Math.random() * 4);
    if (v === prev) v = (v + 1 + Math.floor(Math.random() * 3)) % 4;
    this.lastVariant.set(key, v);
    return v;
  }

  /** Plays a sound built by `build` on `bus`; a no-op when the voice cap is reached. */
  private play(bus: BusName, at: Vec3 | null, build: (s: Strip, t: number) => void, gain = 1): Strip | null {
    const s = this.strip(bus, at, gain);
    if (!s) return null;
    try {
      build(s, this.ctx.currentTime + LEAD);
    } finally {
      s.seal();
    }
    return s;
  }

  /** True when every listed bank is loaded (else the caller uses the procedural sound). */
  private ready(...banks: BankName[]): boolean {
    if (!this.samples) return false;
    let ok = true;
    for (const b of banks) {
      if (!this.samples.has(b)) {
        this.samples.want(b);
        ok = false;
      }
    }
    return ok;
  }

  /** Adds one variant of `bank` to the strip, with random pitch and gain; false if not loaded. */
  private layer(s: Strip, t: number, bank: BankName, o: LayerOpts = {}): boolean {
    const buf = this.samples?.pick(bank);
    if (!buf) return false;
    const v = vary(o.rate ?? 1, o.gain ?? 1, o.rateSpread ?? 0.04, o.gainSpread ?? 2);
    s.sample(t + (o.delay ?? 0), buf, {
      rate: v.rate,
      gain: v.gain,
      pan: o.pan,
      duration: o.duration,
      fadeOut: o.fadeOut,
      fadeIn: o.fadeIn,
      lp: o.lp,
      offset: o.offset,
    });
    return true;
  }

  /** A looped recorded bed (door grinding) for `duration`, faded in and out. */
  private loopLayer(s: Strip, t: number, bank: BankName, duration: number, o: LayerOpts = {}): boolean {
    const l = this.samples?.loop(bank);
    if (!l) return false;
    const v = vary(o.rate ?? 1, o.gain ?? 1, 0.03, 1);
    s.sample(t + (o.delay ?? 0), l.buffer, {
      rate: v.rate,
      gain: v.gain,
      duration,
      loopEnd: l.end,
      offset: Math.random() * l.end * 0.8,
      fadeIn: o.fadeIn ?? 0.2,
      fadeOut: o.fadeOut ?? 0.35,
    });
    return true;
  }

  /** Alternates the player's feet (and hands) slightly left and right. */
  private nextSide(): number {
    this.side = -this.side;
    return this.side * (0.08 + Math.random() * 0.05);
  }

  /** The procedural cues, for when a recorded one cannot play. */
  playMusic(name: CueName): void {
    const now = this.ctx.currentTime;
    // The same cue twice in a row (level.end plus a scripted fanfare) plays once.
    if (this.cue && this.cue.name === name && now - this.cue.at < 2) return;
    if (this.cue) fadeOut(this.cue.strip, 1.5);
    const s = this.strip('music', null);
    if (!s) return;
    playCue(s, now + LEAD, name);
    s.seal();
    this.cue = { name, strip: s, at: now };
  }

  private fallbackCue(cue: string): void {
    const kind = cue.startsWith('sting.death')
      ? 'death'
      : (cue.split('.').find((part) => part in FALLBACK_CUE) ?? '');
    const name = FALLBACK_CUE[kind];
    if (name) this.playMusic(name);
  }

  /** The level whose palette the score uses (see score.ts). */
  setLevel(id: string): void {
    this.director.setLevel(id);
  }

  /** Game phase: the title theme, the intro, play, the end screen. */
  setMusicPhase(phase: 'title' | 'intro' | 'play' | 'end'): void {
    this.director.setPhase(phase);
  }

  /** Player health 0..1 (low health: tension, heartbeat, muffled music). */
  setHealth(h: number): void {
    this.director.setHealth(h);
  }

  setPaused(paused: boolean): void {
    this.score.setPaused(paused);
  }

  /** Menu sounds (not simulation events). */
  ui(name: 'click' | 'hover' | 'confirm'): void {
    const bank: BankName = name === 'click' ? 'ui.click' : name === 'hover' ? 'ui.hover' : 'ui.confirm';
    this.play('ui', null, (s, t) => {
      if (
        !this.layer(s, t, bank, { gain: LEVEL.ui[name], rateSpread: 0.02, gainSpread: 1 }) &&
        name !== 'hover'
      ) {
        chime(s, t, name === 'confirm' ? [69, 76] : [81], 0.03, 0.08);
      }
    });
  }

  private footstep(material: Material, run: boolean): void {
    const gait: Gait = run ? 'run' : 'walk';
    const bank = `step.${material}.${gait}` as BankName;
    const pan = this.nextSide();
    // Footstep voices: the oldest still ringing gives way (their tails overlap at a run).
    for (let i = this.steps.length - 1; i >= 0; i--) if (this.steps[i]?.done) this.steps.splice(i, 1);
    if (this.steps.length >= STEP_VOICES[this.lite ? 'lite' : 'full']) this.steps.shift()?.forceDispose();
    const s = this.strip('sfx', null);
    if (!s) return;
    this.steps.push(s);
    const t = this.ctx.currentTime + LEAD;
    const level = material === 'sand' ? LEVEL.step.sand : LEVEL.step.stone;
    // Under load, the extra layers go first.
    const busy = this.live.size > VOICES[this.lite ? 'lite' : 'full'].total * 0.6;
    if ((material === 'stone' || material === 'sand') && this.ready(bank)) {
      this.layer(s, t, bank, { gain: level[gait], rate: run ? 1.02 : 0.98, pan });
      // Clothing and gear moving with the stride: subtle, not on every step.
      if (!busy && Math.random() < (run ? 0.85 : 0.5)) {
        this.layer(s, t, 'cloth.step', {
          delay: 0.01 + Math.random() * 0.04,
          gain: LEVEL.cloth[gait],
          pan: -pan * 0.5,
          rateSpread: 0.06,
          gainSpread: 3,
        });
      }
      // The steps carry the room: a little more reverb than the bus sends on its own.
      if (!busy) s.send(this.mixer.reverbSend, run ? 0.22 : 0.3);
    } else {
      s.input.gain.value = PLAYER;
      sfx.footstep(s, t, material, this.variant(material), run);
    }
    s.seal();
  }

  /**
   * The engine's watchdog, about once a second while the context runs: frees
   * voices that lost their `ended` event, reopens gains stuck near zero, and
   * restarts a music stream the browser paused behind our back.
   */
  heal(): { reaped: number; stuck: string[] } {
    const reaped = this.reap();
    const stuck: string[] = [...this.mixer.recover(), ...this.score.recover()];
    return { reaped, stuck };
  }

  /** A user gesture arrived: retry what browsers only allow inside one (a refused or paused stream). */
  gesture(): void {
    this.score.kick();
  }

  /** Diagnostics for the watchdog log and the soak test. */
  snapshot(): Record<string, unknown> {
    return {
      voices: this.live.size,
      emitters: this.emitters.liveCount,
      level: Math.round(this.mixer.level() * 10) / 10,
      gains: this.mixer.gains(),
      music: this.score.snapshot(),
      state: this.director.state,
      cue: this.director.cue,
    };
  }

  /** Only the music state (the context is not running: no sound can be made, but the score keeps track). */
  onMusicEvent(e: SimEvent): void {
    this.director.onEvent(e);
  }

  onEvent(e: SimEvent, atRaw: Vec3 | null): void {
    this.director.onEvent(e);
    if (!this.allow(e.type)) return;
    const at = where(e) ?? (atRaw && Number.isFinite(atRaw.x + atRaw.y + atRaw.z) ? atRaw : null);
    const m = this.mixer;
    const mat: 'stone' | 'sand' = this.material === 'sand' ? 'sand' : 'stone';
    switch (e.type) {
      case 'footstep': {
        const raw = str(e, 'material');
        const material = (sfx.MATERIALS as readonly string[]).includes(raw) ? (raw as Material) : 'stone';
        this.material = material;
        this.footstep(material, e.run === true);
        break;
      }
      case 'player.jumped': {
        const kind = str(e, 'kind');
        this.play('sfx', null, (s, t) => {
          const g = kind === 'running' ? 1 : 0.75;
          if (this.ready(`jump.${mat}`, 'cloth.move')) {
            this.layer(s, t, `jump.${mat}`, { gain: LEVEL.jump * g, duration: 0.3, fadeOut: 0.1 });
            this.layer(s, t, 'cloth.move', { delay: 0.02, gain: LEVEL.clothMove * g, rate: 1.05 });
          } else {
            s.input.gain.value = PLAYER;
            sfx.jump(s, t, kind);
          }
        });
        break;
      }
      case 'player.landed': {
        const fall = num(e, 'fall', 0);
        const hard = e.hard === true;
        this.play('sfx', null, (s, t) => {
          // A jump on the level lands at fall 0; drops weigh more with height.
          const k = clamp(0.85 + fall / 8, 0.85, 1.2);
          if (this.ready(`land.${mat}`, 'cloth.move')) {
            this.layer(s, t, `land.${mat}`, { gain: LEVEL.land * k, rate: hard ? 0.92 : 1 });
            this.layer(s, t, 'cloth.move', { delay: 0.015, gain: LEVEL.clothMove * 0.6 * k });
            if (hard || fall > 2) {
              this.layer(s, t, 'body.fall', { gain: LEVEL.bodyFall * k, rate: 0.9 });
              this.layer(s, t, 'debris', {
                delay: 0.05,
                gain: LEVEL.debris * 0.35,
                duration: 0.9,
                fadeOut: 0.4,
              });
            }
            if (hard) sfx.weight(s, t, 0.3 * k); // sub-weight under the recording
          } else {
            s.input.gain.value = PLAYER;
            sfx.landing(s, t, fall, hard);
          }
        });
        break;
      }
      case 'player.grabbed':
        this.play('sfx', null, (s, t) => {
          if (this.ready('hand.stone', 'cloth.move')) {
            // Two hands land a few milliseconds apart, then the body swings and the gear creaks.
            this.layer(s, t, 'hand.stone', { gain: LEVEL.hand, pan: -0.15 });
            this.layer(s, t, 'hand.stone', {
              delay: 0.03 + Math.random() * 0.04,
              gain: LEVEL.hand * 0.85,
              pan: 0.15,
            });
            this.layer(s, t, 'cloth.move', { delay: 0.04, gain: LEVEL.clothMove });
            this.layer(s, t, 'leather', { delay: 0.12, gain: LEVEL.leather, duration: 0.5, fadeOut: 0.2 });
          } else {
            s.input.gain.value = PLAYER;
            sfx.grab(s, t);
          }
        });
        break;
      case 'player.climbing':
        this.play('sfx', null, (s, t) => {
          const T = tuning.climbTime;
          if (this.ready('scrape.stone', 'scuff.stone', 'cloth.move', 'leather')) {
            // Hands drag over the lip, the body heaves (cloth, leather), a boot finds the edge.
            this.layer(s, t, 'scrape.stone', { gain: LEVEL.scrape, pan: this.nextSide() });
            this.layer(s, t, 'cloth.move', { delay: 0.06, gain: LEVEL.clothMove * 1.1, rate: 0.95 });
            this.layer(s, t, 'leather', {
              delay: T * 0.25,
              gain: LEVEL.leather,
              duration: T * 0.6,
              fadeOut: 0.2,
            });
            this.layer(s, t, 'scuff.stone', { delay: T * 0.45, gain: LEVEL.scuff, pan: this.nextSide() });
            this.layer(s, t, 'scuff.stone', {
              delay: T * 0.72,
              gain: LEVEL.scuff * 0.8,
              pan: this.nextSide(),
            });
          } else {
            s.input.gain.value = PLAYER;
            sfx.climbing(s, t, T);
          }
        });
        break;
      case 'player.climbed':
        this.footstep('stone', false);
        break;
      case 'player.letGo':
        this.play('sfx', null, (s, t) => {
          if (!this.layer(s, t, 'cloth.move', { gain: LEVEL.clothMove * 0.8, rate: 0.9 })) {
            s.input.gain.value = PLAYER;
            sfx.letGo(s, t);
          }
        });
        break;
      case 'player.hurt': {
        const amount = num(e, 'amount', 10);
        this.play('sfx', null, (s, t) => {
          const k = clamp(amount / 30, 0.4, 1.2);
          if (this.ready('body.hit')) {
            this.layer(s, t, 'body.hit', { gain: LEVEL.hurt * k });
            this.layer(s, t, 'cloth.move', { delay: 0.01, gain: LEVEL.clothMove * 0.7 });
          } else {
            s.input.gain.value = PLAYER;
            sfx.hurt(s, t, amount);
          }
        });
        break;
      }
      case 'player.died': {
        const cause = str(e, 'cause');
        this.play('sfx', null, (s, t) => {
          if (cause === 'void' || !this.ready('body.fall')) {
            s.input.gain.value = PLAYER;
            sfx.death(s, t, cause);
            return;
          }
          if (cause === 'spikes') sfx.death(s, t, cause);
          else this.layer(s, t, `land.${mat}`, { gain: LEVEL.land * 1.2, rate: 0.9 });
          this.layer(s, t, 'body.fall', { gain: LEVEL.bodyFall * 1.3, rate: 0.85 });
          this.layer(s, t, 'debris', { delay: 0.06, gain: LEVEL.debris * 0.5, duration: 1.2, fadeOut: 0.5 });
        });
        break;
      }
      case 'player.respawned':
        this.play('ui', null, (s, t) => sfx.respawn(s, t));
        break;
      case 'player.grabbedBlock':
        this.play('sfx', at, (s, t) => {
          if (this.ready('hand.stone', 'stone.shift')) {
            this.layer(s, t, 'hand.stone', { gain: LEVEL.hand * 0.8 });
            this.layer(s, t, 'stone.shift', {
              delay: 0.03,
              gain: LEVEL.shift * 0.4,
              duration: 0.25,
              fadeOut: 0.1,
            });
          } else {
            sfx.grab(s, t);
            sfx.grind(s, t + 0.03, 0.12, 1.2, 0.12);
          }
        });
        break;
      case 'block.moving': {
        const mode = str(e, 'mode');
        const dur = mode === 'pull' ? tuning.pullTime : tuning.pushTime;
        this.play('sfx', at, (s, t) => {
          if (this.ready('block.drag')) {
            this.layer(s, t, 'block.drag', {
              gain: LEVEL.drag,
              rate: mode === 'pull' ? 0.94 : 1,
              duration: dur + 0.12,
              fadeOut: 0.22,
            });
          } else {
            sfx.blockMoving(s, t, dur, mode);
          }
        });
        m.duck(dur + 0.3);
        break;
      }
      case 'block.moved':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'stone.knock', { gain: LEVEL.knock * 0.7, rate: 0.8 })) sfx.settle(s, t, 1);
        });
        break;
      case 'block.falling':
        this.play('sfx', at, (s, t) => {
          if (this.ready('block.drag', 'debris')) {
            this.layer(s, t, 'block.drag', {
              gain: LEVEL.drag * 0.7,
              rate: 1.15,
              duration: 0.3,
              fadeOut: 0.12,
            });
            this.layer(s, t, 'debris', { delay: 0.1, gain: LEVEL.debris * 0.6, duration: 1, fadeOut: 0.4 });
          } else {
            sfx.blockFalling(s, t);
          }
        });
        m.duck(1.2);
        break;
      case 'block.landed':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'stone.impact', { gain: LEVEL.impact, rate: 0.85 })) sfx.heavyImpact(s, t, 1);
        });
        m.duck(1.2);
        break;
      case 'lever.pulled':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'lever', { gain: LEVEL.lever, rateSpread: 0.02 })) sfx.lever(s, t);
        });
        m.duck(1.6);
        break;
      case 'door.opening':
      case 'door.closing': {
        const dur = 1 / mechanics.doorSpeed;
        const closing = e.type === 'door.closing';
        this.play('sfx', at, (s, t) => {
          if (this.ready('door.grind', 'stone.shift', 'debris')) {
            // The seal breaks, the slab grinds in its channel, grit trickles from the lintel.
            this.layer(s, t, 'stone.shift', { gain: LEVEL.shift, rate: 0.8, duration: 0.6, fadeOut: 0.2 });
            this.loopLayer(s, t, 'door.grind', dur, {
              delay: 0.08,
              gain: LEVEL.door,
              rate: closing ? 0.9 : 0.85,
              fadeIn: 0.25,
              fadeOut: 0.4,
            });
            this.layer(s, t, 'debris', { delay: 0.2, gain: LEVEL.debris * 0.5, lp: 5000 });
            sfx.doorWeight(s, t, dur); // sub-bass weight of the slab under the recording
          } else {
            sfx.door(s, t, dur, closing);
          }
        });
        m.duck(dur + 0.6);
        break;
      }
      case 'door.opened':
      case 'door.closed': {
        const slam = e.type === 'door.closed';
        this.play('sfx', at, (s, t) => {
          if (this.ready('stone.impact', 'stone.knock', 'debris')) {
            // The slab comes to rest in its channel: a muffled thud; a slam is the full impact.
            if (slam) this.layer(s, t, 'stone.impact', { gain: LEVEL.impact, rate: 0.8 });
            else this.layer(s, t, 'stone.impact', { gain: LEVEL.impact * 0.55, rate: 0.75, lp: 2500 });
            this.layer(s, t, 'stone.knock', { gain: LEVEL.knock, rate: 0.7 });
            this.layer(s, t, 'debris', { delay: 0.08, gain: LEVEL.debris * 0.45, lp: 4000 });
          } else {
            sfx.doorStop(s, t, slam);
          }
        });
        break;
      }
      case 'door.tick': {
        // A timed door counting down: a small stone click (2D, it is the player's timer), doubled at the end.
        const urgent = num(e, 'left', 9) <= 3;
        this.play('sfx', null, (s, t) => {
          if (this.ready('ui.confirm')) {
            const o = {
              gain: LEVEL.tick * (urgent ? 1.2 : 1),
              rate: urgent ? 1.5 : 1.25,
              rateSpread: 0.02,
              gainSpread: 1,
            };
            this.layer(s, t, 'ui.confirm', o);
            if (urgent) this.layer(s, t, 'ui.confirm', { ...o, delay: 0.12, gain: o.gain * 0.7 });
          } else {
            sfx.tick(s, t, urgent);
          }
        });
        break;
      }
      case 'block.reset':
        this.play('sfx', null, (s, t) => {
          if (
            !this.layer(s, t, 'block.drag', {
              gain: LEVEL.drag * 0.8,
              rate: 1.1,
              duration: 0.6,
              fadeOut: 0.2,
            })
          ) {
            sfx.blockMoving(s, t, 0.6, 'push');
          }
        });
        break;
      case 'plate.pressed':
      case 'plate.released': {
        const pressed = e.type === 'plate.pressed';
        this.play('sfx', at, (s, t) => {
          if (this.ready('stone.shift', 'stone.knock')) {
            this.layer(s, t, 'stone.shift', {
              gain: LEVEL.shift * (pressed ? 0.8 : 0.5),
              rate: pressed ? 0.9 : 1.1,
              duration: pressed ? 0.45 : 0.3,
              fadeOut: 0.12,
            });
            if (pressed)
              this.layer(s, t, 'stone.knock', { delay: 0.07, gain: LEVEL.knock * 0.45, rate: 1.1 });
          } else {
            sfx.plate(s, t, pressed);
          }
        });
        break;
      }
      case 'tile.cracked':
        this.play('sfx', at, (s, t) => {
          if (this.ready('tile.crack', 'debris')) {
            // The warning spans the whole delay before the tile gives way.
            const w = mechanics.crumbleDelay;
            this.layer(s, t, 'tile.crack', { gain: LEVEL.crack, duration: w + 0.1, fadeOut: 0.15 });
            this.layer(s, t, 'debris', {
              delay: w * 0.4,
              gain: LEVEL.debris * 0.4,
              duration: w,
              fadeOut: 0.3,
            });
          } else {
            sfx.tileCrack(s, t, mechanics.crumbleDelay);
          }
        });
        m.duck(mechanics.crumbleDelay + 1);
        break;
      case 'tile.fell':
        this.play('sfx', at, (s, t) => {
          if (this.ready('debris', 'stone.impact')) {
            this.layer(s, t, 'debris', { gain: LEVEL.debris * 2.4 });
            this.layer(s, t, 'tile.crack', { gain: LEVEL.crack * 0.6, rate: 0.8 });
            // Landing far below, muffled.
            this.layer(s, t, 'stone.impact', {
              delay: 0.75 + Math.random() * 0.2,
              gain: 0.5,
              rate: 0.75,
              lp: 700,
            });
          } else {
            sfx.tileFall(s, t);
          }
        });
        m.duck(1.4);
        break;
      case 'pickup':
        this.play('ui', null, (s, t) => {
          if (!this.layer(s, t, 'pickup', { gain: LEVEL.pickup })) sfx.pickup(s, t);
          chime(s, t + 0.12, [74, 81], 0.045, 0.1);
        });
        break;
      case 'seal.note': {
        // The title seal's easter egg: each segment it lights rings a step up a pentatonic scale.
        const SCALE = [62, 65, 67, 69, 72, 74, 77, 79];
        const i = typeof e.i === 'number' ? Math.max(0, Math.min(7, e.i)) : 0;
        this.play('ui', null, (s, t) => chime(s, t, [SCALE[i] ?? 69], 0.05, 0));
        break;
      }
      case 'seal.open':
        // The ninth segment: the relic's glass shimmer and the secret chord.
        this.play('ui', null, (s, t) => {
          relicShimmer(s, t);
          secretMotif(s, t + 0.35);
        });
        break;
      case 'secret.found':
        // The secret chord (spec §12); the director adds a sting under it.
        this.play('ui', null, (s, t) => secretMotif(s, t));
        break;
      case 'relic.taken':
        this.play('sfx', at, (s, t) => {
          // The struck bowl carries it; the glass spray stays on top, quieter.
          if (this.layer(s, t, 'relic.bowl', { gain: LEVEL.bowl, rateSpread: 0, gainSpread: 0 })) {
            s.input.gain.value = 0.8;
          }
          relicShimmer(s, t);
        });
        break;
      case 'hint':
        this.play('ui', null, (s, t) => chime(s, t, [81, 88], 0.03, 0.09));
        break;
      case 'camera.focus':
        this.play('ambience', null, (s, t) => sfx.reveal(s, t));
        break;
      case 'sfx':
        if (str(e, 'name') === 'rumble') {
          this.play('sfx', null, (s, t) => {
            if (this.ready('rumble', 'debris')) {
              this.layer(s, t, 'rumble', { gain: LEVEL.rumble, rateSpread: 0.02 });
              this.layer(s, t, 'debris', { delay: 0.8, gain: LEVEL.debris * 0.6, lp: 5000 });
              this.layer(s, t, 'debris', { delay: 1.9, gain: LEVEL.debris * 0.4, lp: 3500 });
            } else {
              sfx.rumble(s, t, 3);
            }
          });
          m.duck(3.5);
        }
        break;
      case 'weapon.fired': {
        const pan = e.hand === 0 ? -0.12 : 0.12;
        this.play('sfx', at, (s, t) => sfx.gunshot(s, t, pan));
        const target = where(e, 't');
        if (target && e.hit !== true) this.play('sfx', target, (s, t) => sfx.ricochet(s, t + 0.02));
        break;
      }
      case 'torch.lit':
      case 'torch.drawn':
      case 'torch.stowed':
      case 'torch.out':
      case 'torch.state': {
        // A whoosh as the pitch catches or the torch swings; a hiss as it dies. The crackle follows.
        const lit = e.type === 'torch.lit' || (e.type !== 'torch.out' && e.lit === true);
        const inHand =
          e.type === 'torch.lit' || e.type === 'torch.drawn' || (e.type === 'torch.state' && e.hand === true);
        if (e.type !== 'torch.state') this.play('sfx', at, (s, t) => sfx.torch(s, t, e.type));
        this.emitters.torch(lit ? (inHand ? 1 : 0.5) : 0);
        break;
      }
      case 'weapons.drawn':
      case 'weapons.holstered': {
        const drawing = e.type === 'weapons.drawn';
        this.play('sfx', at, (s, t) => sfx.holster(s, t, drawing));
        break;
      }
      // Tamrit is clay: no growls or yelps, but stone and wet earth.
      case 'enemy.crumbled':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'stone.impact', { gain: LEVEL.impact * 0.6, rate: 0.5 }))
            sfx.heavyImpact(s, t, 0.6);
          this.layer(s, t, 'debris', { delay: 0.05, gain: LEVEL.debris, duration: 1.2, fadeOut: 0.4 });
        });
        break;
      case 'enemy.reformed':
        this.play('sfx', at, (s, t) => {
          if (
            !this.layer(s, t, 'block.drag', { gain: LEVEL.drag * 0.5, rate: 0.6, duration: 1, fadeOut: 0.3 })
          )
            sfx.rumble(s, t, 1);
        });
        break;
      case 'enemy.dissolved':
        this.play('sfx', at, (s, t) => {
          this.layer(s, t, 'debris', { gain: LEVEL.debris * 0.7, rate: 0.7, duration: 2, fadeOut: 0.8 });
          sfx.rumble(s, t, 1.6);
        });
        m.duck(1.2);
        break;
      // The Forge's automatons are cast bronze: clanks, ringing plates, steam.
      case 'enemy.quenched':
        this.play('sfx', at, (s, t) => {
          sfx.fireHiss(s, t, 2.2);
          sfx.heavyImpact(s, t + 0.9, 0.5);
        });
        break;
      case 'enemy.melted':
        this.play('sfx', at, (s, t) => {
          sfx.fireBurst(s, t, 1.2);
          sfx.rumble(s, t, 1.4);
        });
        break;
      case 'guardian.burned':
        this.play('sfx', at, (s, t) => {
          sfx.fireBurst(s, t, 1.6);
          if (!this.layer(s, t, 'stone.impact', { gain: LEVEL.impact * 0.8, rate: 0.45 }))
            sfx.heavyImpact(s, t, 0.8);
        });
        m.duck(1);
        break;
      case 'enemy.alerted': {
        if (e.enemy === 'automaton') {
          this.play('sfx', at, (s, t) => {
            sfx.lever(s, t);
            sfx.rumble(s, t + 0.1, 0.7);
          });
          break;
        }
        if (e.enemy === 'clay') {
          this.play('sfx', at, (s, t) => sfx.rumble(s, t, 0.9));
          break;
        }
        const dur = growlLength();
        this.play('sfx', at, (s, t) => sfx.growl(s, t, dur));
        break;
      }
      case 'enemy.hit': {
        const dying = num(e, 'health', 1) <= 0;
        const clay = e.enemy === 'clay';
        const plated = e.enemy === 'automaton';
        this.play('sfx', at, (s, t) => {
          if (plated) sfx.ricochet(s, t);
          else sfx.bulletHit(s, t);
          if (!dying && !clay && !plated) sfx.yelp(s, t + 0.02, false);
        });
        break;
      }
      case 'enemy.died':
        this.play('sfx', at, (s, t) => sfx.yelp(s, t + 0.03, true));
        break;
      case 'enemy.bite': {
        const hit = e.hit === true;
        if (e.enemy === 'clay' || e.enemy === 'automaton') {
          // The stylus arm (or the automaton's mallet) comes down like a club.
          this.play('sfx', at, (s, t) => {
            sfx.whoosh(s, t);
            if (hit) sfx.weight(s, t + 0.12, 0.5);
          });
          break;
        }
        this.play('sfx', at, (s, t) => sfx.bite(s, t, hit));
        break;
      }
      case 'enemy.gaveUp':
        this.play('sfx', at, (s, t) => sfx.huff(s, t));
        break;
      case 'medkit.used': {
        const large = str(e, 'size') === 'large';
        this.play('ui', null, (s, t) => {
          sfx.medkit(s, t, large);
          chime(s, t + 0.4, [69, 76], 0.035, 0.12);
        });
        break;
      }
      // The Temple of the Sun: every trap sounds before it acts (spec §12).
      case 'blade.swish':
        this.play('sfx', at, (s, t) => sfx.whoosh(s, t));
        break;
      case 'fire.warn':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'fire', { gain: 0.35, rate: 1.3, duration: 0.9, fadeOut: 0.2 }))
            sfx.fireHiss(s, t, 0.9);
        });
        break;
      case 'fire.burst':
        this.play('sfx', at, (s, t) => {
          this.layer(s, t, 'fire', { gain: 0.9, rate: 0.8, duration: 1.3, fadeOut: 0.4 });
          sfx.fireBurst(s, t, 1.3);
        });
        break;
      // The Clay Archive: a cylinder turning in its socket, and the darts' click and volley.
      case 'glyph.turned':
        this.play('sfx', at, (s, t) => sfx.drumTurn(s, t));
        break;
      case 'darts.click':
        this.play('sfx', at, (s, t) => sfx.holster(s, t, false));
        break;
      case 'darts.fired':
        this.play('sfx', at, (s, t) => {
          sfx.whoosh(s, t);
          sfx.whoosh(s, t + 0.05);
        });
        break;
      case 'mirror.turned':
        this.play('sfx', at, (s, t) => {
          if (
            !this.layer(s, t, 'block.drag', {
              gain: LEVEL.drag * 0.6,
              rate: 1.3,
              duration: 0.7,
              fadeOut: 0.2,
            })
          )
            sfx.drumTurn(s, t);
        });
        break;
      case 'receiver.lit':
        this.play('sfx', at, (s, t) => sfx.sunChime(s, t));
        break;
      // The Wind Stair: the flutes rise before each gust and sing while it blows.
      case 'wind.warn':
        this.play('sfx', at, (s, t) => sfx.fluteRise(s, t, wind.warning, fluteNote(at?.y ?? 0)));
        break;
      case 'wind.gust': {
        const blow = num(e, 'blow', 2);
        this.play('sfx', at, (s, t) => sfx.fluteGust(s, t, blow, fluteNote(at?.y ?? 0)));
        break;
      }
      case 'player.torn':
        this.play('sfx', null, (s, t) => sfx.letGo(s, t));
        break;
      // The Bronze Forge: the crucible's rumble, the pour, the hiss of cooling metal, the heat.
      case 'bronze.warn':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'rumble', { gain: 0.6, rate: 0.7, duration: 1.5, fadeOut: 0.3 }))
            sfx.rumble(s, t, 1.5);
        });
        break;
      case 'bronze.pour':
        this.play('sfx', at, (s, t) => {
          this.layer(s, t, 'fire', { gain: 0.8, rate: 0.55, duration: 2.4, fadeIn: 0.15, fadeOut: 0.6 });
          sfx.fireBurst(s, t, 1.8);
          if (!this.layer(s, t, 'rumble', { gain: 0.5, rate: 0.6, duration: 2, fadeOut: 0.5 }))
            sfx.rumble(s, t, 2);
        });
        break;
      case 'bronze.cooled':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'fire', { gain: 0.3, rate: 1.6, duration: 1.2, fadeOut: 0.6 }))
            sfx.fireHiss(s, t, 1.2);
        });
        break;
      case 'player.burned':
        this.play('sfx', at, (s, t) => sfx.fireBurst(s, t, 0.8));
        break;
      case 'heat.enter':
        this.play('sfx', null, (s, t) => {
          if (!this.layer(s, t, 'fire', { gain: 0.22, rate: 0.5, duration: 2.5, fadeIn: 0.5, fadeOut: 1 }))
            sfx.fireHiss(s, t, 2);
        });
        break;
      case 'boulder.warning':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'rumble', { gain: 0.9, duration: 1.4, fadeOut: 0.3 })) sfx.rumble(s, t, 1.4);
          this.layer(s, t, 'debris', { delay: 0.2, gain: LEVEL.debris, duration: 1.1, fadeOut: 0.3 });
        });
        break;
      case 'boulder.rolling': {
        const dur = Math.max(1, num(e, 'duration', 3));
        this.play('sfx', at, (s, t) => {
          if (this.ready('rumble'))
            this.loopLayer(s, t, 'rumble', dur, { gain: 1, rate: 0.8, fadeIn: 0.3, fadeOut: 0.5 });
          else sfx.rumble(s, t, dur);
        });
        m.duck(dur);
        break;
      }
      case 'boulder.crashed':
      case 'guardian.fell':
      case 'guardian.defeated':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'stone.impact', { gain: LEVEL.impact, rate: 0.6 })) sfx.heavyImpact(s, t, 1);
          this.layer(s, t, 'debris', { delay: 0.1, gain: LEVEL.debris, duration: 1.4, fadeOut: 0.5 });
          sfx.weight(s, t, 0.3);
        });
        m.duck(1.6);
        break;
      case 'guardian.step':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'stone.impact', { gain: LEVEL.impact * 0.35, rate: 0.55, lp: 900 }))
            sfx.heavyImpact(s, t, 0.35);
        });
        break;
      case 'guardian.windup':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'stone.shift', { gain: LEVEL.shift, rate: 0.6, duration: 0.9, fadeOut: 0.3 }))
            sfx.grind(s, t, 0.9, 0.6, 0.12, true);
        });
        break;
      case 'guardian.slam':
        this.play('sfx', at, (s, t) => {
          if (!this.layer(s, t, 'stone.impact', { gain: LEVEL.impact * 1.1, rate: 0.5 }))
            sfx.heavyImpact(s, t, 1.2);
          this.layer(s, t, 'debris', { delay: 0.05, gain: LEVEL.debris * 0.8, duration: 1, fadeOut: 0.4 });
          sfx.weight(s, t, 0.4);
        });
        m.duck(1.2);
        break;
      case 'medkit.none':
        this.play('ui', null, (s, t) => sfx.denied(s, t));
        break;
      default:
        break;
    }
  }

  stopEmitters(): void {
    this.emitters.stopAll();
  }
}

/** Load order after the unlock gesture: what the first seconds of play need comes first. */
export const DEFAULT_LOAD_ORDER: readonly (readonly Category[])[] = [
  ['footsteps', 'ui'],
  ['foley', 'ambience'],
  ['mechanisms'],
];
