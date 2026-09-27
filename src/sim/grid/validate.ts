/**
 * Level validator (spec §16 "Validador de niveles"). Runs in the build and in
 * tests. Reachability search is a later milestone; this checks structure,
 * references and placement.
 */
import { GUARDIAN_ACTIONS, GUARDIAN_SIGNALS } from '../actors/guardian-schema';
import { exprNames, parseExpr } from '../logic/expr';
import { MECHANISM_ACTIONS, isMechanismSignal } from '../mechanisms/schema';
import { validateMechanisms } from '../mechanisms/validate';
import { enemyTypes } from '../player/tuning';
import { Level } from './level';
import { levelSchema } from './schema';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** Signals each entity type emits, by suffix. */
const SIGNALS: Record<string, string[]> = {
  lever: ['used'],
  plate: ['pressed'],
  zone: ['entered'],
  door: ['open'],
  note: ['read'],
  secret: ['taken'],
  relic: ['taken'],
  enemy: ['dead'],
  torch: ['taken'],
  watergate: ['high', 'low'],
  brazier: ['lit'],
  flares: ['taken'],
};

const ACTIONS_ON: Record<string, string[]> = {
  door: ['open', 'close', 'toggle'],
  block: ['reset'],
  watergate: ['raise', 'lower', 'toggle'],
};

export function validateLevel(json: unknown, i18nKeys?: ReadonlySet<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = levelSchema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`schema: ${issue.path.join('.')}: ${issue.message}`);
    return { errors, warnings };
  }
  const file = parsed.data;

  let level: Level;
  try {
    level = new Level(file);
  } catch (e) {
    errors.push(`build: ${(e as Error).message}`);
    return { errors, warnings };
  }

  const ids = new Map<string, string>();
  for (const e of file.entities) {
    if (ids.has(e.id)) errors.push(`entity '${e.id}' is defined twice`);
    ids.set(e.id, e.type);
  }

  for (const e of level.entities) {
    const [cx, cz] = e.at;
    const s = level.sector(cx, cz);
    if (!s) {
      errors.push(`entity '${e.id}' is outside every room`);
      continue;
    }
    if (s.wall && e.type !== 'zone' && e.type !== 'receiver')
      errors.push(`entity '${e.id}' is inside a wall`);
    if (e.type === 'enemy') {
      const stats = enemyTypes[e.enemy];
      if (s.pit || s.flags.has('death')) errors.push(`enemy '${e.id}' starts on a pit or a deadly sector`);
      if (s.ceil - Math.max(...s.floor) < stats.height) errors.push(`enemy '${e.id}' has no headroom`);
    }
    if (e.type === 'lever') {
      const n = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[e.wall];
      const behind = level.sector(cx + (n?.[0] ?? 0), cz + (n?.[1] ?? 0));
      if (behind && !behind.wall) errors.push(`lever '${e.id}' is not against a wall on its ${e.wall} side`);
    }
    if (e.type === 'note') {
      if (e.wall) {
        const n = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }[e.wall];
        const behind = level.sector(cx + (n?.[0] ?? 0), cz + (n?.[1] ?? 0));
        if (behind && !behind.wall) errors.push(`note '${e.id}' is not against a wall on its ${e.wall} side`);
      }
      for (const part of ['meta', 'title', 'body']) {
        const key = `${e.text}.${part}`;
        if (i18nKeys && !i18nKeys.has(key)) errors.push(`note '${e.id}': missing i18n key '${key}'`);
      }
    }
    if (e.type === 'watergate') {
      for (const r of e.rooms ?? [e.room]) {
        if (!level.rooms.some((x) => x.id === r))
          errors.push(`watergate '${e.id}' floods unknown room '${r}'`);
      }
      if (e.low >= e.high) errors.push(`watergate '${e.id}' has low >= high`);
    }
  }

  const start = level.sector(level.start.x, level.start.z);
  if (!start || start.wall) errors.push('the start is not on a floor sector');
  else if (start.flags.has('death')) errors.push('the start is on a deadly sector');

  const known = (name: string): boolean => {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return true; // flags
    const type = ids.get(name.slice(0, dot));
    const suffix = name.slice(dot + 1);
    if (type === 'guardian') return GUARDIAN_SIGNALS.includes(suffix);
    return type !== undefined && ((SIGNALS[type] ?? []).includes(suffix) || isMechanismSignal(type, suffix));
  };

  file.logic.forEach((rule, i) => {
    try {
      for (const n of exprNames(parseExpr(rule.when))) {
        if (!known(n)) errors.push(`rule ${i}: unknown signal '${n}'`);
      }
    } catch (e) {
      errors.push(`rule ${i}: ${(e as Error).message}`);
    }
    for (const action of rule.do) {
      const [verb = '', ...args] = action.split(/\s+/);
      if (['flag', 'sfx', 'music', 'checkpoint', 'level.end', 'wait', 'torch.extinguish'].includes(verb))
        continue;
      if (verb === 'hint') {
        if (i18nKeys && args[0] && !i18nKeys.has(args[0]))
          errors.push(`rule ${i}: missing i18n key '${args[0]}'`);
        continue;
      }
      if (verb === 'water.set') {
        if (!file.rooms.some((r) => r.id === args[0]) || !Number.isInteger(Number(args[1])))
          errors.push(`rule ${i}: bad action '${action}'`);
        continue;
      }
      if (verb === 'camera.focus') {
        if (!args[0] || !ids.has(args[0]))
          errors.push(`rule ${i}: camera.focus on unknown id '${args[0] ?? ''}'`);
        continue;
      }
      const dot = verb.lastIndexOf('.');
      const type = dot > 0 ? ids.get(verb.slice(0, dot)) : undefined;
      const allowed = [
        ...(ACTIONS_ON[type ?? ''] ?? []),
        ...(MECHANISM_ACTIONS[type ?? ''] ?? []),
        ...(type === 'guardian' ? GUARDIAN_ACTIONS : []),
      ];
      if (!type || !allowed.includes(verb.slice(dot + 1))) {
        errors.push(`rule ${i}: unknown action '${action}'`);
      }
    }
  });

  validateMechanisms(level, i18nKeys, errors, warnings);

  const packs = new Map<string, number>();
  for (const e of file.entities)
    if (e.type === 'enemy' && e.pack) packs.set(e.pack, (packs.get(e.pack) ?? 0) + 1);
  for (const [pack, n] of packs) if (n < 2) warnings.push(`pack '${pack}' has a single member`);

  if (i18nKeys && !i18nKeys.has(file.name)) errors.push(`missing i18n key '${file.name}' for the level name`);
  if (!file.entities.some((e) => e.type === 'relic')) warnings.push('the level has no relic');
  const secrets = file.entities.filter((e) => e.type === 'secret').length;
  if (secrets !== 3) warnings.push(`the level has ${secrets} secrets (the spec asks for 3)`);

  return { errors, warnings };
}
