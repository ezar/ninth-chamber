/**
 * Registers the build's service worker (scripts/vite-sw.ts) once the game has
 * loaded, so its precache never competes with the first room's downloads.
 * Development builds have none.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = (): void => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // No worker (private mode, file://): the game simply stays online-only.
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
