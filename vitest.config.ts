import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'desktop/**/*.test.ts'],
    testTimeout: 10_000,
    // Atlas keeps file versions and trash in its state directory; tests must
    // never write into the developer's real one.
    env: { XDG_STATE_HOME: path.join(tmpdir(), `atlas-vitest-state-${process.pid}`) },
  },
});
