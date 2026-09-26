/** Build metadata injected by Vite (scripts/vite-site.ts), for bug reports (spec §14 "Publicación"). */

export const version = __APP_VERSION__;
export const gitHash = __GIT_HASH__;
/** Shown on the title screen, e.g. "v0.3.1 · abc1234". */
export const versionLabel = `v${version} · ${gitHash}`;
/** Audio credits read from CREDITS.md at build time. */
export const audioCredits: readonly string[] = __CREDITS_AUDIO__;
