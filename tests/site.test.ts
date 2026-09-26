import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defines, markdownSection, siteUrl } from '../scripts/vite-site';

describe('build-time site metadata', () => {
  it('reads the bullet items of a CREDITS.md section as plain text', () => {
    const md = [
      '# Credits',
      '## Audio',
      '',
      '- Footsteps by **Someone** — [CC0](https://example.com)',
      '* `src/audio` synthesis',
      'Loose text is ignored.',
      '## Fonts',
      '- Not audio',
    ].join('\n');
    expect(markdownSection(md, 'Audio')).toEqual(['Footsteps by Someone — CC0', 'src/audio synthesis']);
    expect(markdownSection(md, 'Missing')).toEqual([]);
  });

  it('injects the package version, a git hash or dev, and the audio credits', () => {
    const root = new URL('..', import.meta.url).pathname;
    const d = defines(root);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(JSON.parse(d.__APP_VERSION__ ?? '')).toBe(pkg.version);
    expect(JSON.parse(d.__GIT_HASH__ ?? '')).toMatch(/^([0-9a-f]{4,40}|dev)$/);
    expect(Array.isArray(JSON.parse(d.__CREDITS_AUDIO__ ?? ''))).toBe(true);
  });

  it('normalises the public URL used by Open Graph tags', () => {
    expect(siteUrl({ SITE_URL: 'https://example.com/game' })).toBe('https://example.com/game/');
    expect(siteUrl({})).toMatch(/^https:\/\/.+\/$/);
  });
});
