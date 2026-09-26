/**
 * The audio graph on a given context: mixer, ambience, emitters, music, and
 * the mapping from simulation events to sounds. It works on any
 * BaseAudioContext, so the same code renders offline for checks.
 */

import type { SimEvent } from '../core/events';
import { mechanics, tuning } from '../sim/player/tuning';
import { Ambience } from './ambience';
import { noiseBank, Strip, type NoiseBank, type Vec3 } from './dsp';
import { EmitterSet, type EmitterDef } from './emitters';
import { Mixer, type BusName } from './mixer';
import { chime, fadeOut, playCue, relicShimmer, secretMotif, type CueName } from './music';
import type { ReverbPreset } from './reverb';
import * as sfx from './sfx';

export interface ListenerPose extends Vec3 {
  /** 0 looks towards -Z; positive yaw turns towards -X. */
  yaw: number;
}

/** Cap on simultaneous one-shot sounds; beyond it, new ones are dropped. */
const MAX_STRIPS = 48;
/** Minimum spacing between two sounds of the same event type (s). */
const MIN_GAP: Record<string, number> = { footstep: 0.07, 'player.landed': 0.1, 'player.hurt': 0.15 };
const DEFAULT_GAP = 0.03;
/** Scheduling lead, so every node starts on a clean sample in the future. */
const LEAD = 0.01;

