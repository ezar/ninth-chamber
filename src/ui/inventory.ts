/**
 * What the pause menu's inventory panel lists (roadmap 0.2.6, "a panel in the
 * pause menu" instead of the 3D ring of spec §9): what Nora carries now
 * (medkits, flares, the torch, puzzle items), the relics of the chambers
 * already finished, and the idols found in this chamber. Names and
 * descriptions are i18n keys (`item.<id>` and `item.<id>.desc`).
 */
import type { DynamicState, Stats } from '../sim/state';
import { CHAMBERS } from './campaign';
import { isStringKey, type StringKey } from './i18n';

export interface InventoryEntry {
  group: 'items' | 'relics' | 'secrets';
  name: StringKey;
  desc: StringKey | null;
  /** How many, for items that stack (medkits, flares); null for single things. */
  count: number | null;
  /** Words to fill into the name (the idols' tally). */
  vars?: Record<string, string>;
}

/** Inventory ids that are counted and shown with a number. */
const STACKS: ReadonlySet<string> = new Set(['medkit_small', 'medkit_large', 'flare']);
/** The order consumables come in; puzzle items follow in the order they were picked up. */
const ORDER = ['medkit_small', 'medkit_large', 'flare'];

/**
 * The panel's entries. `reached`: chambers reached in the campaign (a chamber
 * whose next one is reached has given up its relic). `secretsTotal`: idols in
 * this chamber.
 */
export function inventoryEntries(
  state: DynamicState,
  stats: Stats,
  levelId: string,
  reached: ReadonlySet<string>,
  secretsTotal: number,
): InventoryEntry[] {
  const out: InventoryEntry[] = [];
  const ids = Object.keys(state.inventory).filter((id) => (state.inventory[id] ?? 0) > 0);
  ids.sort((a, b) => {
    const ia = ORDER.indexOf(a);
    const ib = ORDER.indexOf(b);
    return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib);
  });
  for (const id of ids) {
    const name = `item.${id}`;
    const desc = `${name}.desc`;
    // An item with no name yet (a new level's) is left out rather than shown as an id.
    if (!isStringKey(name)) continue;
    out.push({
      group: 'items',
      name,
      desc: isStringKey(desc) ? desc : null,
      count: STACKS.has(id) ? (state.inventory[id] ?? 0) : null,
    });
  }
  if (state.player.torch.has) {
    out.push({ group: 'items', name: 'item.torch', desc: 'item.torch.desc', count: null });
  }
  CHAMBERS.forEach((c, i) => {
    const next = CHAMBERS[i + 1]?.level;
    if (!c.relic || !c.level || c.level === levelId || !next || !reached.has(next)) return;
    out.push({ group: 'relics', name: c.relic.name, desc: c.relic.clue, count: null });
  });
  if (secretsTotal > 0) {
    out.push({
      group: 'secrets',
      name: 'inventory.secrets',
      desc: null,
      count: null,
      vars: { count: String(stats.secretsFound.length), total: String(secretsTotal) },
    });
  }
  return out;
}
