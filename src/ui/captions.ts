/**
 * Subtitles for the sounds that matter (spec §13 "Accesibilidad"): "[Stone
 * rumbling, left]", and a visual mark at the screen edge when a trap arms, so
 * nothing the game says only with sound is lost to a player who cannot hear it.
 * Only listens to sim events. `captionFor` is pure and tested in Node.
 */
import type { SimEvent } from '../core/events';
import type { StringKey } from './i18n';

export type CaptionSize = 'small' | 'medium' | 'large';
export const CAPTION_SIZES: readonly CaptionSize[] = ['small', 'medium', 'large'];

export type Side = 'left' | 'right' | 'ahead' | 'behind' | 'near';

interface CaptionDef {
  key: StringKey;
  /** A trap arming or about to fire: also gets the visual mark. */
  trap?: boolean;
  /** Seconds the same caption from the same source stays quiet after it shows (repeating sounds). */
  quiet?: number;
}

const CAPTIONS: Record<string, CaptionDef> = {
  'boulder.warning': { key: 'caption.boulderWarning', trap: true },
  'boulder.rolling': { key: 'caption.boulderRolling', quiet: 6 },
  'boulder.crashed': { key: 'caption.boulderCrashed' },
  'darts.click': { key: 'caption.dartsClick', trap: true },
  'darts.fired': { key: 'caption.dartsFired' },
  'tile.cracked': { key: 'caption.tileCracked', trap: true, quiet: 2 },
  'tile.fell': { key: 'caption.tileFell', quiet: 2 },
  'fire.warn': { key: 'caption.fireWarn', trap: true, quiet: 8 },
  'blade.swish': { key: 'caption.bladeSwish', quiet: 8 },
  'trapdoor.closing': { key: 'caption.trapdoorClosing', trap: true },
  'door.opening': { key: 'caption.doorOpening' },
  'door.closing': { key: 'caption.doorClosing' },
  'door.tick': { key: 'caption.doorTick', quiet: 30 },
  'block.falling': { key: 'caption.blockFalling' },
  'water.moving': { key: 'caption.waterMoving', quiet: 6 },
  'platform.started': { key: 'caption.platformStarted', quiet: 4 },
  'guardian.windup': { key: 'caption.guardianWindup', trap: true, quiet: 1 },
  'guardian.step': { key: 'caption.guardianStep', quiet: 10 },
  'guardian.burned': { key: 'caption.guardianBurned' },
  'bronze.warn': { key: 'caption.bronzeWarn', trap: true, quiet: 4 },
  'bronze.pour': { key: 'caption.bronzePour', quiet: 3 },
  'bronze.cooled': { key: 'caption.bronzeCooled', quiet: 3 },
  'heat.enter': { key: 'caption.heat', quiet: 8 },
  'torch.out': { key: 'caption.torchOut' },
  'flare.out': { key: 'caption.flareOut' },
};

const ENEMY_CAPTIONS: Record<string, Partial<Record<string, StringKey>>> = {
  'enemy.alerted': {
    jackal: 'caption.jackalAlerted',
    clay: 'caption.clayAlerted',
    automaton: 'caption.automatonAlerted',
  },
  'enemy.quenched': { automaton: 'caption.automatonQuenched' },
  'enemy.melted': { automaton: 'caption.automatonMelted' },
  'enemy.crumbled': { clay: 'caption.clayCrumbled' },
  'enemy.reformed': { clay: 'caption.clayReformed' },
  'enemy.dissolved': { clay: 'caption.clayDissolved' },
};

/** Sounds further than this are not captioned: the player would not hear them either. */
export const CAPTION_RANGE = 22;
/** Closer than this, a sound has no side worth naming. */
const NEAR = 2.5;

export interface Caption {
  key: StringKey;
  trap: boolean;
  quiet: number;
  side: Side;
  /** Screen-space angle of the source, radians: 0 straight ahead, positive to the right. */
  angle: number;
  /** Identity for repeats: the event type and its source. */
  source: string;
}

/**
 * The caption for an event heard at `at`, by a listener at `listener` looking
 * along camera yaw `yaw` (yaw 0 looks north, -Z), or null if it has none.
 */
export function captionFor(
  e: SimEvent,
  at: { x: number; z: number },
  listener: { x: number; z: number },
  yaw: number,
): Caption | null {
  let def: CaptionDef | undefined = CAPTIONS[e.type];
  const enemyKey = ENEMY_CAPTIONS[e.type]?.[String(e.enemy)];
  if (enemyKey) def = { key: enemyKey, quiet: 3 };
  if (!def) return null;
  const dx = at.x - listener.x;
  const dz = at.z - listener.z;
  const dist = Math.hypot(dx, dz);
  if (dist > CAPTION_RANGE) return null;
  // Camera forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin yaw).
  const forward = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  const angle = Math.atan2(right, forward);
  let side: Side = 'near';
  if (dist >= NEAR) {
    const a = Math.abs(angle);
    side = a < Math.PI / 5 ? 'ahead' : a > (Math.PI * 3) / 4 ? 'behind' : angle > 0 ? 'right' : 'left';
  }
  const id = typeof e.id === 'string' ? e.id : `${String(e.cx)},${String(e.cz)}`;
  return {
    key: def.key,
    trap: def.trap === true,
    quiet: def.quiet ?? 0,
    side,
    angle,
    source: `${e.type}|${id}`,
  };
}

/** Remembers when each source last spoke, so repeating sounds do not flood the screen. */
export class CaptionGate {
  private readonly last = new Map<string, number>();

  /** Whether `c` may show at time `now` (seconds). */
  allow(c: Caption, now: number): boolean {
    const prev = this.last.get(c.source);
    if (prev !== undefined && now - prev < Math.max(c.quiet, 1)) return false;
    this.last.set(c.source, now);
    return true;
  }

  clear(): void {
    this.last.clear();
  }
}
