/**
 * The loading state on the start screen: a thin progress line and a short
 * line of text while textures, Nora and the shaders get ready. The start
 * button works all along: pressed early, the game starts once the tomb is
 * ready (spec §2: the title is usable long before the tomb has loaded). While the story cards
 * play over the reel (ui/prelude.ts) a small copy of the line sits in the
 * letterbox; both show the same progress.
 */
import { DefaultLoadingManager } from 'three/webgpu';
import { t, type StringKey } from './i18n';

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

/** Share of the bar that file downloads fill; the rest is shader warm-up and calibration. */
const FILES_SHARE = 0.75;

export class LoadingScreen {
  private readonly root = byId('loading');
  private readonly fills = [byId('loading-fill'), document.getElementById('prelude-fill')];
  private readonly labels = [byId('loading-label'), document.getElementById('prelude-loading-label')];
  private readonly button = byId('start-button') as HTMLButtonElement;
  private stage: StringKey = 'loading.assets';
  private progress = 0;
  private done = false;

  constructor() {
    // The button works before the tomb is ready (main queues the start); it only says it is busy.
    this.button.setAttribute('aria-busy', 'true');
    document.body.classList.add('loading');
    this.render();
  }

  /** Follows every three.js loader (textures, the glTF, the lightmap). */
  trackDownloads(): void {
    DefaultLoadingManager.onProgress = (_url, loaded, total) => {
      if (this.stage === 'loading.assets' && total > 0) this.setProgress((loaded / total) * FILES_SHARE);
    };
  }

  setStage(stage: StringKey, progress?: number): void {
    this.stage = stage;
    if (progress !== undefined) this.progress = Math.max(this.progress, progress);
    this.render();
  }

  /** Progress 0..1; the bar never moves backwards. */
  setProgress(p: number): void {
    const next = Math.max(this.progress, Math.min(1, p));
    if (next === this.progress) return;
    this.progress = next;
    this.renderFill();
  }

  /** Enter or Continue pressed while loading: the press is taken and the game starts when ready. */
  queue(button: HTMLButtonElement): void {
    button.classList.add('pressed', 'queued');
    this.stage = 'loading.queued';
    this.render();
  }

  get isReady(): boolean {
    return this.done;
  }

  ready(): void {
    if (this.done) return;
    this.done = true;
    this.stage = 'loading.ready';
    this.progress = 1;
    this.render();
    this.button.removeAttribute('aria-busy');
    for (const b of document.querySelectorAll('#start .queued')) b.classList.remove('pressed', 'queued');
    document.body.classList.remove('loading');
    this.root.classList.add('done');
    document.getElementById('prelude-loading')?.classList.add('done');
    byId('start').classList.add('ready');
    DefaultLoadingManager.onProgress = () => undefined;
    this.button.focus({ preventScroll: true });
  }

  /** Re-renders the text (after a language change). */
  refresh(): void {
    this.render();
  }

  private render(): void {
    for (const label of this.labels) if (label) label.textContent = t(this.stage);
    this.renderFill();
  }

  private renderFill(): void {
    for (const fill of this.fills) if (fill) fill.style.transform = `scaleX(${this.progress})`;
  }
}
