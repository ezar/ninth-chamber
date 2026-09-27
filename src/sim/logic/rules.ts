/**
 * Declarative level logic (spec §8): `when → do` rules over named signals
 * and flags. Rules fire on the rising edge of their condition.
 */
import type { RuleFile } from '../grid/schema';
import { extinguishTorch } from '../player/torch';
import { findActor, resetBlock, saveCheckpoint, type World } from '../world';
import { evalExpr, parseExpr, parseSeconds, type Expr } from './expr';
import { runWaterAction } from '../actors/water';

export interface CompiledRule {
  index: number;
  when: Expr;
  actions: string[];
  once: boolean;
}

export function compileRules(rules: readonly RuleFile[]): CompiledRule[] {
  return rules.map((r, index) => ({ index, when: parseExpr(r.when), actions: r.do, once: r.once }));
}

/** Current value of a signal or flag name. */
export function signal(world: World, name: string): boolean {
  return world.state.signals[name] === true || world.state.flags.includes(name);
}

/** Sets a signal; rules see the change on the next logic pass. */
export function setSignal(world: World, name: string, value: boolean): void {
  world.state.signals[name] = value;
}

/** Runs rules whose condition just became true, and queued actions whose wait has elapsed. */
export function runLogic(world: World, dt: number): void {
  const { state } = world;
  const lookup = (n: string): boolean => signal(world, n);

  for (const rule of world.rules) {
    const now = evalExpr(rule.when, lookup);
    const key = `rule:${rule.index}`;
    const was = state.signals[key] === true;
    state.signals[key] = now;
    if (!now || was) continue;
    if (rule.once && state.fired.includes(rule.index)) continue;
    state.fired.push(rule.index);
    runActions(world, rule.actions);
  }

  for (const p of state.pending) p.delay -= dt;
  const due = state.pending.filter((p) => p.delay <= 0);
  state.pending = state.pending.filter((p) => p.delay > 0);
  for (const p of due) runActions(world, p.actions);
}

/** Executes a list of actions; `wait Ns` defers the rest of the list. */
export function runActions(world: World, actions: readonly string[]): void {
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] ?? '';
    const [verb = '', ...args] = action.trim().split(/\s+/);
    if (verb === 'wait') {
      const delay = parseSeconds(args[0]) ?? 0;
      world.state.pending.push({ delay, actions: actions.slice(i + 1) });
      return;
    }
    runAction(world, verb, args);
  }
}

function runAction(world: World, verb: string, args: string[]): void {
  const tick = world.tick;
  switch (verb) {
    case 'flag': {
      const [op, name] = args;
      if (!name) return;
      const flags = world.state.flags.filter((f) => f !== name);
      if (op === 'set') flags.push(name);
      world.state.flags = flags;
      return;
    }
    case 'camera.focus':
      world.events.emit({
        type: 'camera.focus',
        tick,
        target: args[0],
        duration: parseSeconds(args[1]) ?? 2,
      });
      return;
    case 'sfx':
      world.events.emit({ type: 'sfx', tick, name: args[0] });
      return;
    case 'music':
      world.events.emit({ type: 'music', tick, name: args[0] });
      return;
    case 'hint':
      world.events.emit({ type: 'hint', tick, key: args[0] });
      return;
    case 'checkpoint':
      saveCheckpoint(world);
      return;
    case 'level.end':
      world.ended = true;
      world.events.emit({ type: 'level.end', tick });
      return;
    case 'torch.extinguish':
      extinguishTorch(world, 'rule');
      return;
  }

  // "<id>.<verb>": actions on actors.
  const dot = verb.lastIndexOf('.');
  if (dot > 0) {
    const id = verb.slice(0, dot);
    const op = verb.slice(dot + 1);
    if (runWaterAction(world, id, op, args)) return;
    const door = findActor(world, id, 'door');
    if (door) {
      const target =
        op === 'open' ? 1 : op === 'close' ? 0 : op === 'toggle' ? (door.target === 1 ? 0 : 1) : null;
      if (target === null) return;
      const changed = door.target !== target;
      door.target = target;
      // "open 12s" closes again after the delay; a plain "open" holds (and cancels a pending close).
      door.closeIn = target === 1 ? parseSeconds(args[0]) : null;
      // Re-opening an open door or closing a closed one moves nothing, so it makes no sound.
      if (changed) world.events.emit({ type: target === 1 ? 'door.opening' : 'door.closing', tick, id });
      return;
    }
    if (op === 'reset' && findActor(world, id, 'block')) {
      resetBlock(world, id);
      return;
    }
  }
  throw new Error(`Unknown action "${[verb, ...args].join(' ')}"`);
}
