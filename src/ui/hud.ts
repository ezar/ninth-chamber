/**
 * Minimal, near-diegetic HUD (spec §13, Claude Design artboard e): health only
 * when it matters, a context prompt, big brief notices, tutorial hints and the
 * death fade. It only listens to sim events (the end of the level has its own
 * screen, ui/end-screen.ts).
 */
import { actionLabel } from './control-labels';
import type { SimEvent } from '../core/events';
import { BLOCK, DIR_VEC, yawToDir } from '../sim/grid/units';
import { blockAt, type World } from '../sim/world';
import { brazierInReach } from '../sim/player/torch';
import { chamberOf } from './campaign';
import { t, type StringKey } from './i18n';

export type Device = 'keyboard' | 'gamepad' | 'touch';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

export class Hud {
  private readonly health = $('hud-health');
  private readonly healthFill = $('hud-health-fill');
  private readonly prompt = $('hud-prompt');
  private readonly notice = $('hud-notice');
  private readonly hint = $('hud-hint');
  private readonly title = $('hud-title');
  private readonly fade = $('fade');
  /** Red edges when Nora takes damage (spec §7 "Salud"); created here so the page markup stays as is. */
  private readonly hurtFlash = document.createElement('div');
  /** Hot edges in the Forge's open heat. */
  private readonly heat = document.createElement('div');
  private readonly weaponsButton = document.querySelector<HTMLElement>('#touch [data-button="weapons"]');
  private weaponsDrawn = false;
  private readonly torchButton = document.querySelector<HTMLElement>('#touch [data-button="torch"]');
  private torchShown = '';
  private healthShownFor = 0;
  private noticeTimer = 0;
  private hintTimer = 0;
  private lastHealth = 100;
  device: Device = 'keyboard';

  constructor() {
    this.hurtFlash.id = 'hurt-flash';
    this.hurtFlash.setAttribute('aria-hidden', 'true');
    this.heat.id = 'heat-haze';
    this.heat.setAttribute('aria-hidden', 'true');
    $('hud').append(this.hurtFlash, this.heat);
  }

  /** The level title, with an optional kicker line above it (e.g. the tomb and chamber). */
  showTitle(key: StringKey, kicker?: StringKey): void {
    this.title.replaceChildren();
    if (kicker) {
      const k = document.createElement('span');
      k.className = 'kicker';
      k.textContent = t(kicker);
      this.title.append(k);
    }
    this.title.append(t(key));
    this.title.classList.remove('show');
    void this.title.offsetWidth;
    this.title.classList.add('show');
  }

  onEvent(e: SimEvent, world: World): void {
    switch (e.type) {
      case 'checkpoint':
        if (world.tick > 1) this.showNotice(t('notice.checkpoint'), 'lichen');
        break;
      case 'secret.found':
        this.showNotice(t('notice.secret'), 'amber');
        break;
      case 'relic.taken': {
        const relic = chamberOf(world.level.id)?.relic;
        if (relic) this.showNotice(t(relic.name), 'amber');
        break;
      }
      case 'hint':
        this.showHint(t(String(e.key) as StringKey));
        break;
      // Dispatched by main when Nora first has an idea about the room's puzzle.
      case 'hint.offer':
        this.showHint(t('hint.offer'));
        break;
      case 'player.hurt':
        this.hurtFlash.classList.remove('show');
        void this.hurtFlash.offsetWidth;
        this.hurtFlash.classList.add('show');
        requestAnimationFrame(() => this.hurtFlash.classList.remove('show'));
        break;
      case 'player.died':
        this.showNotice(t('notice.died'), 'ember');
        this.fade.classList.add('dark');
        break;
      case 'player.respawned':
        this.fade.classList.remove('dark');
        break;
      // The Forge's heat (spec §19): a hot shimmer at the edges while it drains her.
      case 'heat.enter':
        this.heat.classList.add('show');
        break;
      case 'heat.leave':
        this.heat.classList.remove('show');
        break;
      // Dispatched by the note reader when it closes.
      case 'note.closed':
        if (e.first === true)
          this.showNotice(t('notice.journal', { n: Number(e.count), total: Number(e.total) }), 'amber');
        break;
      default:
        break;
    }
  }

