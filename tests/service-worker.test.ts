/**
 * The generated service worker (scripts/vite-sw.ts): versioned per build,
 * precaching the first room and never answering a page load from the cache
 * while the network is there.
 */
import { describe, expect, it } from 'vitest';
import { PRECACHE_PUBLIC, serviceWorkerSource } from '../scripts/vite-sw';

const precached = (f: string): boolean => PRECACHE_PUBLIC.some((re) => re.test(f));

describe('service worker', () => {
  it('names its cache after the build version and drops the others on activation', () => {
    const src = serviceWorkerSource('abc123', ['./', './assets/index-x.js']);
    expect(src).toContain('const VERSION = "abc123"');
    expect(src).toContain('k !== CACHE');
    expect(src).toContain('"./assets/index-x.js"');
    expect(() => new Function(src)).not.toThrow();
  });

  it('loads pages network first and never takes over a running game', () => {
    const src = serviceWorkerSource('v', []);
    expect(src).toMatch(/mode === 'navigate'[\s\S]*fetch\(request\)/);
    // It takes over only when the page asks (the player chose to update).
    expect(src).toMatch(/event\.data === 'take-over'\) self\.skipWaiting\(\)/);
    expect(src.match(/skipWaiting/g)).toHaveLength(1);
  });

  it('precaches the first room but leaves the music to be cached on use', () => {
    expect(precached('models/nora.glb')).toBe(true);
    expect(precached('textures/wall/albedo.ktx2')).toBe(true);
    expect(precached('basis/basis_transcoder.wasm')).toBe(true);
    expect(precached('levels/antechamber.lightmap.png')).toBe(true);
    expect(precached('anim/idle.json')).toBe(true);
    expect(precached('audio/music/title.ogg')).toBe(false);
    expect(precached('models/README.md')).toBe(false);
  });
});
