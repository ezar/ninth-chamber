import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { tuning } from '../src/sim/player/tuning';
import { hashWorld, stepWorld } from '../src/sim/world';
import { cellZ, frame, run, runUntil, testLevel } from './helpers';

const OPEN = ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#.S.#', '#####'];

describe('ground movement', () => {
  it('running reaches 5.4 m/s', () => {
    const w = testLevel(OPEN);
    run(w, frame({ y: 1 }), 30);
    const v = w.state.player.vel;
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(tuning.runSpeed, 1);
  });

  it('walking reaches 2.2 m/s', () => {
    const w = testLevel(OPEN);
    run(w, frame({ y: 1, held: ['walk'] }), 60);
    const v = w.state.player.vel;
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(tuning.walkSpeed, 2);
  });

  it('forward is camera-relative', () => {
    const w = testLevel(OPEN);
    const z0 = w.state.player.pos.z;
    run(w, frame({ y: 1, yaw: 0 }), 20);
    expect(w.state.player.pos.z).toBeLessThan(z0 - 1);
  });

  it('walls stop the player at the collision radius', () => {
    const w = testLevel(OPEN);
    run(w, frame({ y: 1 }), 240);
    expect(w.state.player.pos.z).toBeCloseTo(2 + tuning.radius, 2);
  });

  it('steps up one click automatically', () => {
    const w = testLevel(['#####', '#111#', '#...#', '#.S.#', '#####']);
    run(w, frame({ y: 1 }), 60);
    expect(w.state.player.pos.y).toBeCloseTo(0.5, 5);
    expect(cellZ(w)).toBe(1);
  });

  it('does not step up two clicks', () => {
    const w = testLevel(['#####', '#222#', '#...#', '#.S.#', '#####']);
    run(w, frame({ y: 1 }), 60);
    expect(w.state.player.pos.y).toBe(0);
    expect(cellZ(w)).toBe(2);
  });

  it('a standing jump climbs onto a two-click (1 m) step', () => {
    const w = testLevel(['#####', '#222#', '#...#', '#.S.#', '#####']);
    run(w, frame({ y: 1 }), 40);
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    run(w, frame({ y: 1 }), 60);
    expect(w.state.player.pos.y).toBeCloseTo(1, 5);
  });

  it('walking never drops off an edge higher than one click', () => {
    const w = testLevel(['#####', '#___#', '#...#', '#.S.#', '#####']);
    run(w, frame({ y: 1, held: ['walk'] }), 180);
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.player.pos.y).toBe(0);
  });

  it('running off an edge falls', () => {
    const w = testLevel(['#####', '#___#', '#...#', '#.S.#', '#####']);
    run(w, frame({ y: 1 }), 40);
    expect(w.state.player.mode).not.toBe('ground');
  });
});

describe('jumps', () => {
  it('a jump rises 1.35 m and lasts 0.67 s', () => {
    const w = testLevel(OPEN);
    stepWorld(w, frame({ pressed: ['jump'] }));
    let peak = 0;
    let ticks = 1;
    while (w.state.player.mode === 'air' && ticks < 200) {
      stepWorld(w, frame());
      peak = Math.max(peak, w.state.player.pos.y);
      ticks++;
    }
    expect(peak).toBeCloseTo(1.35, 2);
    expect(ticks * TICK_DT).toBeCloseTo(0.67, 1);
  });

  // A 2-block gap (4 m) between two floors at the same height.
  const GAP2 = ['#####', '#...#', '#...#', '#___#', '#___#', '#...#', '#...#', '#...#', '#.S.#', '#####'];
  // A 1-block gap (2 m).
  const GAP1 = ['#####', '#...#', '#...#', '#___#', '#...#', '#.S.#', '#####'];

  it('a running jump clears a 2-block gap', () => {
    const w = testLevel(GAP2);
    run(w, frame({ y: 1 }), 30);
    // Jump at the edge of the gap.
    runUntil(w, frame({ y: 1 }), (x) => x.state.player.pos.z <= 10 + 0.1);
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    runUntil(w, frame({ y: 1 }), (x) => x.state.player.mode !== 'air', 120);
    const p = w.state.player;
    const across =
      (p.mode === 'ground' && p.pos.y === 0 && p.pos.z < 6) || p.mode === 'hang' || p.mode === 'climb';
    expect(across).toBe(true);
  });

  it('a standing jump does not clear a 2-block gap', () => {
    const w = testLevel(GAP2);
    run(w, frame({ y: 1, held: ['walk'] }), 200); // walk to the edge
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    run(w, frame({ y: 1 }), 120);
    expect(w.state.player.pos.y).toBeLessThan(-1);
  });

  it('a standing forward jump clears a 1-block gap', () => {
    const w = testLevel(GAP1);
    run(w, frame({ y: 1, held: ['walk'] }), 200);
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    runUntil(w, frame({ y: 1 }), (x) => x.state.player.mode !== 'air', 120);
    expect(w.state.player.pos.y).toBe(0);
    expect(cellZ(w)).toBeLessThanOrEqual(2);
  });
});

