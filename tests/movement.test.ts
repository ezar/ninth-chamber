import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { tuning } from '../src/sim/player/tuning';
import { createWorld, hashWorld, stepWorld } from '../src/sim/world';
import { frame, run } from './helpers';

describe('milestone 1 movement', () => {
  it('running reaches 5.4 m/s', () => {
    const w = createWorld();
    run(w, frame({ y: 1 }), 60);
    expect(Math.hypot(w.player.vel.x, w.player.vel.z)).toBeCloseTo(tuning.runSpeed, 2);
  });

  it('walking reaches 2.2 m/s', () => {
    const w = createWorld();
    run(w, frame({ y: 1, held: ['walk'] }), 60);
    expect(Math.hypot(w.player.vel.x, w.player.vel.z)).toBeCloseTo(tuning.walkSpeed, 2);
  });

  it('forward is camera-relative', () => {
    const w = createWorld();
    run(w, frame({ y: 1, yaw: 0 }), 30);
    expect(w.player.pos.z).toBeLessThan(-1); // camera looking towards -Z
    expect(Math.abs(w.player.pos.x)).toBeLessThan(0.01);

    const w2 = createWorld();
    run(w2, frame({ y: 1, yaw: Math.PI / 2 }), 30);
    expect(w2.player.pos.x).toBeLessThan(-1); // camera turned 90°: looking towards -X
    expect(Math.abs(w2.player.pos.z)).toBeLessThan(0.01);
  });

  it('a jump rises 1.35 m and lasts 0.67 s', () => {
    const w = createWorld();
    stepWorld(w, frame({ pressed: ['jump'] }));
    let peak = 0;
    let ticks = 1;
    while (!w.player.grounded && ticks < 200) {
      stepWorld(w, frame());
      peak = Math.max(peak, w.player.pos.y);
      ticks++;
    }
    expect(peak).toBeCloseTo(1.35, 2);
    expect(ticks * TICK_DT).toBeCloseTo(0.67, 1);
  });

  it('a running jump covers about 3.6 m', () => {
    const w = createWorld();
    run(w, frame({ y: 1 }), 30); // 0.5 s run-up
    const z0 = w.player.pos.z;
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
    while (!w.player.grounded) stepWorld(w, frame({ y: 1 }));
    expect(Math.abs(w.player.pos.z - z0)).toBeGreaterThan(3.5);
    expect(Math.abs(w.player.pos.z - z0)).toBeLessThan(3.9);
  });

  it('emits jump and land events', () => {
    const w = createWorld();
    stepWorld(w, frame({ pressed: ['jump'] }));
    run(w, frame(), 60);
    expect(w.events.drain().map((e) => e.type)).toEqual(['player.jumped', 'player.landed']);
  });

  it('the same InputFrame sequence yields the same World (replay)', () => {
    const script = [
      ...Array.from({ length: 40 }, () => frame({ y: 1 })),
      frame({ y: 1, x: 0.5, pressed: ['jump'] }),
      ...Array.from({ length: 60 }, (_, i) => frame({ x: Math.sin(i / 7), y: 0.6, yaw: i / 30 })),
    ];
    const play = (): string[] => {
      const w = createWorld(123);
      const hashes: string[] = [];
      script.forEach((f, i) => {
        stepWorld(w, f);
        if (i % 20 === 0) hashes.push(hashWorld(w));
      });
      return hashes;
    };
    expect(play()).toEqual(play());
  });
});
