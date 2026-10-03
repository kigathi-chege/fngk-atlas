import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('src/web'),
  publicDir: path.resolve('public'),
  plugins: [svelte()],
  build: {
    outDir: path.resolve('web-dist'),
    emptyOutDir: true,
    // File editing is explicitly lazy-loaded; its CodeMirror grammar bundle is
    // intentionally allowed to exceed the generic 500 kB warning threshold.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/@codemirror/') || id.includes('/@lezer/')) return 'atlas-editor';
          if (id.includes('/@xterm/')) return 'atlas-terminal';
          if (id.includes('/cytoscape/')) return 'atlas-graph';
          if (id.includes('/dockview/')) return 'atlas-dockview';
          return 'atlas-vendor';
        }
      }
    }
  },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4317', ws: true } } },
});
