/**
 * Dual pistols and medkits (spec §7 "Armas", "Reglas de apuntado", "Salud").
 *
 * Weapons are drawn and holstered with the weapons button; pressing Fire
 * with them holstered draws them too (touch has no weapons button). They
 * only work on the ground and in the air: any other mode holsters them.
 *
 * Holding Fire locks the nearest living enemy in range with line of sight
 * and keeps it while it stays visible; the target button cycles to the next
 * one. Shots alternate hands every `cadence` seconds; each one at a target
 * rolls world.rng against the hit chance. With no target Nora fires ahead
 * with no effect. Nora keeps running while she shoots (the arms and torso
 * aim); standing still, she turns towards the target.
 */
import { alertEnemy, clearLine, damageEnemy, enemyCenter, findEnemy, makeNoise } from '../actors/enemies';
import { wrapAngle } from '../grid/units';
import type { EnemyState, PlayerState } from '../state';
import type { World } from '../world';
import { emit, type Ctx } from './context';
import { medkits, noise, tuning, weapons } from './tuning';

const ARMED_MODES: ReadonlySet<PlayerState['mode']> = new Set(['ground', 'air']);

/** Nora's aiming point: eyes and pistols (m). */
export function aimOrigin(p: PlayerState): { x: number; y: number; z: number } {
  return { x: p.pos.x, y: p.pos.y + weapons.aimHeight, z: p.pos.z };
}

/** A living enemy within pistol range and with a clear line of sight. */
export function canTarget(world: World, e: EnemyState): boolean {
  if (e.mode === 'dead') return false;
  const from = aimOrigin(world.state.player);
  const to = enemyCenter(e);
  if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) > weapons.pistols.range) return false;
  return clearLine(world, from, to);
}

/** Visible targets, nearest first (ties by id, for determinism). */
export function visibleTargets(world: World): EnemyState[] {
  const p = world.state.player.pos;
  const d = (e: EnemyState): number => Math.hypot(e.pos.x - p.x, e.pos.y - p.y, e.pos.z - p.z);
  return world.state.enemies
    .filter((e) => canTarget(world, e))
    .sort((a, b) => d(a) - d(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Yaw from Nora to a point, in the player's convention (0 faces -Z). */
const yawTo = (p: PlayerState, x: number, z: number): number => Math.atan2(-(x - p.pos.x), -(z - p.pos.z));

export function stepWeapons(c: Ctx): void {
  const { p, world, dt } = c;
  const w = p.weapon;
  w.busy = Math.max(0, w.busy - dt);
  w.cooldown -= dt;

  if (!ARMED_MODES.has(p.mode)) {
    if (w.drawn) holster(c, true);
    w.target = null;
    w.cooldown = Math.max(0, w.cooldown);
    return;
  }

  if (c.pressed('weapons')) {
    if (w.drawn) holster(c, false);
    else draw(c);
  } else if (!w.drawn && c.pressed('fire')) {
    draw(c);
  }
  if (!w.drawn || !c.held('fire')) {
    w.target = null;
    w.cooldown = Math.max(0, w.cooldown);
    return;
  }

  // Target lock: kept while visible; the target button cycles through the visible ones.
  let target = w.target ? findEnemy(world, w.target) : undefined;
  if (target && !canTarget(world, target)) target = undefined;
  if (!target || c.pressed('target')) {
    const list = visibleTargets(world);
    if (target && list.length > 1) {
      const i = list.findIndex((e) => e.id === target?.id);
      target = list[(i + 1) % list.length];
    } else {
      target = target ?? list[0];
    }
  }
  w.target = target?.id ?? null;

  let inArc = true;
  if (target) {
    const yaw = yawTo(p, target.pos.x, target.pos.z);
    // Standing still, Nora turns to face her target; running, only the torso and arms follow it.
    if (p.mode === 'ground' && c.wish.mag < 0.05) {
      const diff = wrapAngle(yaw - p.yaw);
      const max = weapons.aimTurnSpeed * dt;
      p.yaw = wrapAngle(p.yaw + Math.max(-max, Math.min(max, diff)));
    }
    inArc = Math.abs(wrapAngle(yaw - p.yaw)) <= weapons.aimArc;
  }

  if (w.busy > 1e-9 || !inArc || w.cooldown > 1e-9) {
    w.cooldown = Math.max(0, w.cooldown);
    return;
  }
  fire(c, target ?? null);
  w.cooldown = Math.max(w.cooldown, -dt) + weapons.pistols.cadence;
}

function draw(c: Ctx): void {
  const w = c.p.weapon;
  w.drawn = true;
  w.busy = weapons.drawTime;
  w.cooldown = Math.max(0, w.cooldown);
  emit(c, 'weapons.drawn');
}

function holster(c: Ctx, auto: boolean): void {
  const w = c.p.weapon;
  w.drawn = false;
  w.busy = weapons.drawTime;
  w.target = null;
  if (c.p.mode !== 'dead') emit(c, 'weapons.holstered', { auto });
}

function fire(c: Ctx, target: EnemyState | null): void {
  const { p, world } = c;
  const w = p.weapon;
  const hand = w.hand;
  w.hand = hand === 0 ? 1 : 0;
  world.stats.shots++;
  // Only shots at a target roll the RNG: the hit chance needs line of sight, which canTarget ensured.
  const hit = target !== null && world.rng.next() < weapons.pistols.hitChance;
  emit(c, 'weapon.fired', { hand, target: target?.id ?? null, hit });
  makeNoise(world, p.pos, noise.shot);
  if (!target) return;
  if (!target.aware) alertEnemy(world, target, 'noise');
  if (hit) {
    world.stats.hits++;
    damageEnemy(world, target, weapons.pistols.damage);
  }
}

/**
 * Medkit button: uses the smallest kit that heals fully, or the largest one
 * available when none does. Nothing happens at full health.
 */
export function stepMedkit(c: Ctx): void {
  const { p, world } = c;
  if (!c.pressed('medkit') || p.mode === 'dead') return;
  const missing = tuning.maxHealth - p.health;
  if (missing <= 0) return;
  const inv = world.state.inventory;
  const small = inv.medkit_small ?? 0;
  const large = inv.medkit_large ?? 0;
  let size: 'small' | 'large' | null = null;
  if (small > 0 && missing <= medkits.small) size = 'small';
  else if (large > 0) size = 'large';
  else if (small > 0) size = 'small';
  if (!size) {
    emit(c, 'medkit.none');
    return;
  }
  inv[`medkit_${size}`] = (inv[`medkit_${size}`] ?? 0) - 1;
  const heal = Math.min(missing, medkits[size]);
  p.health += heal;
  world.stats.medkitsUsed++;
  emit(c, 'medkit.used', { size, heal });
}
