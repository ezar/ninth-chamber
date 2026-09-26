import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MUSIC_TIMING,
  MusicDirector,
  PolledClock,
  timerClock,
  type MusicSink,
  type PlayOpts,
} from '../src/audio/director';
import { cueInfo, PALETTES, paletteCues, paletteFor } from '../src/audio/score';
import type { SimEvent } from '../src/core/events';

type Call =
  | { k: 'play'; cue: string | null; o: PlayOpts }
  | { k: 'intensity'; v: number }
  | { k: 'sting'; cue: string; duck: number }
  | { k: 'heartbeat'; bpm: number }
  | { k: 'muffle'; v: number }
  | { k: 'prefetch'; cues: readonly string[] };

class FakeSink implements MusicSink {
  calls: Call[] = [];
  play(cue: string | null, o: PlayOpts): void {
    this.calls.push({ k: 'play', cue, o });
  }
  intensity(v: number): void {
    this.calls.push({ k: 'intensity', v });
  }
  sting(cue: string, duck: number): void {
    this.calls.push({ k: 'sting', cue, duck });
  }
  heartbeat(bpm: number): void {
    this.calls.push({ k: 'heartbeat', bpm });
  }
  muffle(v: number): void {
    this.calls.push({ k: 'muffle', v });
  }
  prefetch(cues: readonly string[]): void {
    this.calls.push({ k: 'prefetch', cues });
  }
  plays(): (string | null)[] {
    return this.calls.filter((c): c is Extract<Call, { k: 'play' }> => c.k === 'play').map((c) => c.cue);
  }
  lastPlay(): Extract<Call, { k: 'play' }> | undefined {
    return this.calls.filter((c): c is Extract<Call, { k: 'play' }> => c.k === 'play').at(-1);
  }
  stings(): string[] {
    return this.calls.filter((c): c is Extract<Call, { k: 'sting' }> => c.k === 'sting').map((c) => c.cue);
  }
  last<K extends Call['k']>(k: K): Extract<Call, { k: K }> | undefined {
    return this.calls.filter((c): c is Extract<Call, { k: K }> => c.k === k).at(-1);
  }
}

let tick = 0;
const ev = (type: string, data: Record<string, unknown> = {}): SimEvent => ({ type, tick: ++tick, ...data });
const seconds = (s: number): void => {
  vi.advanceTimersByTime(s * 1000);
};

