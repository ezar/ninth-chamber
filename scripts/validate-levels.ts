/** Validates every levels/*.level.json (pnpm validate:levels). Fails on errors. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateLevel } from '../src/sim/grid/validate';

const dir = join(import.meta.dirname, '..', 'levels');
const i18n = new Set(
  Object.keys(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'i18n', 'en.json'), 'utf8'))),
);
let failed = false;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.level.json'))) {
  const { errors, warnings } = validateLevel(JSON.parse(readFileSync(join(dir, file), 'utf8')), i18n);
  for (const w of warnings) console.warn(`${file}: warning: ${w}`);
  for (const e of errors) console.error(`${file}: error: ${e}`);
  if (errors.length) failed = true;
  else console.log(`${file}: ok`);
}
process.exit(failed ? 1 : 0);
