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

/** Weapons and aiming (spec §7 "Armas" and "Reglas de apuntado"). */
export const weapons = {
  /** Dual pistols: infinite ammo, no reload in phase 1. */
  pistols: {
    /** Damage per hit. */
    damage: 1,
    /** Time between shots (s), alternating hands. */
    cadence: 0.24,
    /** Maximum range (m). */
    range: 16,
    /** Chance that a shot at a visible target hits. */
    hitChance: 0.85,
  },
  /** Time to draw or holster the pistols (s); they cannot fire meanwhile. */
  drawTime: 0.3,
  /** Height of Nora's eyes and pistols above her feet, for line of sight (m). */
  aimHeight: 1.35,
  /** Half-angle of the arc the torso and arms cover without turning the body (rad). */
  aimArc: (110 * Math.PI) / 180,
  /** Standing still with a target, Nora turns towards it at this rate (rad/s). */
  aimTurnSpeed: 7,
  /** Height of Nora's chest above her feet, what enemies look at (m). */
  chestHeight: 1.2,
};

/** Health restored by each medkit size (spec §7 "Salud"). */
export const medkits = { small: 50, large: 100 } as const;

/** Radius (m) within which each noise alerts enemies (spec §7 "Comportamiento"). */
export const noise = {
  run: 6,
  shot: 14,
  tile: 10,
  /** Nora is heard running above this horizontal speed (m/s), halfway between walking and running. */
  runSpeed: 3.8,
};

/** Enemy types: each is data plus a behaviour from a closed list (spec §7 "Enemigos"). */
export const ENEMY_TYPES = ['jackal'] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];
export const ENEMY_BEHAVIOURS = ['packHunter'] as const;
export type EnemyBehaviour = (typeof ENEMY_BEHAVIOURS)[number];

export interface EnemyStats {
  behaviour: EnemyBehaviour;
  health: number;
  /** Chase speed (m/s). */
  runSpeed: number;
  /** Speed while prowling, returning home or leaving (m/s). */
  trotSpeed: number;
  /** Horizontal acceleration (1/s). */
  accel: number;
  /** Turn rate (rad/s). */
  turnSpeed: number;
  /** Collision half-size and height (m). */
  radius: number;
  height: number;
  /** Eye height above the feet, for line of sight (m). */
  eyeHeight: number;
  /** Highest step it climbs (m): 1 click. It never jumps. */
  climb: number;
  /** Deepest drop it takes (m). */
  maxDrop: number;
  /** Descent speed when stepping down a drop (m/s). */
  dropSpeed: number;
  bite: {
    damage: number;
    /** Time between bites (s). */
    interval: number;
    /** Bites land within this distance between centres (m). */
    range: number;
    /** Highest Nora's feet can be above its own and still be bitten (m). */
    reachUp: number;
    /** Delay from reaching Nora to the first bite (s). */
    windup: number;
  };
  /** Sight: range (m) and largest height difference it notices (m). */
  sightRange: number;
  sightHeight: number;
  /** Time spent alert (growling) before the chase (s). */
  alertTime: number;
  /** Stagger after a hit (s)… */
  hurtTime: number;
  /** …at most once per this many seconds, so steady fire slows it without pinning it (s). */
  staggerCooldown: number;
  /** Minimum time between path searches (s). */
  repathTime: number;
  /** Most cells a path search expands. */
  searchLimit: number;
  /** Nora out of reach this long (a refuge): it gives up and leaves (s). */
  refugeTime: number;
  /** After giving up, sight alone does not alert it for this long (s). */
  calmTime: number;
  /** Pack mates approach from Nora's sides, this far out (m)… */
  flankDistance: number;
  /** …until they are this close, then go straight for her (m). */
  flankUntil: number;
  /** Prowling below a refuge: pacing half-width (m) and rate (rad/s). */
  prowlSwing: number;
  prowlRate: number;
}

export const enemyTypes: Record<EnemyType, EnemyStats> = {
  // The PoC jackal: 4 health, 4.1 m/s, bites 9 every 0.9 s within 1.1 m, climbs 1 click,
  // never jumps or drops more than 1 m, hunts in pairs.
  jackal: {
    behaviour: 'packHunter',
    health: 4,
    runSpeed: 4.1,
    trotSpeed: 1.8,
    accel: 9,
    turnSpeed: 9,
    radius: 0.3,
    height: 0.85,
    eyeHeight: 0.6,
    climb: 0.5,
    maxDrop: 1,
    dropSpeed: 7,
    bite: { damage: 9, interval: 0.9, range: 1.1, reachUp: 0.75, windup: 0.3 },
    sightRange: 12,
    sightHeight: 3,
    alertTime: 0.6,
    hurtTime: 0.2,
    staggerCooldown: 1,
    repathTime: 0.5,
    searchLimit: 1500,
    refugeTime: 8,
    calmTime: 6,
    flankDistance: 1.6,
    flankUntil: 2.5,
    prowlSwing: 0.6,
    prowlRate: 0.9,
  },
};
