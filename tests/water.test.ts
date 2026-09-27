/**
 * Water, water gates and flares (spec §5.10 "Agua", §7 "Bengalas", §8
 * "Compuerta de agua"): each promise of the controller as a deterministic
 * InputFrame script. Camera yaw 0: input y+ is north (-Z).
 */
import { describe, expect, it } from 'vitest';
import { buttonBit } from '../src/core/input-frame';
import { TICK_DT } from '../src/core/loop';
import { waterSurface } from '../src/sim/actors/water';
import { flares, mechanics, swimming, tuning } from '../src/sim/player/tuning';
import { findActor, hashWorld, stepWorld, type World } from '../src/sim/world';
import { cellZ, frame, run, runUntil, testLevel } from './helpers';

const seconds = (s: number): number => Math.ceil(s / TICK_DT);

/** Event types emitted while running `fn`. */
function events(w: World, fn: () => void): string[] {
  w.events.drain();
  fn();
  return w.events.drain().map((e) => e.type);
}

// A 3.5 m deep pool whose surface is 1 click under the shore (floor 0).
const POOL = ['#####', '#WWW#', '#WWW#', '#WWW#', '#...#', '#.S.#', '#####'];
const pool = (water = -1, extra: Parameters<typeof testLevel>[1] = {}): World =>
  testLevel(POOL, { ...extra, legend: { W: { floor: -8, water }, ...extra.legend } });

/** Runs north into the pool and waits until Nora floats at the surface. */
function swimIn(w: World): void {
  runUntil(w, frame({ y: 1 }), (x) => x.state.player.mode === 'swim', 240);
  runUntil(w, frame(), (x) => x.state.player.mode === 'swim' && x.state.player.modeTime > 1, 240);
}

describe('entering water', () => {
  it('running into deep water splashes and swims at the surface, unhurt', () => {
    const w = pool();
    const seen = events(w, () => swimIn(w));
    const p = w.state.player;
    expect(p.mode).toBe('swim');
    expect(seen).toContain('player.splash');
    expect(p.pos.y).toBeCloseTo(-0.5 - swimming.surfaceSink, 2);
    expect(p.health).toBe(tuning.maxHealth);
  });

  it('walking carefully slips into water one click down instead of stopping at the edge', () => {
    const w = pool();
    runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.mode === 'swim', 400);
    expect(w.state.player.mode).toBe('swim');
  });

  it('a jump into deep water is safe from any height', () => {
    // A 20 m tower over a pool 2 m deep.
    const w = testLevel(['#####', '#WWW#', '#WWW#', '#TTT#', '#TST#', '#####'], {
      legend: { W: { floor: -4, water: 0 }, T: 40, S: 40 },
      ceil: 60,
    });
    const seen = events(w, () => {
      run(w, frame({ y: 1 }), 20);
      stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
      runUntil(w, frame({ y: 1 }), (x) => x.state.player.mode !== 'air', seconds(4));
      runUntil(w, frame(), (x) => x.state.player.mode === 'swim', seconds(8));
    });
    expect(w.state.player.mode).toBe('swim');
    expect(w.state.player.health).toBe(tuning.maxHealth);
    expect(seen).toContain('player.splash');
    expect(seen).toContain('player.surfaced');
  });

  it('water two clicks deep breaks a long fall; one click does not', () => {
    const drop = (waterClicks: number): World => {
      const w = testLevel(['#####', '#WWW#', '#TTT#', '#TST#', '#####'], {
        legend: { W: { floor: 0, water: waterClicks }, T: 24, S: 24 },
        ceil: 40,
      });
      runUntil(w, frame({ y: 1 }), (x) => cellZ(x) === 1 && x.state.player.mode !== 'air', 300);
      return w;
    };
    const deep = drop(2);
    expect(deep.state.player.mode).toBe('ground');
    expect(deep.state.player.health).toBe(tuning.maxHealth);
    const shallow = drop(1);
    expect(shallow.state.player.mode).toBe('dead');
  });
});

