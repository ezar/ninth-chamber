/**
 * Third-person orbit camera (spec §6): player-controlled orbit with grid
 * collision, slow distance recovery, auto-framing while hanging and level
 * focus shots. On top of that, the presentation layer a modern action game
 * expects: an over-the-shoulder offset, a lazy follow that drifts behind the
 * direction of travel when the player leaves the stick alone, a slight
 * look-ahead, a speed-driven field of view and trauma-based shake for
 * landings, falling masonry and hits. Rooms may frame the camera (the Wind
 * Stair's shaft): a preferred pitch looking up or down, a distance, and
 * fixed shots it eases into and out of.
 */
import type { SimEvent } from '../core/events';
import { raycast, type GridQuery } from '../sim/grid/collision';
import type { CameraFraming } from '../sim/grid/level';

const DEG = Math.PI / 180;

export const cameraTuning = {
  targetHeight: 1.45,
  hangTargetHeight: 1.7,
  distance: 5.6,
  minDistance: 3,
  maxDistance: 9,
  minPitch: -14 * DEG,
  maxPitch: 66 * DEG,
  follow: 10,
  /** Radians per mouse pixel. */
  sensitivity: 0.005,
  /** Options menu: pushing up looks down (flight-stick style). */
  invertY: false,
  /** Clearance kept between the camera and walls (m). */
  radius: 0.25,
  /** Time to recover the full distance after a collision (s). */
  recover: 0.5,
  /** Below this distance the character fades out (m). */
  fadeDistance: 1.2,
  /** Lateral over-the-shoulder offset to the right of the character (m). */
  shoulder: 0.42,
  /** With the pistols out: over the right shoulder and closer (spec §6 "Apuntado"). */
  aimShoulder: 0.5,
  aimDistance: 4,
  /** Seconds without look input before the lazy follow takes over. */
  followDelay: 1.4,
  /** Maximum lazy-follow turn rate at full running speed (rad/s). */
  followRate: 1.1,
  /** Classic mode's tank controls: look input this recent leaves the camera alone (s)... */
  chaseDelay: 0.6,
  /** ...after which it eases behind the way she faces at this rate (1/s). */
  chaseRate: 3,
  /** Pitch the lazy follow settles to. */
  restPitch: 14 * DEG,
  /** Seconds of velocity the framing leads by. */
  lookAhead: 0.12,
  /** Vertical field of view standing and at full run (degrees). */
  fov: 55,
  runFov: 60,
  runSpeed: 5.4,
  /** Trauma lost per second; shake amplitude is trauma². */
  traumaDecay: 1.4,
  /** Positional (m) and angular (rad) shake at full trauma. */
  shakeMove: 0.16,
  shakeAngle: 2.2 * DEG,
};

