/**
 * The torch: picking it up, lighting it at a brazier, putting it away and
 * taking it out, the automatic stow for two-handed moves, water and the
 * `torch.extinguish` rule action, the `torchLit` signal, one pistol while it
 * is in her hand, and checkpoints.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../src/core/events';
import { TICK_DT } from '../src/core/loop';
import { Level } from '../src/sim/grid/level';
import type { LevelFileInput } from '../src/sim/grid/schema';
import { validateLevel } from '../src/sim/grid/validate';
import { brazierInReach, torchInHand } from '../src/sim/player/torch';
import { tuning, weapons } from '../src/sim/player/tuning';
import { createWorld, respawn, saveCheckpoint, stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const secs = (s: number): number => Math.round(s / TICK_DT);

type Entities = NonNullable<LevelFileInput['entities']>;

function collect(w: World, input: Parameters<typeof run>[1], ticks: number): SimEvent[] {
  w.events.drain();
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepWorld(w, typeof input === 'function' ? input(i) : input);
    out.push(...w.events.drain());
  }
  return out;
}

const of = (events: SimEvent[], type: string): SimEvent[] => events.filter((e) => e.type === type);
const types = (events: SimEvent[]): string[] =>
  events.map((e) => e.type).filter((t) => t.startsWith('torch.'));

const ROOM = ['#######', '#.....#', '#.....#', '#..S..#', '#######'];

/** A room with the torch under Nora's feet and a brazier two cells east of her. */
function withTorch(lit = false, extra: Entities = [], rows = ROOM): World {
  const start = rows.findIndex((r) => r.includes('S'));
  const x = rows[start]?.indexOf('S') ?? 1;
  return testLevel(rows, {
    entities: [{ id: 'torch1', type: 'torch', room: 'r', at: [x, start], lit }, ...extra],
  });
}

/** Picks up the torch in Nora's sector with Action and waits for the crouch to end. */
function pickUp(w: World): SimEvent[] {
  const ev = collect(w, (i) => frame({ pressed: i === 0 ? ['action'] : [] }), secs(tuning.pickupTime) + 2);
  expect(w.state.player.mode).toBe('ground');
  return ev;
}

describe('picking up the torch', () => {
  it('Action over it crouches, takes it unlit and raises torch.picked', () => {
    const w = withTorch();
    const ev = pickUp(w);
    const t = w.state.player.torch;
    expect(t).toMatchObject({ has: true, lit: false, away: false });
    expect(types(ev)).toEqual(['torch.picked']);
    expect(w.state.signals['torch1.taken']).toBe(true);
    // An unlit torch in her hand is not a light.
    expect(w.state.signals.torchLit).toBe(false);
    // It is gone from the floor: Action there does nothing now.
    const again = collect(w, frame({ pressed: ['action'] }), 2);
    expect(w.state.player.mode).toBe('ground');
    expect(types(again)).toEqual([]);
  });

  it('a torch placed lit is picked up burning', () => {
    const w = withTorch(true);
    const ev = pickUp(w);
    expect(types(ev)).toEqual(['torch.picked', 'torch.lit']);
    expect(w.state.player.torch.lit).toBe(true);
    expect(w.state.signals.torchLit).toBe(true);
  });
});

