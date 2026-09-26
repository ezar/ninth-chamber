/**
 * Bucle de paso fijo con acumulador (spec §3 "Bucle y capas").
 *
 * No conoce el reloj del navegador: quien lo usa le pasa el tiempo transcurrido.
 * Así se puede testear en Node y ejecutar sin render.
 */

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
/** Máximo de ticks por frame para no entrar en espiral de la muerte. */
export const MAX_TICKS_PER_FRAME = 5;

export interface FrameResult {
  /** Ticks de simulación ejecutados en este frame. */
  ticks: number;
  /** Fracción [0, 1) entre el estado anterior y el actual, para interpolar el render. */
  alpha: number;
  /** Tiempo descartado porque se superó MAX_TICKS_PER_FRAME. */
  dropped: number;
}

export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    private readonly step: () => void,
    private readonly dt = TICK_DT,
    private readonly maxTicks = MAX_TICKS_PER_FRAME,
  ) {}

  /** Avanza `elapsed` segundos de tiempo real y ejecuta los ticks que tocan. */
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
      // Nos hemos quedado atrás: se descarta el exceso y se conserva la fase.
      dropped = this.accumulator - (this.accumulator % this.dt);
      this.accumulator %= this.dt;
    }
    return { ticks, alpha: this.accumulator / this.dt, dropped };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
