/**
 * The generated service worker (scripts/vite-sw.ts): versioned per build,
 * precaching the whole game, never answering a page load from the cache while
 * the network is there, and offline starting only a build it holds whole.
 */
import { describe, expect, it } from 'vitest';
import { EXTRAS_PUBLIC, PRECACHE_PUBLIC, serviceWorkerSource } from '../scripts/vite-sw';

const precached = (f: string): boolean => PRECACHE_PUBLIC.some((re) => re.test(f));
const extra = (f: string): boolean => EXTRAS_PUBLIC.some((re) => re.test(f));

describe('service worker', () => {
  it('names its cache after the build version and drops older ones on activation', () => {
    const src = serviceWorkerSource('abc123', ['./', './assets/index-x.js']);
    expect(src).toContain('const VERSION = "abc123"');
    expect(src).toContain('i < own');
    expect(src).toContain('"./assets/index-x.js"');
    expect(() => new Function(src)).not.toThrow();
  });

  it('loads pages network first and never takes over a running game', () => {
    const src = serviceWorkerSource('v', []);
    expect(src).toMatch(/mode === 'navigate'[\s\S]*fetch\(request\)/);
    // It takes over only when the page asks (the player chose to update).
    expect(src).toMatch(/event\.data === 'take-over'\) self\.skipWaiting\(\)/);
    expect(src.match(/skipWaiting/g)).toHaveLength(1);
  });

  it('precaches the whole game, and the music after', () => {
    expect(precached('models/nora.glb')).toBe(true);
    expect(precached('models/forge.glb')).toBe(true);
    expect(precached('audio/foley/rope.webm')).toBe(true);
    expect(precached('audio/ambience/wind.webm')).toBe(true);
    expect(precached('audio/music/cisterns-explore-1.webm')).toBe(false);
    expect(extra('audio/music/cisterns-explore-1.webm')).toBe(true);
    expect(extra('audio/foley/rope.webm')).toBe(false);
    expect(precached('textures/wall/albedo.ktx2')).toBe(true);
    expect(precached('basis/basis_transcoder.wasm')).toBe(true);
    expect(precached('levels/antechamber.lightmap.png')).toBe(true);
    expect(precached('anim/idle.json')).toBe(true);
    expect(precached('audio/CREDITS.md')).toBe(false);
    expect(precached('models/README.md')).toBe(false);
  });

  it('stores the page last, so only a whole build has it', () => {
    const src = serviceWorkerSource('v', ['./', './assets/index-x.js'], ['./audio/music/a.webm']);
    expect(src).toContain('const EXTRAS = ["./audio/music/a.webm"]');
    const body = src.slice(src.indexOf('async function precache'), src.indexOf('async function cacheExtras'));
    expect(body.indexOf('Promise.all')).toBeLessThan(body.indexOf('cache.put(SHELL'));
    expect(body).toMatch(/filter\(\(u\) => u !== SHELL\)/);
  });

  it('offline, starts the newest whole build and looks in whole builds first', () => {
    const src = serviceWorkerSource('v', []);
    // Navigations are never cached at run time: the stored page stays its build's.
    expect(src).toMatch(/mode === 'navigate'[\s\S]*?fetch\(request\)\.catch\(/);
    expect(src).not.toMatch(/fetch\(request\)\s*\.then\(\(r\) => put\(request, r\)\)\s*\.catch/);
    expect(src).toMatch(/lookup\(SHELL\)/);
    // A page's requests carry headers the worker's downloads did not (Origin): Vary must not hide them.
    expect(src).toContain('match(request, { ignoreVary: true })');
    expect(src).toMatch(
      /keys\.filter\(\(k, i\) => done\[i\]\), \.\.\.keys\.filter\(\(k, i\) => !done\[i\]\)/,
    );
  });

  it('answers byte ranges from a cached file', () => {
    const src = serviceWorkerSource('v', []);
    expect(src).toContain("request.headers.has('range')");
    expect(src).toContain('status: 206');
    expect(src).toContain('/bytes=(\\d*)-(\\d*)/');
  });
});

