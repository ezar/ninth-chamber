/**
 * Cámara orbital en tercera persona (spec §6). Hito 1: órbita y zoom sin colisión.
 */
const DEG = Math.PI / 180;

export const cameraTuning = {
  targetHeight: 1.45,
  distance: 5.6,
  minDistance: 3,
  maxDistance: 9,
  minPitch: -14 * DEG,
  maxPitch: 66 * DEG,
  follow: 10,
  /** Radianes por píxel de ratón. */
  sensitivity: 0.005,
};

export class OrbitCamera {
  yaw = 0;
  pitch = 18 * DEG;
  distance = cameraTuning.distance;
  readonly target = { x: 0, y: cameraTuning.targetHeight, z: 0 };

  look(dx: number, dy: number, zoom: number): void {
    this.yaw -= dx * cameraTuning.sensitivity;
    this.pitch = Math.max(
      cameraTuning.minPitch,
      Math.min(cameraTuning.maxPitch, this.pitch + dy * cameraTuning.sensitivity),
    );
    this.distance = Math.max(
      cameraTuning.minDistance,
      Math.min(cameraTuning.maxDistance, this.distance + zoom * 0.5),
    );
  }

  /** Recentrar detrás del personaje. */
  recenter(playerYaw: number): void {
    this.yaw = playerYaw;
  }

  follow(x: number, y: number, z: number, dt: number): void {
    const k = 1 - Math.exp(-cameraTuning.follow * dt);
    this.target.x += (x - this.target.x) * k;
    this.target.y += (y + cameraTuning.targetHeight - this.target.y) * k;
    this.target.z += (z - this.target.z) * k;
  }

  /** Posición del ojo según yaw, pitch y distancia. */
  eye(): { x: number; y: number; z: number } {
    const h = Math.cos(this.pitch) * this.distance;
    return {
      x: this.target.x + Math.sin(this.yaw) * h,
      y: this.target.y + Math.sin(this.pitch) * this.distance,
      z: this.target.z + Math.cos(this.yaw) * h,
    };
  }
}
