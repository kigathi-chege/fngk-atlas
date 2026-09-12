import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 20_000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 900 }, launchOptions: { args: ['--disable-dev-shm-usage', '--single-process', '--no-zygote'] } },
  webServer: { command: 'npm run build:web && npx tsx test/fixtures/web-server.ts', url: 'http://127.0.0.1:4318/api/health', reuseExistingServer: false, timeout: 30_000 },
});
