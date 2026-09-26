/**
 * Fixed-step loop with an accumulator (spec §3 "Bucle y capas").
 *
 * It does not read the browser clock: the caller passes in elapsed time.
 * That makes it testable in Node and runnable without rendering.
 */

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
/** Maximum ticks per frame, to avoid the spiral of death. */
export const MAX_TICKS_PER_FRAME = 5;

export interface FrameResult {
  /** Simulation ticks run this frame. */
  ticks: number;
  /** Fraction in [0, 1) between the previous and current state, for render interpolation. */
  alpha: number;
  /** Time discarded because MAX_TICKS_PER_FRAME was exceeded. */
  dropped: number;
}

export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    private readonly step: () => void,
    private readonly dt = TICK_DT,
    private readonly maxTicks = MAX_TICKS_PER_FRAME,
  ) {}

  /** Advances `elapsed` seconds of real time and runs the ticks that are due. */
  advance(elapsed: number): FrameResult {
    this.accumulator += Math.max(0, elapsed);
    let ticks = 0;
    while (this.accumulator >= this.dt && ticks < this.maxTicks) {
      this.step();
      this.accumulator -= this.dt;
      ticks++;
    }
    let dropped = 0;
    if (this.accumulator >= this.dt) {
      // We fell behind: drop the excess and keep the phase.
      dropped = this.accumulator - (this.accumulator % this.dt);
      this.accumulator %= this.dt;
    }
    return { ticks, alpha: this.accumulator / this.dt, dropped };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