describe('wading', () => {
  it('wading is slower than running and never swims in shallows', () => {
    const w = testLevel(['#####', '#...#', '#...#', '#...#', '#...#', '#.S.#', '#####'], { water: 2 });
    run(w, frame({ y: 1 }), 40);
    const v = w.state.player.vel;
    expect(w.state.player.mode).toBe('ground');
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(swimming.wadeSpeed, 1);
  });

  it('swimming into shallows stands Nora up', () => {
    // Deep in the north, a shelf 2 clicks under the surface to the south.
    const w = testLevel(['#####', '#WWW#', '#WWW#', '#hhh#', '#hSh#', '#####'], {
      legend: { W: { floor: -8, water: 0 }, h: { floor: -2, water: 0 } },
    });
    expect(w.state.player.mode).toBe('ground');
    run(w, frame({ y: 1 }), 60);
    expect(w.state.player.mode).toBe('swim');
    runUntil(w, frame({ y: -1 }), (x) => x.state.player.mode === 'ground', 400);
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.player.pos.y).toBeCloseTo(-1, 5);
  });
});

describe('swimming at the surface', () => {
  it('swims at swim speed', () => {
    const w = pool();
    swimIn(w);
    run(w, frame({ x: 1 }), 90);
    const v = w.state.player.vel;
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(swimming.swimSpeed, 1);
  });

  it('climbs out onto an edge one click above the water', () => {
    const w = pool();
    swimIn(w);
    runUntil(w, frame({ y: -1 }), (x) => x.state.player.vel.z > 1, 120);
    run(w, frame({ y: -1 }), 60);
    stepWorld(w, frame({ y: -1, pressed: ['jump'] }));
    expect(w.state.player.mode).toBe('climb');
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 200);
    expect(w.state.player.pos.y).toBe(0);
    expect(cellZ(w)).toBe(4);
  });

  it('cannot climb out onto an edge two clicks above the water', () => {
    const w = pool(-2);
    swimIn(w);
    run(w, frame({ y: -1 }), 120);
    stepWorld(w, frame({ y: -1, pressed: ['jump'] }));
    run(w, frame({ y: -1, held: ['action'] }), 60);
    expect(w.state.player.mode).toBe('swim');
  });

  it('rolls round in the water', () => {
    const w = pool();
    swimIn(w);
    const yaw = w.state.player.yaw;
    stepWorld(w, frame({ pressed: ['roll'] }));
    run(w, frame(), seconds(swimming.rollTime) + 2);
    const turned = Math.abs(Math.abs(w.state.player.yaw - yaw) - Math.PI);
    expect(turned).toBeLessThan(0.05);
  });

  it('a ceiling under the surface stops a surface swimmer; diving passes under it', () => {
    // A flooded passage: the middle row has its ceiling 1 click under the water.
    const rows = ['#####', '#WWW#', '#LLL#', '#WWW#', '#WSW#', '#####'];
    const legend = {
      W: { floor: -8, water: 0 },
      S: { floor: -8, water: 0 },
      L: { floor: -8, ceil: -1, water: 0 },
    };
    const w = testLevel(rows, { legend });
    run(w, frame(), 60);
    expect(w.state.player.mode).toBe('swim');
    run(w, frame({ y: 1 }), 180);
    expect(cellZ(w)).toBe(3);
    // Dive and go through.
    stepWorld(w, frame({ pressed: ['walk'], held: ['walk'] }));
    expect(w.state.player.mode).toBe('dive');
    run(w, frame({ held: ['walk'] }), 60);
    runUntil(w, frame({ y: 1 }), (x) => cellZ(x) === 1, 400);
    expect(cellZ(w)).toBe(1);
    runUntil(w, frame({ held: ['jump'] }), (x) => x.state.player.mode === 'swim', 400);
    expect(w.state.player.mode).toBe('swim');
  });
});