describe('lighting the torch at a brazier', () => {
  const brazier = (id: string, at: [number, number], lit?: boolean): Entities[number] =>
    lit === undefined ? { id, type: 'brazier', room: 'r', at } : { id, type: 'brazier', room: 'r', at, lit };

  it('Action next to a burning brazier lights a carried torch', () => {
    const w = withTorch(false, [brazier('b1', [5, 3])]);
    pickUp(w);
    expect(brazierInReach(w)).toBeNull();
    // Up to the sector next to the brazier.
    run(w, frame({ x: 1 }), 30);
    run(w, frame(), 20);
    expect(brazierInReach(w)?.id).toBe('b1');
    const ev = collect(w, frame({ pressed: ['action'] }), 1);
    expect(types(ev)).toEqual(['torch.lit']);
    expect(of(ev, 'torch.lit')[0]).toMatchObject({ from: 'b1' });
    expect(w.state.player.torch.lit).toBe(true);
    expect(w.state.signals.torchLit).toBe(true);
    // Already lit: nothing more to light.
    expect(brazierInReach(w)).toBeNull();
  });

  it('a cold brazier, a far one or no torch at all light nothing', () => {
    const cold = withTorch(false, [brazier('b1', [4, 3], false)]);
    pickUp(cold);
    run(cold, frame({ x: 1 }), 20);
    expect(brazierInReach(cold)).toBeNull();
    expect(types(collect(cold, frame({ pressed: ['action'] }), 1))).toEqual([]);

    const far = withTorch(false, [brazier('b1', [5, 1])]);
    pickUp(far);
    expect(brazierInReach(far)).toBeNull();

    const none = testLevel(ROOM, { entities: [brazier('b1', [4, 3])] });
    run(none, frame({ x: 1 }), 20);
    expect(brazierInReach(none)).toBeNull();
    expect(types(collect(none, frame({ pressed: ['action'] }), 1))).toEqual([]);
  });
});

describe('putting it away and taking it out', () => {
  it('the torch button puts it on her belt, still lit, and back in her hand', () => {
    const w = withTorch(true);
    pickUp(w);
    let ev = collect(w, frame({ pressed: ['torch'] }), 1);
    expect(of(ev, 'torch.stowed')[0]).toMatchObject({ auto: false });
    expect(w.state.player.torch).toMatchObject({ lit: true, away: true, stowed: true });
    expect(torchInHand(w.state.player)).toBe(false);
    expect(w.state.signals.torchLit).toBe(false);
    ev = collect(w, frame({ pressed: ['torch'] }), 1);
    expect(of(ev, 'torch.drawn')[0]).toMatchObject({ auto: false });
    expect(torchInHand(w.state.player)).toBe(true);
    expect(w.state.signals.torchLit).toBe(true);
  });

  it('the button does nothing without a torch', () => {
    const w = testLevel(ROOM);
    expect(types(collect(w, frame({ pressed: ['torch'] }), 2))).toEqual([]);
    expect(w.state.player.torch.has).toBe(false);
  });
});

describe('two-handed moves', () => {
  // A 6-click ledge north of Nora: jump, grab, hang and climb.
  const LEDGE = ['#####', '#666#', '#...#', '#.S.#', '#####'];
  const grab = (w: World): SimEvent[] => {
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    return collect(w, frame({ held: ['action'] }), 40);
  };

  it('grabbing a ledge stows the lit torch; standing on top again draws it', () => {
    const w = withTorch(true, [], LEDGE);
    pickUp(w);
    const ev = grab(w);
    expect(w.state.player.mode).toBe('hang');
    expect(of(ev, 'torch.stowed')[0]).toMatchObject({ auto: true });
    expect(w.state.player.torch.lit).toBe(true);
    expect(torchInHand(w.state.player)).toBe(false);
    expect(w.state.signals.torchLit).toBe(false);
    const up = collect(w, (i) => frame({ y: i < 20 ? 1 : 0 }), 120);
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.player.pos.y).toBeCloseTo(3, 5);
    expect(of(up, 'torch.drawn')[0]).toMatchObject({ auto: true });
    expect(torchInHand(w.state.player)).toBe(true);
    expect(w.state.signals.torchLit).toBe(true);
  });

  it('a torch put away by choice stays on her belt after the move', () => {
    const w = withTorch(true, [], LEDGE);
    pickUp(w);
    collect(w, frame({ pressed: ['torch'] }), 1);
    grab(w);
    expect(w.state.player.mode).toBe('hang');
    const ev = collect(w, (i) => frame({ y: i < 20 ? 1 : 0 }), 120);
    expect(w.state.player.pos.y).toBeCloseTo(3, 5);
    expect(types(ev)).toEqual([]);
    expect(torchInHand(w.state.player)).toBe(false);
  });

  it('pulling a lever stows it for the pull', () => {
    const rows = ['#####', '#...#', '#.S.#', '#####'];
    const w = withTorch(true, [{ id: 'lv', type: 'lever', room: 'r', at: [2, 2], wall: 'S' }], rows);
    // The lever shares the torch's sector: the first Action takes the torch, the next pulls.
    pickUp(w);
    const ev = collect(w, (i) => frame({ pressed: i === 0 ? ['action'] : [] }), secs(tuning.leverTime) + 3);
    expect(w.state.signals['lv.used']).toBe(true);
    expect(types(ev)).toEqual(['torch.stowed', 'torch.drawn']);
    expect(torchInHand(w.state.player)).toBe(true);
  });

  it('grabbing a block stows it; letting go draws it', () => {
    const rows = ['#####', '#...#', '#...#', '#.S.#', '#####'];
    const w = withTorch(true, [{ id: 'b', type: 'block', room: 'r', at: [2, 2] }], rows);
    pickUp(w);
    run(w, frame({ y: 1, held: ['walk'] }), 30);
    let ev = collect(w, frame({ held: ['action'] }), 2);
    expect(w.state.player.mode).toBe('block');
    expect(of(ev, 'torch.stowed')).toHaveLength(1);
    ev = collect(w, frame(), 2);
    expect(of(ev, 'torch.drawn')).toHaveLength(1);
  });
});

