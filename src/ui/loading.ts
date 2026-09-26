/**
 * The loading state on the start screen: a thin progress line and a short
 * line of text while textures, Nora and the shaders get ready, with the
 * start button disabled until the tomb can be entered.
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
  private readonly fill = byId('loading-fill');
  private readonly label = byId('loading-label');
  private readonly button = byId('start-button') as HTMLButtonElement;
  private stage: StringKey = 'loading.assets';
  private progress = 0;
  private done = false;

  constructor() {
    this.button.disabled = true;
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
    this.fill.style.transform = `scaleX(${this.progress})`;
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
    this.button.disabled = false;
    this.button.removeAttribute('aria-busy');
    document.body.classList.remove('loading');
    this.root.classList.add('done');
    byId('start').classList.add('ready');
    DefaultLoadingManager.onProgress = () => undefined;
    this.button.focus({ preventScroll: true });
  }

  /** Re-renders the text (after a language change). */
  refresh(): void {
    this.render();
  }

  private render(): void {
    this.label.textContent = t(this.stage);
    this.fill.style.transform = `scaleX(${this.progress})`;
  }
}
