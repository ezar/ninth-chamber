/**
 * Pause menu and options (spec §13 "Menús"): Resume, Restart from checkpoint,
 * Options and Quit to title, plus the options screen shared with the title.
 * Keyboard, gamepad, mouse and touch all drive the same focus: the focused
 * item is the selected one, always marked in amber.
 */
import { version } from '../../package.json';
import { QUALITY_TIERS, type QualityTier } from '../render/quality';
import type { Device } from './hud';
import { t, type StringKey } from './i18n';
import {
  ADJUST_EVENT,
  DirectionRepeat,
  PAD,
  adjust,
  focusItem,
  moveFocus,
  navItems,
  padDirection,
  padHas,
  type PadSnapshot,
} from './pad';
import { SENSITIVITY_RANGE, type Language, type Settings } from './settings';

export type MenuContext = 'pause' | 'title';
type PanelName = 'pause' | 'options' | 'confirm';
type ConfirmAction = 'restart' | 'quit';

export interface MenuCallbacks {
  resume(): void;
  restart(): void;
  quit(): void;
  /** The options screen opened from the title was closed. */
  closed(): void;
  /** A setting changed (already written into the settings object). */
  change(key: keyof Settings): void;
}

interface OptionRow {
  el: HTMLElement;
  refresh(): void;
  step(dir: -1 | 1): void;
  /** Enter / Space / A. */
  activate(): void;
}

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

let rowIds = 0;

export class Menu {
  private readonly root = byId('menu');
  private readonly list = byId('options-list');
  private readonly hints = byId('menu-hints');
  private context: MenuContext = 'pause';
  private panel: PanelName = 'pause';
  private confirming: ConfirmAction | null = null;
  private readonly rows: OptionRow[] = [];
  private readonly repeat = new DirectionRepeat();
  private device: Device = 'keyboard';

