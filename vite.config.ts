import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { defines, sitePlugin } from './scripts/vite-site.js';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  // Version, git hash and audio credits for the title and credits screens.
  define: defines(root),
  plugins: [sitePlugin(root)],
  build: {
    target: 'es2022',
    sourcemap: true,
    // three/webgpu weighs ~800 kB; per-room chunking arrives with level loading.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
