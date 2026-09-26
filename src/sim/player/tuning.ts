/**
 * Gameplay constants (spec §5 "Constantes de partida", taken from the PoC).
 * This is the only place they live: the movement tests depend on them.
 */
export const tuning = {
  /** Collision half-size (m). The body is an axis-aligned box of this half-width. */
  radius: 0.34,
  /** Character height (m). */
  height: 1.9,
  /** Automatic step-up height (m). */
  stepUp: 0.55,
  /** Drops up to this height (m) are followed on foot instead of falling. */
  stepDown: 0.55,

  /** Run speed (m/s). */
  runSpeed: 5.4,
  /** Walk speed (m/s). */
  walkSpeed: 2.2,
  /** Horizontal acceleration (1/s): fraction of the speed difference corrected per second. */
  accel: 12,
  /** Turn rate towards the movement direction (rad/s). */
  turnSpeed: 12,

  /** Gravity (m/s²). */
  gravity: 24,
  /** Initial vertical jump speed (m/s). */
  jumpSpeed: 8.05,
  /** Horizontal speed of a standing forward jump (m/s): clears a 1-block gap. */
  standJumpSpeed: 3.4,
  /** Running time needed for a running jump (s). */
  runJumpMinTime: 0.4,
  /** Air control (m/s²). */
  airControl: 3,
  /** Maximum horizontal speed in the air (m/s). */
  airMaxSpeed: 5.6,
  /** Air control can always reach at least this horizontal speed (m/s), e.g. after a vertical jump. */
  airControlMinCap: 1,
  /** Grace time after running off an edge during which a jump still counts (s). */
  coyoteTime: 0.1,
  /** A jump pressed this long before landing still triggers (s). */
  jumpBuffer: 0.12,

  /** Hands height above the feet while hanging (m). */
  handHeight: 2.0,
  /** Grab window: hands may be this far below the ledge (m). */
  grabBelow: 0.45,
  /** Grab window: hands may be this far above the ledge (m). */
  grabAbove: 0.35,
  /** Maximum distance from the body to the ledge to grab it (m). */
  grabReach: 0.5,
  /** Time after letting go during which no ledge is grabbed (s). */
  regrabDelay: 0.35,
  /** Shimmy speed while hanging (m/s). */
  shimmySpeed: 1.4,
  /** Climb-up duration (s). */
  climbTime: 0.8,

  /** Push one block (s). */
  pushTime: 0.9,
  /** Pull one block (s). */
  pullTime: 1.0,
  /** Pull a lever (s); the lever triggers halfway. */
  leverTime: 1.0,
  /** Crouch and pick up an item (s); the item is taken halfway. */
  pickupTime: 0.8,

  /** Falls higher than this hurt (m). */
  fallDamageFrom: 3.5,
  /** Damage per metre above fallDamageFrom. */
  fallDamagePerMetre: 26,
  /** Falls higher than this kill (m). */
  fallDeathFrom: 6.5,
  maxHealth: 100,
  /** Time from death to respawn at the last checkpoint (s). */
  respawnDelay: 2.5,
};

/** World mechanism constants. */
export const mechanics = {
  /** Warning time before a cracked tile falls (s). */
  crumbleDelay: 0.55,
  /** Door open / close speed (fraction per second). */
  doorSpeed: 0.5,
  /** Doors stop blocking once this open. */
  doorPassable: 0.9,
  /** Block height (m). */
  blockHeight: 2,
  /** Block fall speed when pushed over a drop (m/s). */
  blockFallSpeed: 9,
};

export type Tuning = typeof tuning;
