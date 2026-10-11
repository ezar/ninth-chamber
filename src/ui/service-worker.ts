/**
 * Registers the build's service worker (scripts/vite-sw.ts) once the game has
 * loaded, so its precache never competes with the first room's downloads.
 * Development builds have none.
 *
 * A new build installs a worker that waits (it never takes over a game in
 * progress). `onUpdate` is called once it is waiting; `applyUpdate` then asks
 * it to take over and reloads the page when it has. `onOffline` follows the
 * worker's download of the whole game, then says when it can play offline.
 */
let waiting: ServiceWorker | null = null;

/** How far the game is saved for offline play: a fraction while downloading, 'ready' once a whole build is cached. */
export type OfflineState = number | 'ready';

/** The build of the worker in control, or null without one (or with a worker too old to say). */
function activeVersion(): Promise<string | null> {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (e: MessageEvent<unknown>) => {
      window.clearTimeout(timer);
      resolve(typeof e.data === 'string' ? e.data : null);
    };
    worker.postMessage('version', [channel.port2]);
  });
}

/** Whether the worker in control holds its whole build (it stores the page last), so every chamber opens offline. */
async function offlineReady(): Promise<boolean> {
  const version = await activeVersion();
  if (!version || !(await caches.has(`nc-${version}`))) return false;
  const page = new URL(import.meta.env.BASE_URL, location.href).href;
  return !!(await (await caches.open(`nc-${version}`)).match(page, { ignoreVary: true }));
}

export function registerServiceWorker(
  onUpdate: () => void = () => undefined,
  onOffline: (state: OfflineState) => void = () => undefined,
): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // The worker reports its download; once done (or if an earlier build already is), the game plays offline.
  let ready = false;
  const check = (): void => {
    void offlineReady()
      .then((ok) => {
        if (ok && !ready) {
          ready = true;
          onOffline('ready');
        }
      })
      .catch(() => undefined);
  };
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const m = event.data as { type?: string; done?: number; total?: number } | null;
    if (m?.type !== 'nc-precache' || !m.total) return;
    if ((m.done ?? 0) >= m.total) check();
    else if (!ready) onOffline((m.done ?? 0) / m.total);
  });
  check();
  navigator.serviceWorker.addEventListener('controllerchange', check);
  // The music is cached after the rest, by the worker in control.
  const extras = (): void => navigator.serviceWorker.controller?.postMessage('cache-extras');
  if (navigator.serviceWorker.controller) extras();
  else navigator.serviceWorker.addEventListener('controllerchange', extras, { once: true });
  const watch = (reg: ServiceWorkerRegistration): void => {
    const found = (w: ServiceWorker | null): void => {
      // A first install (no controller yet) is not an update.
      if (!w || !navigator.serviceWorker.controller) return;
      waiting = w;
      onUpdate();
    };
    if (reg.waiting) found(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed') found(w);
      });
    });
    // Long sessions (an installed game left open) look for a new build when they come back.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void reg.update().catch(() => undefined);
    });
  };
  const register = (): void => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(watch)
      .catch(() => {
        // No worker (private mode, file://): the game simply stays online-only.
      });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Whether a new build is waiting. */
export const updateWaiting = (): boolean => waiting !== null;

/** Lets the waiting build take over and reloads into it. */
export function applyUpdate(): void {
  const w = waiting;
  if (!w) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  w.postMessage('take-over');
}
