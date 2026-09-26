/**
 * Constantes de juego (spec §5 "Constantes de partida", salen del PoC).
 * Es el único sitio donde viven: los tests de movimiento dependen de ellas.
 */
export const tuning = {
  /** Radio de colisión (m). */
  radius: 0.34,
  /** Altura del personaje (m). */
  height: 1.9,
  /** Subida automática de escalón (m). */
  stepUp: 0.55,

  /** Velocidad corriendo (m/s). */
  runSpeed: 5.4,
  /** Velocidad andando (m/s). */
  walkSpeed: 2.2,
  /** Aceleración horizontal (1/s): fracción de la diferencia que se corrige por segundo. */
  accel: 12,

  /** Gravedad (m/s²). */
  gravity: 24,
  /** Velocidad vertical inicial del salto (m/s). */
  jumpSpeed: 8.05,
  /** Control aéreo (m/s²). */
  airControl: 3,
  /** Velocidad horizontal máxima en el aire (m/s). */
  airMaxSpeed: 5.6,

  /** Velocidad de giro hacia la dirección de movimiento (rad/s). */
  turnSpeed: 12,
};

export type Tuning = typeof tuning;
