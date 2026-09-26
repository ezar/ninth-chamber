/**
 * Estado único de la simulación. Hito 1: un cubo que corre y salta sobre un
 * suelo plano. La rejilla y la máquina de estados de Nora llegan en los hitos 2 y 3.
 */
import { EventQueue } from '../core/events';
import { isPressed, isHeld, type InputFrame } from '../core/input-frame';
import { Rng } from '../core/rng';
import { TICK_DT } from '../core/loop';
import { tuning } from './player/tuning';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  /** Orientación (rad), 0 = mirando a -Z. */
  yaw: number;
  grounded: boolean;
}

export interface World {
  tick: number;
  rng: Rng;
  player: PlayerState;
  events: EventQueue;
}

export function createWorld(seed = 1): World {
  return {
    tick: 0,
    rng: new Rng(seed),
    player: {
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      grounded: true,
    },
    events: new EventQueue(),
  };
}

const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/** Avanza la simulación un tick de 1/60 s. */
export function stepWorld(world: World, input: InputFrame, dt = TICK_DT): void {
  const p = world.player;

  // Dirección deseada relativa a cámara: adelante = hacia donde mira la cámara.
  const sin = Math.sin(input.camYaw);
  const cos = Math.cos(input.camYaw);
  const dirX = input.moveX * cos - input.moveY * sin;
  const dirZ = -input.moveX * sin - input.moveY * cos;
  const mag = Math.hypot(dirX, dirZ);

  if (p.grounded) {
    const speed = isHeld(input, 'walk') ? tuning.walkSpeed : tuning.runSpeed;
    const k = Math.min(1, tuning.accel * dt);
    p.vel.x += (dirX * speed - p.vel.x) * k;
    p.vel.z += (dirZ * speed - p.vel.z) * k;

    if (isPressed(input, 'jump')) {
      p.vel.y = tuning.jumpSpeed;
      p.grounded = false;
      world.events.emit({ type: 'player.jumped', tick: world.tick });
    }
  } else {
    p.vel.x += dirX * tuning.airControl * dt;
    p.vel.z += dirZ * tuning.airControl * dt;
    const h = Math.hypot(p.vel.x, p.vel.z);
    if (h > tuning.airMaxSpeed) {
      p.vel.x *= tuning.airMaxSpeed / h;
      p.vel.z *= tuning.airMaxSpeed / h;
    }
  }

  if (mag > 0.01) {
    const target = Math.atan2(-dirX, -dirZ);
    const diff = wrapAngle(target - p.yaw);
    const maxTurn = tuning.turnSpeed * dt;
    p.yaw = wrapAngle(p.yaw + Math.max(-maxTurn, Math.min(maxTurn, diff)));
  }

  // Gravedad integrada de forma exacta (aceleración constante): la altura y el
  // tiempo de salto coinciden con las fórmulas del spec sin depender del paso.
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  if (!p.grounded) {
    p.pos.y += p.vel.y * dt - 0.5 * tuning.gravity * dt * dt;
    p.vel.y -= tuning.gravity * dt;
  }

  if (!p.grounded && p.pos.y <= 0) {
    p.pos.y = 0;
    p.vel.y = 0;
    p.grounded = true;
    world.events.emit({ type: 'player.landed', tick: world.tick });
  }

  world.tick++;
}

/** Instantánea serializable de World (para guardado, tests y repeticiones). */
export function snapshot(world: World): object {
  return { tick: world.tick, rng: world.rng.state, player: world.player };
}

/** Hash FNV-1a de la instantánea, para comparar repeticiones doradas. */
export function hashWorld(world: World): string {
  const s = JSON.stringify(snapshot(world));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