describe('diving and air', () => {
  it('Walk dives, Jump swims up, and a long dive ends in a gasp', () => {
    const w = pool();
    swimIn(w);
    const seen = events(w, () => stepWorld(w, frame({ pressed: ['walk'], held: ['walk'] })));
    expect(seen).toContain('player.dived');
    expect(w.state.player.mode).toBe('dive');
    const y0 = w.state.player.pos.y;
    run(w, frame({ held: ['walk'] }), 60);
    expect(w.state.player.pos.y).toBeLessThan(y0 - 0.5);
    run(w, frame({ held: ['walk'] }), seconds(40));
    expect(w.state.player.swim.air).toBeCloseTo(swimming.airMax - 41, 0);
    const up = events(w, () =>
      runUntil(w, frame({ held: ['jump'] }), (x) => x.state.player.mode === 'swim', 400),
    );
    expect(up).toContain('player.surfaced');
    expect(up).toContain('player.breath');
    // The air comes back at the surface.
    run(w, frame(), seconds(6));
    expect(w.state.player.swim.air).toBe(swimming.airMax);
  });

  it('air lasts 60 s, then drowning deals 10 damage a second', () => {
    const w = pool();
    swimIn(w);
    stepWorld(w, frame({ pressed: ['walk'], held: ['walk'] }));
    run(w, frame({ held: ['walk'] }), seconds(swimming.airMax) - 1);
    expect(w.state.player.health).toBe(tuning.maxHealth);
    const seen = events(w, () => run(w, frame({ held: ['walk'] }), seconds(1) + 2));
    expect(seen).toContain('player.drowning');
    expect(w.state.player.health).toBe(tuning.maxHealth - swimming.drownDamage);
    run(w, frame({ held: ['walk'] }), seconds(10));
    expect(w.state.player.mode).toBe('dead');
  });

  it('with no input a diver stays near her depth, drifting slowly up', () => {
    const w = pool();
    swimIn(w);
    stepWorld(w, frame({ pressed: ['walk'], held: ['walk'] }));
    run(w, frame({ held: ['walk'] }), 50);
    const y0 = w.state.player.pos.y;
    run(w, frame(), 60);
    const dy = w.state.player.pos.y - y0;
    expect(dy).toBeLessThan(swimming.buoyancy * 1.2);
  });
});

describe('water gates', () => {
  const GATE = ['######', '#WWWW#', '#WWWW#', '#WWWW#', '#.S.4#', '######'];
  const gated = (): World =>
    testLevel(GATE, {
      legend: { W: -8 },
      entities: [
        { id: 'lever1', type: 'lever', room: 'r', at: [2, 4], wall: 'S', spring: true },
        { id: 'gate1', type: 'watergate', room: 'r', at: [1, 1], wall: 'N', low: -6, high: 2 },
      ],
      logic: [{ when: 'lever1.used', do: ['gate1.toggle', 'camera.focus gate1 2s'], once: false }],
    });

  it('a gate raises the room water over a few seconds and signals when it is up', () => {
    const w = gated();
    expect(waterSurface(w, 1, 1)).toBeCloseTo(-3, 5);
    stepWorld(w, frame({ pressed: ['action'] }));
    const seen = events(w, () => run(w, frame(), seconds(tuning.leverTime)));
    expect(seen).toContain('water.moving');
    const rise = (2 - -6) * 0.5;
    run(w, frame(), seconds(rise / mechanics.waterSpeed));
    expect(waterSurface(w, 1, 1)).toBeCloseTo(1, 5);
    expect(w.state.signals['gate1.high']).toBe(true);
    // The spring lever toggles it back down.
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), seconds(tuning.leverTime + rise / mechanics.waterSpeed) + 5);
    expect(waterSurface(w, 1, 1)).toBeCloseTo(-3, 5);
    expect(w.state.signals['gate1.low']).toBe(true);
  });

  it('rising water lifts Nora off the floor and brings a high edge within reach', () => {
    // A dry basin whose east ledge (8 clicks above its floor) is a wall until the water rises.
    const w = testLevel(['######', '#....#', '#....#', '#.S.4#', '######'], {
      legend: { '.': -4, S: -4, '4': 4 },
      entities: [{ id: 'gate1', type: 'watergate', room: 'r', at: [1, 1], wall: 'N', low: -4, high: 3 }],
      logic: [{ when: 'go', do: ['gate1.raise'] }],
    });
    expect(waterSurface(w, 2, 3)).toBeCloseTo(-2, 5);
    w.state.flags.push('go');
    run(w, frame(), seconds(3.5 / mechanics.waterSpeed) + 10);
    expect(w.state.player.mode).toBe('swim');
    expect(w.state.player.pos.y).toBeCloseTo(1.5 - swimming.surfaceSink, 2);
    run(w, frame({ x: 1 }), 120);
    stepWorld(w, frame({ x: 1, pressed: ['jump'] }));
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 200);
    expect(w.state.player.pos.y).toBe(2);
  });
});

