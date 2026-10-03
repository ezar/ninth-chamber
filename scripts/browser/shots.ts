/**
 * Reference shots per room (CLAUDE.md: regenerate after any visual change and
 * compare with the concepts in docs/art/). Stands Nora in the middle of each
 * room and captures the view behind her, at each tier asked for.
 *
 *   pnpm build && pnpm shots [--levels clay_archive] [--tiers high,mobile] [--out shots] [--url …]
 *
 * Writes <out>/<level>/<room>-<tier>.png (shots/ is not committed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { levelIds } from '../../src/levels';
import { arg, launch, openLevel, roomStands, serve, standAt } from './game';

const url = arg('url', '') || null;
const levels = arg('levels', '') ? arg('levels', '').split(',') : levelIds();
const tiers = arg('tiers', 'high,mobile').split(',') as ('high' | 'medium' | 'mobile')[];
const out = arg('out', 'shots');

const { base, stop } = await serve(url);
const browser = await launch();
try {
  for (const level of levels) {
    mkdirSync(join(out, level), { recursive: true });
    for (const tier of tiers) {
      const viewport = tier === 'mobile' ? { width: 844, height: 390 } : { width: 1280, height: 720 };
      const s = await openLevel(browser, base, level, tier, viewport);
      for (const r of await roomStands(s.page)) {
        await standAt(s.page, r.cx, r.cz, 0, 5000);
        const file = join(out, level, `${r.id}-${tier}.png`);
        writeFileSync(file, await s.page.screenshot());
        console.log(file);
      }
      await s.context.close();
    }
  }
} finally {
  await browser.close();
  stop();
}
