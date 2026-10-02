import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'desktop/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