describe('flares', () => {
  const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#..S..#', '#######'];

  it('a pickup adds flares; one lights, is thrown and burns out after 30 s', () => {
    const w = testLevel(ROOM, {
      entities: [{ id: 'box', type: 'flares', room: 'r', at: [3, 3], count: 2 }],
    });
    runUntil(w, frame({ y: 1 }), (x) => cellZ(x) === 3, 60);
    run(w, frame(), 2);
    expect(w.state.inventory.flare).toBe(2);
    const lit = events(w, () => stepWorld(w, frame({ pressed: ['flare'] })));
    expect(lit).toContain('flare.lit');
    expect(w.state.inventory.flare).toBe(1);
    expect(w.state.flares).toHaveLength(1);
    expect(w.state.flares[0]?.held).toBe(true);
    run(w, frame(), 10);
    const thrown = events(w, () => stepWorld(w, frame({ pressed: ['flare'] })));
    expect(thrown).toContain('flare.thrown');
    const f = w.state.flares[0];
    const z0 = f?.z ?? 0;
    run(w, frame(), seconds(2));
    expect(w.state.flares[0]?.held).toBe(false);
    // Thrown ahead (north) and resting on the floor.
    expect(w.state.flares[0]?.z ?? 0).toBeLessThan(z0 - 2);
    expect(w.state.flares[0]?.y ?? 1).toBeCloseTo(0, 1);
    const out = events(w, () => run(w, frame(), seconds(flares.life - 2)));
    expect(out).toContain('flare.out');
    expect(w.state.flares).toHaveLength(0);
  });

  it('Walk and Flare drops the flare at her feet', () => {
    const w = testLevel(ROOM);
    w.state.inventory.flare = 1;
    stepWorld(w, frame({ pressed: ['flare'] }));
    run(w, frame(), 5);
    const seen = events(w, () => stepWorld(w, frame({ held: ['walk'], pressed: ['flare'] })));
    expect(seen).toContain('flare.dropped');
    run(w, frame(), 60);
    const f = w.state.flares[0];
    expect(Math.hypot((f?.x ?? 0) - w.state.player.pos.x, (f?.z ?? 0) - w.state.player.pos.z)).toBeLessThan(
      0.8,
    );
  });

  it('no flares, no light', () => {
    const w = testLevel(ROOM);
    const seen = events(w, () => stepWorld(w, frame({ pressed: ['flare'] })));
    expect(seen).not.toContain('flare.lit');
    expect(w.state.flares).toHaveLength(0);
  });

  it('a burning flare lights a cold brazier, which signals the rules', () => {
    const w = testLevel(ROOM, {
      entities: [{ id: 'b1', type: 'brazier', room: 'r', at: [3, 2], lit: false }],
      logic: [{ when: 'b1.lit', do: ['flag set warm'] }],
    });
    w.state.inventory.flare = 1;
    run(w, frame({ y: 1 }), 20);
    expect(findActor(w, 'b1', 'brazier')?.lit).toBe(false);
    stepWorld(w, frame({ pressed: ['flare'] }));
    runUntil(w, frame({ y: 1 }), (x) => cellZ(x) === 2, 60);
    run(w, frame(), 3);
    expect(findActor(w, 'b1', 'brazier')?.lit).toBe(true);
    expect(w.state.flags).toContain('warm');
  });

  it('flares burn on underwater', () => {
    const w = pool();
    w.state.inventory.flare = 1;
    swimIn(w);
    stepWorld(w, frame({ pressed: ['flare'] }));
    stepWorld(w, frame({ pressed: ['walk'], held: ['walk'] }));
    run(w, frame({ held: ['walk'] }), seconds(3));
    expect(w.state.flares).toHaveLength(1);
    expect(w.state.flares[0]?.y ?? 0).toBeLessThan(-0.5);
  });
});

it('the same swim and dive script yields the same World (replay)', () => {
  const script = [
    ...Array.from({ length: 80 }, () => frame({ y: 1 })),
    frame({ pressed: ['walk'], held: ['walk'] }),
    ...Array.from({ length: 90 }, (_, i) =>
      frame({ x: Math.sin(i / 9), y: 0.5, held: ['walk'], yaw: i / 40 }),
    ),
    ...Array.from({ length: 120 }, () => frame({ held: ['jump'], y: -0.3 })),
  ];
  const play = (): string[] => {
    const w = pool();
    w.state.inventory.flare = 1;
    return script.map((f, i) => {
      stepWorld(w, i === 100 ? { ...f, pressed: f.pressed | buttonBit('flare') } : f);
      return hashWorld(w);
    });
  };
  expect(play()).toEqual(play());
});
