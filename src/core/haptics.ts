/**
 * Haptic feedback: phone vibration (Vibration API, Android browsers) and
 * gamepad rumble (dual-rumble actuators). Presentation only: driven by
 * simulation events and touch buttons, never read by the simulation.
 * iOS Safari has no Vibration API, so phones there stay silent.
 */
import type { SimEvent } from './events';

const STORAGE_KEY = 'nc.haptics';

interface Rumble {
  /** Phone pattern in milliseconds (vibrate, pause, vibrate…). */
  phone: number | number[];
  /** Gamepad low-frequency (heavy) and high-frequency (buzz) motors, 0..1. */
  strong: number;
  weak: number;
  /** Gamepad effect duration (ms). */
  ms: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

type Actuator = {
  playEffect?: (
    type: 'dual-rumble',
    params: { duration: number; strongMagnitude: number; weakMagnitude: number },
  ) => Promise<unknown>;
};

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readEnabled();

export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
}

/** A short tick on the phone, e.g. under a pressed touch button. */
export function buzz(ms: number): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

/** Which device the player is holding decides where the feedback goes. */
export type HapticDevice = 'keyboard' | 'gamepad' | 'touch';

export class Haptics {
  device: HapticDevice = 'keyboard';

  play(r: Rumble, scale = 1): void {
    if (!enabled || scale <= 0.02) return;
    if (this.device === 'touch') {
      try {
        const p = Array.isArray(r.phone)
          ? r.phone.map((v, i) => (i % 2 === 0 ? Math.round(v * Math.max(0.4, scale)) : v))
          : Math.round(r.phone * Math.max(0.4, scale));
        navigator.vibrate?.(p);
      } catch {
        /* unsupported */
      }
    } else if (this.device === 'gamepad') {
      for (const pad of navigator.getGamepads?.() ?? []) {
        const act = (pad as (Gamepad & { vibrationActuator?: Actuator }) | null)?.vibrationActuator;
        void act
          ?.playEffect?.('dual-rumble', {
            duration: r.ms,
            strongMagnitude: Math.min(1, r.strong * scale),
            weakMagnitude: Math.min(1, r.weak * scale),
          })
          .catch(() => {});
      }
    }
  }

  onEvent(e: SimEvent, player: Vec3, positionOf?: (id: string) => Vec3 | null): void {
    const near = (id: unknown, radius: number): number => {
      const at = typeof id === 'string' && positionOf ? positionOf(id) : null;
      if (!at) return 1;
      const d = Math.hypot(at.x - player.x, at.z - player.z);
      return Math.max(0, 1 - d / radius);
    };
    const at = (ev: SimEvent, radius: number): number => {
      const x = Number(ev.x);
      const z = Number(ev.z);
      if (!Number.isFinite(x + z)) return 1;
      return Math.max(0.3, 1 - Math.hypot(x - player.x, z - player.z) / radius);
    };
    switch (e.type) {
      case 'player.landed': {
        const fall = Number(e.fall) || 0;
        if (e.hard) this.play({ phone: 70, strong: 0.9, weak: 0.5, ms: 220 });
        else if (fall > 2) this.play({ phone: 22, strong: 0.35, weak: 0.2, ms: 90 });
        break;
      }
      case 'player.grabbed':
        this.play({ phone: 14, strong: 0.15, weak: 0.45, ms: 60 });
        break;
      case 'player.hurt':
        this.play({ phone: [60, 40, 40], strong: 0.8, weak: 0.6, ms: 200 });
        break;
      case 'player.died':
        this.play({ phone: [140, 70, 260], strong: 1, weak: 0.7, ms: 600 });
        break;
      case 'block.moving':
        this.play({ phone: 18, strong: 0.25, weak: 0.1, ms: 700 });
        break;
      case 'block.landed':
        this.play({ phone: 55, strong: 0.85, weak: 0.3, ms: 250 }, near(e.id, 14));
        break;
      case 'tile.cracked':
        this.play({ phone: [12, 50, 12], strong: 0.1, weak: 0.5, ms: 120 });
        break;
      case 'tile.fell':
        this.play({ phone: 45, strong: 0.7, weak: 0.3, ms: 220 });
        break;
      case 'door.opening':
      case 'door.closing':
        this.play(
          { phone: [30, 60, 30, 60, 30, 60, 30], strong: 0.35, weak: 0.15, ms: 1200 },
          near(e.id, 18),
        );
        break;
      case 'lever.pulled':
        this.play({ phone: 25, strong: 0.4, weak: 0.3, ms: 140 });
        break;
      case 'secret.found':
      case 'pickup':
        this.play({ phone: [15, 60, 15], strong: 0.1, weak: 0.4, ms: 110 });
        break;
      case 'torch.lit':
        // A small tick as the pitch catches.
        this.play({ phone: [12], strong: 0, weak: 0.3, ms: 60 });
        break;
      case 'relic.taken':
        this.play({ phone: [40, 80, 40, 80, 160], strong: 0.6, weak: 0.6, ms: 900 });
        break;
      case 'checkpoint':
        this.play({ phone: 10, strong: 0, weak: 0.25, ms: 60 });
        break;
      // Combat. Enemy events carry their own position (x, y, z).
      case 'weapon.fired':
        this.play({ phone: 12, strong: 0.05, weak: 0.35, ms: 70 });
        break;
      case 'enemy.hit':
        this.play({ phone: 8, strong: 0.15, weak: 0.25, ms: 50 }, at(e, 16));
        break;
      case 'enemy.bite':
        // A landed bite also sends player.hurt, which follows and takes over; a miss is a faint snap.
        this.play(
          e.hit ? { phone: 10, strong: 0.3, weak: 0.7, ms: 80 } : { phone: 6, strong: 0, weak: 0.3, ms: 40 },
        );
        break;
      case 'enemy.died':
        this.play({ phone: [25, 40, 15], strong: 0.4, weak: 0.3, ms: 160 }, at(e, 16));
        break;
    }
  }
}
