/**
 * Gameplay constants (spec §5 "Constantes de partida", taken from the PoC).
 * This is the only place they live: the movement tests depend on them.
 */
export const tuning = {
  /** Collision radius (m). */
  radius: 0.34,
  /** Character height (m). */
  height: 1.9,
  /** Automatic step-up height (m). */
  stepUp: 0.55,

  /** Run speed (m/s). */
  runSpeed: 5.4,
  /** Walk speed (m/s). */
  walkSpeed: 2.2,
  /** Horizontal acceleration (1/s): fraction of the speed difference corrected per second. */
  accel: 12,

  /** Gravity (m/s²). */
  gravity: 24,
  /** Initial vertical jump speed (m/s). */
  jumpSpeed: 8.05,
  /** Air control (m/s²). */
  airControl: 3,
  /** Maximum horizontal speed in the air (m/s). */
  airMaxSpeed: 5.6,

  /** Turn rate towards the movement direction (rad/s). */
  turnSpeed: 12,
};

export type Tuning = typeof tuning;
