/**
 * The torch (owner's request): picked up with Action, lit at a burning
 * brazier (or found lit), put away and taken out with the torch button.
 *
 * Moves that need both hands (hanging, climbing, holding, pushing and pulling
 * a block, pulling a lever) put it on her belt, still burning; it comes back
 * to her hand when she is free, unless she put it away herself. Water over
 * the flame, or the `torch.extinguish` rule action, puts it out.
 *
 * While the lit torch is in her hand the `torchLit` signal is true, for level
 * rules (a dark passage that reacts to it), and only the right pistol can be
 * used (see weapons.ts).
 *
 * Events: `torch.picked` { id }, `torch.lit` { from }, `torch.stowed` { auto },
 * `torch.drawn` { auto, lit }, `torch.out` { cause }.
 */
import { waterSurface } from '../actors/water';
import { BLOCK, cellCenter } from '../grid/units';
import type { BrazierActor, PickupActor, PlayerMode, PlayerState, TorchState } from '../state';
import type { World } from '../world';
import { emit, type Ctx } from './context';
import { torch as T } from './tuning';

/** Moves that need both hands: the torch goes on her belt meanwhile. */
const TWO_HANDED: ReadonlySet<PlayerMode> = new Set([
  'hang',
  'wall',
  'climb',
  'block',
  'push',
  'pull',
  'lever',
  'rope',
]);

/** The signal level rules read while the lit torch is in her hand. */
export const TORCH_LIT = 'torchLit';

export const newTorch = (): TorchState => ({ has: false, lit: false, stowed: false, away: false });

/** The torch is in her left hand (lit or not). */
export function torchInHand(p: PlayerState): boolean {
  return p.torch.has && !p.torch.stowed;
}

/** The lit torch is in her hand: it lights the way. */
export function torchLight(p: PlayerState): boolean {
  return torchInHand(p) && p.torch.lit;
}

/**
 * The burning brazier Action would light her torch at: she stands on the
 * ground carrying an unlit torch, within reach of it. Null otherwise.
 */
export function brazierInReach(world: World): BrazierActor | null {
  const p = world.state.player;
  if (!p.torch.has || p.torch.lit || p.mode !== 'ground') return null;
  let best: BrazierActor | null = null;
  let bestD = T.lightReach;
  for (const a of world.state.actors) {
    if (a.kind !== 'brazier' || !a.lit || Math.abs(a.y - p.pos.y) > T.lightHeight) continue;
    const d = Math.hypot(cellCenter(a.cx) - p.pos.x, cellCenter(a.cz) - p.pos.z);
    if (d <= bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** Action next to a burning brazier: lights the torch (and takes it out if it was put away). */
export function tryLightTorch(c: Ctx): boolean {
  const b = brazierInReach(c.world);
  if (!b) return false;
  const t = c.p.torch;
  t.lit = true;
  t.away = false;
  emit(c, 'torch.lit', { from: b.id });
  return true;
}

/** Takes a torch from the floor (halfway through the crouch). */
export function pickTorch(c: Ctx, a: PickupActor): void {
  const t = c.p.torch;
  const wasLit = t.has && t.lit;
  t.has = true;
  t.away = false;
  t.lit = wasLit || a.variant === 'lit';
  emit(c, 'torch.picked', { id: a.id });
  if (t.lit && !wasLit) emit(c, 'torch.lit', { from: a.id });
}

/** Puts the flame out (water, or the `torch.extinguish` rule action). */
export function extinguishTorch(world: World, cause: string): void {
  const t = world.state.player.torch;
  if (!t.has || !t.lit) return;
  t.lit = false;
  world.state.signals[TORCH_LIT] = false;
  world.events.emit({ type: 'torch.out', tick: world.tick, cause });
}

/** Once per tick, after the player's mode: the torch button, two-handed moves, water and the signal. */
export function stepTorch(c: Ctx): void {
  const { p, world } = c;
  const t = p.torch;
  if (t.has && p.mode !== 'dead') {
    const button = c.pressed('torch');
    if (button) t.away = !t.away;
    const stow = t.away || TWO_HANDED.has(p.mode);
    if (stow !== t.stowed) {
      t.stowed = stow;
      emit(c, stow ? 'torch.stowed' : 'torch.drawn', { auto: !button, lit: t.lit });
    }
    if (t.lit) {
      // The live surface: sluices and tide gates move the water.
      const water = waterSurface(world, Math.floor(p.pos.x / BLOCK), Math.floor(p.pos.z / BLOCK));
      const flame = p.pos.y + (t.stowed ? T.beltHeight : T.handHeight);
      if (water != null && flame < water) extinguishTorch(world, 'water');
    }
  }
  world.state.signals[TORCH_LIT] = torchLight(p);
}