describe('ledges', () => {
  const wall = (clicks: number): string[] => [
    '#####',
    `#${String(clicks).repeat(3)}#`,
    '#...#',
    '#.S.#',
    '#####',
  ];

  it('grabs a 3-click ledge and climbs onto it', () => {
    const w = testLevel(wall(3));
    run(w, frame({ y: 1 }), 30);
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    run(w, frame({ y: 1, held: ['action'] }), 90);
    expect(w.state.player.pos.y).toBeCloseTo(1.5, 5);
    expect(w.state.player.mode).toBe('ground');
  });

  it('hangs from a 7-click ledge after a jump', () => {
    const w = testLevel(wall(7));
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 60);
    expect(w.state.player.mode).toBe('hang');
    expect(w.state.player.pos.y + tuning.handHeight).toBeCloseTo(3.5, 5);
  });

  it('cannot reach an 8-click ledge', () => {
    const w = testLevel(wall(8));
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    run(w, frame({ held: ['action'] }), 60);
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.player.pos.y).toBe(0);
  });

  it('climbs up from a hang', () => {
    const w = testLevel(wall(6));
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 60);
    run(w, frame({ y: 1 }), 20);
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 120);
    expect(w.state.player.pos.y).toBeCloseTo(3, 5);
    expect(cellZ(w)).toBe(1);
  });

  it('lets go with Action and falls back down', () => {
    const w = testLevel(wall(6));
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 60);
    stepWorld(w, frame({ pressed: ['action'] }));
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 120);
    expect(w.state.player.pos.y).toBe(0);
  });

  it('shimmies along a continuous ledge', () => {
    const w = testLevel(wall(6));
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 60);
    const x0 = w.state.player.pos.x;
    run(w, frame({ x: 1 }), 30);
    expect(w.state.player.mode).toBe('hang');
    expect(w.state.player.pos.x).toBeCloseTo(x0 + tuning.shimmySpeed * 0.5, 1);
  });
});

describe('falls', () => {
  it('a fall over 6.5 m kills', () => {
    const w = testLevel(['#####', '#___#', '#...#', '#.S.#', '#####'], { legend: { _: 'pit' } });
    run(w, frame({ y: 1 }), 120);
    expect(w.state.player.mode).toBe('dead');
  });

  it('a 4 m fall hurts but does not kill', () => {
    const w = testLevel(['#####', '#...#', '#888#', '#8S8#', '#####'], { legend: { S: 8 } });
    run(w, frame({ y: 1 }), 90);
    expect(w.state.player.pos.y).toBe(0);
    expect(w.state.player.health).toBe(100 - Math.round(0.5 * tuning.fallDamagePerMetre));
  });

  it('respawns at the last checkpoint after dying', () => {
    const w = testLevel(['#####', '#___#', '#...#', '#.S.#', '#####']);
    const start = { ...w.state.player.pos };
    run(w, frame({ y: 1 }), 120);
    expect(w.state.player.mode).toBe('dead');
    run(w, frame(), Math.ceil(tuning.respawnDelay / TICK_DT) + 2);
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.player.pos).toEqual(start);
  });
});

it('the same InputFrame sequence yields the same World (replay)', () => {
  const script = [
    ...Array.from({ length: 40 }, () => frame({ y: 1 })),
    frame({ y: 1, x: 0.5, pressed: ['jump'] }),
    ...Array.from({ length: 90 }, (_, i) => frame({ x: Math.sin(i / 7), y: 0.6, yaw: i / 30 })),
  ];
  const play = (): string[] => {
    const w = testLevel(OPEN);
    return script.map((f) => {
      stepWorld(w, f);
      return hashWorld(w);
    });
  };
  expect(play()).toEqual(play());
});
