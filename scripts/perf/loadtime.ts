/**
 * Cold start on 4G (spec §2, Phase 3 gate: "tiempo de carga inicial por
 * debajo de 4 s en 4G"). Serves dist/ the way GitHub Pages does (gzip for
 * text, binaries as they are), opens it in headless Chromium with an empty
 * cache on an emulated 4G link and measures:
 *
 * - first paint: the splash and the story prelude on screen;
 * - title usable: a press on "Enter the tomb" is taken (the game then starts
 *   as soon as the tomb is ready); the threshold the gate is measured
 *   against (docs/roadmap.md);
 * - tomb ready: the first room loaded and its shaders compiled;
 * - transfer: bytes on the wire until then.
 *
 *   pnpm build && pnpm loadtime [--budget 4] [--down 9] [--rtt 150] [--runs 3]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { arg } from '../browser/game';

const budget = Number(arg('budget', '4'));
const downMbps = Number(arg('down', '9'));
const rtt = Number(arg('rtt', '150'));
const runs = Number(arg('runs', '3'));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.txt', '.wasm']);

const root = join(process.cwd(), 'dist');
const gzCache = new Map<string, Buffer>();
const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://x');
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) return void res.writeHead(403).end();
    try {
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    } catch {
      return void res.writeHead(404).end();
    }
    const ext = extname(path);
    let body: Buffer = await readFile(path);
    const headers: Record<string, string> = { 'content-type': TYPES[ext] ?? 'application/octet-stream' };
    if (COMPRESS.has(ext) && /gzip/.test(String(req.headers['accept-encoding']))) {
      const cached = gzCache.get(path) ?? gzipSync(body, { level: 6 });
      gzCache.set(path, cached);
      body = cached;
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  })();
});
await new Promise<void>((r) => server.listen(0, r));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://localhost:${port}/`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results: { paint: number; title: number; tomb: number; bytes: number; total: number }[] = [];
try {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      // A returning player's settings, so the first-run benchmark does not count as loading.
      localStorage.setItem(
        'nc.settings',
        JSON.stringify({ quality: 'mobile', qualitySource: 'user', version: 3, renderer: 'webgl2' }),
      );
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: rtt,
      downloadThroughput: (downMbps * 1e6) / 8,
      uploadThroughput: (1.5e6 / 8) * 1,
    });
    let bytes = 0;
    cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => (bytes += e.encodedDataLength));
    const t0 = Date.now();
    await page.goto(base, { waitUntil: 'commit' });
    await page.waitForFunction(
      () => performance.getEntriesByName('first-contentful-paint').length > 0,
      null,
      {
        polling: 50,
        timeout: 120_000,
      },
    );
    const paint = await page.evaluate(
      () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0,
    );
    await page.waitForFunction(() => document.querySelector('#start.live') !== null, null, {
      polling: 50,
      timeout: 300_000,
    });
    const title = (Date.now() - t0) / 1000;
    const bytesAtTitle = bytes;
    await page.waitForFunction(() => document.querySelector('#start.ready') !== null, null, {
      polling: 100,
      timeout: 300_000,
    });
    const tomb = (Date.now() - t0) / 1000;
    if (process.argv.includes('--detail')) {
      const entries = await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((e) => {
            const r = e as PerformanceResourceTiming;
            return {
              name: r.name.replace(location.origin, ''),
              end: r.responseEnd / 1000,
              size: r.encodedBodySize,
            };
          })
          .sort((a, b) => a.end - b.end),
      );
      for (const e of entries)
        console.log(
          `  ${e.end.toFixed(2).padStart(6)} s ${(e.size / 1024).toFixed(0).padStart(6)} kB  ${e.name}`,
        );
    }
    results.push({ paint: paint / 1000, title, tomb, bytes: bytesAtTitle, total: bytes });
    console.log(
      `run ${i + 1}: first paint ${(paint / 1000).toFixed(2)} s · title usable ${title.toFixed(2)} s (${(bytesAtTitle / 1e6).toFixed(1)} MB) · tomb ready ${tomb.toFixed(2)} s (${(bytes / 1e6).toFixed(1)} MB)`,
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const title = median(results.map((r) => r.title));
console.log(
  `median on ${downMbps} Mbps / ${rtt} ms: first paint ${median(results.map((r) => r.paint)).toFixed(2)} s, title usable ${title.toFixed(2)} s (budget ${budget} s), tomb ready ${median(results.map((r) => r.tomb)).toFixed(2)} s`,
);
process.exit(title <= budget ? 0 : 1);
