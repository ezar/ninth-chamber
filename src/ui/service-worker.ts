/**
 * Registers the build's service worker (scripts/vite-sw.ts) once the game has
 * loaded, so its precache never competes with the first room's downloads.
 * Development builds have none.
 *
 * A new build installs a worker that waits (it never takes over a game in
 * progress). `onUpdate` is called once it is waiting; `applyUpdate` then asks
 * it to take over and reloads the page when it has.
 */
let waiting: ServiceWorker | null = null;

export function registerServiceWorker(onUpdate: () => void = () => undefined): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
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
