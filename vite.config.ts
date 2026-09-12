import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';

export default defineConfig({
  root: path.resolve('src/web'),
  plugins: [svelte()],
  build: { outDir: path.resolve('web-dist'), emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4317', ws: true } } },
});
