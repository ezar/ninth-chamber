/** Build-time constants injected by vite.config.ts (see scripts/vite-site.ts). */

/** package.json version, e.g. "0.3.1". */
declare const __APP_VERSION__: string;
/** Git short hash of the build, or "dev" when git is unavailable. */
declare const __GIT_HASH__: string;
/** Bullet items of the Audio and Music sections of CREDITS.md at build time (empty when absent). */
declare const __CREDITS_AUDIO__: readonly string[];
