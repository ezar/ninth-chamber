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

  /** A hanging rope (spec §8): she holds it anywhere along this length above its lower end (m). */
  ropeLength: 1.6,
  /** And this far from its line, sideways (m). */
  ropeReach: 0.7,
  /** Hanging from a rope and pulling it (s); the rope triggers halfway, then she lets go. */
  ropeTime: 1.0,

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

/** The Temple of the Sun's mechanisms (spec §8 "Mecanismos"): platforms, trapdoors, sun beams, key items. */
export const devices = {
  /** Thickness of a moving platform's slab under its top (m). */
  platformThickness: 0.5,
  /** Trapdoor open / close speed (fraction per second): fast, it is a trap. */
  trapdoorSpeed: 4,
  /** A trapdoor stops holding weight once this open. */
  trapdoorGives: 0.3,
  /** Longest sun-beam trace, in cells (a guard against mirror loops). */
  beamMaxCells: 160,
  /** Nora reaches a mirror's drum from this far off its face (m, from her centre). */
  mirrorReach: 0.8,
};

/** Traps (spec §8 "Trampas"): each warns before it acts and resets at checkpoints. */
export const traps = {
  boulder: {
    /** Radius of the stone ball (m); it fills a one-block corridor. */
    radius: 0.95,
    /** Rumble between the trigger and the roll (s). */
    warning: 1.1,
    /** Acceleration (m/s²) up to the top speed (m/s): a little faster than Nora runs. */
    accel: 3.2,
    maxSpeed: 6.2,
  },
  blade: {
    /** Full swing cycle (s): the blade crosses the corridor twice per cycle. */
    period: 2.4,
    damage: 40,
    /** Knock-back speed along the swing (m/s) and upwards (m/s). */
    push: 4.5,
    lift: 2.5,
    /** Swing amplitude (rad) about the pivot under the ceiling. */
    amplitude: 0.62,
    /** Half-width of the crescent blade, its height and its thickness (m). */
    halfWidth: 0.55,
    height: 0.9,
    thickness: 0.08,
    /** Gap between the blade's lowest point and the floor (m). */
    clearance: 0.45,
    /** A blade hits at most once per this many seconds. */
    cooldown: 0.9,
  },
  fire: {
    /** Embers and a hiss before each burst (s): the readable warning. */
    warning: 0.9,
  },
  /** The Clay Archive's darts (spec §19): a painted slab, a click, then a volley across the corridor. */
  darts: {
    /** From the click to the volley (s): a quick step off the line avoids it. */
    delay: 0.45,
    damage: 12,
    /** Before the slab can fire again (s), once she is off it. */
    cooldown: 1.5,
    /** The volley flies below this height above the slab (m): she cannot jump over it. */
    height: 2,
  },
};

/**
 * The Bronze Forge (spec §19, chamber VI): molten bronze poured along a
 * trench, which kills while it glows and cools into a bridge; heat that
 * drains health away from the walls' shade.
 */
export const forge = {
  pour: {
    /** How fast the bronze runs along its trench (cells/s). */
    speed: 2.5,
    /** From the trench filling up to solid, walkable bronze (s): red, then dark. */
    cool: 4,
    /** A repeating pour rumbles this long before it runs again (s). */
    warning: 1.5,
    /** Feet within this height above hot bronze burn (m). */
    reach: 0.3,
  },
  heat: {
    /** Health lost per second in the open heat (a full bar in about half a minute). */
    rate: 3,
  },
};

/** The Wind Stair's gusts (spec §19, chamber VII): fixed cycles, like the Temple's fire floors. */
export const wind = {
  /** A horizontal gust carries her this fast in the air (m/s): about a block more or less on a running jump. */
  speed: 3,
  /** On the ground it pushes at this fraction of `speed`: always slower than walking against it. */
  ground: 1 / 3,
  /** An updraught takes this fraction of gravity away in the air. */
  lift: 0.5,
  /** The flutes' tone rises this long before each gust (s). */
  warning: 1.5,
  /** A gust builds up and dies down over this long (s). */
  ramp: 0.3,
  /** Default cycle (s) and gust length within it (s). */
  period: 6,
  blow: 2.5,
  /** Hanging in a tearing gust, she holds on this long before it tears her off (s). */
  grip: 0.6,
  /** Torn off, she is thrown this fast along the wind (m/s). */
  throw: 1.5,
};

/** Climbing walls of roots (spec §5 "Escalar paredes", §19 chamber V). */
export const wallClimb = {
  /** Climbing speed up, down and sideways (m/s). */
  up: 0.9,
  down: 1.3,
  side: 0.9,
  /** Furthest from the face she gets on or catches it (m), like a ledge grab. */
  reach: 0.5,
  /** A face is climbed only if its top is at least this far above her hands (m); a lower one is a ledge. */
  minAbove: 0.6,
  /** She gets on this far up from the floor, so she is off the ground (m). */
  lift: 0.15,
  /** Gap kept between her body and the face (m). */
  gap: 0.02,
  /** A jump back off the face: away from it (m/s) and up, as a fraction of a jump. */
  backSpeed: 3.4,
  backLift: 0.6,
  /** From the top edge, pulling back puts her on the face this far below the hang (m). */
  fromLedge: 0.2,
};

