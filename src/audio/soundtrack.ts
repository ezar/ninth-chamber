/**
 * Recorded music (spec §12 "Música"): a few long cues streamed through
 * <audio> elements into the music bus, so the options volume and the ducking
 * still apply and nothing large is decoded into memory. Cues crossfade; only
 * the title cue loops. Silence is part of the design: the exploration cue
 * plays once when entering the great hall and then leaves the room to the
 * ambience.
 *
 * Needs a real AudioContext (MediaElementAudioSourceNode) and Opus in WebM;
 * when either is missing, or a file fails, `play` returns false and the
 * graph falls back to the synthesised cues.
 */

import manifest from './samples.json';

export type TrackName = keyof typeof manifest.music;

interface TrackEntry {
  file: string;
  loop: boolean;
  duration?: number;
}

const TRACKS = manifest.music as Record<TrackName, TrackEntry>;

interface Playing {
  name: TrackName;
  el: HTMLAudioElement;
  node: MediaElementAudioSourceNode;
  gain: GainNode;
  released: boolean;
}

export function isTrack(name: string): name is TrackName {
  return Object.prototype.hasOwnProperty.call(TRACKS, name);
}

export class Soundtrack {
  private current: Playing | null = null;
  private readonly failed = new Set<TrackName>();

  private constructor(
    private readonly ctx: AudioContext,
    private readonly dest: AudioNode,
    private readonly base: string,
    private readonly onFail: (name: TrackName) => void,
  ) {}

  /** A soundtrack on `ctx`, or null where recorded music cannot stream (offline contexts, no Opus). */
  static create(
    ctx: BaseAudioContext,
    dest: AudioNode,
    base: string,
    onFail: (name: TrackName) => void,
  ): Soundtrack | null {
    if (typeof AudioContext === 'undefined' || !(ctx instanceof AudioContext)) return null;
    if (typeof Audio === 'undefined' || new Audio().canPlayType('audio/webm; codecs="opus"') === '')
      return null;
    return new Soundtrack(ctx, dest, base, onFail);
  }

  get playing(): TrackName | null {
    return this.current?.name ?? null;
  }

  /** Crossfades to `name`; true if the recorded cue is (or already was) playing. */
  play(name: TrackName, fadeIn = 1.5, crossfade = 2.5): boolean {
    if (this.failed.has(name)) return false;
    if (this.current?.name === name && !this.current.released) return true;
    this.stop(crossfade);
    const entry = TRACKS[name];
    const el = new Audio();
    el.preload = 'auto';
    el.loop = entry.loop;
    el.src = this.base + entry.file;
    const node = this.ctx.createMediaElementSource(el);
    const gain = new GainNode(this.ctx, { gain: 0 });
    node.connect(gain).connect(this.dest);
    const p: Playing = { name, el, node, gain, released: false };
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + Math.max(0.05, fadeIn));
    const fail = (): void => {
      if (p.released) return;
      this.failed.add(name);
      this.release(p, 0);
      if (this.current === p) this.current = null;
      this.onFail(name);
    };
    el.addEventListener('error', fail, { once: true });
    el.addEventListener(
      'ended',
      () => {
        this.release(p, 0);
        if (this.current === p) this.current = null;
      },
      { once: true },
    );
    el.play().catch((err: unknown) => {
      const name = err instanceof Error ? err.name : '';
      // Blocked by the autoplay policy, or interrupted by our own stop: not a broken file, try again next time.
      if (name === 'NotAllowedError' || name === 'AbortError') {
        this.release(p, 0);
        if (this.current === p) this.current = null;
      } else {
        fail();
      }
    });
    this.current = p;
    return true;
  }

  /** Fades the current cue out over `fade` seconds, after `delay` seconds. */
  stop(fade = 2, delay = 0): void {
    const p = this.current;
    if (!p) return;
    this.current = null;
    const t = this.ctx.currentTime + delay;
    const g = p.gain.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setValueAtTime(g.value, this.ctx.currentTime);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.05, fade));
    this.release(p, delay + fade + 0.1);
  }

  private release(p: Playing, after: number): void {
    if (p.released) return;
    p.released = true;
    const done = (): void => {
      p.el.pause();
      p.el.removeAttribute('src');
      p.el.load();
      p.node.disconnect();
      p.gain.disconnect();
    };
    if (after <= 0) done();
    else setTimeout(done, after * 1000);
  }
}
