/**
 * Build-time site metadata for Vite (spec §14 "Publicación" and "PWA"):
 *
 * - `defines()`: the version from package.json, the git short hash ('dev'
 *   when git is unavailable) and the Audio and Music sections of CREDITS.md, injected as
 *   __APP_VERSION__, __GIT_HASH__ and __CREDITS_AUDIO__ (see src/env.d.ts).
 * - `sitePlugin()`: fills `%t:<key>%` placeholders in index.html from
 *   i18n/en.json (player-facing text stays in i18n), `%site%` with the public
 *   URL, generates manifest.json from i18n, and ships CREDITS.md as credits.txt.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

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

export function defines(root: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const credits = join(root, 'CREDITS.md');
  const md = existsSync(credits) ? readFileSync(credits, 'utf8') : '';
  // The Credits screen's sound row: recorded and synthesised audio, then music.
  const audio = [...markdownSection(md, 'Audio'), ...markdownSection(md, 'Music')];
  return {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(gitShortHash(root)),
    __CREDITS_AUDIO__: JSON.stringify(audio),
  };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
        orientation: 'landscape',
        background_color: '#0f0d0b',
        theme_color: '#0f0d0b',
        categories: ['games'],
        icons: [
          { src: 'icons/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
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
        return html
          .replace(/%t:([\w.]+)%/g, (m, key: string) => (t[key] !== undefined ? escapeHtml(t[key]) : m))
          .replace(/%site%/g, siteUrl());
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
