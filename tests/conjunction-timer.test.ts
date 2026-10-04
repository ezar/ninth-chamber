/**
 * The conjunction timer (spec §19, chamber IX; owner's decision: real but
 * generous): rules start and stop a countdown; when it runs out Nora goes
 * back to the last checkpoint with the time she had there, never less than a
 * generous minimum, so a run can always be finished.
 */
import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/loop';
import { runActions } from '../src/sim/logic/rules';
import { migrate } from '../src/sim/save/save';
import { validateLevel } from '../src/sim/grid/validate';
import { conjunction as C } from '../src/sim/player/tuning';
import { respawn, saveCheckpoint, type World } from '../src/sim/world';
import { frame, run, testLevel } from './helpers';

const ticks = (s: number): number => Math.round(s / TICK_DT);
const hall = (): World => testLevel(['#####', '#...#', '#.S.#', '#####']);

describe('the conjunction timer', () => {
  it('is off until a rule starts it', () => {
    const w = hall();
    run(w, frame(), 30);
    expect(w.state.timer).toBeNull();
  });

  it('counts down once started, and a rule can stop it', () => {
    const w = hall();
    runActions(w, ['timer.start 90s']);
    expect(w.state.timer?.left).toBeCloseTo(90, 6);
    run(w, frame(), ticks(10));
    expect(w.state.timer?.left).toBeCloseTo(80, 3);
    runActions(w, ['timer.stop']);
    expect(w.state.timer).toBeNull();
  });

  it('a rule can add time', () => {
    const w = hall();
    runActions(w, ['timer.start 30s', 'timer.add 20s']);
    expect(w.state.timer?.left).toBeCloseTo(50, 6);
  });

  it('emits a warning in the last seconds, and when it runs out Nora falls', () => {
    const w = hall();
    runActions(w, ['timer.start 12s']);
    const events: { type: string; cause?: unknown }[] = [];
    for (let i = 0; i < ticks(13); i++) {
      run(w, frame(), 1);
      events.push(...w.events.drain());
    }
    expect(events.map((e) => e.type)).toContain('timer.warn');
    expect(events.find((e) => e.type === 'player.died')?.cause).toBe('conjunction');
    expect(w.state.player.mode).toBe('dead');
  });

  it('back at the checkpoint she has the time she had there, never less than the minimum', () => {
    const w = hall();
    runActions(w, ['timer.start 200s']);
    run(w, frame(), ticks(20));
    saveCheckpoint(w);
    run(w, frame(), ticks(60));
    respawn(w);
    expect(w.state.timer?.left).toBeCloseTo(180, 3);
    // A checkpoint saved with little time left still gives her the minimum after a fall.
    runActions(w, ['timer.start 10s']);
    saveCheckpoint(w);
    run(w, frame(), ticks(11));
    respawn(w);
    expect(w.state.timer?.left).toBeCloseTo(C.minAfterRespawn, 6);
  });

  it('a checkpoint saved before it started brings back no timer', () => {
    const w = hall();
    saveCheckpoint(w);
    runActions(w, ['timer.start 60s']);
    respawn(w);
    expect(w.state.timer).toBeNull();
  });

  it('old saves are migrated with no timer', () => {
    const save = { schema: 7, level: 'x', game: { checkpoint: { mechanisms: {} }, resume: null } };
    const m = migrate(save) as { game: { checkpoint: Record<string, unknown> } } | null;
    expect(m?.game.checkpoint.timer).toBeNull();
  });

  it('level.end says which ending was reached, and the validator knows the endings', () => {
    const w = hall();
    runActions(w, ['level.end keeper']);
    expect(w.ended).toBe(true);
    expect(w.ending).toBe('keeper');
    const file = (end: string) => ({
      schema: 1,
      id: 't',
      name: 't',
      start: { room: 'r', at: [1, 1] as [number, number], face: 'N' as const },
      rooms: [
        {
          id: 'r',
          origin: [0, 0, 0] as [number, number, number],
          ceil: 12,
          legend: { '#': 'wall' as const, '.': 0 },
          rows: ['###', '#.#', '###'],
        },
      ],
      entities: [{ id: 'z', type: 'zone' as const, room: 'r', at: [1, 1] as [number, number] }],
      logic: [{ when: 'z.entered', do: ['timer.start 90s', 'timer.add 5s', 'timer.stop', end] }],
    });
    const errs = (end: string) => validateLevel(file(end)).errors.filter((e) => e.includes('rule'));
    expect(errs('level.end blank')).toEqual([]);
    expect(errs('level.end')).toEqual([]);
    expect(errs('level.end triumph')).toEqual(["rule 0: unknown ending 'triumph'"]);
  });
});
