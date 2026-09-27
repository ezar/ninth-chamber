/**
 * End of the level (spec §9 "Estadísticas de nivel"): the relic moment with
 * the clue carved inside the relic (ui/campaign.ts), the stats and the seal
 * they earn, the best run kept in localStorage and the next chamber teaser.
 *
 * Audio hooks (via `cue`): `end.show` { rank, score, newRecord }, `end.reveal`.
 */
import { rating } from '../sim/player/tuning';
import { rateLevel } from '../sim/rating';
import type { World } from '../sim/world';
import { chamberOf, nextChamber } from './campaign';
import { t, type StringKey } from './i18n';
import { focusFirst, menuKey, menuPad, type PadEdges } from './nav';
import { recordRun } from './records';
import { relicFigureSvg } from './relic-figures';
import { sealSvg } from './seal';

/** Stone segments lit on the rank seal, per rank; the amber seal also fills the ninth. */
const LIT = [1, 3, 5, 7, 8];
/** When the record column appears if nothing is pressed (s); matches the CSS delays. */
const RECORD_AT = 7;
/** Input during the first moments (still running or walking) does not skip the relic moment (s). */
const SKIP_GRACE = 1.5;

export const formatTime = (s: number): string =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

export class EndScreen {
  private readonly root = $('end');
  private readonly actions = $('end-actions');
  private revealTimer = 0;
  private shownAt = 0;

  constructor(
    onRestart: () => void,
    onMenu: () => void,
    private readonly cue: (type: string, data?: Record<string, unknown>) => void,
    onNext: (levelId: string) => void = () => {},
  ) {
    $('end-next').addEventListener('click', () => {
      const id = $('end-next').dataset.level;
      if (id) onNext(id);
    });
    $('end-restart').addEventListener('click', onRestart);
    $('end-menu').addEventListener('click', onMenu);
    this.root.addEventListener('pointerdown', () => this.skip());
    window.addEventListener('keydown', (e) => {
      if (!this.visible || e.repeat) return;
      if (!this.revealed) {
        e.preventDefault();
        this.skip();
        return;
      }
      menuKey(e, this.actions);
    });
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  private get revealed(): boolean {
    return this.root.classList.contains('revealed');
  }

  /**
   * Shows the end of `world`'s level. `playable` says whether a level id can
   * be played in this build (the teaser says "coming soon" otherwise).
   */
  show(world: World, playable: (levelId: string) => boolean = () => false): void {
    const { stats, level } = world;
    this.showStory(level.id, playable);
    const count = (type: string): number => level.entities.filter((e) => e.type === type).length;
    const totals = { secrets: count('secret'), notes: count('note') };
    const result = rateLevel(stats, totals, level.par ?? rating.defaultPar);
    const rankName = t(`rank.${result.rank}` as StringKey);
    const record = recordRun(level.id, {
      time: stats.time,
      rankIndex: result.rankIndex,
      score: result.score,
    });

    $('end-seal').innerHTML = sealSvg({
      lit: LIT[result.rankIndex] ?? 8,
      ninth: result.rank === 'amber' ? 'filled' : 'outline',
      label: rankName,
    });
    $('end-seal').dataset.rank = result.rank;
    $('end-rank-name').textContent = rankName;
    $('end-score').textContent = t('end.score', { score: result.score });

    const rows: [StringKey, string][] = [
      ['end.time', formatTime(stats.time)],
      ['end.secrets', `${stats.secrets} / ${totals.secrets}`],
      ['end.notes', `${stats.notes.length} / ${totals.notes}`],
      ['end.deaths', String(stats.deaths)],
      ['end.distance', `${Math.round(stats.distance)} m`],
    ];
    // Combat (spec §9): enemies, accuracy and medkits used.
    const enemies = world.state.enemies;
    if (enemies.length > 0)
      rows.push(['end.enemies', `${enemies.filter((e) => e.mode === 'dead').length} / ${enemies.length}`]);
    if (stats.shots > 0) rows.push(['end.accuracy', `${Math.round((100 * stats.hits) / stats.shots)} %`]);
    rows.push(['end.medkits', String(stats.medkitsUsed)]);
    const list = $('end-stats');
    list.replaceChildren();
    for (const [k, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = t(k);
      const dd = document.createElement('dd');
      dd.textContent = value;
      list.append(dt, dd);
    }

    const best = $('end-best');
    const bestRank = rating.ranks[record.best.rankIndex]?.id ?? 'sand';
    best.replaceChildren(
      `${t('end.best')} · ${formatTime(record.best.time)} · ${t(`rank.${bestRank}` as StringKey)}`,
    );
    const newRecord = record.newTime || record.newRank;
    if (newRecord) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t('end.newBest');
      best.append(tag);
    }

    this.root.classList.remove('show', 'revealed');
    this.root.hidden = false;
    this.shownAt = performance.now();
    requestAnimationFrame(() => this.root.classList.add('show'));
    window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => this.reveal(), RECORD_AT * 1000);
    this.cue('end.show', { rank: result.rank, score: result.score, newRecord });
  }

  /** The relic moment and the teaser for what comes next. */
  private showStory(levelId: string, playable: (levelId: string) => boolean): void {
    const relic = chamberOf(levelId)?.relic;
    const text = (key: StringKey | undefined): string => (key ? t(key) : '');
    $('end-kicker').textContent = text(relic?.cleared);
    $('end-title').textContent = text(relic?.name);
    $('end-figure').innerHTML = relic ? relicFigureSvg(relic.figure, t(relic.figureLabel)) : '';
    this.root.querySelectorAll<HTMLElement>('.relic-line').forEach((el, i) => {
      el.textContent = text(relic?.moment[i]);
    });

    // Next chamber, or the chambers still sealed after the last playable one.
    const next = nextChamber(levelId);
    const open = next?.level !== undefined;
    $('end-next-label').textContent = t(open ? 'end.next' : 'end.remaining');
    $('end-next-name').textContent = open && next ? t(next.name) : '';
    $('end-next-name').hidden = !open;
    $('end-next-line').textContent = text(chamberOf(levelId)?.teaser);
    const ready = open && playable(next?.level ?? '');
    $('end-next-soon').hidden = !open || ready;
    // "Enter the next chamber" once that chamber can be played in this build.
    const button = $('end-next');
    button.hidden = !ready;
    if (ready && next?.level) button.dataset.level = next.level;
    else delete button.dataset.level;
    this.root.querySelector('.end-teaser')?.toggleAttribute('hidden', !next);
  }

  /** Player input during the staged entrance: shows everything, after a short grace. */
  private skip(): void {
    if (performance.now() - this.shownAt >= SKIP_GRACE * 1000) this.reveal();
  }

  /** Ends the staged entrance and focuses the first action. */
  reveal(): void {
    if (!this.visible || this.revealed) return;
    window.clearTimeout(this.revealTimer);
    this.root.classList.add('revealed');
    focusFirst(this.actions);
    this.cue('end.reveal');
  }

  hide(): void {
    window.clearTimeout(this.revealTimer);
    this.root.classList.remove('show', 'revealed');
    this.root.hidden = true;
  }

  pad(p: PadEdges): void {
    if (!this.visible) return;
    if (!this.revealed) {
      if (p.any) this.skip();
      return;
    }
    menuPad(p, this.actions);
  }
}
