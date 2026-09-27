/**
 * Sun beams, mirrors and receivers (spec §8 "Pilar giratorio / espejo"): a
 * beam enters at a declared cell and direction, is traced through the grid,
 * turns on mirrors and lights sun discs, which emit `<id>.lit` for rules.
 * The traced path is simulation state. Cells are world cells.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import type { EntityFile } from '../src/sim/grid/schema';
import { runActions, signal } from '../src/sim/logic/rules';
import type { BeamState, MirrorState } from '../src/sim/mechanisms/types';
import { mechanics, tuning } from '../src/sim/player/tuning';
import { hashWorld, stepWorld, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const secs = (s: number): number => Math.round(s / TICK_DT);

/** 7 × 5 floor inside walls; Nora starts at (4, 5). */
const ROOM = ['#########', '#.......#', '#.......#', '#.......#', '#.......#', '#...S...#', '#########'];

type Extra = Record<string, unknown>;
const sun = (id: string, at: [number, number], dir: string, extra: Extra = {}): EntityFile =>
  ({ id, type: 'sunbeam', room: 'r', at, dir, y: 3, ...extra }) as EntityFile;
const rx = (id: string, at: [number, number], face: string): EntityFile =>
  ({ id, type: 'receiver', room: 'r', at, face }) as EntityFile;
const mirror = (id: string, at: [number, number], facing: string, extra: Extra = {}): EntityFile =>
  ({ id, type: 'mirror', room: 'r', at, facing, ...extra }) as EntityFile;

function beam(w: World, id = 'sun1'): BeamState {
  const b = w.state.mechanisms.beams.find((x) => x.id === id);
  if (!b) throw new Error(`no beam ${id}`);
  return b;
}
function mirrorState(w: World, id: string): MirrorState {
  const m = w.state.mechanisms.mirrors.find((x) => x.id === id);
  if (!m) throw new Error(`no mirror ${id}`);
  return m;
}

