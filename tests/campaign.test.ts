import { describe, expect, it } from 'vitest';
import levelJson from '../levels/antechamber.level.json';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
import { Level } from '../src/sim/grid/level';
import { CHAMBERS, chamberOf, nextChamber } from '../src/ui/campaign';

const keys = (o: object): Set<string> => new Set(Object.keys(o));

describe('campaign story data', () => {
  it('has nine chambers: three playable, five sealed and the ninth unknown', () => {
    expect(CHAMBERS.map((c) => c.numeral)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']);
    expect(CHAMBERS.slice(0, 3).map((c) => c.level)).toEqual(['antechamber', 'cisterns', 'sun_temple']);
    expect(CHAMBERS.slice(3, 8).every((c) => c.status === 'sealed' && !c.level)).toBe(true);
    expect(CHAMBERS[8]?.status).toBe('unknown');
  });

  it('gives every playable chamber an intro, a relic with a clue, a teaser and 2 to 4 journal notes', () => {
    for (const c of CHAMBERS.filter((x) => x.level)) {
      expect(c.intro?.length, c.numeral).toBeGreaterThanOrEqual(3);
      expect(c.relic?.moment.length, c.numeral).toBe(3);
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

  it('chains the chambers: the Temple leads to the sealed ones', () => {
    expect(nextChamber('antechamber')?.level).toBe('cisterns');
    expect(nextChamber('cisterns')?.level).toBe('sun_temple');
    expect(nextChamber('sun_temple')?.status).toBe('sealed');
    expect(chamberOf('nowhere')).toBeUndefined();
  });
});
