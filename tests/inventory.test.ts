import { describe, expect, it } from 'vitest';
import antechamberJson from '../levels/antechamber.level.json';
import cisternsJson from '../levels/cisterns.level.json';
import templeJson from '../levels/sun_temple.level.json';
import en from '../i18n/en.json';
import { Level } from '../src/sim/grid/level';
import { createWorld } from '../src/sim/world';
import { inventoryEntries } from '../src/ui/inventory';

const temple = Level.parse(templeJson);

describe('inventory panel', () => {
  it('lists consumables first with counts, then puzzle items, relics and idols', () => {
    const w = createWorld(temple, 1);
    w.state.inventory = { bronze_ray: 1, flare: 3, medkit_small: 2, medkit_large: 0 };
    w.state.player.torch.has = true;
    w.stats.secretsFound = ['idol_gold'];
    const reached = new Set(['antechamber', 'cisterns', 'sun_temple']);
    const out = inventoryEntries(w.state, w.stats, 'sun_temple', reached, 3);
    expect(out.map((e) => [e.group, e.name, e.count])).toEqual([
      ['items', 'item.medkit_small', 2],
      ['items', 'item.flare', 3],
      ['items', 'item.bronze_ray', null],
      ['items', 'item.torch', null],
      ['relics', 'relic.antechamber.name', null],
      ['relics', 'relic.cisterns.name', null],
      ['secrets', 'inventory.secrets', null],
    ]);
    expect(out.at(-1)?.vars).toEqual({ count: '1', total: '3' });
  });

  it('shows no relic for chambers not finished yet', () => {
    const w = createWorld(temple, 1);
    const out = inventoryEntries(w.state, w.stats, 'antechamber', new Set(['antechamber']), 3);
    expect(out.filter((e) => e.group === 'relics')).toEqual([]);
  });

  it('has a name and a description for everything a level can give', () => {
    const ids = new Set(['medkit_small', 'medkit_large', 'flare', 'torch']);
    for (const json of [antechamberJson, cisternsJson, templeJson]) {
      for (const e of json.entities as { type: string; item?: string }[])
        if (e.type === 'item' && e.item) ids.add(e.item);
    }
    const keys = en as Record<string, string>;
    for (const id of ids) {
      expect(keys[`item.${id}`], id).toBeTruthy();
      expect(keys[`item.${id}.desc`], id).toBeTruthy();
    }
  });
});