const str = (e: SimEvent, key: string): string => {
  const v = e[key];
  return typeof v === 'string' ? v : '';
};
const num = (e: SimEvent, key: string, fallback = 0): number => {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

export interface GraphOptions {
  ambience?: boolean;
  destination?: AudioNode;
}

export class AudioGraph {
  readonly noise: NoiseBank;
  readonly mixer: Mixer;
  private readonly ambience: Ambience | null;
  private readonly emitters: EmitterSet;
  private strips = 0;
  private readonly last = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();
  private cue: { name: CueName; strip: Strip; at: number } | null = null;

  constructor(
    readonly ctx: BaseAudioContext,
    opts: GraphOptions = {},
  ) {
    this.noise = noiseBank(ctx);
    this.mixer = new Mixer(ctx, opts.destination);
    this.emitters = new EmitterSet(ctx, this.noise, this.mixer.bus.ambience);
    this.ambience =
      opts.ambience === false
        ? null
        : new Ambience(ctx, this.noise, this.mixer.bus.ambience, () => this.strip('ambience', null));
  }

  /** Starts the continuous layers (call once the context is running). */
  start(): void {
    this.ambience?.start();
  }

  /** A new one-shot on `bus`, spatialised at `at` when given; null when the voice cap is reached. */
  strip(bus: BusName, at: Vec3 | null, gain = 1): Strip | null {
    if (this.strips >= MAX_STRIPS) return null;
    this.strips++;
    const s = new Strip(this.ctx, this.noise, this.mixer.bus[bus], at, () => this.strips--);
    s.input.gain.value = gain;
    return s;
  }

  get activeStrips(): number {
    return this.strips;
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
  }

  private allow(type: string): boolean {
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[type] ?? DEFAULT_GAP;
    const prev = this.last.get(type);
    if (prev !== undefined && now - prev < gap) return false;
    this.last.set(type, now);
    return true;
  }

  private variant(key: string): number {
    const prev = this.lastVariant.get(key) ?? -1;
    let v = Math.floor(Math.random() * 4);
    if (v === prev) v = (v + 1 + Math.floor(Math.random() * 3)) % 4;
    this.lastVariant.set(key, v);
    return v;
  }

  /** Plays a sound built by `build` on `bus`; a no-op when the voice cap is reached. */
  private play(bus: BusName, at: Vec3 | null, build: (s: Strip, t: number) => void, gain = 1): void {
    const s = this.strip(bus, at, gain);
    if (!s) return;
    build(s, this.ctx.currentTime + LEAD);
    s.seal();
  }

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

  onEvent(e: SimEvent, atRaw: Vec3 | null): void {
    if (!this.allow(e.type)) return;
    const at = atRaw && Number.isFinite(atRaw.x + atRaw.y + atRaw.z) ? atRaw : null;
    const m = this.mixer;
    switch (e.type) {
      case 'footstep': {
        const raw = str(e, 'material');
        const material = (sfx.MATERIALS as readonly string[]).includes(raw) ? (raw as sfx.Material) : 'stone';
        const run = e.run === true;
        const v = this.variant(material);
        this.play('sfx', at, (s, t) => sfx.footstep(s, t, material, v, run));
        break;
      }
      case 'player.jumped':
        this.play('sfx', at, (s, t) => sfx.jump(s, t, str(e, 'kind')));
        break;
      case 'player.landed': {
        const fall = num(e, 'fall', 1);
        const hard = e.hard === true;
        this.play('sfx', at, (s, t) => sfx.landing(s, t, fall, hard));
        break;
      }
      case 'player.grabbed':
        this.play('sfx', at, (s, t) => sfx.grab(s, t));
        break;
      case 'player.climbing':
        this.play('sfx', at, (s, t) => sfx.climbing(s, t, tuning.climbTime));
        break;
      case 'player.climbed':
        this.play('sfx', at, (s, t) => sfx.footstep(s, t, 'stone', this.variant('stone'), false), 0.7);
        break;
      case 'player.letGo':
        this.play('sfx', at, (s, t) => sfx.letGo(s, t));
        break;
      case 'player.hurt': {
        const amount = num(e, 'amount', 10);
        this.play('sfx', at, (s, t) => sfx.hurt(s, t, amount));
        break;
      }
      case 'player.died': {
        const cause = str(e, 'cause');
        this.play('sfx', at, (s, t) => sfx.death(s, t, cause));
        this.playMusic('death');
        break;
      }
      case 'player.respawned':
        this.play('ui', null, (s, t) => sfx.respawn(s, t));
        break;
      case 'player.grabbedBlock':
        this.play('sfx', at, (s, t) => {
          sfx.grab(s, t);
          sfx.grind(s, t + 0.03, 0.12, 1.2, 0.12);
        });
        break;
      case 'block.moving': {
        const mode = str(e, 'mode');
        const dur = mode === 'pull' ? tuning.pullTime : tuning.pushTime;
        this.play('sfx', at, (s, t) => sfx.blockMoving(s, t, dur, mode));
        m.duck(dur + 0.3);
        break;
      }
      case 'block.moved':
        this.play('sfx', at, (s, t) => sfx.settle(s, t, 1));
        break;
      case 'block.falling':
        this.play('sfx', at, (s, t) => sfx.blockFalling(s, t));
        m.duck(1.2);
        break;
      case 'block.landed':
        this.play('sfx', at, (s, t) => sfx.heavyImpact(s, t, 1));
        m.duck(1.2);
        break;
      case 'lever.pulled':
        this.play('sfx', at, (s, t) => sfx.lever(s, t));
        m.duck(1.6);
        break;
      case 'door.opening':
      case 'door.closing': {
        const dur = 1 / mechanics.doorSpeed;
        const closing = e.type === 'door.closing';
        this.play('sfx', at, (s, t) => sfx.door(s, t, dur, closing));
        m.duck(dur + 0.6);
        break;
      }
      case 'door.opened':
      case 'door.closed': {
        const slam = e.type === 'door.closed';
        this.play('sfx', at, (s, t) => sfx.doorStop(s, t, slam));
        break;
      }
      case 'plate.pressed':
      case 'plate.released': {
        const pressed = e.type === 'plate.pressed';
        this.play('sfx', at, (s, t) => sfx.plate(s, t, pressed));
        break;
      }
      case 'tile.cracked':
        this.play('sfx', at, (s, t) => sfx.tileCrack(s, t, mechanics.crumbleDelay));
        m.duck(mechanics.crumbleDelay + 1);
        break;
      case 'tile.fell':
        this.play('sfx', at, (s, t) => sfx.tileFall(s, t));
        m.duck(1.4);
        break;
      case 'pickup':
        this.play('ui', null, (s, t) => {
          sfx.pickup(s, t);
          chime(s, t + 0.12, [74, 81], 0.045, 0.1);
        });
        break;
      case 'secret.found':
        this.play('ui', null, (s, t) => secretMotif(s, t));
        break;
      case 'relic.taken':
        this.play('sfx', at, (s, t) => relicShimmer(s, t));
        break;
      case 'checkpoint':
        this.play('ui', null, (s, t) => chime(s, t, [62, 69], 0.05, 0.14));
        break;
      case 'hint':
        this.play('ui', null, (s, t) => chime(s, t, [81, 88], 0.03, 0.09));
        break;
      case 'camera.focus':
        this.play('ambience', null, (s, t) => sfx.reveal(s, t));
        break;
      case 'sfx':
        if (str(e, 'name') === 'rumble') {
          this.play('sfx', null, (s, t) => sfx.rumble(s, t, 3));
          m.duck(3.5);
        }
        break;
      case 'music': {
        const name = str(e, 'name');
        if (name === 'hall' || name === 'relic' || name === 'fanfare') this.playMusic(name);
        break;
      }
      case 'level.end':
        this.playMusic('fanfare');
        break;
      default:
        break;
    }
  }

  stopEmitters(): void {
    this.emitters.stopAll();
  }
}