  private showNotice(text: string, tone: 'amber' | 'lichen' | 'ember'): void {
    this.notice.textContent = text;
    this.notice.dataset.tone = tone;
    this.notice.classList.add('show');
    this.noticeTimer = 3;
  }

  private showHint(text: string): void {
    this.hint.textContent = text;
    this.hint.classList.add('show');
    this.hintTimer = 7;
  }

  /** Clears everything on screen (back to the title). */
  reset(): void {
    this.fade.classList.remove('dark');
    for (const el of [this.notice, this.hint, this.prompt, this.title, this.health, this.heat])
      el.classList.remove('show');
    this.noticeTimer = 0;
    this.hintTimer = 0;
    this.healthShownFor = 0;
    this.lastHealth = 100;
  }

  update(world: World, dt: number): void {
    const p = world.state.player;
    if (p.health !== this.lastHealth) {
      this.healthShownFor = 3;
      this.lastHealth = p.health;
    }
    this.healthShownFor -= dt;
    const poisoned = p.poison > 0;
    const showHealth = this.healthShownFor > 0 || p.health < 50 || poisoned;
    this.health.classList.toggle('show', showHealth);
    this.health.classList.toggle('low', p.health < 25 && !poisoned);
    // Poison drains the bar: it changes colour and pattern while it lasts (colour-safe under Options).
    this.health.classList.toggle('poisoned', poisoned);
    this.healthFill.style.width = `${p.health}%`;

    // The touch draw / holster button says what it will do and glows while armed.
    if (this.weaponsButton && p.weapon.drawn !== this.weaponsDrawn) {
      this.weaponsDrawn = p.weapon.drawn;
      this.weaponsButton.classList.toggle('armed', this.weaponsDrawn);
      const label = this.weaponsButton.querySelector('span');
      if (label) label.textContent = t(this.weaponsDrawn ? 'touch.holster' : 'touch.draw');
    }

    // The torch button appears once she carries one and glows while it burns in her hand.
    const torchKey = `${p.torch.has}|${p.torch.has && p.torch.lit && !p.torch.stowed}`;
    if (torchKey !== this.torchShown) {
      this.torchShown = torchKey;
      document.body.classList.toggle('has-torch', p.torch.has);
      this.torchButton?.classList.toggle('lit', p.torch.has && p.torch.lit && !p.torch.stowed);
    }

    this.noticeTimer -= dt;
    if (this.noticeTimer <= 0) this.notice.classList.remove('show');
    this.hintTimer -= dt;
    if (this.hintTimer <= 0) this.hint.classList.remove('show');

    const key = this.promptFor(world);
    if (key) {
      const button = actionLabel(this.device);
      this.prompt.innerHTML = `<kbd>${button}</kbd>${t(key)}`;
      this.prompt.classList.add('show');
    } else {
      this.prompt.classList.remove('show');
    }
    document.body.classList.toggle('can-act', key !== null);
  }

  private promptFor(world: World): StringKey | null {
    const p = world.state.player;
    if (p.mode !== 'ground') return null;
    const cx = Math.floor(p.pos.x / BLOCK);
    const cz = Math.floor(p.pos.z / BLOCK);
    for (const a of world.state.actors) {
      if (a.cx !== cx || a.cz !== cz) continue;
      if (a.kind === 'lever' && !a.used) return 'prompt.lever';
      if ((a.kind === 'secret' || a.kind === 'relic') && !a.taken) return 'prompt.pickup';
      if (a.kind === 'note') return 'prompt.read';
      if (a.kind === 'torch' && !a.taken) return 'prompt.pickup';
    }
    if (brazierInReach(world)) return 'prompt.lightTorch';
    const v = DIR_VEC[yawToDir(p.yaw)];
    const b = blockAt(world, cx + v.x, cz + v.z);
    if (b && Math.abs(b.y - p.pos.y) < 0.05) {
      const edge =
        v.x !== 0
          ? v.x > 0
            ? (cx + 1) * BLOCK - p.pos.x
            : p.pos.x - cx * BLOCK
          : v.z > 0
            ? (cz + 1) * BLOCK - p.pos.z
            : p.pos.z - cz * BLOCK;
      if (edge < 0.7) return 'prompt.block';
    }
    return null;
  }
}
