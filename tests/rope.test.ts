/**
 * The hanging rope (spec §8 "Cuerda para tirar", first used in chamber VII):
 * like a lever, but hanging. She jumps up to it, grabs it with Action held
 * (or auto-grab after a jump), pulls it and lets go. Camera yaw 0: forward is
 * north (-Z).
 */
import { describe, expect, it } from 'vitest';
import { tuning } from '../src/sim/player/tuning';
import { stepWorld, type World } from '../src/sim/world';
import { frame, run, runUntil, testLevel } from './helpers';

const ROOM = ['#####', '#...#', '#.R.#', '#...#', '#.S.#', '#####'];

/** A room with a rope over the R cell, its lower end at `h` clicks. */
function ropeRoom(h: number, opts: { spring?: boolean } = {}): World {
  return testLevel(ROOM, {
    legend: { R: 0 },
    entities: [
      { id: 'rope', type: 'rope', room: 'r', at: [2, 2], h, ...opts },
      { id: 'door', type: 'door', room: 'r', at: [2, 1] },
    ],
    logic: [{ when: 'rope.pulled', do: ['door.open'] }],
  });
}

/** Walks to the rope's cell and jumps straight up, Action held. */
function jumpUnder(w: World, held: ('action' | 'walk')[] = ['action']): void {
  runUntil(w, frame({ y: 1, held: ['walk'] }), (x) => x.state.player.pos.z <= 5.05, 200);
  run(w, frame(), 20);
  stepWorld(w, frame({ pressed: ['jump'], held }));
}

describe('ropes', () => {
  it('a jump into a rope within reach grabs it, pulls it, and lets go', () => {
    // Lower end at 3 m: hands reach 2 m standing, 3.35 m at the top of a jump.
    const w = ropeRoom(6);
    jumpUnder(w);
    const modes: string[] = [];
    const events: string[] = [];
    for (let i = 0; i < 150; i++) {
      stepWorld(w, frame({ held: ['action'] }));
      modes.push(w.state.player.mode);
      events.push(...w.events.drain().map((e) => e.type));
    }
    expect(modes).toContain('rope');
    expect(events).toContain('rope.grabbed');
    expect(events).toContain('rope.pulled');
    expect(w.state.signals['rope.pulled']).toBe(true);
    // She dropped back to the floor, and the rule opened the door.
    expect(w.state.player.mode).toBe('ground');
    expect(w.state.player.pos.y).toBe(0);
    const door = w.state.actors.find((a) => a.id === 'door');
    expect(door?.kind === 'door' && door.target).toBe(1);
  });

  it('pulls halfway through the hang', () => {
    const w = ropeRoom(6);
    jumpUnder(w);
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'rope', 60);
    run(w, frame({ held: ['action'] }), Math.floor((tuning.ropeTime / 2) * 60) - 3);
    expect(w.state.signals['rope.pulled']).not.toBe(true);
    run(w, frame({ held: ['action'] }), 6);
    expect(w.state.signals['rope.pulled']).toBe(true);
  });

  it('is out of reach when its end hangs too high', () => {
    // 4 m: above the hands at the top of a jump plus the grab window.
    const w = ropeRoom(8);
    jumpUnder(w);
    run(w, frame({ held: ['action'] }), 120);
    expect(w.state.signals['rope.pulled']).not.toBe(true);
  });

  it('a spring rope rises again and can be pulled twice', () => {
    const w = testLevel(ROOM, {
      legend: { R: 0 },
      entities: [{ id: 'rope', type: 'rope', room: 'r', at: [2, 2], h: 6, spring: true }],
    });
    let pulls = 0;
    const count = (): void => {
      for (let i = 0; i < 150; i++) {
        stepWorld(w, frame({ held: ['action'] }));
        pulls += w.events.drain().filter((e) => e.type === 'rope.pulled').length;
      }
    };
    jumpUnder(w);
    count();
    expect(w.state.signals['rope.pulled']).toBe(false);
    stepWorld(w, frame({ pressed: ['jump'], held: ['action'] }));
    count();
    expect(pulls).toBe(2);
  });

  it('a plain rope only pulls once', () => {
    const w = ropeRoom(6);
    let pulls = 0;
    jumpUnder(w);
    for (let n = 0; n < 2; n++) {
      for (let i = 0; i < 150; i++) {
        stepWorld(w, frame({ held: ['action'] }));
        pulls += w.events.drain().filter((e) => e.type === 'rope.pulled').length;
      }
      stepWorld(w, frame({ pressed: ['jump'], held: ['action'] }));
    }
    expect(pulls).toBe(1);
  });

  it('Action lets go early, before the pull', () => {
    const w = ropeRoom(6);
    jumpUnder(w);
    runUntil(w, frame({ held: ['action'] }), (x) => x.state.player.mode === 'rope', 60);
    run(w, frame(), 15);
    stepWorld(w, frame({ pressed: ['action'] }));
    expect(w.state.player.mode).toBe('air');
    run(w, frame(), 60);
    expect(w.state.signals['rope.pulled']).not.toBe(true);
  });
});