/** Runs the worker against in-memory caches and a network that is on or off. */
function harness(version: string, precache: string[], files: Record<string, string>) {
  const ORIGIN = 'https://game.test/nc/';
  const stores = new Map<string, Map<string, Response>>();
  const open = (name: string) => {
    let m = stores.get(name);
    if (!m) stores.set(name, (m = new Map()));
    const store = m;
    const key = (r: { url: string } | string) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
    return {
      keys: async () => [...store.keys()].map((u) => new Request(u)),
      match: async (r: { url: string } | string) => store.get(key(r))?.clone(),
      put: async (r: { url: string } | string, res: Response) => void store.set(key(r), res.clone()),
    };
  };
  const net = { online: true };
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL('sw.js', ORIGIN),
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    clients: { matchAll: async () => [], claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  const caches = {
    open: async (n: string) => open(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
  };
  const fetchFn = async (r: { url: string } | string) => {
    const url = typeof r === 'string' ? r : r.url;
    if (!net.online) throw new TypeError('offline');
    const path = new URL(url).pathname.replace('/nc/', './');
    const body = files[path];
    return body === undefined ? new Response('', { status: 404 }) : new Response(body);
  };
  new Function('self', 'caches', 'fetch', serviceWorkerSource(version, precache))(self, caches, fetchFn);
  const run = async (type: string, extra: object = {}): Promise<Response | undefined> => {
    let answer: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners[type]?.({
      ...extra,
      respondWith: (p: Promise<Response>) => (answer = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    return answer && (await answer);
  };
  const get = (path: string, mode: RequestMode = 'same-origin', headers: Record<string, string> = {}) =>
    run('fetch', {
      request: { method: 'GET', url: new URL(path, ORIGIN).href, mode, headers: new Headers(headers) },
    });
  return { stores, net, run, get, caches, listeners };
}

describe('service worker at work', () => {
  it('offline, starts the build it holds whole rather than a newer one cut short', async () => {
    const a = harness('a', ['./', './assets/a.js'], { './': 'page A', './assets/a.js': 'A' });
    await a.run('install');
    // Build B was deployed and its download stopped half way: its cache has no page.
    (await a.caches.open('nc-b')).put('https://game.test/nc/assets/b.js', new Response('B'));
    a.net.online = false;
    const page = await a.get('./?level=cisterns', 'navigate');
    expect(await page?.text()).toBe('page A');
  });

  it('online, a page load goes to the network and is not stored', async () => {
    const a = harness('a', ['./'], { './': 'page A' });
    await a.run('install');
    const page = await a.get('./', 'navigate');
    expect(await page?.text()).toBe('page A');
    expect([...(a.stores.get('nc-a')?.keys() ?? [])]).toEqual(['https://game.test/nc/']);
  });

  it('a failed download leaves the page out, so the build never counts as whole', async () => {
    const a = harness('a', ['./', './models/x.glb'], { './': 'page A' });
    await expect(a.run('install')).rejects.toThrow(/HTTP 404/);
    expect(a.stores.get('nc-a')?.has('https://game.test/nc/')).toBe(false);
  });

  it('tells the page its build, so the title only says it plays offline once this worker is in control', async () => {
    const a = harness('a', ['./'], { './': 'page A' });
    let said: unknown;
    await a.run('message', { data: 'version', ports: [{ postMessage: (v: unknown) => (said = v) }] });
    expect(said).toBe('a');
  });

  it('never refreshes a cached file in place, so a build cached whole stays that build', async () => {
    const files: Record<string, string> = { './': 'page A', './models/x.glb': 'model A' };
    const a = harness('a', ['./', './models/x.glb'], files);
    await a.run('install');
    // Build B is deployed: same name, new content.
    files['./models/x.glb'] = 'model B';
    const r = await a.get('./models/x.glb');
    expect(await r?.text()).toBe('model A');
    await new Promise((done) => setTimeout(done, 0));
    expect(await (await a.caches.open('nc-a')).match('./models/x.glb').then((c) => c?.text())).toBe(
      'model A',
    );
  });

  it('answers a byte range from the cached file', async () => {
    const a = harness('a', ['./', './audio/music/x.webm'], {
      './': 'p',
      './audio/music/x.webm': '0123456789',
    });
    await a.run('install');
    a.net.online = false;
    const r = await a.get('./audio/music/x.webm', 'no-cors', { range: 'bytes=2-5' });
    expect(r?.status).toBe(206);
    expect(r?.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(await r?.text()).toBe('2345');
    const tail = await a.get('./audio/music/x.webm', 'no-cors', { range: 'bytes=7-' });
    expect(await tail?.text()).toBe('789');
  });
});