/** Tangles of roots (spec §19, chamber V): they shrink back from a lit torch and grow back slowly. */
export const tangle = {
  /** A lit torch in her hand this close to the roots makes them shrink (m, from the torch). */
  reach: 2.2,
  /** Height of the torch above her feet (m). */
  handHeight: 1.3,
  /** Shrinking back from fully grown (s). */
  shrinkTime: 0.8,
  /** With no torch close, they wait this long (s), then grow back over this long (s). */
  regrowDelay: 2.5,
  regrowTime: 6,
};

/** Mild poison from darts (spec §19): it drains health for a while but never kills; a medkit cures it. */
export const poison = {
  /** Seconds a dart poisons for (a second dart restarts it). */
  duration: 8,
  /** Health lost per second while poisoned. */
  rate: 2.5,
  /** It never takes her below this health. */
  floor: 10,
};

/** The stone guardian (spec §7): immune to everything but traps and a blow to its core from above. */
export const guardianTuning = {
  /** Body radius (m) for pushing Nora away and for landing on it; hulking, wider than a sector. */
  bodyRadius: 1.15,
  /** Collision half-size against the grid (m): it still fits a one-block bridge. */
  radius: 0.8,
  /** Standing height (m). */
  height: 2.8,
  /** Top of its hunched back while it recovers from a slam: where the core is struck (m). */
  coreTop: 1.9,
  /** Walking speed per phase (m/s). */
  speed: [1.45, 2.0],
  accel: 4,
  /** Turn rate per phase (rad/s). */
  turnSpeed: [1.7, 2.4],
  /** One click up or down per step; it never jumps (m). */
  climb: 0.5,
  maxDrop: 0.5,
  /** A stride, for step events and camera shake (m). */
  stride: 1.25,
  /** Winds up when Nora, on its level, is this close (m, centre to centre). */
  slamRange: 2.7,
  /** Pounds the wall below a Nora out of reach this close (m). */
  poundRange: 3.3,
  /** The slam hurts within this radius (m)… */
  slamRadius: 3.0,
  /** …when Nora's feet are at most this far above its floor: a jump dodges it (m). */
  slamReach: 0.9,
  slamDamage: 60,
  /** Knock-back from a slam (m/s, outwards and up). */
  slamPush: 5.5,
  slamLift: 3.5,
  /** Readable wind-up per phase (s). */
  windup: [1.1, 0.85],
  /** Hit window after a slam, fists buried and core bared, per phase (s). */
  recover: [2.0, 1.5],
  /** Rest after recovering before the next wind-up (s). */
  cooldown: 0.8,
  /** A fall onto the core must start at least this high above the core (m). */
  strikeDrop: 2,
  /** Nora bounces off its back (m/s up, m/s outwards). */
  bounceUp: 4.5,
  bounceOut: 2.8,
  /** Stagger after a core strike (s). */
  stunTime: 2.4,
  /** Bazûr: after molten bronze has cost it a phase, it must stand this long clear of hot bronze before another pour counts (s). */
  bronzeImmune: 1,
  /** Fall speed limit and gravity in a pit (m/s, m/s²). */
  gravity: 24,
  /** Lies stunned at the bottom of a pit (s), then drags itself out (s). */
  fallenTime: 2.2,
  climbOutTime: 3,
  /** Path search: minimum interval (s) and node budget. */
  repathTime: 0.5,
  searchLimit: 1200,
  /** Shrugging off a Nora who lands on it outside the window (m/s out, m/s up). */
  shrugPush: 3.5,
  shrugLift: 3,
};

/**
 * Anzur, the Observatory's keeper (guardian kind 'giant', spec §19): the
 * largest of the eight, three phases advanced by the dome's rings. It
 * sweeps wide and slow; in phase 2 its slams break the floor; in phase 3
 * only the oculus light stops it.
 */
export const giantTuning: typeof guardianTuning = {
  ...guardianTuning,
  bodyRadius: 2.0,
  radius: 0.9,
  height: 5.2,
  coreTop: 3.8,
  speed: [1.2, 1.4, 1.6],
  turnSpeed: [1.2, 1.5, 1.8],
  stride: 2.0,
  slamRange: 3.6,
  poundRange: 4.2,
  /** The sweep: a wide blow round it. */
  slamRadius: 4.2,
  slamDamage: 35,
  slamPush: 7,
  windup: [1.4, 1.2, 1.0],
  recover: [1.4, 1.2, 1.0],
  cooldown: 1.1,
  stunTime: 1.8,
  searchLimit: 2000,
};