  constructor(
    private readonly settings: Settings,
    private readonly cb: MenuCallbacks,
  ) {
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (el?.dataset.action) this.action(el.dataset.action);
    });
    // The hovered item becomes the focused one, so there is a single selection.
    this.root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
      if (item && item !== document.activeElement) item.focus({ preventScroll: true });
    });
    this.buildOptions();
    byId('menu-version').textContent = `v${version}`;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(context: MenuContext): void {
    this.context = context;
    this.root.hidden = false;
    this.root.dataset.context = context;
    this.repeat.reset();
    this.refresh();
    this.show(context === 'pause' ? 'pause' : 'options');
    requestAnimationFrame(() => this.root.classList.add('show'));
  }

  close(): void {
    this.root.classList.remove('show');
    this.root.hidden = true;
    this.confirming = null;
  }

  /** Escape / B: one step back, closing from the top level. */
  back(): void {
    if (this.panel === 'confirm') {
      this.show('pause', this.confirming ?? undefined);
      this.confirming = null;
    } else if (this.panel === 'options') {
      if (this.context === 'title') this.cb.closed();
      else this.show('pause', 'options');
    } else {
      this.cb.resume();
    }
  }

  /** Re-renders every text (after a language change). */
  refresh(): void {
    for (const r of this.rows) r.refresh();
    if (this.confirming) this.fillConfirm(this.confirming);
    this.renderHints();
  }

  setDevice(device: Device): void {
    if (device === this.device) return;
    this.device = device;
    this.root.dataset.device = device;
    this.renderHints();
  }

  /** Keyboard navigation; returns true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    const panel = this.panelEl();
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        moveFocus(panel, -1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        moveFocus(panel, 1);
        break;
      case 'Tab':
        moveFocus(panel, e.shiftKey ? -1 : 1);
        break;
      case 'ArrowLeft':
      case 'KeyA':
        adjust(document.activeElement, -1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        adjust(document.activeElement, 1);
        break;
      case 'Home':
        focusItem(navItems(panel)[0]);
        break;
      case 'End':
        focusItem(navItems(panel).at(-1));
        break;
      case 'Escape':
      case 'Backspace':
        if (!e.repeat) this.back();
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        if (!e.repeat) this.activateFocused();
        break;
      default:
        return false;
    }
    this.setDevice('keyboard');
    e.preventDefault();
    return true;
  }

  /** Gamepad navigation, once per frame while open. */
  update(pad: PadSnapshot, dt: number): void {
    if (!this.isOpen || !pad.connected) {
      this.repeat.reset();
      return;
    }
    const panel = this.panelEl();
    const dir = this.repeat.update(padDirection(pad), dt);
    if (dir) this.setDevice('gamepad');
    if (dir === 'up') moveFocus(panel, -1);
    else if (dir === 'down') moveFocus(panel, 1);
    else if (dir === 'left') adjust(document.activeElement, -1);
    else if (dir === 'right') adjust(document.activeElement, 1);
    if (pad.pressed) this.setDevice('gamepad');
    if (padHas(pad.pressed, PAD.A)) this.activateFocused();
    else if (padHas(pad.pressed, PAD.B)) this.back();
    else if (padHas(pad.pressed, PAD.START) && this.context === 'pause') this.cb.resume();
  }

  private panelEl(): HTMLElement {
    return this.root.querySelector<HTMLElement>(`[data-panel="${this.panel}"]`) ?? this.root;
  }

  private show(panel: PanelName, focusAction?: string): void {
    this.panel = panel;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-panel]')) {
      el.hidden = el.dataset.panel !== panel;
    }
    const current = this.panelEl();
    const heading = current.querySelector('h2');
    if (heading?.id) this.root.setAttribute('aria-labelledby', heading.id);
    const target = focusAction
      ? current.querySelector<HTMLElement>(`[data-action="${focusAction}"]`)
      : panel === 'confirm'
        ? current.querySelector<HTMLElement>('[data-action="cancel"]')
        : navItems(current)[0];
    focusItem(target ?? navItems(current)[0]);
    if (panel === 'options') this.list.scrollTop = 0;
  }

  private activateFocused(): void {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !this.root.contains(el) || !el.hasAttribute('data-nav')) {
      focusItem(navItems(this.panelEl())[0]);
      return;
    }
    const row = this.rows.find((r) => r.el === el);
    if (row) row.activate();
    else el.click();
  }

  private action(name: string): void {
    switch (name) {
      case 'resume':
        this.cb.resume();
        break;
      case 'restart':
      case 'quit':
        this.confirming = name;
        this.fillConfirm(name);
        this.show('confirm');
        break;
      case 'options':
        this.show('options');
        break;
      case 'back':
        this.back();
        break;
      case 'cancel':
        this.back();
        break;
      case 'confirm': {
        const what = this.confirming;
        this.confirming = null;
        if (what === 'restart') this.cb.restart();
        else if (what === 'quit') this.cb.quit();
        break;
      }
      default:
        break;
    }
  }

  private fillConfirm(what: ConfirmAction): void {
    byId('confirm-title').textContent = t(`confirm.${what}.title`);
    byId('confirm-body').textContent = t(`confirm.${what}.body`);
    byId('confirm-ok').textContent = t(`confirm.${what}.ok`);
  }

  private renderHints(): void {
    const pad = this.device === 'gamepad';
    const items: [string, StringKey][] = [
      ['↑↓', 'menu.hint.select'],
      ['←→', 'menu.hint.change'],
      [pad ? 'A' : 'Enter', 'menu.hint.confirm'],
      [pad ? 'B' : 'Esc', 'menu.hint.back'],
    ];
    this.hints.replaceChildren(
      ...items.map(([key, label]) => {
        const span = document.createElement('span');
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        span.append(kbd, t(label));
        return span;
      }),
    );
  }

  // ─────────────────────────────── Options ───────────────────────────────

  private buildOptions(): void {
    const s = this.settings;
    const group = (label: StringKey): void => {
      const h = document.createElement('h3');
      h.className = 'opt-group';
      h.dataset.i18n = label;
      h.textContent = t(label);
      this.list.append(h);
    };
    const pct = (v: number): string => `${Math.round(v * 100)}`;

    group('options.group.graphics');
    // Lowest to highest, so "right" always means more.
    const tiers = [...QUALITY_TIERS].reverse();
    this.addRow(
      choiceRow<QualityTier>(
        'options.quality',
        tiers,
        () => s.quality ?? 'high',
        (v) => {
          s.quality = v;
          s.qualitySource = 'user';
          this.cb.change('quality');
        },
        (v) => t(`options.quality.${v}`),
        () => {
          const tier = s.quality ?? 'high';
          const hint = t(`options.quality.${tier}.hint`);
          return s.qualitySource === 'auto' ? `${hint} ${t('options.quality.auto')}` : hint;
        },
      ),
    );

    group('options.group.audio');
    for (const [key, label] of [
      ['masterVolume', 'options.master'],
      ['musicVolume', 'options.music'],
      ['sfxVolume', 'options.sfx'],
    ] as const) {
      this.addRow(
        rangeRow(
          label,
          { min: 0, max: 1, step: 0.1 },
          () => s[key],
          (v) => {
            s[key] = v;
            this.cb.change(key);
          },
          pct,
        ),
      );
    }

    group('options.group.camera');
    this.addRow(
      rangeRow(
        'options.sensitivity',
        SENSITIVITY_RANGE,
        () => s.cameraSensitivity,
        (v) => {
          s.cameraSensitivity = v;
          this.cb.change('cameraSensitivity');
        },
        (v) => `${v.toFixed(2)}×`,
      ),
    );
    this.addRow(
      toggleRow(
        'options.invertY',
        () => s.invertY,
        (v) => {
          s.invertY = v;
          this.cb.change('invertY');
        },
      ),
    );

    group('options.group.access');
    this.addRow(
      toggleRow(
        'options.reducedMotion',
        () => s.reducedMotion,
        (v) => {
          s.reducedMotion = v;
          this.cb.change('reducedMotion');
        },
        () => t('options.reducedMotion.hint'),
      ),
    );
    this.addRow(
      toggleRow(
        'options.subtitles',
        () => s.subtitles,
        (v) => {
          s.subtitles = v;
          this.cb.change('subtitles');
        },
        () => t('options.subtitles.hint'),
      ),
    );
    this.addRow(
      choiceRow<Language>(
        'options.language',
        ['en', 'es'],
        () => s.language ?? (document.documentElement.lang === 'es' ? 'es' : 'en'),
        (v) => {
          s.language = v;
          this.cb.change('language');
        },
        (v) => t(`lang.${v}`),
      ),
    );
  }

  private addRow(row: OptionRow): void {
    this.rows.push(row);
    this.list.append(row.el);
    row.el.addEventListener(ADJUST_EVENT, (e) => {
      const step = (e as CustomEvent<number>).detail;
      row.step(step < 0 ? -1 : 1);
    });
    row.el.addEventListener('click', (e) => {
      const arrow = (e.target as HTMLElement).closest<HTMLElement>('[data-step]');
      if (arrow) row.step(arrow.dataset.step === '-1' ? -1 : 1);
      row.el.focus({ preventScroll: true });
    });
  }
}

