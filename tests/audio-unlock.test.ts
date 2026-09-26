import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { adoptedContext } from '../src/audio/engine';

/** The first-gesture audio unlock script of index.html, run against a fake page. */
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = /<script id="audio-unlock">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

class FakeContext {
  static made: FakeContext[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  resumes = 0;
  started = 0;
  readonly destination = {};
  constructor(readonly options: { latencyHint?: unknown }) {
    FakeContext.made.push(this);
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }
  createBuffer(): object {
    return {};
  }
  createBufferSource(): object {
    return {
      buffer: null,
      connect: () => undefined,
      start: () => {
        this.started++;
      },
    };
  }
}

function page(opts: { coarse?: boolean; ua?: string } = {}) {
  FakeContext.made = [];
  const listeners = new Map<string, (() => void)[]>();
  const window: Record<string, unknown> = {
    AudioContext: FakeContext,
    matchMedia: (q: string) => ({ matches: q.includes('coarse') && opts.coarse === true }),
  };
  const document = {
    addEventListener: (type: string, fn: () => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  };
  runInNewContext(script, { window, document, navigator: { userAgent: opts.ua ?? 'Desktop' } });
  const fire = (type: string): void => {
    for (const fn of listeners.get(type) ?? []) fn();
  };
  return { window, fire, types: [...listeners.keys()] };
}

describe('first-gesture audio unlock (index.html)', () => {
  it('is in the page, ahead of the game bundle', () => {
    expect(script).toContain('__ncAudioCtx');
    expect(html.indexOf('id="audio-unlock"')).toBeLessThan(html.indexOf('src="/src/main.ts"'));
  });

  it('does nothing before a gesture', () => {
    const p = page();
    expect(p.types).toEqual(expect.arrayContaining(['pointerdown', 'touchend', 'keydown', 'click']));
    expect(FakeContext.made).toHaveLength(0);
    expect(adoptedContext(p.window)).toBeNull();
  });

  it('a tap on the splash makes the context and unlocks it inside the gesture (resume + a silent buffer)', () => {
    const p = page();
    p.fire('pointerdown');
    expect(FakeContext.made).toHaveLength(1);
    const ctx = FakeContext.made[0] as FakeContext;
    expect(ctx.resumes).toBe(1);
    expect(ctx.started).toBe(1);
    expect(ctx.options.latencyHint).toBe('interactive');
    // The engine adopts that same context (no second gesture needed).
    expect(adoptedContext(p.window)).toBe(ctx);
    // Later gestures reuse it and only resume it when needed.
    p.fire('keydown');
    expect(FakeContext.made).toHaveLength(1);
    expect(ctx.resumes).toBe(1);
    ctx.state = 'suspended';
    p.fire('touchend');
    expect(ctx.resumes).toBe(2);
  });

  it('phones get the larger output buffer the engine uses', () => {
    const p = page({ ua: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
    p.fire('pointerdown');
    expect((FakeContext.made[0] as FakeContext).options.latencyHint).toBe(0.06);
  });

  it('reuses a context the engine already published (one tap, one context)', () => {
    const p = page();
    const engineCtx = new FakeContext({ latencyHint: 'interactive' });
    p.window.__ncAudioCtx = engineCtx;
    p.fire('pointerdown');
    expect(FakeContext.made).toEqual([engineCtx]);
    expect(engineCtx.resumes).toBe(1);
  });

  it('a closed context is not adopted', () => {
    const p = page();
    p.fire('click');
    (FakeContext.made[0] as FakeContext).state = 'closed';
    expect(adoptedContext(p.window)).toBeNull();
  });
});
