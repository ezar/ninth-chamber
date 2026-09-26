/**
 * Build-time site metadata for Vite (spec §14 "Publicación" and "PWA"):
 *
 * - `defines()`: the version from package.json, the git short hash ('dev'
 *   when git is unavailable) and the Audio and Music sections of CREDITS.md, injected as
 *   __APP_VERSION__, __GIT_HASH__ and __CREDITS_AUDIO__ (see src/env.d.ts).
 * - `sitePlugin()`: fills `%t:<key>%` placeholders in index.html from
 *   i18n/en.json (player-facing text stays in i18n), `%site%` with the public
 *   URL, generates manifest.json from i18n, and ships CREDITS.md as credits.txt.
 * - Before any bundle arrives the page already plays the splash and the story
 *   prelude (src/ui/prelude.ts), so the plugin also bakes in `%tt:<key>%`
 *   (the text in every locale, one `<span lang>` each, shown by the page's
 *   language), `%version%`, the seal (the splash's, drawn to be carved, and
 *   the title's), the prelude's cards and each locale's card schedule.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { sealSvg } from '../src/ui/seal.js';
import { preludeSchedule, type PreludeSchedule } from '../src/ui/story-timing.js';

/** The splash's black, also the installed app's splash and status bar colour. */
export const SPLASH_BLACK = '#0a0806';

/** Public URL of the deployed game, for Open Graph tags (absolute URLs are required there). */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.SITE_URL ?? env.DEPLOY_PRIME_URL ?? 'https://ezar.github.io/ninth-chamber/';
  return url.endsWith('/') ? url : `${url}/`;
}

export function gitShortHash(cwd: string): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return /^[0-9a-f]{4,40}$/.test(hash) ? hash : 'dev';
  } catch {
    return 'dev';
  }
}

/** Bullet items under a `## <heading>` of a Markdown file, as plain text. */
export function markdownSection(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!m?.[1]) continue;
    items.push(
      m[1]
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]/g, '')
        .trim(),
    );
  }
  return items;
}

const packageVersion = (root: string): string =>
  (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;

export function defines(root: string): Record<string, string> {
  const credits = join(root, 'CREDITS.md');
  const md = existsSync(credits) ? readFileSync(credits, 'utf8') : '';
  // The Credits screen's sound row: recorded and synthesised audio, then music.
  const audio = [...markdownSection(md, 'Audio'), ...markdownSection(md, 'Music')];
  return {
    __APP_VERSION__: JSON.stringify(packageVersion(root)),
    __GIT_HASH__: JSON.stringify(gitShortHash(root)),
    __CREDITS_AUDIO__: JSON.stringify(audio),
  };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Locales = Record<string, Record<string, string>>;

/** Every i18n/*.json, English first (the reference). */
export function readLocales(root: string): Locales {
  const dir = join(root, 'i18n');
  const names = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
  return Object.fromEntries(
    names.map((n) => [n, JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8')) as Record<string, string>]),
  );
}

/** A string in every locale, one span each; CSS shows the page language's (see .fallback). */
export function allLocales(locales: Locales, key: string): string {
  return Object.entries(locales)
    .map(([lang, t]) => `<span lang="${lang}">${escapeHtml(t[key] ?? locales.en?.[key] ?? key)}</span>`)
    .join('');
}

/**
 * The prelude's story cards: the first chamber's intro, `intro.antechamber.N`
 * in order (the same list as CHAMBERS[0].intro in src/ui/campaign.ts, which
 * tests/prelude.test.ts checks; campaign.ts itself is not loaded into the Vite config).
 */
export function preludeKeys(locales: Locales): string[] {
  const n = (k: string): number => Number(k.split('.').pop());
  return Object.keys(locales.en ?? {})
    .filter((k) => /^intro\.antechamber\.\d+$/.test(k))
    .sort((a, b) => n(a) - n(b));
}

/** Each locale's card timeline, for the inline script that starts the prelude. */
export function preludeSchedules(locales: Locales): Record<string, PreludeSchedule> {
  const keys = preludeKeys(locales);
  return Object.fromEntries(
    Object.entries(locales).map(([lang, t]) => [
      lang,
      preludeSchedule(keys.map((k) => t[k] ?? locales.en?.[k] ?? '')),
    ]),
  );
}

/** The cards as markup: every locale's text, each card timed by its CSS variables (set by the inline script). */
export function preludeCards(locales: Locales): string {
  return preludeKeys(locales)
    .map(
      (key, i) =>
        `<p class="prelude-card fallback" style="--at: var(--card${i + 1}-at); --out: var(--card${i + 1}-out)">` +
        `${allLocales(locales, key)}</p>`,
    )
    .join('\n');
}

export function sitePlugin(root: string): Plugin {
  const strings = (): Record<string, string> =>
    JSON.parse(readFileSync(join(root, 'i18n', 'en.json'), 'utf8')) as Record<string, string>;

  const manifest = (): string => {
    const t = strings();
    return JSON.stringify(
      {
        name: t.title,
        short_name: t['meta.shortName'],
        description: t['meta.description'],
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        // Phones play in portrait too.
        orientation: 'any',
        // The install splash and status bar match the page's splash.
        background_color: SPLASH_BLACK,
        theme_color: SPLASH_BLACK,
        categories: ['games'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    );
  };
  const credits = (): string | null => {
    const file = join(root, 'CREDITS.md');
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };

  return {
    name: 'ninth-chamber-site',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const t = strings();
        const locales = readLocales(root);
        return (
          html
            .replace('<!--%splash:seal%-->', sealSvg({ className: 'splash-seal', draw: true }))
            // The title's seal is in the page before the script redraws the same one (ui/title.ts).
            .replace('<!--%title:seal%-->', sealSvg())
            .replace('<!--%prelude:cards%-->', preludeCards(locales))
            .replace('/*%prelude:schedule%*/ null', JSON.stringify(preludeSchedules(locales)))
            .replace(/%tt:([\w.]+)%/g, (m, key: string) =>
              t[key] !== undefined ? allLocales(locales, key) : m,
            )
            .replace(/%t:([\w.]+)%/g, (m, key: string) => (t[key] !== undefined ? escapeHtml(t[key]) : m))
            .replace(/%version%/g, `v${packageVersion(root)} · ${gitShortHash(root)}`)
            .replace(/%splash-black%/g, SPLASH_BLACK)
            .replace(/%site%/g, siteUrl())
        );
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (path.endsWith('/manifest.json')) {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.end(manifest());
          return;
        }
        const text = path.endsWith('/credits.txt') ? credits() : null;
        if (text !== null) {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(text);
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: manifest() });
      const text = credits();
      if (text !== null) this.emitFile({ type: 'asset', fileName: 'credits.txt', source: text });
    },
  };
}
