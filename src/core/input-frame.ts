/**
 * InputFrame: la entrada de un tick como datos puros (spec §3).
 * Grabar la lista de InputFrame es grabar una partida.
 */

export const BUTTONS = [
  'jump',
  'action',
  'walk',
  'fire',
  'roll',
  'weapons',
  'medkit',
  'flare',
  'inventory',
  'pause',
  'recenter',
] as const;

export type Button = (typeof BUTTONS)[number];

/** Máscara de bits: un bit por botón, en el orden de BUTTONS. */
export type ButtonMask = number;

export const buttonBit = (b: Button): number => 1 << BUTTONS.indexOf(b);

export interface InputFrame {
  /** Eje de movimiento, x = derecha, y = adelante, longitud ≤ 1. */
  moveX: number;
  moveY: number;
  /**
   * Orientación de la cámara (radianes) en este tick. El movimiento es relativo
   * a cámara, así que forma parte de la entrada para que las repeticiones sean deterministas.
   */
  camYaw: number;
  held: ButtonMask;
  pressed: ButtonMask;
  released: ButtonMask;
}

export const emptyFrame = (): InputFrame => ({
  moveX: 0,
  moveY: 0,
  camYaw: 0,
  held: 0,
  pressed: 0,
  released: 0,
});

export const isHeld = (f: InputFrame, b: Button): boolean => (f.held & buttonBit(b)) !== 0;
export const isPressed = (f: InputFrame, b: Button): boolean => (f.pressed & buttonBit(b)) !== 0;
export const isReleased = (f: InputFrame, b: Button): boolean => (f.released & buttonBit(b)) !== 0;

/** Estado bruto que aporta cada dispositivo en un instante. */
export interface RawInput {
  moveX: number;
  moveY: number;
  held: ButtonMask;
}

/**
 * Convierte muestras brutas (unión de todos los dispositivos) en InputFrame,
 * calculando flancos de pulsación y suelta entre ticks consecutivos.
 *
 * Una pulsación y suelta que ocurren entre dos ticks no se pierde: los
 * dispositivos acumulan `tapped` y se funde aquí como pulsado.
 */
export class InputFramer {
  private prevHeld: ButtonMask = 0;

  next(raw: RawInput, tapped: ButtonMask, camYaw: number): InputFrame {
    let { moveX, moveY } = raw;
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    const held = raw.held;
    const pressed = ((held & ~this.prevHeld) | tapped) >>> 0;
    const released = (this.prevHeld & ~held) >>> 0;
    this.prevHeld = held;
    return { moveX, moveY, camYaw, held, pressed, released };
  }
}
