/**
 * Repeatable performance benchmark (docs/performance.md): plays a fixed
 * camera route through every room of the Antechamber at each quality tier and
 * records CPU frame time, renderer.info counters, heap and allocation
 * pressure, main-thread breakdown and load timing.
 *
 *   pnpm bench [--url http://localhost:5173/] [--tiers high,medium,mobile]
 *              [--out bench.json] [--shots dir] [--warm 12] [--frames 16]
 *              [--level cisterns]
 *
 * `--level` plays another chamber (the Cisterns route crosses every wet
 * room, so it measures the water); the default is the Antechamber.
 *
 * The route stands Nora in each room and looks through every doorway to a
 * neighbouring room, so room culling is measured (and screenshotted) exactly
 * where it could pop. With a software GPU (SwiftShader) absolute timings mean
 * little: compare runs on the same machine.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type CDPSession, type Page } from 'playwright';

type Tier = 'high' | 'medium' | 'mobile';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

const URL_ = arg('url', 'http://localhost:5173/');
const TIERS = arg('tiers', 'high,medium,mobile').split(',') as Tier[];
const OUT = arg('out', '');
const SHOTS = arg('shots', '');
const WARM = Number(arg('warm', '12'));
const FRAMES = Number(arg('frames', '16'));
const LEVEL = arg('level', '');

/** One frame as the page records it. */
interface FrameSample {
  ms: number;
  /** Time since the previous frame started: with a software GPU this includes GPU work. */
  wallMs: number;
  drawCalls: number;
  triangles: number;
}

interface View {
  room: string;
  toward: string;
  x: number;
  z: number;
  yaw: number;
}

interface ViewResult extends View {
  cpuMs: number;
  wallMs: number;
  cpuP90: number;
  drawCalls: number;
  triangles: number;
}

interface TierResult {
  tier: Tier;
  readyMs: number;
  transfer: Record<string, { count: number; transferKB: number; decodedKB: number }>;
  views: ViewResult[];
  summary: {
    cpuMs: number;
    wallMs: number;
    cpuP90: number;
    drawCalls: { mean: number; max: number };
    triangles: { mean: number; max: number };
    programs: number;
    textures: number;
    texturesMB: number;
    geometries: number;
    attributesMB: number;
    heapMB: number;
    allocKBPerFrame: number;
    topAllocators: { fn: string; kb: number }[];
    gc: { minor: number; major: number; ms: number };
    mainThread: Record<string, number>;
  };
}

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const p90 = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.round((s.length - 1) * 0.9))] ?? 0;
};
const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

/** Page side: wraps the animation loop to time each frame and read renderer.info after it. */
function instrument(): void {
  interface Nc {
    renderer: { renderer: RendererLike };
  }
  interface RendererLike {
    _animation: { _animationLoop: ((t: number, f?: unknown) => void) | null };
    setAnimationLoop(fn: (t: number, f?: unknown) => void): void;
    info: { render: { drawCalls: number; triangles: number } };
  }
  const w = window as unknown as { __nc: Nc; __perf: { frames: FrameSample[] } };
  const r = w.__nc.renderer.renderer;
  const loop = r._animation._animationLoop;
  if (!loop) throw new Error('no animation loop');
  w.__perf = { frames: [] };
  let last = performance.now();
  r.setAnimationLoop((t, f) => {
    const s = performance.now();
    loop(t, f);
    const ms = performance.now() - s;
    w.__perf.frames.push({
      ms,
      wallMs: s - last,
      drawCalls: r.info.render.drawCalls,
      triangles: r.info.render.triangles,
    });
    last = s;
  });
}