/** How Anzur breaks the floor in phase 2: the cells within this many of the impact, a stride ahead of it, crack and fall. */
export const giantFloor = {
  /** Impact point ahead of its feet (m). */
  ahead: 2.4,
  /** Cells round the impact cell that break (Chebyshev distance). */
  radius: 1,
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

/** Nora's ideas (spec §15, pregenerated hints): seconds in a room with no progress before she offers one. */
export const hints = { idle: 180 } as const;

/** Radius (m) within which each noise alerts enemies (spec §7 "Comportamiento"). */
export const noise = {
  run: 6,
  shot: 14,
  tile: 10,
  /** Nora is heard running above this horizontal speed (m/s), halfway between walking and running. */
  runSpeed: 3.8,
};

/** Enemy types: each is data plus a behaviour from a closed list (spec §7 "Enemigos"). */
export const ENEMY_TYPES = ['jackal', 'clay', 'automaton', 'bird'] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];
export const ENEMY_BEHAVIOURS = ['packHunter', 'flyer'] as const;
export type EnemyBehaviour = (typeof ENEMY_BEHAVIOURS)[number];

export interface EnemyStats {
  behaviour: EnemyBehaviour;
  health: number;
  /** Share of a hit's damage that gets through (1 when omitted; the automatons' plates let little through). */
  armour?: number;
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
  // Tamrit, the Clay Archive's scribe (spec §19): slow, tall and patient. Shot to pieces it
  // crumbles and reforms (clayGuardian below); only deep water dissolves it. It never gives up.
  clay: {
    behaviour: 'packHunter',
    health: 8,
    runSpeed: 2.7,
    trotSpeed: 1.4,
    accel: 5,
    turnSpeed: 3.2,
    radius: 0.5,
    height: 2.3,
    eyeHeight: 2.0,
    climb: 0.5,
    maxDrop: 1,
    dropSpeed: 5,
    bite: { damage: 22, interval: 1.6, range: 1.5, reachUp: 1, windup: 0.7 },
    sightRange: 16,
    sightHeight: 4,
    alertTime: 1.2,
    hurtTime: 0.15,
    staggerCooldown: 2,
    repathTime: 0.5,
    searchLimit: 2000,
    refugeTime: 1e9,
    calmTime: 6,
    flankDistance: 0,
    flankUntil: 0,
    prowlSwing: 0.8,
    prowlRate: 0.6,
  },
  // The Forge's bronze automatons (spec §19): slow and heavy, plated so pistols barely scratch
  // them (about thirty seconds of steady fire). Quench water or molten bronze ends them for good.
  automaton: {
    behaviour: 'packHunter',
    health: 6,
    armour: 0.05,
    runSpeed: 2.1,
    trotSpeed: 1.2,
    accel: 4,
    turnSpeed: 2.6,
    radius: 0.5,
    height: 2.1,
    eyeHeight: 1.8,
    climb: 0.5,
    maxDrop: 1,
    dropSpeed: 5,
    bite: { damage: 26, interval: 1.9, range: 1.5, reachUp: 1, windup: 0.8 },
    sightRange: 14,
    sightHeight: 3,
    alertTime: 1,
    hurtTime: 0.1,
    staggerCooldown: 3,
    repathTime: 0.6,
    searchLimit: 2000,
    refugeTime: 10,
    calmTime: 6,
    flankDistance: 0,
    flankUntil: 0,
    prowlSwing: 0.6,
    prowlRate: 0.5,
  },
  // The Wind Stair's rock birds (spec §19): quick and fragile, they fly at Nora and shove her
  // (a little damage) instead of biting. Two pistol hits bring one down. They never give up.
  bird: {
    behaviour: 'flyer',
    health: 2,
    runSpeed: 7,
    trotSpeed: 3,
    accel: 3,
    turnSpeed: 10,
    radius: 0.3,
    height: 0.4,
    eyeHeight: 0.2,
    climb: 0,
    maxDrop: 0,
    dropSpeed: 9,
    bite: { damage: 4, interval: 2.4, range: 0.9, reachUp: 99, windup: 0 },
    sightRange: 14,
    sightHeight: 14,
    alertTime: 0.8,
    hurtTime: 0.35,
    staggerCooldown: 0.6,
    repathTime: 1,
    searchLimit: 0,
    refugeTime: 1e9,
    calmTime: 4,
    flankDistance: 0,
    flankUntil: 0,
    prowlSwing: 0,
    prowlRate: 0,
  },
};

/**
 * The Wind Stair's rock birds (enemy type 'bird', spec §19): they nest in the
 * shaft, dive at Nora and shove her instead of biting, then climb away.
 */
export const birds = {
  /** A shove carries her this far along the bird's dive (m): it can knock her off a ledge. */
  shove: 0.9,
  /** After a shove it climbs away for this long before diving again (s). */
  retreat: 1.4,
  /** It climbs to this height above her chest while retreating (m). */
  retreatHeight: 3,
  /** It keeps this far from walls, floors and ceilings (m). */
  clearance: 0.3,
  /** It hovers this high over its nest while it screeches (m). */
  hover: 1,
  /** A dead bird falls at this gravity (m/s²). */
  gravity: 18,
};

/** The bronze automatons (enemy type 'automaton'). */
export const automaton = {
  /** Water this deep over its floor quenches it for good (m). */
  quenchDepth: 1,
};

/** Tamrit's clay (enemy type 'clay'). */
export const clayGuardian = {
  /** A heap of wet clay for this long after being shot to pieces, then it rises again (s). */
  reform: 6,
  /** Water this deep over its floor dissolves it for good (m). */
  dissolveDepth: 1,
};
