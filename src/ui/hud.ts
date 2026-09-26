/**
 * Minimal, near-diegetic HUD (spec §13, Claude Design artboard e): health only
 * when it matters, a context prompt, big brief notices, tutorial hints, the
 * death fade and the end-of-level screen. It only listens to sim events.
 */
import type { SimEvent } from '../core/events';
import { BLOCK, DIR_VEC, yawToDir } from '../sim/grid/units';
import { blockAt, type World } from '../sim/world';
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
  private readonly end = $('end');
  /** Red edges when Nora takes damage (spec §7 "Salud"); created here so the page markup stays as is. */
  private readonly hurtFlash = document.createElement('div');
  private readonly weaponsButton = document.querySelector<HTMLElement>('#touch [data-button="weapons"]');
  private weaponsDrawn = false;
  private healthShownFor = 0;
  private noticeTimer = 0;
  private hintTimer = 0;
  private lastHealth = 100;
  device: Device = 'keyboard';

  constructor(private readonly onRestart: () => void) {
    $('end-restart').addEventListener('click', () => this.onRestart());
    this.hurtFlash.id = 'hurt-flash';
    this.hurtFlash.setAttribute('aria-hidden', 'true');
    $('hud').append(this.hurtFlash);
  }

  showTitle(key: StringKey): void {
    this.title.textContent = t(key);
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
      case 'relic.taken':
        this.showNotice(t('notice.relic'), 'amber');
        break;
      case 'hint':
        this.showHint(t(String(e.key) as StringKey));
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
      case 'level.end':
        this.showEnd(world);
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

  private showEnd(world: World): void {
    const s = world.stats;
    const mins = Math.floor(s.time / 60);
    const secs = Math.floor(s.time % 60)
      .toString()
      .padStart(2, '0');
    const secretsTotal = world.level.entities.filter((e) => e.type === 'secret').length;
    const rows: [StringKey, string][] = [
      ['end.time', `${mins}:${secs}`],
      ['end.secrets', `${s.secrets} / ${secretsTotal}`],
      ['end.deaths', String(s.deaths)],
      ['end.distance', `${Math.round(s.distance)} m`],
    ];
    const enemies = world.state.enemies;
    if (enemies.length > 0) {
      const dead = enemies.filter((e) => e.mode === 'dead').length;
      rows.push(['end.enemies', `${dead} / ${enemies.length}`]);
    }
    if (s.shots > 0) rows.push(['end.accuracy', `${Math.round((100 * s.hits) / s.shots)} %`]);
    rows.push(['end.medkits', String(s.medkitsUsed)]);
    $('end-title').textContent = t('end.title');
    $('end-stats').innerHTML = rows
      .map(([k, v]) => `<div class="row"><span>${t(k)}</span><b>${v}</b></div>`)
      .join('');
    $('end-restart').textContent = t('end.restart');
    this.end.hidden = false;
    requestAnimationFrame(() => this.end.classList.add('show'));
    // Enter, Space or the pad's A replays straight away.
    $('end-restart').focus({ preventScroll: true });
  }

  hideEnd(): void {
    this.end.classList.remove('show');
    this.end.hidden = true;
  }

  get endVisible(): boolean {
    return !this.end.hidden;
  }

  /** Clears everything on screen (back to the title). */
  reset(): void {
    this.hideEnd();
    this.fade.classList.remove('dark');
    for (const el of [this.notice, this.hint, this.prompt, this.title, this.health])
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
    const showHealth = this.healthShownFor > 0 || p.health < 50;
    this.health.classList.toggle('show', showHealth);
    this.health.classList.toggle('low', p.health < 25);
    this.healthFill.style.width = `${p.health}%`;

    // The touch draw / holster button says what it will do and glows while armed.
    if (this.weaponsButton && p.weapon.drawn !== this.weaponsDrawn) {
      this.weaponsDrawn = p.weapon.drawn;
      this.weaponsButton.classList.toggle('armed', this.weaponsDrawn);
      const label = this.weaponsButton.querySelector('span');
      if (label) label.textContent = t(this.weaponsDrawn ? 'touch.holster' : 'touch.draw');
    }

    this.noticeTimer -= dt;
    if (this.noticeTimer <= 0) this.notice.classList.remove('show');
    this.hintTimer -= dt;
    if (this.hintTimer <= 0) this.hint.classList.remove('show');

    const key = this.promptFor(world);
    if (key) {
      const button = this.device === 'gamepad' ? 'X' : this.device === 'touch' ? '◉' : 'E';
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
    }
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
