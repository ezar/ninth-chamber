/**
 * Input devices (keyboard, gamepad and touch) merged into a RawInput.
 * Only this layer touches the DOM; the simulation receives InputFrames.
 */
import { buttonBit, type Button, type ButtonMask, type RawInput } from './input-frame';

export interface InputDevice {
  /** Current device state. */
  poll(): RawInput;
  /** Buttons pressed since the last call (even if already released). Clears them. */
  takeTapped(): ButtonMask;
  /** Camera look accumulated since the last call (px, or stick·s units). Clears it. */
  takeLook(): { x: number; y: number; zoom: number };
  dispose(): void;
}

// ───────────────────────────── Keyboard and mouse ─────────────────────────────

const KEY_BUTTONS: Record<string, Button> = {
  Space: 'jump',
  KeyE: 'action',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  KeyF: 'fire',
  KeyQ: 'roll',
  KeyR: 'weapons',
  KeyH: 'medkit',
  KeyG: 'flare',
  KeyI: 'inventory',
  Tab: 'inventory',
  Escape: 'pause',
  KeyC: 'recenter',
};

const KEY_AXES: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class KeyboardMouseDevice implements InputDevice {
  private keys = new Set<string>();
  private tapped: ButtonMask = 0;
  private look = { x: 0, y: 0, zoom: 0 };
  private dragging = false;
  private rightDown = false;
  private readonly off: (() => void)[] = [];

  constructor(private readonly target: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(
      el: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, 'keydown', (e) => {
      if (e.code in KEY_BUTTONS || e.code in KEY_AXES) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const b = KEY_BUTTONS[e.code];
      if (b) this.tapped |= buttonBit(b);
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => {
      this.keys.clear();
      this.rightDown = false;
      this.dragging = false;
    });

    on(target, 'pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.dragging = true;
      if (e.button === 2) {
        this.rightDown = true;
        this.tapped |= buttonBit('fire');
      }
    });
    on(window, 'pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.dragging = false;
      if (e.button === 2) this.rightDown = false;
    });
    on(window, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (this.dragging || document.pointerLockElement === target) {
        this.look.x += e.movementX;
        this.look.y += e.movementY;
      }
    });
    on(target, 'wheel', (e) => (this.look.zoom += Math.sign(e.deltaY)), { passive: true });
    on(target, 'contextmenu', (e) => e.preventDefault());
  }

  poll(): RawInput {
    let moveX = 0;
    let moveY = 0;
    let held: ButtonMask = 0;
    for (const code of this.keys) {
      const axis = KEY_AXES[code];
      if (axis) {
        moveX += axis[0];
        moveY += axis[1];
      }
      const b = KEY_BUTTONS[code];
      if (b) held |= buttonBit(b);
    }
    if (this.rightDown) held |= buttonBit('fire');
    return { moveX: Math.sign(moveX), moveY: Math.sign(moveY), held };
  }

  takeTapped(): ButtonMask {
    const t = this.tapped;
    this.tapped = 0;
    return t;
  }

  takeLook(): { x: number; y: number; zoom: number } {
    const l = this.look;
    this.look = { x: 0, y: 0, zoom: 0 };
    return l;
  }

  dispose(): void {
    this.off.forEach((f) => f());
  }
}

// ────────────────────────────────── Gamepad ──────────────────────────────────

/** Gamepad API standard mapping (spec §13). */
const PAD_BUTTONS: [number, Button][] = [
  [0, 'jump'], // A
  [2, 'action'], // X
  [1, 'roll'], // B
  [7, 'fire'], // RT
  [6, 'walk'], // LT
  [5, 'weapons'], // RB
  [4, 'flare'], // LB
  [3, 'medkit'], // Y
  [8, 'inventory'], // Select
  [9, 'pause'], // Start
  [11, 'recenter'], // right stick click
];

const DEADZONE = 0.18;
const deadzone = (v: number): number =>
  Math.abs(v) < DEADZONE ? 0 : (Math.sign(v) * (Math.abs(v) - DEADZONE)) / (1 - DEADZONE);

export class GamepadDevice implements InputDevice {
  private prevHeld: ButtonMask = 0;
  private tapped: ButtonMask = 0;
  private look = { x: 0, y: 0, zoom: 0 };
  private last: RawInput = { moveX: 0, moveY: 0, held: 0 };

