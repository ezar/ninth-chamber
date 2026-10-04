import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import { Level } from '../src/sim/grid/level';
import { CHAMBERS, chamberOf, endStory, nextChamber } from '../src/ui/campaign';

const keys = (o: object): Set<string> => new Set(Object.keys(o));

describe('campaign story data', () => {
  it('has nine chambers, the ninth the end of the campaign', () => {
    expect(CHAMBERS.map((c) => c.numeral)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']);
    expect(CHAMBERS.map((c) => c.level ?? null)).toEqual([
      'antechamber',
      'cisterns',
      'sun_temple',
      'clay_archive',
      'root_halls',
      'bronze_forge',
      'wind_stair',
      'observatory',
      'ninth_chamber',
    ]);
    expect(CHAMBERS.some((c) => c.status)).toBe(false);
  });

  it('gives every playable chamber an intro, a relic (or the endings) with a clue, a teaser and 2 to 4 journal notes', () => {
    for (const c of CHAMBERS.filter((x) => x.level)) {
      expect(c.intro?.length, c.numeral).toBeGreaterThanOrEqual(3);
      if (c.endings) expect(c.relic, c.numeral).toBeUndefined();
      else expect(c.relic?.moment.length, c.numeral).toBe(3);
      expect(c.teaser, c.numeral).toBeDefined();
      expect(c.journal?.length, c.numeral).toBeGreaterThanOrEqual(2);
      expect(c.journal?.length, c.numeral).toBeLessThanOrEqual(4);
    }
  });

  it('has every journal note in every locale', () => {
    for (const locale of [keys(en), keys(es)]) {
      for (const prefix of CHAMBERS.flatMap((c) => c.journal ?? [])) {
        for (const part of ['meta', 'title', 'body'])
          expect(locale.has(`${prefix}.${part}`), prefix).toBe(true);
      }
    }
  });

  it('matches the notes placed in The Antechamber', () => {
    const level = Level.parse(levelJson);
    const placed = level.entities.flatMap((e) => (e.type === 'note' ? [e.text] : []));
    expect([...placed].sort()).toEqual([...(chamberOf('antechamber')?.journal ?? [])].sort());
  });

  it('chains the chambers: the Archive leads to the Root Halls, then the Forge, the Wind Stair, the Observatory and the ninth', () => {
    expect(nextChamber('antechamber')?.level).toBe('cisterns');
    expect(nextChamber('cisterns')?.level).toBe('sun_temple');
    expect(nextChamber('sun_temple')?.level).toBe('clay_archive');
    expect(nextChamber('clay_archive')?.level).toBe('root_halls');
    expect(nextChamber('root_halls')?.level).toBe('bronze_forge');
    expect(nextChamber('bronze_forge')?.level).toBe('wind_stair');
    expect(nextChamber('wind_stair')?.level).toBe('observatory');
    expect(nextChamber('observatory')?.numeral).toBe('IX');
    expect(chamberOf('nowhere')).toBeUndefined();
  });

  it('ends the campaign two ways: the keeper alone, the bare segment with Elena beside Nora', () => {
    const keeper = endStory('ninth_chamber', 'keeper');
    const blank = endStory('ninth_chamber', 'blank');
    expect(keeper.kind).toBe('ending');
    expect(blank.kind).toBe('ending');
    if (keeper.kind !== 'ending' || blank.kind !== 'ending') return;
    expect(keeper.story.signatures).toEqual(['end.ninth_chamber.signature.nora']);
    expect(blank.story.signatures).toEqual([
      'end.ninth_chamber.signature.elena',
      'end.ninth_chamber.signature.nora',
    ]);
    expect(keeper.story.note).not.toBe(blank.story.note);
    for (const s of [keeper.story, blank.story])
      for (const k of [s.cleared, s.title, s.figureLabel, s.note, ...s.moment, ...s.signatures])
        expect(keys(en).has(k) && keys(es).has(k), k).toBe(true);
    // Other chambers tell their relic, whatever the ending.
    expect(endStory('observatory', null).kind).toBe('relic');
    expect(endStory('observatory', 'keeper').kind).toBe('relic');
  });
});