/** Player motion the camera reacts to. */
export interface CameraSubject {
  /** Horizontal velocity (m/s). */
  vx: number;
  vz: number;
  vy: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class OrbitCamera {
  yaw = 0;
  pitch = 16 * DEG;
  distance = cameraTuning.distance;
  /** Distance after collision, eased back out. */
  private actual = cameraTuning.distance;
  readonly target = { x: 0, y: cameraTuning.targetHeight, z: 0 };
  readonly eye = { x: 0, y: 0, z: 0 };
  readonly lookAt = { x: 0, y: 0, z: 0 };
  /** Vertical field of view in degrees, eased with speed. */
  fov = cameraTuning.fov;
  /** Reduced motion: no shake and no speed-driven field of view. */
  calm = false;
  /** Narrow (portrait) screens: keep Nora centred instead of over the shoulder. */
  narrow = false;
  private focus: { at: Vec3; left: number; blend: number } | null = null;
  private focusEase = 0;
  private autoYaw: number | null = null;
  private sinceLook = 0;
  private trauma = 0;
  private time = 0;
  private shoulderNow = cameraTuning.shoulder;
  /** Pistols drawn: set by the game each frame. */
  aiming = false;
  /**
   * Classic mode's tank controls: the yaw the camera keeps behind (her facing), set by the game
   * each frame; null for the free camera. Without it, turning on the spot would turn her away.
   */
  chase: number | null = null;
  private aimNow = 0;
  private readonly lead = { x: 0, z: 0 };
  /** The current room's framing, the distance eased towards it, and a fixed shot's weight. */
  private framing: CameraFraming | null = null;
  private framedDistance = cameraTuning.distance;
  private shot: Vec3 | null = null;
  private shotTarget: Vec3 | null = null;
  private shotWeight = 0;

  /** The framing of the room Nora is in (null: the free orbit). */
  setFraming(f: CameraFraming | null): void {
    this.framing = f;
    if (f?.shot) this.shotTarget = f.shot;
  }

  /** Lowest pitch allowed: a framing that looks up the shaft lets the player look up as far. */
  private get minPitch(): number {
    const f = this.framing?.pitch;
    return f !== null && f !== undefined
      ? Math.min(cameraTuning.minPitch, f - 10 * DEG)
      : cameraTuning.minPitch;
  }

  look(dx: number, dy: number, zoom: number): void {
    if (dx !== 0 || dy !== 0) {
      this.autoYaw = null;
      this.sinceLook = 0;
    }
    this.yaw -= dx * cameraTuning.sensitivity;
    const pitchDelta = (cameraTuning.invertY ? -dy : dy) * cameraTuning.sensitivity;
    this.pitch = Math.max(this.minPitch, Math.min(cameraTuning.maxPitch, this.pitch + pitchDelta));
    this.distance = Math.max(
      cameraTuning.minDistance,
      Math.min(cameraTuning.maxDistance, this.distance + zoom * 0.5),
    );
  }

  /** Recenter behind the character. */
  recenter(playerYaw: number): void {
    this.autoYaw = playerYaw;
  }

  /** Turn smoothly behind the character (e.g. when grabbing a ledge). */
  swingBehind(playerYaw: number): void {
    this.autoYaw = playerYaw;
  }

  /** Look at a point for a few seconds (camera.focus). Any input skips it after 0.5 s. */
  focusOn(at: Vec3, seconds: number): void {
    this.focus = { at, left: seconds, blend: 0 };
  }

  skipFocus(): void {
    if (this.focus && this.focus.blend > 0.5) this.focus.left = Math.min(this.focus.left, 0.3);
  }

  get focusing(): boolean {
    return this.focus !== null;
  }

  /** The point a focus shot looks at, for depth of field (null outside focus shots). */
  get focusPoint(): Vec3 | null {
    return this.focus?.at ?? null;
  }

  /** How far the current focus shot has blended in (0..1, eased). */
  get focusWeight(): number {
    return this.focusEase;
  }

  /** Adds screen shake (0..1); amplitude grows with the square of the accumulated trauma. */
  shake(amount: number): void {
    if (this.calm) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Shake cues from the simulation, attenuated with distance from the player. */
  onEvent(e: SimEvent, player: Vec3, positionOf?: (id: string) => Vec3 | null): void {
    const near = (id: unknown, radius: number): number => {
      const at = typeof id === 'string' && positionOf ? positionOf(id) : null;
      if (!at) return 1;
      const d = Math.hypot(at.x - player.x, at.y - player.y, at.z - player.z);
      return Math.max(0, 1 - d / radius);
    };
    switch (e.type) {
      case 'player.landed': {
        const fall = Number(e.fall) || 0;
        if (fall > 1.2) this.shake(Math.min(0.75, (fall - 1.2) * 0.12 + (e.hard ? 0.35 : 0)));
        break;
      }
      case 'player.hurt':
        this.shake(0.35);
        break;
      case 'player.died':
        this.shake(0.6);
        break;
      case 'block.landed':
        this.shake(0.45 * near(e.id, 14));
        break;
      case 'tile.fell': {
        const d = Math.hypot(Number(e.cx) * 2 + 1 - player.x, Number(e.cz) * 2 + 1 - player.z);
        this.shake(0.3 * Math.max(0, 1 - (Number.isFinite(d) ? d : 99) / 12));
        break;
      }
      case 'door.opening':
      case 'door.closing':
        this.shake(0.22 * near(e.id, 18));
        break;
      // Combat: a small kick per shot, a jolt when a jackal snaps at Nora (a landed bite adds player.hurt).
      case 'weapon.fired':
        this.shake(0.18);
        break;
      case 'enemy.bite':
        this.shake(0.2);
        break;
      // The temple: the guardian's tread and blows, the boulder, heavy slabs coming to rest.
      case 'guardian.step':
      case 'guardian.slam':
      case 'guardian.fell':
      case 'guardian.defeated':
      case 'boulder.rolling':
      case 'boulder.crashed': {
        const d = Math.hypot(Number(e.x) - player.x, Number(e.z) - player.z);
        const k = Math.max(0, 1 - (Number.isFinite(d) ? d : 99) / 22);
        const amount: Record<string, number> = {
          'guardian.step': 0.14,
          'guardian.slam': 0.75,
          'guardian.fell': 0.6,
          'guardian.defeated': 0.55,
          'boulder.rolling': 0.35,
          'boulder.crashed': 0.65,
        };
        this.shake((amount[e.type] ?? 0) * k);
        break;
      }
    }
  }

  update(
    player: Vec3,
    hanging: boolean,
    grid: GridQuery,
    dt: number,
    motion: CameraSubject = { vx: 0, vz: 0, vy: 0 },
  ): void {
    this.time += dt;
    this.sinceLook += dt;
    if (!Number.isFinite(this.target.x + this.target.y + this.target.z)) {
      this.target.x = player.x;
      this.target.y = player.y;
      this.target.z = player.z;
    }
    if (this.autoYaw !== null) {
      const d = wrap(this.autoYaw - this.yaw);
      this.yaw += d * Math.min(1, dt * 4);
      if (Math.abs(d) < 0.01) this.autoYaw = null;
      this.sinceLook = cameraTuning.followDelay;
    }
    if (
      this.chase !== null &&
      this.autoYaw === null &&
      !this.focus &&
      this.sinceLook > cameraTuning.chaseDelay
    )
      this.yaw += wrap(this.chase - this.yaw) * Math.min(1, dt * cameraTuning.chaseRate);
    const speed = Math.hypot(motion.vx, motion.vz);
    // Lazy follow: once the player stops steering the camera, drift behind the
    // direction of travel. sin() keeps it still when running straight at the
    // lens and strongest when crossing the screen.
    if (
      this.chase === null &&
      this.autoYaw === null &&
      !this.focus &&
      !hanging &&
      speed > 0.8 &&
      this.sinceLook > cameraTuning.followDelay
    ) {
      const behind = Math.atan2(-motion.vx, -motion.vz);
      const d = wrap(behind - this.yaw);
      const ramp = Math.min(1, (this.sinceLook - cameraTuning.followDelay) / 1.5);
      const rate = cameraTuning.followRate * Math.min(1, speed / cameraTuning.runSpeed) * ramp;
      this.yaw += Math.sin(d) * rate * dt;
      // A framed room sets the pitch itself (below); the lazy follow only turns.
      if (this.framing?.pitch === null || this.framing?.pitch === undefined)
        this.pitch += (cameraTuning.restPitch - this.pitch) * Math.min(1, dt * 0.8 * ramp);
    }

    // A framed room eases the pitch to its own once the player leaves the camera alone.
    const framedPitch = this.framing?.pitch ?? null;
    if (framedPitch !== null && !this.focus && this.sinceLook > cameraTuning.followDelay)
      this.pitch += (framedPitch - this.pitch) * Math.min(1, dt * 1.5);
    this.framedDistance +=
      ((this.framing?.distance ?? this.distance) - this.framedDistance) * Math.min(1, dt * 2);

    const k = 1 - Math.exp(-cameraTuning.follow * dt);
    const th = hanging ? cameraTuning.hangTargetHeight : cameraTuning.targetHeight;
    // Frame slightly ahead of where the character is heading.
    const kl = 1 - Math.exp(-3 * dt);
    this.lead.x += (motion.vx * cameraTuning.lookAhead - this.lead.x) * kl;
    this.lead.z += (motion.vz * cameraTuning.lookAhead - this.lead.z) * kl;
    this.target.x += (player.x + this.lead.x - this.target.x) * k;
    this.target.y += (player.y + th - this.target.y) * k;
    this.target.z += (player.z + this.lead.z - this.target.z) * k;

    // Over-the-shoulder pivot, pulled toward the centre while hanging and
    // clipped against walls so the camera never starts inside stone.
    this.aimNow += ((this.aiming && !hanging ? 1 : 0) - this.aimNow) * Math.min(1, dt * 4);
    const shoulder = cameraTuning.shoulder + (cameraTuning.aimShoulder - cameraTuning.shoulder) * this.aimNow;
    const want0 = hanging || this.focus ? 0 : shoulder * (this.narrow ? 0.15 : 1);
    this.shoulderNow += (want0 - this.shoulderNow) * Math.min(1, dt * 3);
    const base =
      this.framing?.distance !== null && this.framing?.distance !== undefined
        ? this.framedDistance
        : this.distance;
    const distance = base + (Math.min(base, cameraTuning.aimDistance) - base) * this.aimNow;
    const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const reach = {
      x: this.target.x + right.x * (this.shoulderNow + cameraTuning.radius),
      y: this.target.y,
      z: this.target.z + right.z * (this.shoulderNow + cameraTuning.radius),
    };
    const side = Math.max(
      0,
      raycast(grid, this.target, reach, 0.05) * (this.shoulderNow + cameraTuning.radius) -
        cameraTuning.radius,
    );
    const pivot = {
      x: this.target.x + right.x * Math.min(side, this.shoulderNow),
      y: this.target.y,
      z: this.target.z + right.z * Math.min(side, this.shoulderNow),
    };

    const h = Math.cos(this.pitch);
    const dir = { x: Math.sin(this.yaw) * h, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * h };
    const want = {
      x: pivot.x + dir.x * (distance + cameraTuning.radius),
      y: pivot.y + dir.y * (distance + cameraTuning.radius),
      z: pivot.z + dir.z * (distance + cameraTuning.radius),
    };
    const free = raycast(grid, pivot, want, 0.05) * (distance + cameraTuning.radius) - cameraTuning.radius;
    const allowed = Math.max(0.3, Math.min(distance, free));
    // Snap in on collision, ease back out slowly so passing columns does not jerk.
    this.actual =
      allowed < this.actual
        ? allowed
        : this.actual + (allowed - this.actual) * Math.min(1, dt / cameraTuning.recover);

    this.eye.x = pivot.x + dir.x * this.actual;
    this.eye.y = pivot.y + dir.y * this.actual;
    this.eye.z = pivot.z + dir.z * this.actual;
    this.lookAt.x = pivot.x;
    this.lookAt.y = pivot.y;
    this.lookAt.z = pivot.z;

    // A fixed shot: the camera eases to its stand and keeps watching her from there.
    this.shotWeight += ((this.framing?.shot ? 1 : 0) - this.shotWeight) * Math.min(1, dt * 1.5);
    // From one fixed shot straight into another, the stand itself travels (no cut at the doorway).
    if (this.shotTarget) {
      if (!this.shot || this.shotWeight < 1e-3) this.shot = { ...this.shotTarget };
      else {
        const k = Math.min(1, dt * 1.5);
        this.shot.x += (this.shotTarget.x - this.shot.x) * k;
        this.shot.y += (this.shotTarget.y - this.shot.y) * k;
        this.shot.z += (this.shotTarget.z - this.shot.z) * k;
      }
    }
    if (this.shot && this.shotWeight > 1e-3) {
      const w = this.shotWeight * this.shotWeight * (3 - 2 * this.shotWeight);
      this.eye.x += (this.shot.x - this.eye.x) * w;
      this.eye.y += (this.shot.y - this.eye.y) * w;
      this.eye.z += (this.shot.z - this.eye.z) * w;
    }

    // Speed widens the lens a touch; a long fall widens it further.
    const run = Math.min(1, speed / cameraTuning.runSpeed);
    const fall = Math.min(1, Math.max(0, -motion.vy - 6) / 10);
    const fovWant = this.calm
      ? cameraTuning.fov
      : cameraTuning.fov + (cameraTuning.runFov - cameraTuning.fov) * run * run + 6 * fall;
    this.fov += (fovWant - this.fov) * Math.min(1, dt * 2.5);

    // Trauma shake: layered incommensurate sines read as noise without a noise table.
    this.trauma = Math.max(0, this.trauma - cameraTuning.traumaDecay * dt);
    const amp = this.trauma * this.trauma;
    if (amp > 0) {
      const t = this.time * 23;
      const nx = Math.sin(t * 1.0) * 0.6 + Math.sin(t * 2.31 + 1.7) * 0.4;
      const ny = Math.sin(t * 1.17 + 4.2) * 0.6 + Math.sin(t * 2.73 + 0.3) * 0.4;
      const nr = Math.sin(t * 0.87 + 2.9) * 0.6 + Math.sin(t * 1.93 + 5.1) * 0.4;
      const m = amp * cameraTuning.shakeMove;
      this.eye.x += right.x * nx * m;
      this.eye.z += right.z * nx * m;
      this.eye.y += ny * m;
      const lean = amp * cameraTuning.shakeAngle * this.actual;
      this.lookAt.x += right.x * nr * lean;
      this.lookAt.z += right.z * nr * lean;
      this.lookAt.y += ny * lean * 0.6;
    }

    if (this.focus) {
      const f = this.focus;
      f.left -= dt;
      f.blend = Math.min(1, f.blend + dt * 1.5);
      const b = f.left > 0 ? f.blend : Math.max(0, f.blend - (0 - f.left) * 2);
      const e = b * b * (3 - 2 * b);
      this.focusEase = e;
      this.lookAt.x += (f.at.x - this.lookAt.x) * e;
      this.lookAt.y += (f.at.y - this.lookAt.y) * e;
      this.lookAt.z += (f.at.z - this.lookAt.z) * e;
      if (f.left < -0.5) this.focus = null;
    } else {
      this.focusEase = 0;
    }
  }

  /** Distance from the eye to the orbit target, for fading the character. */
  get currentDistance(): number {
    return this.actual;
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
