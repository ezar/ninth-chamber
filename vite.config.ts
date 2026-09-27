import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { defines, sitePlugin } from './scripts/vite-site.js';
import { preloadPlugin, serviceWorkerPlugin } from './scripts/vite-sw.js';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  // Version, git hash and audio credits for the title and credits screens.
  define: defines(root),
  // The service worker (offline play and fast starts) is generated from the build's file list.
  plugins: [sitePlugin(root), serviceWorkerPlugin(root), preloadPlugin()],
  build: {
    target: 'es2022',
    sourcemap: true,
    // three/webgpu weighs ~1.2 MB on its own.
    chunkSizeWarningLimit: 1400,
    rolldownOptions: {
      output: {
        // The engine in its own chunk: its name (content hash) survives game deploys, so
        // browsers and the service worker keep it cached while the game code changes.
        codeSplitting: {
          groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/](build|src)[\\/]/ }],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
