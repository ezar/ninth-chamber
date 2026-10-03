/**
 * The playtest log (roadmap 0.2.5): what testers' sessions looked like, kept
 * on the device and exported with one button in Options. Nothing is sent
 * anywhere: the tester shares the file if they want to.
 *
 * Each session records the device, the renderer and quality tier, the frame
 * rate (average and worst half second), and per room the time spent, deaths
 * and hints shown, plus where the player stopped and whether the chamber was
 * finished. Storage can be missing, blocked or full, so every access is
 * guarded and the log just lasts for the page.
 */

/** The subset of Storage the log needs (tests pass a Map-backed one). */
export interface LogStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RoomStats {
  /** Seconds of play in the room. */
  time: number;
  deaths: number;
  hints: number;
}

export interface PlaytestSession {
  /** Game version (package.json). */
  version: string;
  /** ISO time the session started. */
  started: string;
  level: string;
  device: {
    userAgent: string;
    touch: boolean;
    cores: number | null;
    memoryGb: number | null;
    screen: string;
  };
  renderer: string;
  tier: string;
  /** Seconds of play (the tomb, not the title or menus). */
  playTime: number;
  fps: {
    /** Frames over seconds of play. */
    average: number;
    /** The slowest half second of play. */
    worst: number;
  };
  rooms: Record<string, RoomStats>;
  /** The room the player was in when the session ended or was last saved. */
  lastRoom: string | null;
  finished: boolean;
  /** Script errors and renderer warnings seen during the session, by message (the first few distinct ones). */
  problems: Record<string, number>;
}

export const LOG_KEY = 'nc.playtest';
/** Sessions kept: the oldest go first. */
export const MAX_SESSIONS = 30;
/** Distinct problem messages kept per session, and their length. */
const MAX_PROBLEMS = 20;
const PROBLEM_LENGTH = 200;
/** Window for the worst frame rate, in seconds. */
const WINDOW = 0.5;

export function loadSessions(storage: LogStorage | null): PlaytestSession[] {
  try {
    const raw = storage?.getItem(LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as PlaytestSession[]) : [];
  } catch {
    return [];
  }
}

export function clearSessions(storage: LogStorage | null): void {
  try {
    storage?.removeItem(LOG_KEY);
  } catch {
    // Blocked: nothing was kept anyway.
  }
}

const round = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;

/** One session in progress. `save()` writes it into the stored list (replacing its earlier copy). */
export class PlaytestLog {
  private readonly session: PlaytestSession;
  private room: string | null = null;
  private frames = 0;
  private windowFrames = 0;
  private windowTime = 0;
  private worst = Infinity;
  private dirty = false;
  private sinceSave = 0;

  constructor(
    private readonly storage: LogStorage | null,
    init: Pick<PlaytestSession, 'version' | 'started' | 'level' | 'device' | 'renderer' | 'tier'>,
  ) {
    this.session = {
      ...init,
      playTime: 0,
      fps: { average: 0, worst: 0 },
      rooms: {},
      lastRoom: null,
      finished: false,
      problems: {},
    };
  }

  get data(): Readonly<PlaytestSession> {
    return this.session;
  }

  setTier(tier: string): void {
    this.session.tier = tier;
  }

  private stats(room: string): RoomStats {
    return (this.session.rooms[room] ??= { time: 0, deaths: 0, hints: 0 });
  }

  /** The room the player is in (null outside any room). */
  enterRoom(room: string | null): void {
    this.room = room;
    if (room) {
      this.stats(room);
      this.session.lastRoom = room;
    }
  }

  /** A simulation or UI event. */
  onEvent(type: string): void {
    if (!this.room) return;
    if (type === 'player.died') this.stats(this.room).deaths++;
    else if (type === 'hint') this.stats(this.room).hints++;
    else if (type === 'level.end') this.session.finished = true;
    else return;
    this.dirty = true;
  }

  /** A script error or renderer warning (counted by message; ids and addresses are folded together). */
  problem(message: string): void {
    const key = message
      .replace(/\s+/g, ' ')
      .replace(/0x[0-9a-f]+/gi, '0x…')
      .trim()
      .slice(0, PROBLEM_LENGTH);
    if (!key) return;
    const p = this.session.problems;
    if (p[key] === undefined && Object.keys(p).length >= MAX_PROBLEMS) return;
    p[key] = (p[key] ?? 0) + 1;
    this.dirty = true;
  }

  /** One rendered frame of play, `dt` in seconds. Saves now and then. */
  frame(dt: number): void {
    if (!(dt > 0)) return;
    const s = this.session;
    s.playTime += dt;
    this.frames++;
    if (this.room) this.stats(this.room).time += dt;
    this.windowFrames++;
    this.windowTime += dt;
    if (this.windowTime >= WINDOW) {
      this.worst = Math.min(this.worst, this.windowFrames / this.windowTime);
      this.windowFrames = 0;
      this.windowTime = 0;
    }
    this.dirty = true;
    this.sinceSave += dt;
    if (this.sinceSave >= 15) this.save();
  }

  /** Writes the session into storage, replacing its earlier copy. */
  save(): void {
    this.sinceSave = 0;
    if (!this.dirty) return;
    this.dirty = false;
    const s = this.session;
    s.fps.average = s.playTime > 0 ? round(this.frames / s.playTime) : 0;
    s.fps.worst = Number.isFinite(this.worst) ? round(this.worst) : s.fps.average;
    for (const r of Object.values(s.rooms)) r.time = round(r.time);
    s.playTime = round(s.playTime);
    // A session with no play (the title only) is not worth a line.
    if (s.playTime <= 0) return;
    const list = loadSessions(this.storage).filter((x) => x.started !== s.started || x.level !== s.level);
    list.push(structuredClone(s));
    try {
      this.storage?.setItem(LOG_KEY, JSON.stringify(list.slice(-MAX_SESSIONS)));
    } catch {
      // Full or blocked: the log lasts for this page only.
    }
  }
}

/** The exported file: every stored session, newest last. */
export function exportLog(sessions: readonly PlaytestSession[], exported: string): string {
  return JSON.stringify({ game: 'The Ninth Chamber', exported, sessions }, null, 2);
}
