import { buttonBit, emptyFrame, type Button, type InputFrame } from '../src/core/input-frame';
import { stepWorld, type World } from '../src/sim/world';

/** Builds an InputFrame from axes and held / pressed buttons. */
export function frame(
  opts: { x?: number; y?: number; held?: Button[]; pressed?: Button[]; yaw?: number } = {},
): InputFrame {
  const f = emptyFrame();
  f.moveX = opts.x ?? 0;
  f.moveY = opts.y ?? 0;
  f.camYaw = opts.yaw ?? 0;
  for (const b of opts.held ?? []) f.held |= buttonBit(b);
  for (const b of opts.pressed ?? []) {
    f.pressed |= buttonBit(b);
    f.held |= buttonBit(b);
  }
  return f;
}

export function run(world: World, input: InputFrame, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world, input);
}
