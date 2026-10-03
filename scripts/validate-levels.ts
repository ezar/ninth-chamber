/** Validates every levels/*.level.json (pnpm validate:levels). Fails on errors. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateLevel } from '../src/sim/grid/validate';
import { exprNames, parseExpr } from '../src/sim/logic/expr';
import { validateHints } from '../src/sim/hints/hints';

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
// Nora's ideas: rooms, signals (as the level's rules use them) and i18n keys must exist.
for (const file of readdirSync(dir).filter((f) => f.endsWith('.hints.json'))) {
  const id = file.replace(/\.hints\.json$/, '');
  const level = JSON.parse(readFileSync(join(dir, `${id}.level.json`), 'utf8')) as {
    rooms: { id: string }[];
    logic: { when: string }[];
  };
  const names = new Set(level.logic.flatMap((r) => exprNames(parseExpr(r.when))));
  const errors = validateHints(
    JSON.parse(readFileSync(join(dir, file), 'utf8')),
    new Set(level.rooms.map((r) => r.id)),
    names,
    i18n,
  );
  for (const e of errors) console.error(`${file}: error: ${e}`);
  if (errors.length) failed = true;
  else console.log(`${file}: ok`);
}
process.exit(failed ? 1 : 0);
