/**
 * Browser smoke test (roadmap 0.3.0, run in CI): loads every level of the
 * built game in headless Chromium, enters play, visits each room and fails
 * on any script error or console error or warning the game produces.
 *
 *   pnpm build && pnpm smoke [--url http://localhost:5173/] [--levels a,b] [--tier mobile]
 */
import { levelIds } from '../../src/levels';
import { arg, launch, openLevel, roomStands, serve, standAt } from './game';

const url = arg('url', '') || null;
const levels = arg('levels', '') ? arg('levels', '').split(',') : levelIds();
const tier = arg('tier', 'mobile') as 'high' | 'medium' | 'mobile';

const { base, stop } = await serve(url);
const browser = await launch();
let failed = false;
try {
  for (const level of levels) {
    const t0 = Date.now();
    const s = await openLevel(browser, base, level, tier);
    // Fresh in the chamber, Nora has no idea yet: the pause menu must not offer to ask her.
    await s.page.keyboard.press('Escape');
    await s.page.waitForSelector('#menu:not([hidden])', { timeout: 5000 });
    if (await s.page.locator('[data-action="hint"]').isVisible())
      s.problems.push('pause menu: "Ask Nora" visible with no idea to give');
    await s.page.keyboard.press('Escape');
    await s.page.waitForSelector('#menu', { state: 'hidden', timeout: 5000 });
    const rooms = await roomStands(s.page);
    for (const r of rooms) await standAt(s.page, r.cx, r.cz, 0, 1200);
    const ok = s.problems.length === 0;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${level}: ${rooms.length} rooms in ${((Date.now() - t0) / 1000).toFixed(0)} s`,
    );
    for (const p of s.problems.slice(0, 20)) console.log(`     ${p}`);
    if (!ok) failed = true;
    await s.context.close();
  }
} finally {
  await browser.close();
  stop();
}
process.exit(failed ? 1 : 0);