  /** Called once per render frame with the elapsed time. */
  update(dt: number): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pads.find((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
    if (!pad) {
      this.last = { moveX: 0, moveY: 0, held: 0 };
      this.prevHeld = 0;
      return;
    }
    let held: ButtonMask = 0;
    for (const [i, b] of PAD_BUTTONS) {
      const btn = pad.buttons[i];
      if (btn && (btn.pressed || btn.value > 0.5)) held |= buttonBit(b);
    }
    this.tapped |= held & ~this.prevHeld;
    this.prevHeld = held;
    this.last = {
      moveX: deadzone(pad.axes[0] ?? 0),
      moveY: -deadzone(pad.axes[1] ?? 0),
      held,
    };
    // Right stick: units equivalent to mouse pixels.
    const LOOK_SPEED = 900;
    this.look.x += deadzone(pad.axes[2] ?? 0) * LOOK_SPEED * dt;
    this.look.y += deadzone(pad.axes[3] ?? 0) * LOOK_SPEED * dt;
  }

  poll(): RawInput {
    return this.last;
  }

  takeTapped(): ButtonMask {
    const t = this.tapped;
    this.tapped = 0;
    return t;
  }

  takeLook(): { x: number; y: number; zoom: number } {
    const l = this.look;
    this.look = { x: 0, y: 0, zoom: 0 };
    return l;
  }

  dispose(): void {}
}

// ─────────────────────────────────── Touch ───────────────────────────────────

const JOY_RADIUS = 60;

/**
 * Floating joystick on the left half, camera drag on the right half and
 * on-screen buttons (elements with data-button inside `root`).
 */
export class TouchDevice implements InputDevice {
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joy = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private look = { x: 0, y: 0, zoom: 0 };
  private buttons = new Map<number, Button>();
  private toggled: ButtonMask = 0;
  private tapped: ButtonMask = 0;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly root: HTMLElement,
    private readonly stick: { base: HTMLElement; knob: HTMLElement },
  ) {
    const listen = (el: HTMLElement, type: string, fn: (e: PointerEvent) => void): void => {
      el.addEventListener(type, fn as EventListener);
      this.off.push(() => el.removeEventListener(type, fn as EventListener));
    };

    listen(surface, 'pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.clientX < window.innerWidth / 2 && this.joyId === null) {
        this.joyId = e.pointerId;
        this.joyOrigin = { x: e.clientX, y: e.clientY };
        this.joy = { x: 0, y: 0 };
        this.showStick(true);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
    });
    listen(surface, 'pointermove', (e) => {
      if (e.pointerId === this.joyId) {
        let dx = e.clientX - this.joyOrigin.x;
        let dy = e.clientY - this.joyOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) {
          dx *= JOY_RADIUS / len;
          dy *= JOY_RADIUS / len;
        }
        this.joy = { x: dx / JOY_RADIUS, y: -dy / JOY_RADIUS };
        this.stick.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (e.pointerId === this.lookId) {
        this.look.x += (e.clientX - this.lookLast.x) * 1.4;
        this.look.y += (e.clientY - this.lookLast.y) * 1.4;
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.joy = { x: 0, y: 0 };
        this.showStick(false);
      }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    listen(surface, 'pointerup', end);
    listen(surface, 'pointercancel', end);

    for (const el of root.querySelectorAll<HTMLElement>('[data-button]')) {
      const b = el.dataset.button as Button;
      const toggle = el.dataset.toggle === 'true';
      listen(el, 'pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        if (toggle) {
          this.toggled ^= buttonBit(b);
          el.classList.toggle('on', (this.toggled & buttonBit(b)) !== 0);
          return;
        }
        this.buttons.set(e.pointerId, b);
        this.tapped |= buttonBit(b);
        el.classList.add('on');
      });
      const release = (e: PointerEvent): void => {
        if (this.buttons.delete(e.pointerId)) el.classList.remove('on');
      };
      listen(el, 'pointerup', release);
      listen(el, 'pointercancel', release);
    }
  }

  private showStick(visible: boolean): void {
    const { base, knob } = this.stick;
    base.style.display = visible ? 'block' : 'none';
    base.style.left = `${this.joyOrigin.x}px`;
    base.style.top = `${this.joyOrigin.y}px`;
    knob.style.transform = 'translate(0, 0)';
  }

  poll(): RawInput {
    let held = this.toggled;
    for (const b of this.buttons.values()) held |= buttonBit(b);
    return { moveX: this.joy.x, moveY: this.joy.y, held };
  }

  takeTapped(): ButtonMask {
    const t = this.tapped;
    this.tapped = 0;
    return t;
  }

  takeLook(): { x: number; y: number; zoom: number } {
    const l = this.look;
    this.look = { x: 0, y: 0, zoom: 0 };
    return l;
  }

  dispose(): void {
    this.off.forEach((f) => f());
  }
}

// ───────────────────────────── Device merging ─────────────────────────────

/** Merges several devices: axes are summed (and clamped), buttons are OR-ed. */
export function mergeDevices(devices: readonly InputDevice[]): {
  raw: RawInput;
  tapped: ButtonMask;
} {
  let moveX = 0;
  let moveY = 0;
  let held: ButtonMask = 0;
  let tapped: ButtonMask = 0;
  for (const d of devices) {
    const r = d.poll();
    moveX += r.moveX;
    moveY += r.moveY;
    held |= r.held;
    tapped |= d.takeTapped();
  }
  return {
    raw: { moveX: Math.max(-1, Math.min(1, moveX)), moveY: Math.max(-1, Math.min(1, moveY)), held },
    tapped,
  };
}