describe('putting it out', () => {
  it('deep water puts out the flame', () => {
    const file = {
      schema: 1,
      id: 'wet',
      name: 'wet',
      start: { room: 'r', at: [2, 3], face: 'N' },
      rooms: [
        {
          id: 'r',
          origin: [0, 0, 0],
          ceil: 24,
          legend: { '#': 'wall', '.': 0 },
          rows: ['#####', '#...#', '#...#', '#...#', '#####'],
          // Water 2 m deep over the middle sector: above her hand.
          overrides: [{ at: [2, 1], water: 4 }],
        },
      ],
      entities: [{ id: 't', type: 'torch', room: 'r', at: [2, 3], lit: true }],
    };
    const w = createWorld(Level.parse(file));
    pickUp(w);
    expect(w.state.player.torch.lit).toBe(true);
    const ev = collect(w, frame({ y: 1 }), 60);
    expect(of(ev, 'torch.out')[0]).toMatchObject({ cause: 'water' });
    expect(w.state.player.torch).toMatchObject({ has: true, lit: false });
    expect(w.state.signals.torchLit).toBe(false);
  });

  it('the torch.extinguish rule action puts it out', () => {
    const w = withTorch(true, [{ id: 'z', type: 'zone', room: 'r', at: [1, 1], size: [5, 1] }]);
    const logic = [{ when: 'z.entered', do: ['torch.extinguish'] }];
    const w2 = testLevel(ROOM, {
      entities: [
        { id: 'torch1', type: 'torch', room: 'r', at: [3, 3], lit: true },
        { id: 'z', type: 'zone', room: 'r', at: [1, 1], size: [5, 1] },
      ],
      logic,
    });
    for (const world of [w, w2]) pickUp(world);
    const ev = collect(w2, frame({ y: 1 }), 60);
    expect(of(ev, 'torch.out')[0]).toMatchObject({ cause: 'rule' });
    expect(w2.state.player.torch.lit).toBe(false);
    // Without the rule the walk keeps it burning.
    run(w, frame({ y: 1 }), 60);
    expect(w.state.player.torch.lit).toBe(true);
  });

  it('the validator knows torch.extinguish and the torchLit signal', () => {
    const level = (logic: { when: string; do: string[] }[]): unknown => ({
      schema: 1,
      id: 'v',
      name: 'v',
      start: { room: 'r', at: [1, 1], face: 'N' },
      rooms: [
        {
          id: 'r',
          origin: [0, 0, 0],
          ceil: 24,
          legend: { '#': 'wall', '.': 0 },
          rows: ['###', '#.#', '###'],
        },
      ],
      entities: [{ id: 't', type: 'torch', room: 'r', at: [1, 1] }],
      logic,
    });
    expect(validateLevel(level([{ when: 'torchLit', do: ['torch.extinguish'] }])).errors).toEqual([]);
    expect(validateLevel(level([{ when: 't.taken', do: ['flag set got'] }])).errors).toEqual([]);
    expect(validateLevel(level([{ when: 'torchLit', do: ['torch.explode'] }])).errors).toHaveLength(1);
  });
});