/** Page side: the route, one view per doorway of every room (computed from the level grid). */
function route(): View[] {
  interface Sector {
    cx: number;
    cz: number;
    room: string;
    wall: boolean;
    pit: boolean;
    flags: Set<string>;
    water: number | null;
  }
  interface LevelLike {
    rooms: { id: string; minX: number; minZ: number; maxX: number; maxZ: number }[];
    sector(cx: number, cz: number): Sector | undefined;
    allSectors(): Iterable<Sector>;
  }
  const level = (window as unknown as { __nc: { world: { level: LevelLike } } }).__nc.world.level;
  const B = 2;
  const open = (s: Sector | undefined): s is Sector =>
    !!s && !s.wall && !s.pit && !s.flags.has('death') && !s.flags.has('crumble') && s.water === null;
  const portals = new Map<string, { x: number; z: number; n: number }>();
  for (const s of level.allSectors()) {
    if (s.wall) continue;
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const n = level.sector(s.cx + dx, s.cz + dz);
      if (!n || n.wall || n.room === s.room) continue;
      for (const [a, b] of [
        [s.room, n.room],
        [n.room, s.room],
      ] as const) {
        const k = `${a}>${b}`;
        const p = portals.get(k) ?? { x: 0, z: 0, n: 0 };
        p.x += (s.cx + 0.5 + dx / 2) * B;
        p.z += (s.cz + 0.5 + dz / 2) * B;
        p.n++;
        portals.set(k, p);
      }
    }
  }
  const views: View[] = [];
  for (const room of level.rooms) {
    const mx = (room.minX + room.maxX) / 2;
    const mz = (room.minZ + room.maxZ) / 2;
    let best: Sector | null = null;
    let bestD = Infinity;
    for (let cx = room.minX; cx < room.maxX; cx++) {
      for (let cz = room.minZ; cz < room.maxZ; cz++) {
        const s = level.sector(cx, cz);
        if (!open(s) || s.room !== room.id) continue;
        const d = (cx + 0.5 - mx) ** 2 + (cz + 0.5 - mz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    if (!best) continue;
    const x = (best.cx + 0.5) * B;
    const z = (best.cz + 0.5) * B;
    for (const [k, p] of portals) {
      const [from, to] = k.split('>');
      if (from !== room.id || !to) continue;
      const tx = p.x / p.n;
      const tz = p.z / p.n;
      views.push({ room: room.id, toward: to, x, z, yaw: Math.atan2(-(tx - x), -(tz - z)) });
    }
  }
  return views;
}

/** Page side: stands Nora at a view and turns the camera behind her. */
function place(v: View): void {
  interface Nc {
    world: {
      level: { floorAt(x: number, z: number): number };
      state: {
        player: {
          pos: { x: number; y: number; z: number };
          vel: { x: number; y: number; z: number };
          yaw: number;
          health: number;
        };
      };
    };
    camera: { yaw: number; recenter(yaw: number): void };
  }
  const nc = (window as unknown as { __nc: Nc }).__nc;
  const p = nc.world.state.player;
  p.pos = { x: v.x, y: nc.world.level.floorAt(v.x, v.z), z: v.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = v.yaw;
  p.health = 1000;
  nc.camera.yaw = v.yaw;
  nc.camera.recenter(v.yaw);
}

/** Waits for `n` rendered frames and returns their samples. */
async function frames(page: Page, n: number): Promise<FrameSample[]> {
  await page.evaluate(() => {
    (window as unknown as { __perf: { frames: FrameSample[] } }).__perf.frames = [];
  });
  await page.waitForFunction(
    (k) => (window as unknown as { __perf: { frames: unknown[] } }).__perf.frames.length >= k,
    n,
    { polling: 50, timeout: 600_000 },
  );
  return page.evaluate(() => (window as unknown as { __perf: { frames: FrameSample[] } }).__perf.frames);
}

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: SamplingNode[];
}

function allocators(root: SamplingNode): { total: number; byFn: Map<string, number> } {
  const byFn = new Map<string, number>();
  let total = 0;
  const walk = (n: SamplingNode): void => {
    if (n.selfSize) {
      total += n.selfSize;
      const file = n.callFrame.url.split('/').pop()?.split('?')[0] ?? '';
      const key = `${n.callFrame.functionName || '(anonymous)'} ${file}:${n.callFrame.lineNumber + 1}`;
      byFn.set(key, (byFn.get(key) ?? 0) + n.selfSize);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return { total, byFn };
}

interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
  tid: number;
  pid: number;
  args?: { data?: { type?: string } };
}

async function trace(cdp: CDPSession, page: Page): Promise<{ events: TraceEvent[]; frames: number }> {
  const events: TraceEvent[] = [];
  cdp.on('Tracing.dataCollected', (e) => events.push(...(e.value as unknown as TraceEvent[])));
  const done = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,v8,disabled-by-default-v8.gc,blink.user_timing',
    transferMode: 'ReportEvents',
  });
  const f = await frames(page, FRAMES * 2);
  await cdp.send('Tracing.end');
  await done;
  return { events, frames: f.length };
}

function mainThread(
  events: TraceEvent[],
  nFrames: number,
): { breakdown: Record<string, number>; gc: TierResult['summary']['gc'] } {
  // The renderer main thread is the one running the animation-frame callbacks.
  const raf = events.find((e) => e.name === 'FireAnimationFrame');
  const main = events.filter((e) => raf && e.tid === raf.tid && e.pid === raf.pid && e.ph === 'X');
  const sum = (pred: (e: TraceEvent) => boolean): number =>
    main.filter(pred).reduce((a, e) => a + (e.dur ?? 0), 0) / 1000;
  const minor = main.filter((e) => e.name === 'MinorGC' || e.name === 'V8.GC_SCAVENGER');
  const major = main.filter((e) => e.name === 'MajorGC' || e.name === 'V8.GC_MARK_COMPACTOR');
  const per = (v: number): number => round(v / Math.max(1, nFrames));
  return {
    breakdown: {
      taskMsPerFrame: per(sum((e) => e.name === 'RunTask')),
      animationFrameMsPerFrame: per(sum((e) => e.name === 'FireAnimationFrame')),
      functionCallMsPerFrame: per(sum((e) => e.name === 'FunctionCall')),
      gcMsPerFrame: per(sum((e) => e.name === 'MinorGC' || e.name === 'MajorGC')),
      layoutMsPerFrame: per(sum((e) => e.name === 'Layout' || e.name === 'UpdateLayoutTree')),
      paintMsPerFrame: per(sum((e) => e.name === 'Paint' || e.name === 'PrePaint')),
    },
    gc: {
      minor: minor.length,
      major: major.length,
      ms: round(sum((e) => e.name === 'MinorGC' || e.name === 'MajorGC')),
    },
  };
}

async function runTier(tier: Tier): Promise<TierResult> {
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  // tsx keeps function names with an `__name` helper that page-side functions also reference.
  await context.addInitScript('window.__name = (f) => f;');
  await context.addInitScript((t) => {
    localStorage.setItem(
      'nc.settings',
      JSON.stringify({ quality: t, qualitySource: 'user', language: 'en' }),
    );
  }, tier);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${tier}] pageerror`, e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  const target = new URL(URL_);
  if (LEVEL) target.searchParams.set('level', LEVEL);
  await page.goto(target.toString(), { waitUntil: 'load' });
  await page.waitForFunction(
    () => (window as unknown as { __nc?: { loading: { isReady: boolean } } }).__nc?.loading.isReady === true,
    null,
    { timeout: 300_000, polling: 100 },
  );
  const readyMs = await page.evaluate(() => performance.now());
  console.log(`[${tier}] ready after ${Math.round(readyMs)} ms`);
  const transfer = await page.evaluate(() => {
    const out: Record<string, { count: number; transferKB: number; decodedKB: number }> = {};
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const path = new URL(e.name).pathname;
      const ext = /\.(\w+)$/.exec(path)?.[1] ?? 'other';
      const kind = ['js', 'ts', 'mjs'].includes(ext) ? 'script' : ext;
      const o = (out[kind] ??= { count: 0, transferKB: 0, decodedKB: 0 });
      o.count++;
      o.transferKB += e.transferSize / 1024;
      o.decodedKB += e.decodedBodySize / 1024;
    }
    return out;
  });

  // Into play: skip the prelude, start, skip the intro.
  await page.evaluate(() => {
    const nc = (window as unknown as { __nc: { prelude: { skip(): void }; start(): void } }).__nc;
    nc.prelude.skip();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as unknown as { __nc: { start(): void } }).__nc.start());
  await page.waitForFunction(
    () => (window as unknown as { __nc: { phase: string } }).__nc.phase === 'intro',
    null,
    {
      timeout: 60_000,
    },
  );
  // The intro only lets itself be skipped after half a second of its own (frame-capped) time.
  await page.waitForFunction(
    () => {
      const nc = (window as unknown as { __nc: { phase: string; skipIntro(): void } }).__nc;
      nc.skipIntro();
      return nc.phase === 'play';
    },
    null,
    { timeout: 300_000, polling: 250 },
  );
  await page.evaluate(instrument);
  const views = await page.evaluate(route);
  console.log(`[${tier}] playing; ${views.length} views`);

  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 4096,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });

  const results: ViewResult[] = [];
  let measured = 0;
  for (const [i, v] of views.entries()) {
    await page.evaluate(place, v);
    await frames(page, WARM);
    const f = await frames(page, FRAMES);
    measured += f.length;
    const ms = f.map((s) => s.ms);
    results.push({
      ...v,
      cpuMs: round(median(ms)),
      wallMs: round(median(f.map((x) => x.wallMs))),
      cpuP90: round(p90(ms)),
      drawCalls: median(f.map((s) => s.drawCalls)),
      triangles: median(f.map((s) => s.triangles)),
    });
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      // A software GPU can take seconds per frame: give the capture room.
      await page.screenshot({
        timeout: 300_000,
        path: join(SHOTS, `${tier}-${String(i).padStart(2, '0')}-${v.room}-to-${v.toward}.png`),
      });
    }
    console.log(
      `[${tier}] ${v.room} → ${v.toward}: cpu ${results.at(-1)?.cpuMs} ms, wall ${results.at(-1)?.wallMs} ms, ${results.at(-1)?.drawCalls} calls, ${results.at(-1)?.triangles} tris`,
    );
  }
  const profile = (await cdp.send('HeapProfiler.stopSampling')) as { profile: { head: SamplingNode } };
  const alloc = allocators(profile.profile.head);

  // Main-thread breakdown in the first room.
  const first = views[0];
  if (first) await page.evaluate(place, first);
  await frames(page, WARM);
  const tr = await trace(cdp, page);
  const mt = mainThread(tr.events, tr.frames);

  const metrics = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  const metric = (n: string): number => metrics.metrics.find((m) => m.name === n)?.value ?? 0;
  const info = await page.evaluate(() => {
    const r = (
      window as unknown as {
        __nc: { renderer: { renderer: { info: { memory: Record<string, number> } } } };
      }
    ).__nc.renderer.renderer;
    return r.info.memory;
  });
  await browser.close();

  const cpu = results.map((r) => r.cpuMs);
  const dc = results.map((r) => r.drawCalls);
  const tri = results.map((r) => r.triangles);
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return {
    tier,
    readyMs: Math.round(readyMs),
    transfer: Object.fromEntries(
      Object.entries(transfer).map(([k, v]) => [
        k,
        { count: v.count, transferKB: Math.round(v.transferKB), decodedKB: Math.round(v.decodedKB) },
      ]),
    ),
    views: results,
    summary: {
      cpuMs: round(median(cpu)),
      wallMs: round(median(results.map((r) => r.wallMs))),
      cpuP90: round(p90(results.map((r) => r.cpuP90))),
      drawCalls: { mean: Math.round(mean(dc)), max: Math.max(...dc) },
      triangles: { mean: Math.round(mean(tri)), max: Math.max(...tri) },
      programs: info.programs ?? 0,
      textures: info.textures ?? 0,
      texturesMB: round((info.texturesSize ?? 0) / 2 ** 20, 1),
      geometries: info.geometries ?? 0,
      attributesMB: round(((info.attributesSize ?? 0) + (info.indexAttributesSize ?? 0)) / 2 ** 20, 1),
      heapMB: round(metric('JSHeapUsedSize') / 2 ** 20, 1),
      allocKBPerFrame: round(alloc.total / 1024 / Math.max(1, measured + views.length * WARM), 1),
      topAllocators: [...alloc.byFn.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([fn, b]) => ({ fn, kb: Math.round(b / 1024) })),
      gc: mt.gc,
      mainThread: mt.breakdown,
    },
  };
}

const out: TierResult[] = [];
for (const tier of TIERS) {
  const r = await runTier(tier);
  out.push(r);
  const s = r.summary;
  console.log(
    `\n${tier}: ready ${r.readyMs} ms · cpu ${s.cpuMs} ms (p90 ${s.cpuP90}) · wall ${s.wallMs} ms · calls ${s.drawCalls.mean}/${s.drawCalls.max} · ` +
      `tris ${s.triangles.mean}/${s.triangles.max} · programs ${s.programs} · textures ${s.textures} (${s.texturesMB} MB) · ` +
      `geometries ${s.geometries} · heap ${s.heapMB} MB · alloc ${s.allocKBPerFrame} KB/frame · gc ${JSON.stringify(s.gc)}`,
  );
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
