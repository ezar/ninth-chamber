import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { tuning } from '../src/sim/player/tuning';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, runUntil, testLevel } from './helpers';

/**
 * Classic mode (spec §5 "Esquemas de control" and "Ayudas", §18): tank controls and no assists.
 * Unlocked by finishing the campaign; off by default, so every other test plays assisted.
 */

const OPEN = ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#.S.#', '#####'];
const classic = (w: World): World => {
  w.classic = true;
  return w;
};

describe('tank controls', () => {
  it('forward runs the way Nora faces, whatever the camera', () => {
    const w = classic(testLevel(OPEN));
    const { x: x0, z: z0 } = w.state.player.pos;
    // The camera looks east: camera-relative forward would be east, but she faces north.
    run(w, frame({ y: 1, yaw: -Math.PI / 2 }), 20);
    expect(w.state.player.pos.z).toBeLessThan(z0 - 1);
    expect(w.state.player.pos.x).toBeCloseTo(x0, 5);
  });

  it('the sides turn her on the spot', () => {
    const w = classic(testLevel(OPEN));
    const { x: x0, z: z0 } = w.state.player.pos;
    const yaw0 = w.state.player.yaw;
    run(w, frame({ x: 1 }), 15);
    const p = w.state.player;
    expect(p.pos.x).toBeCloseTo(x0, 5);
    expect(p.pos.z).toBeCloseTo(z0, 5);
    // Right is clockwise from above: the yaw goes down.
    expect(p.yaw).toBeCloseTo(yaw0 - tuning.tankTurnSpeed * 15 * TICK_DT, 5);
  });

  it('back steps backwards without turning round', () => {
    const w = classic(testLevel(OPEN));
    run(w, frame({ y: 1 }), 10);
    const z0 = w.state.player.pos.z;
    const yaw0 = w.state.player.yaw;
    run(w, frame({ y: -1 }), 30);
    expect(w.state.player.pos.z).toBeGreaterThan(z0 + 0.5);
    expect(w.state.player.yaw).toBeCloseTo(yaw0, 5);
  });

  it('turning and running together curves her path', () => {
    const w = classic(testLevel(OPEN));
    const x0 = w.state.player.pos.x;
    run(w, frame({ x: 1, y: 1 }), 12);
    expect(w.state.player.pos.x).toBeGreaterThan(x0 + 0.1);
  });

  it('shimmies along a ledge with the sides, whatever the camera', () => {
    const w = classic(testLevel(['#####', '#666#', '#...#', '#.S.#', '#####']));
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['jump'], held: ['action'] }));
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'hang', 60);
    expect(w.state.player.mode).toBe('hang');
    const x0 = w.state.player.pos.x;
    run(w, frame({ x: 1, yaw: Math.PI, held: ['action'] }), 30);
    expect(w.state.player.mode).toBe('hang');
    expect(w.state.player.pos.x).toBeGreaterThan(x0 + 0.4);
  });
});

describe('assists, on by default and off in classic mode', () => {
  // Running north off a ledge: floor 0 then a pit.
  const EDGE = ['#####', '#___#', '#___#', '#...#', '#...#', '#...#', '#.S.#', '#####'];
  /** Runs off the edge, then presses jump `late` ticks after leaving the ground. */
  function lateJump(w: World, late: number): void {
    runUntil(w, frame({ y: 1 }), (x) => x.state.player.mode === 'air', 200);
    run(w, frame({ y: 1 }), late);
    stepWorld(w, frame({ y: 1, pressed: ['jump'] }));
  }

  it('coyote time: a jump just after running off an edge still counts', () => {
    const w = testLevel(EDGE);
    lateJump(w, 3);
    expect(w.state.player.vel.y).toBeGreaterThan(0);
  });

  it('no coyote time in classic mode', () => {
    const w = classic(testLevel(EDGE));
    lateJump(w, 3);
    expect(w.state.player.vel.y).toBeLessThan(0);
  });

  /** Jumps on the spot, then presses jump again `early` ticks before landing. */
  function earlyJump(w: World, early: number): void {
    stepWorld(w, frame({ pressed: ['jump'] }));
    const air = Math.round(0.67 / TICK_DT);
    run(w, frame(), air - early);
    stepWorld(w, frame({ pressed: ['jump'] }));
    runUntil(w, frame(), (x) => x.state.player.mode === 'ground', 60);
    run(w, frame(), 2);
  }

  it('jump buffer: a jump pressed just before landing triggers on landing', () => {
    const w = testLevel(OPEN);
    earlyJump(w, 4);
    expect(w.state.player.mode).toBe('air');
  });

  it('no jump buffer in classic mode', () => {
    const w = classic(testLevel(OPEN));
    earlyJump(w, 4);
    expect(w.state.player.mode).toBe('ground');
  });

  const WALL7 = ['#####', '#777#', '#...#', '#.S.#', '#####'];
  /** Runs at the wall and jumps; `action`: hold Action through the jump. */
  function jumpAtWall(w: World, action: boolean): void {
    run(w, frame({ y: 1 }), 60);
    const held = action ? (['action'] as const) : [];
    stepWorld(w, frame({ pressed: ['jump'], held: [...held] }));
    run(w, frame({ held: [...held] }), 60);
  }

  it('auto-grab: a jump at a ledge grabs it without holding Action', () => {
    const w = testLevel(WALL7);
    jumpAtWall(w, false);
    expect(w.state.player.mode).toBe('hang');
  });

  it('no auto-grab in classic mode: Action must be held', () => {
    const w = classic(testLevel(WALL7));
    jumpAtWall(w, false);
    expect(w.state.player.mode).toBe('ground');
    const v = classic(testLevel(WALL7));
    jumpAtWall(v, true);
    expect(v.state.player.mode).toBe('hang');
  });
});
