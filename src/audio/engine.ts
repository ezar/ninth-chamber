/**
 * Game audio engine (spec §12) on the raw Web Audio API.
 *
 * The simulation never calls this: main wires simulation events and the
 * camera pose into it. Sounds are recorded samples (public/audio, see
 * samples.ts and soundtrack.ts) with the procedural synthesis as fallback
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

  /** Must be called from a user gesture (browsers block audio until then). Safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this.ctx) {
      return this.ctx.state === 'running' ? Promise.resolve() : this.ctx.resume().catch(() => undefined);
    }
    if (this.unlocking) return this.unlocking;
    const Ctor = contextCtor();
    if (!Ctor) return Promise.resolve();
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // resume() must be requested synchronously inside the gesture.
    const resumed = ctx.resume().catch(() => undefined);
    const graph = new AudioGraph(ctx, { samples: `${import.meta.env.BASE_URL}audio/` });
    this.graph = graph;
    for (const [bus, v] of this.volumes) graph.mixer.setBusVolume(bus, v);
    graph.mixer.setMuted(this.muted);
    graph.setRoom(this.room);
    graph.setEmitters(this.emitters);
    graph.start();
    void graph.loadSamples();
    this.unlocking = resumed.then(() => {
      this.unlocking = null;
      // Generate the remaining impulse responses off the critical path.
      const warm = (): void =>
        graph.mixer.warm(['stone_small', 'stone_medium', 'hall_large', 'water_cistern']);
      if (typeof requestIdleCallback === 'function') requestIdleCallback(warm);
      else setTimeout(warm, 500);
    });
    return this.unlocking;
  }

  /** Handle a simulation event. `at` is the world position where it happened (usually the player). */
  onEvent(e: SimEvent, at: { x: number; y: number; z: number }): void {
    if (!this.graph || this.ctx?.state !== 'running') return;
    this.graph.onEvent(e, at);
  }

  /** Per render frame. */
  update(listener: Listener, _dt: number): void {
    if (!this.graph || this.ctx?.state !== 'running') return;
    this.graph.update(listener);
  }

  /** Starts a recorded music cue that no simulation event plays (the title theme). No-op before unlock. */
  playTrack(name: 'title', fadeIn = 2): void {
    this.graph?.playTrack(name, fadeIn);
  }

  /** Fades the music out over `fade` s after `delay` s. */
  stopMusic(fade = 3, delay = 0): void {
    this.graph?.stopMusic(fade, delay);
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

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.graph?.mixer.setMuted(muted);
  }
}