// ─────────────────────────────── Option rows ───────────────────────────────

function rowShell(
  label: StringKey,
  role: 'slider' | 'switch',
): {
  el: HTMLElement;
  labelEl: HTMLElement;
  value: HTMLElement;
  prev: HTMLElement;
  next: HTMLElement;
  hint: HTMLElement;
} {
  const id = `opt-${rowIds++}`;
  const el = document.createElement('div');
  el.className = 'opt';
  el.tabIndex = 0;
  el.dataset.nav = '';
  el.setAttribute('role', role);
  el.setAttribute('aria-labelledby', `${id}-label`);
  el.setAttribute('aria-describedby', `${id}-hint`);
  el.innerHTML = `
    <div class="opt-main">
      <span class="opt-label" id="${id}-label"></span>
      <span class="opt-control">
        <span class="opt-arrow" data-step="-1" aria-hidden="true"></span>
        <span class="opt-value"></span>
        <span class="opt-arrow" data-step="1" aria-hidden="true"></span>
      </span>
    </div>
    <p class="opt-hint" id="${id}-hint"></p>`;
  const q = (sel: string): HTMLElement => el.querySelector<HTMLElement>(sel) as HTMLElement;
  const labelEl = q('.opt-label');
  labelEl.dataset.i18n = label;
  return {
    el,
    labelEl,
    value: q('.opt-value'),
    prev: q('[data-step="-1"]'),
    next: q('[data-step="1"]'),
    hint: q('.opt-hint'),
  };
}

