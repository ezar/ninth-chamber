/**
 * iPhone Home Screen apps installed with a translucent status bar start the
 * page under the bar but size its viewport as if the bar were still there
 * (WebKit bug 236445): the game sits a status bar too high and leaves a band
 * of page background at the bottom. The app keeps the status bar style it was
 * installed with, so changing the page's meta tag does not reach it.
 *
 * Here the missing height is measured (the screen's height less the
 * viewport's) and the page grows by it. The body becomes the frame of every
 * full-screen layer (a transform makes it their containing block), sized to
 * the whole screen. Only a standalone iPhone app whose page starts under the
 * status bar (a safe area at the top) is touched; anywhere else the gap is 0.
 */
const GAP = '--standalone-gap';

/** The top safe area, read through a probe (env() has no script API). */
function safeTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top)';
  document.body.append(probe);
  const top = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return top;
}

/** The viewport height the page is missing, in CSS pixels (0 when it is not short). */
export function standaloneGap(
  screenW: number,
  screenH: number,
  innerW: number,
  innerH: number,
  top: number,
): number {
  if (top <= 0) return 0;
  // iOS reports the screen in portrait whatever the orientation.
  const tall = innerH >= innerW ? Math.max(screenW, screenH) : Math.min(screenW, screenH);
  const gap = Math.round(tall - innerH);
  // About one status bar: more is something else (a keyboard, a split view), and is left alone.
  return gap > 0 && gap <= top + 8 ? gap : 0;
}

/** Measures now and on every resize; `changed` runs when the gap changes (so the renderer can resize). */
export function fitStandaloneViewport(changed: () => void): void {
  if ((navigator as Navigator & { standalone?: boolean }).standalone !== true) return;
  let last = -1;
  const apply = (): void => {
    const gap = standaloneGap(screen.width, screen.height, window.innerWidth, window.innerHeight, safeTop());
    if (gap === last) return;
    last = gap;
    const root = document.documentElement;
    root.style.setProperty(GAP, `${gap}px`);
    root.classList.toggle('standalone-gap', gap > 0);
    changed();
  };
  apply();
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => window.setTimeout(apply, 300));
}
