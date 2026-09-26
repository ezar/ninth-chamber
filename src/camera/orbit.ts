/**
 * Third-person orbit camera (spec §6): player-controlled orbit with grid
 * collision, slow distance recovery, auto-framing while hanging and level
 * focus shots.
 */
import { raycast, type GridQuery } from '../sim/grid/collision';

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
};

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
  private focus: { at: Vec3; left: number; blend: number } | null = null;
  private focusEase = 0;
  private autoYaw: number | null = null;

  look(dx: number, dy: number, zoom: number): void {
    if (dx !== 0 || dy !== 0) this.autoYaw = null;
    this.yaw -= dx * cameraTuning.sensitivity;
    const pitchDelta = (cameraTuning.invertY ? -dy : dy) * cameraTuning.sensitivity;
    this.pitch = Math.max(cameraTuning.minPitch, Math.min(cameraTuning.maxPitch, this.pitch + pitchDelta));
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

  update(player: Vec3, hanging: boolean, grid: GridQuery, dt: number): void {
    if (!Number.isFinite(this.target.x + this.target.y + this.target.z)) {
      this.target.x = player.x;
      this.target.y = player.y;
      this.target.z = player.z;
    }
    if (this.autoYaw !== null) {
      let d = this.autoYaw - this.yaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += d * Math.min(1, dt * 4);
      if (Math.abs(d) < 0.01) this.autoYaw = null;
    }
    const k = 1 - Math.exp(-cameraTuning.follow * dt);
    const th = hanging ? cameraTuning.hangTargetHeight : cameraTuning.targetHeight;
    this.target.x += (player.x - this.target.x) * k;
    this.target.y += (player.y + th - this.target.y) * k;
    this.target.z += (player.z - this.target.z) * k;

    const h = Math.cos(this.pitch);
    const dir = { x: Math.sin(this.yaw) * h, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * h };
    const want = {
      x: this.target.x + dir.x * (this.distance + cameraTuning.radius),
      y: this.target.y + dir.y * (this.distance + cameraTuning.radius),
      z: this.target.z + dir.z * (this.distance + cameraTuning.radius),
    };
    const free =
      raycast(grid, this.target, want, 0.05) * (this.distance + cameraTuning.radius) - cameraTuning.radius;
    const allowed = Math.max(0.3, Math.min(this.distance, free));
    // Snap in on collision, ease back out slowly so passing columns does not jerk.
    this.actual =
      allowed < this.actual
        ? allowed
        : this.actual + (allowed - this.actual) * Math.min(1, dt / cameraTuning.recover);

    this.eye.x = this.target.x + dir.x * this.actual;
    this.eye.y = this.target.y + dir.y * this.actual;
    this.eye.z = this.target.z + dir.z * this.actual;
    this.lookAt.x = this.target.x;
    this.lookAt.y = this.target.y;
    this.lookAt.z = this.target.z;

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