describe('level rules see the torch', () => {
  it('torchLit is true only while the lit torch is in her hand', () => {
    const w = withTorch(false, [], ROOM);
    const w2 = testLevel(ROOM, {
      entities: [
        { id: 'torch1', type: 'torch', room: 'r', at: [3, 3], lit: true },
        { id: 'dark', type: 'zone', room: 'r', at: [1, 1], size: [5, 1] },
      ],
      logic: [{ when: 'dark.entered and torchLit', do: ['flag set carving_seen'] }],
    });
    pickUp(w);
    expect(w.state.signals.torchLit).toBe(false);
    pickUp(w2);
    run(w2, frame({ y: 1 }), 60);
    expect(w2.state.flags).toContain('carving_seen');
  });
});

describe('one pistol while the torch is in her hand', () => {
  it('draws only the right pistol and fires it at its own cadence', () => {
    const w = withTorch(true);
    pickUp(w);
    const ev = collect(
      w,
      (i) => frame({ held: ['fire'], pressed: i === 0 ? ['fire'] : [] }),
      secs(0.3 + 4.8),
    );
    expect(of(ev, 'weapons.drawn')[0]).toMatchObject({ pistols: 1 });
    const shots = of(ev, 'weapon.fired');
    expect(shots.every((s) => s.hand === 1)).toBe(true);
    expect(shots.length).toBeGreaterThanOrEqual(Math.floor(4.8 / weapons.pistols.oneHandCadence));
    expect(shots.length).toBeLessThanOrEqual(Math.floor(4.8 / weapons.pistols.oneHandCadence) + 1);
    const first = shots[0] as SimEvent;
    const last = shots.at(-1) as SimEvent;
    const gap = ((last.tick - first.tick) * TICK_DT) / (shots.length - 1);
    expect(gap).toBeCloseTo(weapons.pistols.oneHandCadence, 2);
    // The same cadence per hand as with two pistols: the rate halves.
    expect(weapons.pistols.oneHandCadence).toBeCloseTo(weapons.pistols.cadence * 2, 5);
  });

  it('with the torch put away both pistols fire again, alternating', () => {
    const w = withTorch(true);
    pickUp(w);
    collect(w, frame({ pressed: ['torch'] }), 1);
    const ev = collect(
      w,
      (i) => frame({ held: ['fire'], pressed: i === 0 ? ['fire'] : [] }),
      secs(0.3 + 1.2),
    );
    expect(of(ev, 'weapons.drawn')[0]).toMatchObject({ pistols: 2 });
    expect(
      of(ev, 'weapon.fired')
        .map((s) => s.hand)
        .slice(0, 4),
    ).toEqual([1, 0, 1, 0]);
  });
});

describe('checkpoints', () => {
  it('a respawn restores the torch as it was at the checkpoint', () => {
    const w = withTorch(false, [{ id: 'b1', type: 'brazier', room: 'r', at: [4, 3] }]);
    // Checkpoint before the pickup: after a death the torch is back on the floor.
    saveCheckpoint(w);
    pickUp(w);
    respawn(w);
    expect(w.state.player.torch.has).toBe(false);
    expect(w.state.signals['torch1.taken']).not.toBe(true);
    // Checkpoint with the torch unlit; lit afterwards; a death brings back the unlit torch.
    pickUp(w);
    saveCheckpoint(w);
    run(w, frame({ x: 1 }), 20);
    collect(w, frame({ pressed: ['action'] }), 1);
    expect(w.state.player.torch.lit).toBe(true);
    respawn(w);
    expect(w.state.player.torch).toMatchObject({ has: true, lit: false });
    // And a lit one put away stays lit and put away.
    run(w, frame({ x: 1 }), 20);
    collect(w, frame({ pressed: ['action'] }), 1);
    collect(w, frame({ pressed: ['torch'] }), 1);
    saveCheckpoint(w);
    collect(w, frame({ pressed: ['torch'] }), 1);
    respawn(w);
    expect(w.state.player.torch).toMatchObject({ has: true, lit: true, away: true });
    stepWorld(w, frame());
    expect(w.state.signals.torchLit).toBe(false);
  });
});
