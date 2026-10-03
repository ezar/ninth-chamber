/**
 * The Observatory's dome (spec §19, chamber VIII): three rings turned one
 * position per pull of a rim lever until each is aligned, and the oculus
 * whose light rules let fall once all three are set.
 */
import { describe, expect, it } from 'vitest';
import { runActions } from '../src/sim/logic/rules';
import { inOculusLight } from '../src/sim/mechanisms/rings';
import { migrate } from '../src/sim/save/save';
import { validateLevel } from '../src/sim/grid/validate';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const ROWS = ['#######', '#.....#', '#.....#', '#..o..#', '#.....#', '#..S..#', '#######'];

/** A dome over the hall: three rings centred on (3, 3) and the oculus over it. */
function dome(extra: { logic?: { when: string; do: string[] }[] } = {}): World {
  return testLevel(ROWS, {
    legend: { o: 0 },
    entities: [
      { id: 'sky', type: 'ring', kind: 'sky', room: 'r', at: [3, 3], start: 2 },
      { id: 'moon', type: 'ring', kind: 'moon', room: 'r', at: [3, 3], start: 5 },
      { id: 'horizon', type: 'ring', kind: 'horizon', room: 'r', at: [3, 3], start: 7 },
      { id: 'oculus', type: 'oculus', room: 'r', at: [3, 3] },
    ],
    logic: [{ when: 'sky.set and moon.set and horizon.set', do: ['oculus.on'] }, ...(extra.logic ?? [])],
  });
}

const pos = (w: World, id: string): number => w.state.mechanisms.rings.find((r) => r.id === id)?.pos ?? -1;

describe('dome rings', () => {
  it('turn one position per pull and wrap round', () => {
    const w = dome();
    runActions(w, ['sky.turn']);
    expect(pos(w, 'sky')).toBe(3);
    for (let i = 0; i < 8; i++) runActions(w, ['sky.turn']);
    expect(pos(w, 'sky')).toBe(2);
    runActions(w, ['sky.back']);
    expect(pos(w, 'sky')).toBe(1);
  });

  it('are set only at their target, the ninth place, and report every position', () => {
    const w = dome();
    run(w, frame(), 2);
    expect(w.state.signals['moon.set']).toBe(false);
    expect(w.state.signals['moon.at5']).toBe(true);
    runActions(w, ['moon.turn', 'moon.turn', 'moon.turn']);
    run(w, frame(), 2);
    expect(pos(w, 'moon')).toBe(8);
    expect(w.state.signals['moon.set']).toBe(true);
    expect(w.state.signals['moon.at5']).toBe(false);
  });

  it('announce each turn, and whether it aligned the ring', () => {
    const w = dome();
    runActions(w, ['horizon.turn']);
    const e = w.events.drain().find((x) => x.type === 'ring.turned');
    expect(e?.kind).toBe('horizon');
    expect(e?.aligned).toBe(true);
  });

  it('let the oculus light fall once all three are aligned', () => {
    const w = dome();
    runActions(w, ['sky.turn', 'sky.turn', 'sky.turn', 'sky.turn', 'sky.turn', 'sky.turn']);
    runActions(w, ['moon.turn', 'moon.turn', 'moon.turn']);
    run(w, frame(), 3);
    expect(inOculusLight(w, 3, 3)).toBe(false);
    runActions(w, ['horizon.turn']);
    const types: string[] = [];
    for (let i = 0; i < 3; i++) {
      stepWorld(w, frame());
      types.push(...w.events.drain().map((e) => e.type));
    }
    expect(types).toContain('oculus.open');
    expect(w.state.signals['oculus.on']).toBe(true);
    expect(inOculusLight(w, 3, 3)).toBe(true);
    expect(inOculusLight(w, 2, 3)).toBe(false);
  });

  it('can open something on a wrong position too (the constellation niche)', () => {
    const w = dome({ logic: [{ when: 'sky.at4', do: ['flag niche'] }] });
    runActions(w, ['sky.turn', 'sky.turn']);
    run(w, frame(), 2);
    expect(w.state.signals['sky.at4']).toBe(true);
  });
});

describe('dome validation', () => {
  it('rejects a target beyond the ring’s positions and an oculus over a wall', () => {
    const lv = {
      schema: 1,
      id: 't',
      name: 't',
      start: { room: 'r', at: [3, 5], face: 'N' },
      rooms: [
        { id: 'r', origin: [0, 0, 0], ceil: 24, legend: { '#': 'wall', '.': 0, o: 0, S: 0 }, rows: ROWS },
      ],
      entities: [
        { id: 'sky', type: 'ring', kind: 'sky', room: 'r', at: [3, 3], positions: 9, target: 9 },
        { id: 'oc', type: 'oculus', room: 'r', at: [0, 3], size: [2, 1] },
      ],
      logic: [],
    };
    const { errors } = validateLevel(lv);
    expect(errors.some((e) => e.includes("ring 'sky'"))).toBe(true);
    expect(errors.some((e) => e.includes("oculus 'oc'"))).toBe(true);
  });
});

describe('saves from before the dome', () => {
  it('migrate with no rings and no oculus', () => {
    const save = { schema: 5, level: 'x', game: { checkpoint: { mechanisms: { winds: [] } }, resume: null } };
    const m = migrate(save) as { game: { checkpoint: { mechanisms: Record<string, unknown> } } } | null;
    expect(m?.game.checkpoint.mechanisms.rings).toEqual([]);
    expect(m?.game.checkpoint.mechanisms.oculi).toEqual([]);
  });
});