describe('sun beams', () => {
  it('crosses a room and lights a sun disc set in the far wall', () => {
    const w = testLevel(ROOM, { entities: [sun('sun1', [1, 2], 'E'), rx('rx1', [8, 2], 'W')] });
    stepWorld(w, frame());
    const b = beam(w);
    expect(b.points[0]).toEqual({ x: 2, y: 1.5, z: 5 });
    expect(b.points.at(-1)).toEqual({ x: 16, y: 1.5, z: 5 });
    expect(b.hits).toEqual(['rx1']);
    run(w, frame(), 1);
    expect(signal(w, 'rx1.lit')).toBe(true);
    expect(w.events.drain().map((e) => e.type)).toContain('receiver.lit');
  });

  it('comes down an oculus when it enters from the sky', () => {
    const w = testLevel(ROOM, {
      ceil: 16,
      entities: [sun('sun1', [2, 3], 'N', { from: 'sky' }), rx('rx1', [2, 0], 'S')],
    });
    stepWorld(w, frame());
    const b = beam(w);
    expect(b.points[0]).toEqual({ x: 5, y: 8, z: 7 });
    expect(b.points[1]).toEqual({ x: 5, y: 1.5, z: 7 });
    expect(b.hits).toEqual(['rx1']);
  });

  it('turns 90° on a mirror and stops on its back', () => {
    const w = testLevel(ROOM, {
      entities: [
        sun('sun1', [1, 2], 'E'),
        mirror('m1', [4, 2], 'NW'),
        rx('rx1', [8, 2], 'W'),
        rx('rx2', [4, 0], 'S'),
      ],
    });
    run(w, frame(), 2);
    expect(beam(w).points).toEqual([
      { x: 2, y: 1.5, z: 5 },
      { x: 9, y: 1.5, z: 5 },
      { x: 9, y: 1.5, z: 2 },
    ]);
    expect(beam(w).hits).toEqual(['m1', 'rx2']);
    expect(signal(w, 'rx2.lit')).toBe(true);
    expect(signal(w, 'rx1.lit')).toBe(false);

    mirrorState(w, 'm1').facing = 1; // SE: its back faces the beam
    run(w, frame(), 2);
    expect(beam(w).hits).toEqual(['m1']);
    expect(signal(w, 'rx2.lit')).toBe(false);
  });

  it('Nora turns a mirror a quarter turn clockwise with Action at its drum', () => {
    const w = testLevel(ROOM, {
      entities: [
        sun('sun1', [1, 2], 'E'),
        mirror('m1', [4, 2], 'NW'),
        rx('rx2', [4, 0], 'S'),
        rx('rx3', [4, 6], 'N'),
      ],
    });
    // The drum is solid: she walks up against it.
    run(w, frame({ y: 1 }), 60);
    expect(w.state.player.pos.z).toBeCloseTo(6 + tuning.radius, 2);
    run(w, frame(), 2);
    expect(signal(w, 'rx2.lit')).toBe(true);
    const turn = (): void => {
      stepWorld(w, frame({ pressed: ['action'] }));
      expect(w.state.player.mode).toBe('lever');
      run(w, frame(), secs(tuning.leverTime) + 2);
      expect(w.state.player.mode).toBe('ground');
    };
    turn();
    expect(mirrorState(w, 'm1').facing).toBe(0); // NW → NE
    expect(signal(w, 'rx2.lit')).toBe(false);
    turn();
    turn();
    expect(mirrorState(w, 'm1').facing).toBe(2); // SW sends it south
    run(w, frame(), 2);
    expect(signal(w, 'rx3.lit')).toBe(true);
    expect(beam(w).points.at(-1)).toEqual({ x: 9, y: 1.5, z: 12 });
  });

  it('a fixed mirror cannot be turned by hand, but a rule can turn it', () => {
    const w = testLevel(ROOM, {
      entities: [sun('sun1', [1, 2], 'E'), mirror('m1', [4, 2], 'NW', { fixed: true })],
    });
    run(w, frame({ y: 1 }), 60);
    stepWorld(w, frame({ pressed: ['action'] }));
    run(w, frame(), secs(1.2));
    expect(mirrorState(w, 'm1').facing).toBe(3);
    runActions(w, ['m1.turn']);
    expect(mirrorState(w, 'm1').facing).toBe(0);
  });

  it('a closed door stops it until the door opens', () => {
    const w = testLevel(ROOM, {
      entities: [
        sun('sun1', [1, 2], 'E'),
        rx('rx1', [8, 2], 'W'),
        { id: 'd1', type: 'door', room: 'r', at: [6, 2], height: 8 } as EntityFile,
      ],
    });
    run(w, frame(), 2);
    expect(signal(w, 'rx1.lit')).toBe(false);
    expect(beam(w).points.at(-1)?.x).toBeLessThan(13);
    runActions(w, ['d1.open']);
    run(w, frame(), secs(1 / mechanics.doorSpeed) + 2);
    expect(signal(w, 'rx1.lit')).toBe(true);
  });

  it('a block in its way casts a shadow on the receiver', () => {
    const w = testLevel(ROOM, {
      entities: [
        sun('sun1', [1, 2], 'E'),
        rx('rx1', [8, 2], 'W'),
        { id: 'b1', type: 'block', room: 'r', at: [6, 2] } as EntityFile,
      ],
    });
    run(w, frame(), 2);
    expect(signal(w, 'rx1.lit')).toBe(false);
    expect(beam(w).points.at(-1)).toEqual({ x: 12, y: 1.5, z: 5 });
  });

  it('a sun disc lights only from the side it faces', () => {
    const w = testLevel(ROOM, { entities: [sun('sun1', [1, 2], 'E'), rx('rx1', [8, 2], 'N')] });
    run(w, frame(), 2);
    expect(signal(w, 'rx1.lit')).toBe(false);
    expect(beam(w).hits).toEqual([]);
  });

  it('rules can wait for two lit discs, and switch the sun off and on', () => {
    const w = testLevel(ROOM, {
      entities: [
        sun('sun1', [1, 2], 'E'),
        rx('rx1', [8, 2], 'W'),
        sun('sun2', [1, 4], 'E'),
        mirror('m2', [6, 4], 'SE', { fixed: true }),
        rx('rx2', [6, 6], 'N'),
      ],
      logic: [{ when: 'rx1.lit and rx2.lit', do: ['flag set both'] }],
    });
    run(w, frame(), 3);
    expect(w.state.flags).not.toContain('both');
    runActions(w, ['m2.turn']); // SE → SW: sends it south
    run(w, frame(), 3);
    expect(signal(w, 'rx2.lit')).toBe(true);
    expect(w.state.flags).toContain('both');
    runActions(w, ['sun1.off']);
    run(w, frame(), 2);
    expect(signal(w, 'rx1.lit')).toBe(false);
    expect(beam(w).points).toEqual([]);
    runActions(w, ['sun1.on']);
    run(w, frame(), 2);
    expect(signal(w, 'rx1.lit')).toBe(true);
  });

  it('is part of the deterministic state', () => {
    const make = (): World =>
      testLevel(ROOM, {
        entities: [sun('sun1', [1, 2], 'E'), mirror('m1', [4, 2], 'NW'), rx('rx2', [4, 0], 'S')],
      });
    const a = make();
    const b = make();
    run(a, frame({ y: 1 }), 40);
    run(b, frame({ y: 1 }), 40);
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.state.mechanisms.beams).toEqual(b.state.mechanisms.beams);
  });
});