function setHint(hintEl: HTMLElement, text: string | null): void {
  hintEl.textContent = text ?? '';
  hintEl.hidden = !text;
}

function choiceRow<T extends string>(
  label: StringKey,
  values: readonly T[],
  get: () => T,
  set: (v: T) => void,
  text: (v: T) => string,
  hint?: () => string | null,
): OptionRow {
  const r = rowShell(label, 'slider');
  const wrap = values.length <= 2;
  const index = (): number => Math.max(0, values.indexOf(get()));
  const refresh = (): void => {
    const i = index();
    const v = values[i] as T;
    r.labelEl.textContent = t(label);
    r.value.textContent = text(v);
    r.el.setAttribute('aria-valuetext', text(v));
    r.el.setAttribute('aria-valuenow', String(i));
    r.el.setAttribute('aria-valuemin', '0');
    r.el.setAttribute('aria-valuemax', String(values.length - 1));
    r.prev.classList.toggle('off', !wrap && i === 0);
    r.next.classList.toggle('off', !wrap && i === values.length - 1);
    setHint(r.hint, hint ? hint() : null);
  };
  const step = (dir: -1 | 1): void => {
    const i = index();
    const n = wrap
      ? (i + dir + values.length) % values.length
      : Math.min(values.length - 1, Math.max(0, i + dir));
    if (n === i) return;
    set(values[n] as T);
    refresh();
  };
  refresh();
  return { el: r.el, refresh, step, activate: () => step(1) };
}

function rangeRow(
  label: StringKey,
  range: { min: number; max: number; step: number },
  get: () => number,
  set: (v: number) => void,
  format: (v: number) => string,
): OptionRow {
  const r = rowShell(label, 'slider');
  const segments = Math.round((range.max - range.min) / range.step);
  r.value.classList.add('opt-range');
  const bar = document.createElement('span');
  bar.className = 'opt-bar';
  for (let i = 0; i < segments; i++) bar.append(document.createElement('i'));
  const num = document.createElement('span');
  num.className = 'opt-num';
  r.value.append(bar, num);
  const snap = (v: number): number =>
    Math.min(
      range.max,
      Math.max(range.min, Math.round((v - range.min) / range.step) * range.step + range.min),
    );
  const refresh = (): void => {
    const v = get();
    r.labelEl.textContent = t(label);
    const filled = Math.round((v - range.min) / range.step);
    bar.querySelectorAll('i').forEach((seg, i) => seg.classList.toggle('on', i < filled));
    num.textContent = format(v);
    r.el.setAttribute('aria-valuetext', format(v));
    r.el.setAttribute('aria-valuenow', String(v));
    r.el.setAttribute('aria-valuemin', String(range.min));
    r.el.setAttribute('aria-valuemax', String(range.max));
    r.prev.classList.toggle('off', v <= range.min + 1e-6);
    r.next.classList.toggle('off', v >= range.max - 1e-6);
    setHint(r.hint, null);
  };
  const apply = (v: number): void => {
    const n = snap(v);
    if (Math.abs(n - get()) < 1e-6) return;
    set(Math.round(n * 1000) / 1000);
    refresh();
  };
  // Pointer: tap or drag along the bar.
  const fromPointer = (e: PointerEvent): void => {
    const box = bar.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (e.clientX - box.left) / Math.max(1, box.width)));
    apply(range.min + Math.ceil(k * segments - 0.25) * range.step);
  };
  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  bar.addEventListener('pointermove', (e) => {
    if (bar.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  refresh();
  return {
    el: r.el,
    refresh,
    step: (dir) => apply(get() + dir * range.step),
    activate: () => undefined,
  };
}

function toggleRow(
  label: StringKey,
  get: () => boolean,
  set: (v: boolean) => void,
  hint?: () => string | null,
): OptionRow {
  const r = rowShell(label, 'switch');
  const refresh = (): void => {
    const v = get();
    r.labelEl.textContent = t(label);
    r.value.textContent = t(v ? 'options.on' : 'options.off');
    r.value.classList.toggle('is-on', v);
    r.el.setAttribute('aria-checked', String(v));
    setHint(r.hint, hint ? hint() : null);
  };
  const flip = (): void => {
    set(!get());
    refresh();
  };
  refresh();
  return { el: r.el, refresh, step: flip, activate: flip };
}
