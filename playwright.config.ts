import { defineConfig } from '@playwright/test';
export default defineConfig({
  // One renderer prevents optional heavy panels from multiplying browser
  // memory on modest CI hosts; product code remains independently lazy.
  testDir: './e2e', timeout: 20_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--disable-dev-shm-usage'] } },
  webServer: { command: 'npm run build:web && npx tsx test/fixtures/web-server.ts', url: 'http://127.0.0.1:4318/api/health', reuseExistingServer: false, timeout: 30_000 },
});
