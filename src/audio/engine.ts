/**
 * Game audio engine (spec §12) on the raw Web Audio API.
 *
 * The simulation never calls this: main wires simulation events and the
 * camera pose into it. Sounds are recorded samples (public/audio, see
 * samples.ts; music: director.ts, score.ts and score-player.ts) with the procedural synthesis as fallback
 * while files load or where Opus/WebM cannot be decoded. Silence is part of
 * the design: a discreet ambience bed, effects that announce mechanisms
 * before they act, and music only at marked moments.
 *
 * Nothing is created until unlock(), which must run inside a user gesture.
 * Before that every call just records state (room, emitters, volumes, mute)
 * and events are dropped. unlock() then fetches and decodes the sample banks
 * in the background, most urgent first.
 */

import type { SimEvent } from '../core/events';
import { AudioGraph } from './graph';
import type { BusName } from './mixer';
import type { ReverbPreset } from './reverb';

export type { ReverbPreset } from './reverb';

export interface Listener {
  x: number;
  y: number;
  z: number;
  /** 0 looks towards -Z; positive yaw turns towards -X. */
  yaw: number;
}

export interface Emitter {
  id: string;
  x: number;
  y: number;
  z: number;
  kind: 'brazier' | 'relic';
}

type AudioContextCtor = typeof AudioContext;

/**
 * Phones and tablets get the light audio profile: fewer voices, equal-power
 * panning, shorter reverbs, lower decode rates, direct music streams and a
 * larger output buffer (the audio thread must never miss its deadline).
 */
export function isLiteDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

/** The context index.html's first-gesture script made and unlocked (see #audio-unlock), if any. */
export function adoptedContext(
  win: unknown = typeof window === 'undefined' ? undefined : window,
): AudioContext | null {
  const ctx = (win as { __ncAudioCtx?: AudioContext } | undefined)?.__ncAudioCtx;
  return ctx && ctx.state !== 'closed' ? ctx : null;
}

/** How often the watchdog looks at the context (ms). */
const WATCHDOG_MS = 1000;

function contextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private graph: AudioGraph | null = null;
  private unlocking: Promise<void> | null = null;
  private room: ReverbPreset | null = null;
  private emitters: Emitter[] = [];
  private readonly volumes = new Map<BusName, number>();
  private muted = false;
  private level = 'antechamber';
  /** The pause menu suspended the audio on purpose: the watchdog leaves it alone. */
  private paused = false;
  private readonly lite = isLiteDevice();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  /** Diagnostics: recoveries so far, and a short log of what the watchdog saw. */
  private readonly stats = { resumes: 0, reaped: 0, healed: 0, interruptions: 0 };
  private readonly journal: string[] = [];
  private phase: 'title' | 'intro' | 'play' | 'end' | null = null;

  /** A gesture already unlocked audio (on the splash, before this code loaded): unlock() needs no new one. */
  get gestureSeen(): boolean {
    return adoptedContext() !== null;
  }

  /** Must be called from a user gesture (browsers block audio until then). Safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this.ctx) {
      return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume().catch(() => undefined);
    }
    if (this.unlocking) return this.unlocking;
    // The splash's first gesture may already have made and unlocked the context: adopt it.
    const adopted = adoptedContext();
    const Ctor = contextCtor();
    if (!adopted && !Ctor) return Promise.resolve();
    // Phones: a 60 ms output buffer instead of the smallest one, so a busy frame cannot starve the audio thread.
    const ctx = adopted ?? new (Ctor as AudioContextCtor)({ latencyHint: this.lite ? 0.06 : 'interactive' });
    this.ctx = ctx;
    // Publish it for index.html's gesture script, so that same tap never makes a second context
    // (window capture listeners, like main's, run before its document ones).
    if (!adopted && typeof window !== 'undefined') {
      (window as unknown as { __ncAudioCtx?: AudioContext }).__ncAudioCtx = ctx;
    }
    this.guard(ctx);
    // resume() must be requested synchronously inside the gesture.
    const resumed = ctx.resume().catch(() => undefined);
    // Building the graph synthesises buffers and impulse responses: seconds on
    // a slow phone. It waits a moment so whatever the gesture changed on
    // screen (the start button's press) paints first; events meanwhile are dropped.
    const built = new Promise<void>((done) => setTimeout(done, 60)).then(() => {
      const graph = new AudioGraph(ctx, { samples: `${import.meta.env.BASE_URL}audio/`, lite: this.lite });
      this.graph = graph;
      for (const [bus, v] of this.volumes) graph.mixer.setBusVolume(bus, v);
      graph.mixer.setMuted(this.muted);
      graph.setRoom(this.room);
      graph.setEmitters(this.emitters);
      graph.start();
      graph.setLevel(this.level);
      if (this.phase) graph.setMusicPhase(this.phase);
      void graph.loadSamples();
      return graph;
    });
    this.unlocking = Promise.all([resumed, built]).then(([, graph]) => {
      this.unlocking = null;
      // Generate the remaining impulse responses off the critical path.
      const warm = (): void =>
        graph.mixer.warm(['stone_small', 'stone_medium', 'hall_large', 'water_cistern']);
      if (typeof requestIdleCallback === 'function') requestIdleCallback(warm);
      else setTimeout(warm, 500);
    });
    return this.unlocking;
  }

  /**
   * The self-healing part. Browsers suspend or interrupt an AudioContext on
   * their own (Chrome for Android: audio focus taken by another app or a
   * call, the screen turning off, the tab going to the background). Nothing
   * brought it back during play, so the sound came and went and finally
   * stopped. Now: every state change, every user gesture, the page becoming
   * visible again and a one-second watchdog resume it (Chrome allows resume()
   * once the page has had a gesture); the watchdog also frees voices that lost
   * their `ended` event and reopens gains stuck near zero.
   */
  private guard(ctx: AudioContext): void {
    ctx.addEventListener('statechange', () => {
      this.note(`state ${ctx.state}`);
      if (ctx.state !== 'running') {
        if (ctx.state !== 'closed' && !this.paused) this.stats.interruptions++;
        this.revive();
      }
    });
    if (typeof window !== 'undefined') {
      const gesture = (): void => {
        this.revive();
        this.graph?.gesture();
      };
      for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) {
        window.addEventListener(type, gesture, { capture: true, passive: true });
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.note(document.hidden ? 'hidden' : 'visible');
        if (!document.hidden) {
          this.revive();
          this.graph?.gesture();
        }
      });
    }
    this.watchdog = setInterval(() => this.check(), WATCHDOG_MS);
  }

  /** Resumes the context unless the pause menu holds it or the page is hidden. */
  private revive(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed' || this.paused) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.stats.resumes++;
    void ctx.resume().catch(() => undefined);
  }

  private check(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      this.revive();
      return;
    }
    const g = this.graph;
    if (!g) return;
    const { reaped, stuck } = g.heal();
    if (reaped > 0) {
      this.stats.reaped += reaped;
      this.note(`reaped ${reaped} voices`);
    }
    if (stuck.length > 0) {
      this.stats.healed += stuck.length;
      this.note(`reopened ${stuck.join(', ')}`);
    }
  }

  private note(line: string): void {
    const t = this.ctx ? this.ctx.currentTime.toFixed(1) : '-';
    this.journal.push(`${t} ${line}`);
    if (this.journal.length > 40) this.journal.shift();
  }

  /** Diagnostics for the console (`__nc.audio.debug()`) and the soak test. */
  debug(): Record<string, unknown> {
    const ctx = this.ctx;
    return {
      state: ctx?.state ?? 'none',
      time: ctx ? Math.round(ctx.currentTime * 100) / 100 : 0,
      lite: this.lite,
      latency: ctx ? Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000) : 0,
      paused: this.paused,
      ...this.stats,
      ...(this.graph ? this.graph.snapshot() : {}),
      log: this.journal.slice(-8),
    };
  }

  /** Handle a simulation event. `at` is the world position where it happened (usually the player). */
  onEvent(e: SimEvent, at: { x: number; y: number; z: number }): void {
    if (!this.graph) return;
    // While the context is not running no sound can be made, but the music keeps track of the game.
    if (this.ctx?.state !== 'running') {
      this.graph.onMusicEvent(e);
      return;
    }
    this.graph.onEvent(e, at);
  }

  /** Per render frame. */
  update(listener: Listener, _dt: number): void {
    if (!this.graph || this.ctx?.state !== 'running') return;
    this.graph.update(listener);
  }

  /** The level whose music palette plays (score.ts). Safe before unlock. */
  setLevel(id: string): void {
    this.level = id;
    this.graph?.setLevel(id);
  }

  /**
   * Game phase for the music director: the title theme, the intro, play, the end screen.
   * Before the graph exists (it is built a moment after the unlock gesture) the phase is remembered.
   */
  setMusicPhase(phase: 'title' | 'intro' | 'play' | 'end'): void {
    this.phase = phase;
    this.graph?.setMusicPhase(phase);
  }

  /** Player health 0..1, every frame: low health brings tension, a heartbeat and muffled music. */
  setHealth(h: number): void {
    this.graph?.setHealth(h);
  }

  /** Menu feedback: a press, a hover, a confirmation. No-op before unlock. */
  ui(name: 'click' | 'hover' | 'confirm'): void {
    if (this.graph) this.graph.ui(name);
  }

  /** Crossfades the convolution reverb to the room's preset (null: dry). */
  setRoom(reverb: ReverbPreset | null): void {
    this.room = reverb;
    this.graph?.setRoom(reverb);
  }

  /** Looping positional sources (fire crackle, relic hum); diffed by id. */
  setEmitters(emitters: Emitter[]): void {
    this.emitters = emitters.map((e) => ({ ...e }));
    this.graph?.setEmitters(this.emitters);
  }

  /** Linear volume 0..1 for a bus, as set in the options menu. */
  setBusVolume(bus: 'music' | 'ambience' | 'sfx' | 'ui' | 'voice', v: number): void {
    const clamped = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    this.volumes.set(bus, clamped);
    this.graph?.mixer.setBusVolume(bus, clamped);
  }

  /** The camera under water (0..1): the whole mix goes dull. */
  setUnderwater(v: number): void {
    this.graph?.mixer.setUnderwater(v);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.graph?.mixer.setMuted(muted);
  }

  /**
   * Pause menu: suspends the whole audio context, so loops, reverb tails and
   * scheduled music stop in place and continue where they were on resume.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const ctx = this.ctx;
    if (!ctx) return;
    this.graph?.setPaused(paused);
    if (paused) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  }
}
