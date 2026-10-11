/**
 * Offline play (spec §14 "PWA": the game works offline once downloaded): loads
 * the built game once, waits for the service worker to take control and finish
 * its precache, then cuts the network, reloads, and checks that the title and
 * the first room come up with no errors, and that every other chamber loads
 * as itself (a chamber that fails to load falls back to the first one).
 *
 *   pnpm build && pnpm offline [--url http://localhost:4173/]
 */
import { CHAMBERS } from '../../src/ui/campaign';
import { levelUrl } from '../../src/levels';
import { arg, launch, serve } from './game';

const url = arg('url', '') || null;
const { base, stop } = await serve(url);
const browser = await launch();
let ok: boolean;
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await context.addInitScript(() => {
    localStorage.setItem(
      'nc.settings',
      JSON.stringify({ quality: 'mobile', qualitySource: 'user', version: 3, renderer: 'webgl2' }),
    );
  });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  let where = 'online';
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/fonts\.(googleapis|gstatic)|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(m.text())
    )
      problems.push(`${where}: ${m.text().slice(0, 200)}`);
  });
  const ready = (): Promise<unknown> =>
    page.waitForFunction(() => document.querySelector('#start.ready') !== null, null, { timeout: 600_000 });

  // Online: the worker registers after loading and precaches the first room.
  await page.goto(base);
  await ready();
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
      );
    return reg.active?.state;
  });
  await page.waitForFunction(
    () => document.getElementById('offline-status')?.dataset.i18n === 'offline.ready',
    null,
    {
      timeout: 600_000,
    },
  );
  console.log('online: loaded, service worker in control, title says it plays offline');

  // Offline: reload and play.
  // The browser's offline switch does not reach the service worker's own requests: a local
  // server is stopped too, so nothing can come from the network.
  await context.setOffline(true);
  if (!url) stop();
  where = 'offline';
  await page.reload();
  await ready();
  console.log('offline: title ready');
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
    { polling: 500, timeout: 120_000 },
  );
  await page.waitForTimeout(2000);
  console.log('offline: in the first room');
  for (const chamber of CHAMBERS.slice(1)) {
    const id = chamber.level;
    if (!id) continue;
    where = `chamber ${chamber.numeral}`;
    await page.goto(levelUrl(base, id));
    await page.waitForFunction(
      () => (window as unknown as { __nc?: { loading: { isReady: boolean } } }).__nc?.loading.isReady,
      null,
      { timeout: 300_000 },
    );
    const got = await page.evaluate(
      () => (window as unknown as { __nc: { world: { level: { id: string } } } }).__nc.world.level.id,
    );
    await page.waitForTimeout(3000);
    if (got !== id) problems.push(`offline: chamber ${chamber.numeral} (${id}) opened ${got}`);
    else console.log(`offline: chamber ${chamber.numeral} (${id})`);
  }
  ok = problems.length === 0;
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
} finally {
  await browser.close();
  stop();
}
console.log(ok ? 'ok   offline play' : 'FAIL offline play');
process.exit(ok ? 0 : 1);
