import { describe, expect, it } from 'vitest';
import { CHAMBERS, chamberOf, nextChamber } from '../src/ui/campaign';
import { chamberState, loadReached, markReached, type ProgressStorage } from '../src/ui/progress';
import {
  DEFAULT_LEVEL,
  levelFromQuery,
  levelIds,
  levelUrl,
  loadLevelFile,
  loadPlayableLevel,
} from '../src/levels';
import { Level } from '../src/sim/grid/level';

const memory = (): ProgressStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('campaign progress', () => {
  it('starts with the first chamber reached, with or without storage', () => {
    expect([...loadReached(memory())]).toEqual(['antechamber']);
    expect([...loadReached(null)]).toEqual(['antechamber']);
  });

  it('saves the chambers reached and reads them back', () => {
    const s = memory();
    markReached(s, 'cisterns');
    expect(loadReached(s).has('cisterns')).toBe(true);
    expect(loadReached(s).has('sun_temple')).toBe(false);
  });

  it('survives corrupt data and storage that throws', () => {
    const s = memory();
    s.data.set('ninth-chamber.campaign', '{not json');
    expect([...loadReached(s)]).toEqual(['antechamber']);
    const broken: ProgressStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(() => markReached(broken, 'cisterns')).not.toThrow();
    expect(markReached(broken, 'cisterns').has('cisterns')).toBe(true);
  });

  it('shows reached chambers open, the rest locked or coming, and IX unknown', () => {
    const playable = new Set(['antechamber', 'cisterns']);
    const states = CHAMBERS.map((c) => chamberState(c, new Set(['antechamber']), playable));
    expect(states).toEqual(['open', 'locked', 'soon', 'soon', 'soon', 'soon', 'soon', 'soon', 'unknown']);
  });

  it('opens the Root Halls for anyone who already got past them to the Forge', () => {
    const s = memory();
    s.data.set('ninth-chamber.campaign', JSON.stringify({ reached: ['antechamber', 'bronze_forge'] }));
    const reached = loadReached(s);
    expect(reached.has('root_halls')).toBe(true);
    expect(reached.has('clay_archive')).toBe(true);
    expect(reached.has('wind_stair')).toBe(false);
  });

  it('chains the chambers: the Antechamber, then the Cisterns, then the Temple of the Sun', () => {
    expect(nextChamber('antechamber')?.level).toBe('cisterns');
    expect(nextChamber('cisterns')?.level).toBe('sun_temple');
    expect(chamberOf('cisterns')?.relic?.name).toBe('relic.cisterns.name');
  });
});

describe('level registry', () => {
  it('registers the Antechamber and the Cisterns', () => {
    expect(levelIds()).toEqual(expect.arrayContaining(['antechamber', 'cisterns']));
  });

  it('picks the level from the query and falls back to the first for unknown or missing ones', () => {
    expect(levelFromQuery('?level=cisterns')).toBe('cisterns');
    expect(levelFromQuery('?level=atlantis')).toBe(DEFAULT_LEVEL);
    expect(levelFromQuery('')).toBe(DEFAULT_LEVEL);
  });

  it('loads every registered level as a valid level of that id', async () => {
    for (const id of levelIds()) expect(Level.parse(await loadLevelFile(id)).id).toBe(id);
  });

  it('falls back to the first chamber when a level is unknown', async () => {
    expect((await loadPlayableLevel('atlantis')).id).toBe(DEFAULT_LEVEL);
    expect((await loadPlayableLevel('cisterns')).id).toBe('cisterns');
  });

  it('builds the URL of a chamber, keeping other parameters', () => {
    expect(levelUrl('https://x.test/nc/?dev=1', 'cisterns')).toBe('https://x.test/nc/?dev=1&level=cisterns');
    expect(levelUrl('https://x.test/nc/?level=cisterns#a', 'antechamber')).toBe('https://x.test/nc/');
  });
});
