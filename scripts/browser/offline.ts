/**
 * Offline play (spec §14 "PWA": the game works offline once downloaded): loads
 * the built game once, waits for the service worker to take control and finish
 * its precache, then cuts the network, reloads, and checks that the title and
 * the first room come up with no errors.
 *
 *   pnpm build && pnpm offline [--url http://localhost:4173/]
 */
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
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/fonts\.(googleapis|gstatic)|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(m.text())
    )
      problems.push(`error: ${m.text().slice(0, 200)}`);
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
  console.log('online: loaded, service worker in control');

  // Offline: reload and play.
  await context.setOffline(true);
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
  ok = problems.length === 0;
  for (const p of problems.slice(0, 10)) console.log(`  ${p}`);
} finally {
  await browser.close();
  stop();
}
console.log(ok ? 'ok   offline play' : 'FAIL offline play');
process.exit(ok ? 0 : 1);
