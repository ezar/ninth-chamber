import { describe, expect, it } from 'vitest';
import {
  LOG_KEY,
  MAX_SESSIONS,
  PlaytestLog,
  clearSessions,
  exportLog,
  loadSessions,
  type LogStorage,
} from '../src/ui/playtest';

function memory(): LogStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const init = (started: string) => ({
  version: '0.2.5',
  started,
  level: 'antechamber',
  device: { userAgent: 'test', touch: true, cores: 6, memoryGb: 4, screen: '390×844 @3' },
  renderer: 'WebGPU',
  tier: 'mobile',
});

describe('playtest log', () => {
  it('records time, deaths and hints per room, and where the player stopped', () => {
    const storage = memory();
    const log = new PlaytestLog(storage, init('2026-10-03T10:00:00.000Z'));
    log.enterRoom('entrance');
    for (let i = 0; i < 120; i++) log.frame(1 / 60);
    log.onEvent('hint');
    log.enterRoom('hall');
    for (let i = 0; i < 60; i++) log.frame(1 / 30);
    log.onEvent('player.died');
    log.onEvent('player.died');
    log.onEvent('hint.asked');
    log.onEvent('player.hurt');
    log.save();
    const [s] = loadSessions(storage);
    expect(s?.rooms.entrance).toEqual({ time: 2, deaths: 0, hints: 1, asked: 0 });
    expect(s?.rooms.hall).toEqual({ time: 2, deaths: 2, hints: 0, asked: 1 });
    expect(s?.lastRoom).toBe('hall');
    expect(s?.playTime).toBe(4);
    expect(s?.fps.average).toBe(45);
    expect(s?.fps.worst).toBe(30);
    expect(s?.finished).toBe(false);
  });

  it('keeps one copy per session and marks a finished chamber', () => {
    const storage = memory();
    const log = new PlaytestLog(storage, init('2026-10-03T10:00:00.000Z'));
    log.enterRoom('entrance');
    log.frame(0.5);
    log.save();
    log.onEvent('level.end');
    log.save();
    const list = loadSessions(storage);
    expect(list).toHaveLength(1);
    expect(list[0]?.finished).toBe(true);
  });

  it('skips sessions with no play and keeps the newest sessions only', () => {
    const storage = memory();
    new PlaytestLog(storage, init('title-only')).save();
    expect(loadSessions(storage)).toEqual([]);
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      const log = new PlaytestLog(storage, init(`s${i}`));
      log.frame(0.1);
      log.save();
    }
    const list = loadSessions(storage);
    expect(list).toHaveLength(MAX_SESSIONS);
    expect(list.at(-1)?.started).toBe(`s${MAX_SESSIONS + 4}`);
  });

  it('counts problems by message, folding addresses, and keeps a few distinct ones', () => {
    const storage = memory();
    const log = new PlaytestLog(storage, init('p'));
    log.problem('warning: GL error at 0x5a10  bind');
    log.problem('warning: GL error at 0x77ff bind');
    for (let i = 0; i < 40; i++) log.problem(`error: ${i}`);
    log.frame(0.1);
    log.save();
    const p = loadSessions(storage)[0]?.problems ?? {};
    expect(p['warning: GL error at 0x… bind']).toBe(2);
    expect(Object.keys(p)).toHaveLength(20);
  });

  it('survives missing, corrupt and full storage', () => {
    const log = new PlaytestLog(null, init('x'));
    log.frame(0.1);
    expect(() => log.save()).not.toThrow();
    const corrupt = memory();
    corrupt.map.set(LOG_KEY, '{nope');
    expect(loadSessions(corrupt)).toEqual([]);
    const full: LogStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const l2 = new PlaytestLog(full, init('y'));
    l2.frame(0.1);
    expect(() => l2.save()).not.toThrow();
  });

  it('exports every session and clears them', () => {
    const storage = memory();
    const log = new PlaytestLog(storage, init('a'));
    log.frame(0.2);
    log.save();
    const file = JSON.parse(exportLog(loadSessions(storage), 'now')) as { sessions: unknown[] };
    expect(file.sessions).toHaveLength(1);
    clearSessions(storage);
    expect(loadSessions(storage)).toEqual([]);
  });
});
