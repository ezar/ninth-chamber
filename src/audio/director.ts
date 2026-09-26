/**
 * The music director (spec §12 "Música"): an adaptive score driven by
 * simulation and UI events. It decides *what* plays; a MusicSink (the Web
 * Audio ScorePlayer, or a fake in tests) decides *how*.
 *
 * States, highest priority first:
 *
 *   death  → the death sting, then silence and a calm return after respawn
 *   boss   → `music boss` (the stone guardian), until `music calm`
 *   chase  → `music chase` (the rolling boulder), until `music calm`
 *   combat → while enemies hunt the player; back to calm a few seconds after the last dies or gives up
 *   tension→ a layered bed whose intensity follows the worst threat: a timed door ticking,
 *            a cracking floor, a trap zone (`music tension`), low health (plus heartbeat and muffling)
 *   base   → title, intro, relic, fanfare, end, or exploration: one cue at a time with long
 *            silences between, so the music never becomes wallpaper
 *
 * Stingers (discovery, puzzle solved, checkpoint) play over whatever runs and duck it.
 * Transitions between loops wait for the next bar; urgent ones (death, chase) cut in at once.
 *
 * Level rules drive it with `music <name>`: hall|explore, relic, fanfare, tension, calm,
 * combat, chase, boss, vista, solved, silence. Nothing here runs in the simulation.
 */

import type { SimEvent } from '../core/events';
import { cueInfo, paletteCues, paletteFor, TITLE, type Motif, type Palette } from './score';

export interface PlayOpts {
  fadeIn: number;
  fadeOut: number;
  /** Wait for the next bar of the current loop before switching. */
  sync: boolean;
  loop: boolean;
}

/** What the director asks of the audio side. */
export interface MusicSink {
  /** Crossfades the main slot to `cue` (null: silence). */
  play(cue: string | null, o: PlayOpts): void;
  /** Intensity 0..1 of a layered bed: filtered drone → full bed → percussion layer. */
  intensity(v: number): void;
  /** A stinger (or a synthesised motif) over the bed, which ducks by `duck` dB. */
  sting(cue: string | Motif, duck: number): void;
  /** Low-health heartbeat (beats per minute; 0: off). */
  heartbeat(bpm: number): void;
  /** Low-pass "tunnel hearing" on the music, 0..1. */
  muffle(v: number): void;
  /** Loads cues ahead (loops and stingers are decoded; streams need nothing). */
  prefetch(cues: readonly string[]): void;
}

/** Time source; the game uses the audio clock (it stops while paused), tests use fake timers. */
export interface Clock {
  now(): number;
  /** Runs `fn` after `seconds`; returns a cancel function. */
  after(seconds: number, fn: () => void): () => void;
}

/** setTimeout-based clock (tests with fake timers, or anywhere without an audio clock). */
export const timerClock: Clock = {
  now: () => Date.now() / 1000,
  after: (s, fn) => {
    const id = setTimeout(fn, s * 1000);
    return () => clearTimeout(id);
  },
};

/** A clock driven by `tick(now)` from the render loop (the AudioContext's currentTime). */
export class PolledClock implements Clock {
  private t = 0;
  private timers: { at: number; fn: () => void; dead: boolean }[] = [];

  now(): number {
    return this.t;
  }

  after(seconds: number, fn: () => void): () => void {
    const timer = { at: this.t + Math.max(0, seconds), fn, dead: false };
    this.timers.push(timer);
    return () => {
      timer.dead = true;
    };
  }

  tick(now: number): void {
    this.t = now;
    const due = this.timers.filter((x) => !x.dead && x.at <= now).sort((a, b) => a.at - b.at);
    if (due.length === 0) return;
    this.timers = this.timers.filter((x) => !x.dead && x.at > now);
    for (const x of due) x.fn();
  }
}

/** Timings (s). Exported for the tests and the docs. */
export const MUSIC_TIMING = {
  /** Silence before the first exploration cue after the intro, a respawn or a fight. */
  firstExplore: [45, 75] as const,
  /** Silence between exploration cues. */
  exploreGap: [100, 170] as const,
  /** Combat keeps going this long after the last hunter dies or gives up. */
  combatLinger: 4,
  /** With no enemy news for this long, a fight is over anyway (an enemy lost track silently). */
  combatTimeout: 25,
  /** A door's timer counts as tension until this long after its last tick. */
  tickLinger: 1.6,
  /** A cracking floor's tension decays over this long. */
  crackDecay: 5,
  /** Health below this is "low": tension, heartbeat, muffled music. */
  lowHealth: 0.3,
  /** At most one checkpoint motif in this long. */
  checkpointGap: 20,
  /** A door opening within this long after a lever or plate counts as a solved puzzle. */
  solvedWindow: 1.5,
  /** Silence after the death sting before the calm return is allowed. */
  deathHold: 3,
} as const;