function playing(level = 'antechamber'): { d: MusicDirector; sink: FakeSink } {
  const sink = new FakeSink();
  const d = new MusicDirector(sink, timerClock);
  d.setLevel(level);
  d.setPhase('play');
  return { d, sink };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('score data', () => {
  it('every palette cue exists in the manifest with the right kind', () => {
    for (const p of Object.values(PALETTES)) {
      expect(cueInfo(p.intro)?.kind).toBe('stream');
      for (const c of [...p.explore, p.relic, p.fanfare]) expect(cueInfo(c)?.kind).toBe('stream');
      for (const c of [p.tension, p.combat, p.chase, p.boss]) expect(cueInfo(c)?.kind).toBe('loop');
      for (const c of Object.values(p.stingers)) expect(cueInfo(c)?.kind).toBe('sting');
    }
    expect(cueInfo('title')?.kind).toBe('stream');
  });

  it('loops with a tempo carry a whole number of bars', () => {
    for (const p of Object.values(PALETTES)) {
      for (const c of [p.tension, p.combat, p.chase, p.boss]) {
        const info = cueInfo(c);
        if (!info?.bpm) continue;
        const bars = ((info.length ?? 0) * info.bpm) / 240;
        expect(Math.abs(bars - Math.round(bars))).toBeLessThan(0.01);
      }
    }
  });

  it('maps the three chambers by level id, and unknown levels to the Antechamber', () => {
    expect(paletteFor('cisterns').combat).toBe('cisterns.combat');
    expect(paletteFor('sun_temple').relic).toBe('sun_temple.relic');
    expect(paletteFor('no_such_level')).toBe(PALETTES.antechamber);
    expect(paletteCues(paletteFor('sun_temple'))).toContain('boss');
  });
});

describe('music director', () => {
  it('title loops; the intro takes over; play starts in silence and exploration comes later', () => {
    const sink = new FakeSink();
    const d = new MusicDirector(sink, timerClock);
    d.setLevel('antechamber');
    d.setPhase('title');
    expect(sink.lastPlay()).toMatchObject({ cue: 'title', o: { loop: true } });
    d.onEvent(ev('intro.start'));
    expect(d.state).toBe('intro');
    expect(sink.lastPlay()?.cue).toBe('antechamber.intro');
    d.onEvent(ev('intro.end', { skipped: false }));
    d.setPhase('play');
    expect(sink.lastPlay()?.cue).toBeNull();
    expect(d.state).toBe('silence');
    seconds(MUSIC_TIMING.firstExplore[0] - 1);
    expect(d.state).toBe('silence');
    seconds(MUSIC_TIMING.firstExplore[1] - MUSIC_TIMING.firstExplore[0] + 1);
    expect(d.state).toBe('explore');
    expect(sink.lastPlay()?.cue).toBe('antechamber.explore.1');
  });

  it('an exploration cue plays once, then a long silence, then the next one', () => {
    const { d, sink } = playing();
    d.onEvent(ev('music', { name: 'hall' }));
    expect(sink.lastPlay()?.cue).toBe('antechamber.explore.1');
    const length = cueInfo('antechamber.explore.1')?.duration ?? 0;
    seconds(length + 0.1);
    expect(d.state).toBe('silence');
    seconds(MUSIC_TIMING.exploreGap[0] - 1);
    expect(d.state).toBe('silence');
    seconds(MUSIC_TIMING.exploreGap[1] - MUSIC_TIMING.exploreGap[0] + 1);
    expect(sink.lastPlay()?.cue).toBe('antechamber.explore.2');
  });

  it('combat starts when a jackal is alerted and falls back a few seconds after the last one dies', () => {
    const { d, sink } = playing();
    d.onEvent(ev('music', { name: 'hall' }));
    d.onEvent(ev('enemy.alerted', { id: 'j1' }));
    d.onEvent(ev('enemy.alerted', { id: 'j2' }));
    expect(d.state).toBe('combat');
    expect(sink.lastPlay()).toMatchObject({ cue: 'antechamber.combat', o: { loop: true } });
    expect(sink.last('intensity')?.v).toBeGreaterThanOrEqual(0.9);
    d.onEvent(ev('enemy.died', { id: 'j1' }));
    seconds(10);
    expect(d.state).toBe('combat');
    d.onEvent(ev('enemy.gaveUp', { id: 'j2' }));
    seconds(MUSIC_TIMING.combatLinger - 0.5);
    expect(d.state).toBe('combat');
    seconds(1);
    expect(d.state).not.toBe('combat');
    // The fight hands back on the bar, and the interrupted exploration cue does not restart: a silence first.
    expect(sink.lastPlay()).toMatchObject({ cue: null, o: { sync: true } });
    expect(d.state).toBe('silence');
    seconds(MUSIC_TIMING.firstExplore[1] + 1);
    expect(sink.lastPlay()?.cue).toBe('antechamber.explore.2');
  });

  it('a fight is over if the hunters go quiet for long enough', () => {
    const { d } = playing();
    d.onEvent(ev('enemy.alerted', { id: 'j1' }));
    seconds(MUSIC_TIMING.combatTimeout + 1);
    expect(d.state).toBe('silence');
  });

  it('a timed door ticking raises the tension, more as time runs out, and lets go after the last tick', () => {
    const { d, sink } = playing();
    d.onEvent(ev('door.tick', { id: 'gate2', left: 10 }));
    expect(d.state).toBe('tension');
    expect(sink.lastPlay()?.cue).toBe('antechamber.tension');
    const early = sink.last('intensity')?.v ?? 0;
    seconds(1);
    d.onEvent(ev('door.tick', { id: 'gate2', left: 2 }));
    expect(sink.last('intensity')?.v ?? 0).toBeGreaterThan(early);
    seconds(MUSIC_TIMING.tickLinger + 0.2);
    expect(d.state).toBe('silence');
  });

  it('combat outranks tension; tension resumes afterwards; transitions between loops wait for the bar', () => {
    const { d, sink } = playing();
    d.onEvent(ev('music', { name: 'tension' }));
    expect(d.state).toBe('tension');
    d.onEvent(ev('enemy.alerted', { id: 'j1' }));
    expect(d.state).toBe('combat');
    expect(sink.lastPlay()?.o.sync).toBe(true);
    d.onEvent(ev('enemy.died', { id: 'j1' }));
    seconds(MUSIC_TIMING.combatLinger + 0.5);
    expect(d.state).toBe('tension');
    d.onEvent(ev('music', { name: 'calm' }));
    expect(d.state).toBe('silence');
  });

  it('a cracking floor spikes the tension, which decays', () => {
    const { d } = playing();
    d.onEvent(ev('tile.cracked', { cx: 1, cz: 1 }));
    expect(d.state).toBe('tension');
    seconds(MUSIC_TIMING.crackDecay + 0.2);
    expect(d.state).toBe('silence');
  });

  it('chase and boss come from level rules, cut in at once and end with music calm', () => {
    const { d, sink } = playing('sun_temple');
    d.onEvent(ev('music', { name: 'chase' }));
    expect(sink.lastPlay()).toMatchObject({ cue: 'chase', o: { sync: false } });
    d.onEvent(ev('enemy.alerted', { id: 'j1' }));
    expect(d.state).toBe('chase');
    d.onEvent(ev('music', { name: 'boss' }));
    expect(sink.lastPlay()?.cue).toBe('boss');
    d.onEvent(ev('music', { name: 'calm' }));
    // The jackal still hunts: calm hands over to combat, not silence.
    expect(d.state).toBe('combat');
    expect(sink.lastPlay()?.cue).toBe('sun_temple.combat');
  });

  it('low health brings a heartbeat, muffled music and tension; healing clears them', () => {
    const { d, sink } = playing();
    d.setHealth(0.15);
    expect(sink.last('heartbeat')?.bpm).toBeGreaterThan(70);
    expect(sink.last('muffle')?.v).toBeGreaterThan(0.2);
    expect(d.state).toBe('tension');
    d.setHealth(0.9);
    expect(sink.last('heartbeat')?.bpm).toBe(0);
    expect(sink.last('muffle')?.v).toBe(0);
    expect(d.state).toBe('silence');
  });

  it('death: the sting, silence, everything reset; the respawn returns calmly', () => {
    const { d, sink } = playing();
    d.onEvent(ev('enemy.alerted', { id: 'j1' }));
    d.setHealth(0.1);
    d.onEvent(ev('player.died', { cause: 'bite' }));
    expect(d.state).toBe('death');
    expect(sink.stings()).toContain('sting.death');
    expect(sink.lastPlay()?.cue).toBeNull();
    expect(sink.last('heartbeat')?.bpm).toBe(0);
    d.onEvent(ev('player.respawned'));
    d.setHealth(1);
    expect(d.state).toBe('silence');
    seconds(MUSIC_TIMING.firstExplore[1] + 1);
    expect(d.state).toBe('explore');
  });

  it('stingers: secrets, journal notes, vistas, and a door opened by a lever (once per door)', () => {
    const { d, sink } = playing();
    d.onEvent(ev('secret.found', { id: 's1' }));
    d.onEvent(ev('note.read', { id: 'n1' }));
    d.onEvent(ev('music', { name: 'vista' }));
    expect(sink.stings()).toEqual(['sting.secret', 'sting.journal', 'sting.vista']);
    d.onEvent(ev('lever.pulled', { id: 'lever1' }));
    d.onEvent(ev('door.opening', { id: 'door1' }));
    expect(sink.stings().at(-1)).toBe('sting.solved');
    const n = sink.stings().length;
    d.onEvent(ev('plate.pressed', { id: 'p' }));
    d.onEvent(ev('door.opening', { id: 'door1' }));
    expect(sink.stings().length).toBe(n);
    // A door that opens on its own (no lever or plate just before) is not a solved puzzle.
    seconds(5);
    d.onEvent(ev('door.opening', { id: 'door2' }));
    expect(sink.stings().length).toBe(n);
  });

  it('the checkpoint motif plays alone, not when a rule sets music in the same tick, and not too often', () => {
    const { d, sink } = playing();
    d.onEvent({ type: 'checkpoint', tick: 500 });
    d.onEvent({ type: 'music', tick: 500, name: 'hall' });
    seconds(0.1);
    expect(sink.stings()).not.toContain('motif.checkpoint');
    d.onEvent({ type: 'checkpoint', tick: 900 });
    seconds(0.1);
    expect(sink.stings()).toContain('motif.checkpoint');
    d.onEvent({ type: 'checkpoint', tick: 950 });
    seconds(0.1);
    expect(sink.stings().filter((s) => s === 'motif.checkpoint').length).toBe(1);
  });

  it('relic, fanfare and the end screen: the main theme returns after the fanfare', () => {
    const { d, sink } = playing();
    d.onEvent(ev('music', { name: 'relic' }));
    expect(sink.lastPlay()?.cue).toBe('antechamber.relic');
    d.onEvent(ev('music', { name: 'fanfare' }));
    d.onEvent(ev('level.end'));
    expect(sink.plays().filter((c) => c === 'fanfare').length).toBe(1);
    d.setPhase('end');
    d.onEvent(ev('end.show', { rank: 'A' }));
    seconds(5);
    expect(sink.lastPlay()).toMatchObject({ cue: 'title', o: { loop: true } });
  });

  it('the polled clock (the game uses the audio clock) fires timers in order and cancels', () => {
    const c = new PolledClock();
    const log: string[] = [];
    c.after(2, () => log.push('b'));
    c.after(1, () => log.push('a'));
    const cancel = c.after(1.5, () => log.push('x'));
    cancel();
    c.tick(0.5);
    expect(log).toEqual([]);
    c.tick(3);
    expect(log).toEqual(['a', 'b']);
  });
});
