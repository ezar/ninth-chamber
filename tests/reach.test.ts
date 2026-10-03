/**
 * The validator's reachability check (spec §16 "Validador de niveles"): an
 * over-approximation of where Nora can go, so a level whose exit, relic,
 * secret or checkpoint lies outside it fails `pnpm validate:levels`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Level } from '../src/sim/grid/level';
import type { LevelFileInput } from '../src/sim/grid/schema';
import { CLIMB, key, reachableCells } from '../src/sim/grid/reach';
import { validateLevel } from '../src/sim/grid/validate';

type Legend = NonNullable<LevelFileInput['rooms'][number]['legend']>;

/** A one-room level from rows; S is the start, R the relic. */
function file(rows: string[], extra: Partial<LevelFileInput> = {}, legend: Legend = {}): LevelFileInput {
  const find = (ch: string): [number, number] => {
    for (let z = 0; z < rows.length; z++) {
      const x = rows[z]?.indexOf(ch) ?? -1;
      if (x >= 0) return [x, z];
    }
    throw new Error(`no ${ch}`);
  };
  const base: Legend = { '#': 'wall', '.': 0, S: 0, R: 0, _: 'pit' };
  for (let d = 1; d <= 9; d++) base[String(d)] = d;
  return {
    schema: 1,
    id: 'test',
    name: 'test',
    start: { room: 'r', at: find('S'), face: 'N' },
    rooms: [{ id: 'r', origin: [0, 0, 0], ceil: 24, legend: { ...base, ...legend }, rows }],
    entities: [{ id: 'relic', type: 'relic', room: 'r', at: find('R') }],
    logic: [],
    ...extra,
  };
}

const relicError = (f: LevelFileInput): boolean =>
  validateLevel(f).errors.some((e) => e.includes("relic 'relic' cannot be reached"));

describe('reachability', () => {
  it('passes for every shipped level', () => {
    for (const name of readdirSync('levels').filter((n) => n.endsWith('.level.json'))) {
      const { errors } = validateLevel(JSON.parse(readFileSync(`levels/${name}`, 'utf8')));
      expect(
        errors.filter((e) => e.includes('reached') || e.includes('trap')),
        name,
      ).toEqual([]);
    }
  });

  it('fails a relic sealed behind a wall', () => {
    expect(relicError(file(['#####', '#.R.#', '#####', '#.S.#', '#####']))).toBe(true);
    expect(relicError(file(['#####', '#.R.#', '#...#', '#.S.#', '#####']))).toBe(false);
  });

  it('climbs what a jump and a grab reach, and no higher', () => {
    // 7 clicks = 3.5 m: within reach. 8 clicks = 4 m: out of reach.
    expect(CLIMB).toBeGreaterThan(3.5);
    expect(CLIMB).toBeLessThan(4);
    expect(relicError(file(['#####', '#7R7#', '#777#', '#.S.#', '#####'], {}, { R: 7 }))).toBe(false);
    expect(relicError(file(['#####', '#8R8#', '#888#', '#.S.#', '#####'], {}, { R: 8 }))).toBe(true);
  });

  it('crosses gaps a running jump clears, not wider ones', () => {
    const gap = (n: number): string[] => [
      '#####',
      '#.R.#',
      ...Array<string>(n).fill('#___#'),
      '#...#',
      '#.S.#',
      '#####',
    ];
    expect(relicError(file(gap(2)))).toBe(false);
    expect(relicError(file(gap(3)))).toBe(true);
  });

  it('counts a pushable block as a step', () => {
    const rows = ['#####', '#8R8#', '#888#', '#4..#', '#.S.#', '#####'];
    expect(relicError(file(rows, {}, { R: 8 }))).toBe(false);
    const noStep = ['#####', '#8R8#', '#888#', '#...#', '#.S.#', '#####'];
    expect(relicError(file(noStep, {}, { R: 8 }))).toBe(true);
    const withBlock = file(noStep, {}, { R: 8 });
    withBlock.entities?.push({ id: 'b', type: 'block', room: 'r', at: [2, 3] });
    expect(relicError(withBlock)).toBe(false);
  });

  it('swims across flooded rooms and climbs out', () => {
    const rows = ['#####', '#4R4#', '#___#', '#___#', '#___#', '#4S4#', '#####'];
    expect(relicError(file(rows, {}, { R: 4, S: 4, _: -8 }))).toBe(true);
    const flooded = file(rows, {}, { R: 4, S: 4, _: -8 });
    if (flooded.rooms?.[0]) flooded.rooms[0].water = 2;
    expect(relicError(flooded)).toBe(false);
  });

  it('fails a checkpoint on a deadly sector', () => {
    const f = file(['#####', '#.R.#', '#.d.#', '#.S.#', '#####'], {}, { d: { floor: 0, flags: ['death'] } });
    f.entities?.push({ id: 'z', type: 'zone', room: 'r', at: [2, 2] });
    f.logic = [{ when: 'z.entered', do: ['checkpoint'] }];
    expect(
      validateLevel(f).errors.some((e) => e.includes("checkpoint zone 'z' lies on a deadly sector")),
    ).toBe(true);
  });

  it('reaches every cell of an open room', () => {
    const lv = Level.parse(file(['#####', '#.R.#', '#...#', '#.S.#', '#####']));
    const cells = reachableCells(lv);
    for (let x = 1; x <= 3; x++) for (let z = 1; z <= 3; z++) expect(cells.has(key(x, z))).toBe(true);
  });

  it('crosses a trench on the bridge its pour cools into', () => {
    const rows = ['#####', '#.R.#', '#ttt#', '#ttt#', '#ttt#', '#.S.#', '#####'];
    const f = file(rows, {}, { t: -12 });
    expect(relicError(f)).toBe(true);
    f.entities?.push({
      id: 'p',
      type: 'pour',
      room: 'r',
      at: [2, 4],
      path: [
        [2, 4],
        [2, 2],
      ],
      h: 0,
    });
    expect(relicError(f)).toBe(false);
  });
});