type Base = 'silence' | 'title' | 'intro' | 'explore' | 'relic' | 'fanfare' | 'end';
export type MusicState = Base | 'tension' | 'combat' | 'chase' | 'boss' | 'death';

const rand = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
const num = (e: SimEvent, key: string, fallback: number): number => {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

export class MusicDirector {
  private palette: Palette = paletteFor('antechamber');
  private base: Base = 'silence';
  /** When the level-end fanfare rings out (clock time), so the end screen lets it finish. */
  private fanfareEndsAt = 0;
  /** The cue the base state is playing (null during a silence). */
  private baseCue: string | null = null;
  private exploreIndex = 0;
  private exploreTimer: (() => void) | null = null;
  private baseEndTimer: (() => void) | null = null;

  private dead = false;
  private deathTimer: (() => void) | null = null;
  private forced: 'chase' | 'boss' | null = null;
  private manualTension = false;
  private manualCombat = false;
  private hunters = new Set<string>();
  private combatUntil = 0;
  private combatTimer: (() => void) | null = null;
  private timerTension = 0;
  private timerUntil = 0;
  private crackAt = -1e9;
  private health = 1;
  private decayTimer: (() => void) | null = null;

  /** What is playing in the main slot, as last requested. */
  private current: { state: MusicState; cue: string | null } = { state: 'silence', cue: null };
  private intensityNow = -1;
  private heartbeatNow = 0;
  private muffleNow = 0;
  private lastCheckpoint = -1e9;
  private lastTrigger = -1e9;
  private lastMusicTick = -1;
  private readonly solvedDoors = new Set<string>();

  constructor(
    private readonly sink: MusicSink,
    private readonly clock: Clock = timerClock,
  ) {}

  /** The state the director is in (for the HUD's debug line and the tests). */
  get state(): MusicState {
    return this.current.state;
  }

  get cue(): string | null {
    return this.current.cue;
  }

  setLevel(levelId: string): void {
    this.palette = paletteFor(levelId);
    this.exploreIndex = 0;
    this.solvedDoors.clear();
    this.sink.prefetch(paletteCues(this.palette));
  }

  /** Game phase from the UI: the title theme, the intro, play, the end screen. */
  setPhase(phase: 'title' | 'intro' | 'play' | 'end'): void {
    if (phase === 'title') {
      this.resetDanger();
      this.dead = false;
      this.setBase('title', TITLE, { loop: true, fadeIn: 3 });
    } else if (phase === 'intro') {
      this.setBase('intro', this.palette.intro, { fadeIn: 2.5, fadeOut: 4 });
    } else if (phase === 'play') {
      // Coming out of the intro, the end screen or the title: the tomb's own sound first.
      if (this.base === 'intro' || this.base === 'title' || this.base === 'end') this.calm(true);
    } else {
      this.enterEnd();
    }
  }

  /**
   * The end screen: a fanfare still ringing plays out, then the main theme
   * returns; without one, a short silence first.
   */
  private enterEnd(): void {
    const now = this.clock.now();
    const fanfare = this.palette.fanfare;
    const ringing = this.current.cue === fanfare && now < this.fanfareEndsAt;
    const theme = (): void => this.setBase('end', TITLE, { loop: true, fadeIn: 6 });
    if (ringing) {
      this.cancelBaseTimers();
      this.resetDanger();
      this.base = 'end';
      this.baseCue = fanfare;
      this.current = { state: 'end', cue: fanfare };
      this.scheduleBase(this.fanfareEndsAt - now + 1, theme);
      return;
    }
    if (this.base === 'end' && this.baseCue === TITLE) return;
    this.setBase('end', null);
    this.scheduleBase(4, theme);
  }

  /** Player health 0..1, every frame (cheap: acts on changes only). */
  setHealth(h: number): void {
    if (!Number.isFinite(h) || Math.abs(h - this.health) < 0.005) return;
    this.health = h;
    this.update();
  }

  onEvent(e: SimEvent): void {
    const now = this.clock.now();
    switch (e.type) {
      case 'intro.start':
        this.setPhase('intro');
        break;
      case 'intro.end':
        // The intro cue fades as control passes to the player.
        this.calm(true);
        break;
      case 'end.show':
        // The main theme returns under the end screen once the fanfare has rung out.
        if (this.base !== 'end') this.enterEnd();
        break;
      case 'end.reveal':
        this.sting(this.palette.stingers.journal, -6);
        break;
      case 'music':
        this.lastMusicTick = e.tick;
        this.rule(String(e.name ?? ''));
        break;
      case 'level.end':
        if (this.base !== 'fanfare')
          this.setBase('fanfare', this.palette.fanfare, { fadeIn: 0.05, fadeOut: 1.5 });
        break;
      case 'enemy.alerted':
        if (typeof e.id === 'string') this.hunters.add(e.id);
        this.combatUntil = now + MUSIC_TIMING.combatTimeout;
        this.armCombatTimer(MUSIC_TIMING.combatTimeout);
        this.update();
        break;
      case 'enemy.hit':
      case 'enemy.bite':
        if (this.hunters.size > 0) {
          this.combatUntil = now + MUSIC_TIMING.combatTimeout;
          this.armCombatTimer(MUSIC_TIMING.combatTimeout);
        }
        break;
      case 'enemy.died':
      case 'enemy.gaveUp':
        if (typeof e.id === 'string') this.hunters.delete(e.id);
        if (this.hunters.size === 0 && this.combatUntil > now) {
          this.combatUntil = now + MUSIC_TIMING.combatLinger;
          this.armCombatTimer(MUSIC_TIMING.combatLinger);
        }
        this.update();
        break;
      case 'door.tick': {
        const left = num(e, 'left', 8);
        this.timerTension = Math.min(1, Math.max(0.35, 1 - left / 12));
        this.timerUntil = now + MUSIC_TIMING.tickLinger;
        this.armDecay(MUSIC_TIMING.tickLinger + 0.05);
        this.update();
        break;
      }
      case 'door.closed':
        this.timerUntil = 0;
        this.update();
        break;
      case 'tile.cracked':
        this.crackAt = now;
        this.armDecay(MUSIC_TIMING.crackDecay + 0.05);
        this.update();
        break;
      case 'lever.pulled':
      case 'plate.pressed':
        this.lastTrigger = now;
        break;
      case 'door.opening':
        if (typeof e.id === 'string' && now - this.lastTrigger <= MUSIC_TIMING.solvedWindow) {
          if (!this.solvedDoors.has(e.id)) {
            this.solvedDoors.add(e.id);
            this.sting(this.palette.stingers.solved, -8);
          }
        }
        break;
      case 'secret.found':
        // The secret chord (a synthesised motif, spec §12) with an exotic sting under it.
        this.sting(this.palette.stingers.secret, -9);
        break;
      case 'note.read':
        this.sting(this.palette.stingers.journal, -8);
        break;
      case 'checkpoint': {
        // A rule may set a music state in the same tick ("checkpoint, music hall"): then no motif.
        const tick = e.tick;
        this.clock.after(0.05, () => {
          if (this.lastMusicTick === tick || this.dead) return;
          if (this.dangerState() !== null) return;
          if (this.clock.now() - this.lastCheckpoint < MUSIC_TIMING.checkpointGap) return;
          this.lastCheckpoint = this.clock.now();
          this.sink.sting('motif.checkpoint', -4);
        });
        break;
      }
      case 'player.died':
        this.die();
        break;
      case 'player.respawned':
        this.dead = false;
        this.deathTimer?.();
        this.deathTimer = null;
        this.current = { state: 'silence', cue: null };
        this.calm(false);
        this.update();
        break;
      default:
        break;
    }
  }

  /** `music <name>` from level rules. */
  private rule(name: string): void {
    switch (name) {
      case 'hall':
      case 'explore':
        if (this.dangerState() === null) this.playExplore();
        break;
      case 'relic':
        this.setBase('relic', this.palette.relic, { fadeIn: 2, fadeOut: 3 });
        break;
      case 'fanfare':
        this.setBase('fanfare', this.palette.fanfare, { fadeIn: 0.05, fadeOut: 1.5 });
        break;
      case 'tension':
        this.manualTension = true;
        this.update();
        break;
      case 'combat':
        this.manualCombat = true;
        this.update();
        break;
      case 'chase':
      case 'boss':
        this.forced = name;
        this.update();
        break;
      case 'calm':
        this.forced = null;
        this.manualTension = false;
        this.manualCombat = false;
        this.update();
        break;
      case 'vista':
      case 'discovery':
        this.sting(this.palette.stingers.vista, -9);
        break;
      case 'solved':
        this.sting(this.palette.stingers.solved, -8);
        break;
      case 'silence':
        this.setBase('silence', null, { fadeOut: 4 });
        break;
      default:
        break;
    }
  }

  private sting(cue: string, duck: number): void {
    if (this.dead) return;
    this.sink.sting(cue, duck);
  }

  private die(): void {
    this.dead = true;
    this.resetDanger();
    this.cancelBaseTimers();
    this.sink.heartbeat(0);
    this.heartbeatNow = 0;
    this.sink.muffle(0);
    this.muffleNow = 0;
    this.base = 'silence';
    this.baseCue = null;
    this.current = { state: 'death', cue: null };
    this.sink.play(null, { fadeIn: 0, fadeOut: 0.4, sync: false, loop: false });
    this.sink.sting(this.palette.stingers.death, 0);
    this.deathTimer = this.clock.after(MUSIC_TIMING.deathHold, () => {
      this.deathTimer = null;
    });
  }

  private resetDanger(): void {
    this.forced = null;
    this.manualTension = false;
    this.manualCombat = false;
    this.hunters.clear();
    this.combatUntil = 0;
    this.combatTimer?.();
    this.combatTimer = null;
    this.timerUntil = 0;
    this.crackAt = -1e9;
  }

  private armCombatTimer(seconds: number): void {
    this.combatTimer?.();
    this.combatTimer = this.clock.after(seconds + 0.01, () => {
      this.combatTimer = null;
      if (this.clock.now() >= this.combatUntil - 0.02) this.hunters.clear();
      this.update();
    });
  }

  private armDecay(seconds: number): void {
    this.decayTimer?.();
    this.decayTimer = this.clock.after(seconds, () => {
      this.decayTimer = null;
      this.update();
    });
  }

  /** The highest-priority danger state and its intensity, or null when calm. */
  private dangerState(): { state: 'boss' | 'chase' | 'combat' | 'tension'; v: number } | null {
    if (this.dead) return null;
    const now = this.clock.now();
    if (this.forced) return { state: this.forced, v: 1 };
    // combatUntil: refreshed while enemies hunt, a short linger after the last one is gone.
    if (this.manualCombat || now < this.combatUntil) {
      return { state: 'combat', v: Math.min(1, 0.75 + 0.1 * this.hunters.size) };
    }
    let v = 0;
    if (now < this.timerUntil) v = Math.max(v, this.timerTension);
    const crack = now - this.crackAt;
    if (crack < MUSIC_TIMING.crackDecay) v = Math.max(v, 0.8 * (1 - crack / MUSIC_TIMING.crackDecay));
    if (this.manualTension) v = Math.max(v, 0.55);
    if (this.health < MUSIC_TIMING.lowHealth) v = Math.max(v, 0.45 + (MUSIC_TIMING.lowHealth - this.health));
    return v > 0.05 ? { state: 'tension', v: Math.min(1, v) } : null;
  }

  /** Re-evaluates the danger layers and the low-health effects. */
  private update(): void {
    if (this.dead) return;
    const low = this.health < MUSIC_TIMING.lowHealth && this.health > 0;
    const bpm = low ? Math.round(72 + (MUSIC_TIMING.lowHealth - this.health) * 200) : 0;
    if (bpm !== this.heartbeatNow) {
      this.heartbeatNow = bpm;
      this.sink.heartbeat(bpm);
    }
    const muffle = low ? Math.min(0.7, 0.25 + (MUSIC_TIMING.lowHealth - this.health) * 1.5) : 0;
    if (Math.abs(muffle - this.muffleNow) > 0.02) {
      this.muffleNow = muffle;
      this.sink.muffle(muffle);
    }

    const danger = this.dangerState();
    if (danger) {
      const cue = this.palette[danger.state];
      if (this.current.state !== danger.state || this.current.cue !== cue) {
        const urgent =
          danger.state === 'chase' || danger.state === 'boss' || this.current.state === 'silence';
        const fromLoop = this.current.state !== 'silence' && cueInfo(this.current.cue ?? '')?.kind === 'loop';
        this.current = { state: danger.state, cue };
        this.cancelExplore();
        this.sink.play(cue, {
          fadeIn: danger.state === 'tension' ? 3 : urgent ? 0.4 : 1.2,
          fadeOut: urgent ? 0.8 : 2.5,
          sync: fromLoop && !urgent,
          loop: true,
        });
        this.intensityNow = -1;
      }
      const v = Math.round(danger.v * 20) / 20;
      if (v !== this.intensityNow) {
        this.intensityNow = v;
        this.sink.intensity(v);
      }
      return;
    }
    // Danger over: back to the base state (a finished fight leaves a silence, then exploration).
    const wasDanger =
      this.current.state === 'tension' ||
      this.current.state === 'combat' ||
      this.current.state === 'chase' ||
      this.current.state === 'boss';
    if (wasDanger) {
      const fadeOut = this.current.state === 'tension' ? 5 : 4;
      if (this.base === 'silence' || this.base === 'explore') {
        // The interrupted exploration cue does not come back: a silence, then the next one.
        this.base = 'silence';
        this.baseCue = null;
        this.current = { state: 'silence', cue: null };
        this.sink.play(null, { fadeIn: 0, fadeOut, sync: true, loop: false });
        this.scheduleExplore(MUSIC_TIMING.firstExplore);
      } else {
        // Relic, fanfare, title or end: the base cue comes back.
        const loop = this.base === 'title' || this.base === 'end';
        this.current = { state: this.base, cue: this.baseCue };
        this.sink.play(this.baseCue, { fadeIn: 3, fadeOut, sync: true, loop });
      }
    }
  }

  private cancelExplore(): void {
    this.exploreTimer?.();
    this.exploreTimer = null;
  }

  private cancelBaseTimers(): void {
    this.cancelExplore();
    this.baseEndTimer?.();
    this.baseEndTimer = null;
  }

  private scheduleBase(seconds: number, fn: () => void): void {
    this.baseEndTimer?.();
    this.baseEndTimer = this.clock.after(seconds, () => {
      this.baseEndTimer = null;
      fn();
    });
  }

  /** Sets the base state; one-shot cues fall back to silence when they end. */
  private setBase(
    base: Base,
    cue: string | null,
    o: { loop?: boolean; fadeIn?: number; fadeOut?: number } = {},
  ): void {
    this.cancelBaseTimers();
    this.base = base;
    this.baseCue = cue;
    if (this.dangerState() === null || base === 'title' || base === 'intro' || base === 'end') {
      if (base === 'title' || base === 'intro' || base === 'end') this.resetDanger();
      this.current = { state: base, cue };
      this.sink.play(cue, {
        fadeIn: o.fadeIn ?? 1.5,
        fadeOut: o.fadeOut ?? 2.5,
        sync: false,
        loop: o.loop ?? false,
      });
    }
    const length = cue ? cueInfo(cue)?.duration : undefined;
    if (base === 'fanfare' && cue) this.fanfareEndsAt = this.clock.now() + (length ?? 15);
    if (cue && length && !o.loop) {
      this.scheduleBase(length, () => {
        if (this.baseCue !== cue) return;
        this.baseCue = null;
        const next: Base = base === 'fanfare' || base === 'end' ? base : 'silence';
        this.base = next;
        if (this.current.cue === cue) this.current = { state: next, cue: null };
        if (next === 'silence') this.scheduleExplore(MUSIC_TIMING.exploreGap);
      });
    }
  }

  /** Silence now (fading whatever plays), exploration later. */
  private calm(fromCutscene: boolean): void {
    if (this.base !== 'explore' || fromCutscene) {
      this.setBase('silence', null, { fadeOut: fromCutscene ? 4 : 5 });
    }
    this.scheduleExplore(MUSIC_TIMING.firstExplore);
  }

  private scheduleExplore(range: readonly [number, number]): void {
    this.cancelExplore();
    this.exploreTimer = this.clock.after(rand(range), () => {
      this.exploreTimer = null;
      if (this.dead || this.dangerState() !== null) return;
      if (this.base === 'silence') this.playExplore();
    });
  }

  private playExplore(): void {
    const list = this.palette.explore;
    if (list.length === 0) return;
    const cue = list[this.exploreIndex % list.length] as string;
    this.exploreIndex++;
    this.setBase('explore', cue, { fadeIn: 4, fadeOut: 6 });
  }
}
