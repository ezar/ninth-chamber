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

/**
 * End-of-level rating (spec §9 "Estadísticas de nivel"): 100 points split
 * between time, secrets, journal notes and deaths, and the seal each score earns.
 */
export const rating = {
  /** Full time points up to the level's par time; they fall linearly to 0 at par × timeZeroAt. */
  timePoints: 35,
  timeZeroAt: 2.5,
  /** Par (s) for levels that do not set one. */
  defaultPar: 300,
  secretPoints: 30,
  notePoints: 15,
  /** Points for a deathless run; each death costs deathPenalty. */
  deathPoints: 20,
  deathPenalty: 7,
  /** Seals from lowest to highest, with the minimum score for each. */
  ranks: [
    { id: 'sand', min: 0 },
    { id: 'stone', min: 35 },
    { id: 'bronze', min: 55 },
    { id: 'gold', min: 75 },
    { id: 'amber', min: 90 },
  ],
} as const;

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
  /** Water gates raise or lower a room's water at this rate (m/s): a click a second. */
  waterSpeed: 0.5,
};

/**
 * Water (spec §5.10 "Agua"): wading, surface swimming, diving with a 60 s
 * air bar, safe falls into deep water and climbing out onto low edges.
 */
export const swimming = {
  /** Water at least this deep (m) is swum, not waded: 3 clicks. */
  swimDepth: 1.5,
  /** A fall into water at least this deep (m) does no damage, from any height: 2 clicks. */
  safeDepth: 1,
  /** Wading: water this deep (m) or more slows Nora down. */
  wadeDepth: 0.3,
  /** Wading speeds (m/s): running and walking through water. */
  wadeSpeed: 3.2,
  wadeWalkSpeed: 1.6,

  /** At the surface the feet reference sits this far under the water (head and shoulders out) (m). */
  surfaceSink: 1.45,
  /** Surface swimming speed (m/s), acceleration (1/s) and turn rate (rad/s). */
  swimSpeed: 1.8,
  swimAccel: 3,
  swimTurn: 5,
  /** Underwater speed (m/s) and acceleration (1/s). */
  diveSpeed: 2.4,
  diveAccel: 2.5,
  /** With no input a diver drifts up this fast (m/s). */
  buoyancy: 0.2,
  /** Duck dive from the surface: initial downward speed (m/s). */
  duckDive: 1.6,
  /** Falling faster than this (m/s) into deep water goes under before surfacing. */
  plunge: 7,
  /** Underwater body: a box from bodyLow to bodyHigh above the feet reference (m). */
  bodyLow: 0.95,
  bodyHigh: 1.75,

  /** Climbing out onto an edge up to 1 click above the water (m) (spec §5). */
  climbOutAbove: 0.5,
  /** Edges this close under the surface (m) are climbed onto too: the water is too shallow to swim there. */
  climbOutBelow: 0.5,
  /** Reach from the body to the edge (m) and duration of the climb out (s). */
  climbOutReach: 0.45,
  climbOutTime: 1.1,

  /** Air bar (s), refilled at this rate at the surface and on land (s per s). */
  airMax: 60,
  airRefill: 15,
  /** With no air left: this much damage every interval (s) (spec: 10 per second). */
  drownDamage: 10,
  drownInterval: 1,
  /** Surfacing with less than this fraction of air left, Nora gasps. */
  gaspBelow: 0.6,
  /** A roll in the water: a 180° turn (spec §5.6) over this long (s). */
  rollTime: 0.45,
  /** A swim stroke every this many metres (for sound and animation). */
  strokeDistance: 1.1,
};

/** Flares (spec §7 "Bengalas"): they light for 30 s in an 8 m radius. */
export const flares = {
  /** Burn time (s). */
  life: 30,
  /** Light radius (m). */
  radius: 8,
  /** Most burning flares at once; lighting another puts out the oldest on the ground. */
  max: 4,
  /** Flares in a pickup when the level does not say. */
  perPickup: 2,
  /** Throw: forward and upward speed (m/s). */
  throwSpeed: 7,
  throwLift: 3.5,
  /** A dropped flare falls from the hand (m/s forward). */
  dropSpeed: 0.6,
  gravity: 18,
  /** Speed kept after a bounce on the floor, and horizontal friction on it (1/s). */
  bounce: 0.3,
  friction: 4,
  /** In water: drag (1/s) and sinking speed (m/s). */
  waterDrag: 3,
  sinkSpeed: 0.5,
  /** A burning flare lights a cold brazier within this distance of its bowl (m). */
  igniteRange: 1.4,
  /** Height of a brazier's bowl above its floor (m). */
  brazierBowl: 1.15,
  /** Where Nora holds a lit flare, relative to her feet: right, up, forward (m). */
  hand: { right: -0.28, up: 1.0, forward: 0.3 },
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
    /**
     * Time between shots with only the right pistol, while the torch fills her
     * left hand (s): each hand keeps its own rate, so the rate halves.
     */
    oneHandCadence: 0.48,
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

/** The torch (owner's request): lighting it and where its flame sits. */
export const torch = {
  /** Action lights a carried torch within this distance of a burning brazier's centre (m): from the next sector. */
  lightReach: 2.3,
  /** Largest height between her feet and the brazier's floor for lighting it (m). */
  lightHeight: 1,
  /** Flame height above her feet with the torch raised in her hand (m); water above it puts it out. */
  handHeight: 1.6,
  /** Flame height above her feet with the torch on her belt (m). */
  beltHeight: 0.95,
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
