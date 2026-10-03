/**
 * Shared harness for the browser tools (pnpm smoke, pnpm shots): serves the
 * built game (or uses --url), opens it in headless Chromium on the WebGL 2
 * backend (software rendering where there is no GPU) and drives it through
 * the debug handle `window.__nc`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};

/** Serves dist/ with `vite preview` unless a URL is given; returns the base URL and a stop function. */
export async function serve(url: string | null): Promise<{ base: string; stop: () => void }> {
  if (url) return { base: url.endsWith('/') ? url : `${url}/`, stop: () => undefined };
  const port = 4300 + Math.floor(Math.random() * 500);
  const child: ChildProcess = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    stdio: 'ignore',
  });
  const base = `http://localhost:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base);
      if (r.ok) return { base, stop: () => child.kill() };
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('vite preview did not start (run pnpm build first)');
}

export async function launch(): Promise<Browser> {
  return chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Console errors and warnings, and page errors, as seen. */
  problems: string[];
}

/** Opens a level at a tier on WebGL 2, waits for it to load and enters play past the intro. */
export async function openLevel(
  browser: Browser,
  base: string,
  level: string,
  tier: 'high' | 'medium' | 'mobile',
  viewport = { width: 960, height: 540 },
): Promise<Session> {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((t) => {
    localStorage.setItem(
      'nc.settings',
      JSON.stringify({ quality: t, qualitySource: 'user', version: 3, renderer: 'webgl2' }),
    );
  }, tier);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    // The software renderer's own chatter is not the game's.
    if (/GL Driver Message|swiftshader|GroupMarkerNotSet|fonts\.googleapis|ERR_CERT|net::ERR_/i.test(text))
      return;
    problems.push(`${m.type()}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}?level=${level}`);
  await page.waitForFunction(
    () => !!(window as unknown as { __nc?: { loading: { isReady: boolean } } }).__nc?.loading.isReady,
    null,
    { timeout: 600_000 },
  );
  await page.evaluate(() => {
    const nc = (window as unknown as { __nc: { drs: { update: () => null } } }).__nc;
    nc.drs.update = () => null;
  });
  await page.waitForFunction(
    () => {
      const nc = (
        window as unknown as {
          __nc: { prelude?: { skip?: () => void }; phase: string; start: () => void; skipIntro: () => void };
        }
      ).__nc;
      nc.prelude?.skip?.();
      if (nc.phase === 'title') nc.start();
      nc.skipIntro();
      return nc.phase === 'play';
    },
    null,
    { polling: 500, timeout: 600_000 },
  );
  return { context, page, problems };
}

/** The level's rooms with a standing cell in each (its most central open floor). */
export async function roomStands(page: Page): Promise<{ id: string; cx: number; cz: number }[]> {
  return page.evaluate(() => {
    type Sector = { wall: boolean; pit: boolean; room: string };
    const nc = (
      window as unknown as {
        __nc: {
          world: {
            level: {
              rooms: { id: string; minX: number; maxX: number; minZ: number; maxZ: number }[];
              sector(x: number, z: number): Sector | undefined;
            };
            grid: { floorAt(x: number, z: number): number };
          };
        };
      }
    ).__nc;
    const lv = nc.world.level;
    const out: { id: string; cx: number; cz: number }[] = [];
    for (const r of lv.rooms) {
      const mx = (r.minX + r.maxX) / 2;
      const mz = (r.minZ + r.maxZ) / 2;
      let best: { cx: number; cz: number; d: number } | null = null;
      for (let cz = r.minZ; cz < r.maxZ; cz++)
        for (let cx = r.minX; cx < r.maxX; cx++) {
          const s = lv.sector(cx, cz);
          if (!s || s.wall || s.pit || s.room !== r.id) continue;
          if (!Number.isFinite(nc.world.grid.floorAt(cx * 2 + 1, cz * 2 + 1))) continue;
          const d = Math.hypot(cx + 0.5 - mx, cz + 0.5 - mz);
          if (!best || d < best.d) best = { cx, cz, d };
        }
      if (best) out.push({ id: r.id, cx: best.cx, cz: best.cz });
    }
    return out;
  });
}

/** Stands Nora at the centre of a cell, the camera behind her, and lets a few frames settle. */
export async function standAt(page: Page, cx: number, cz: number, yaw = 0, settle = 2500): Promise<void> {
  await page.evaluate(
    ([x, z, y]) => {
      const nc = (
        window as unknown as {
          __nc: {
            world: {
              state: {
                player: {
                  pos: { x: number; y: number; z: number };
                  vel: { x: number; y: number; z: number };
                  yaw: number;
                };
              };
              grid: { floorAt(x: number, z: number): number };
            };
            camera: { yaw: number; recenter(y: number): void };
          };
        }
      ).__nc;
      const p = nc.world.state.player;
      p.pos.x = x * 2 + 1;
      p.pos.z = z * 2 + 1;
      p.pos.y = nc.world.grid.floorAt(p.pos.x, p.pos.z);
      p.vel.x = p.vel.y = p.vel.z = 0;
      p.yaw = y;
      nc.camera.yaw = y;
      nc.camera.recenter(y);
    },
    [cx, cz, yaw] as const,
  );
  await page.waitForTimeout(settle);
}
