import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { availableRuntimeManagers } from '../../src/deployments/runtime-managers.js';

describe('runtime manager probe', () => {
  it('reports the managers on PATH from a POSIX shell', async () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'atlas-managers-'));
    try {
      for (const tool of ['pm2', 'docker']) { writeFileSync(path.join(bin, tool), '#!/bin/sh\n'); chmodSync(path.join(bin, tool), 0o755); }
      const executor = { execute: async (command: string) => { const run = spawnSync('dash', ['-c', command], { env: { PATH: `${bin}:/usr/bin:/bin` } }); return { output: run.stdout, exitCode: run.status ?? 1 }; } };
      expect((await availableRuntimeManagers(executor))?.sort()).toEqual(['docker', 'pm2']);
    } finally { rmSync(bin, { recursive: true, force: true }); }
  });

  it('reports unknown when the Device cannot be asked', async () => {
    await expect(availableRuntimeManagers({ execute: async () => { throw Object.assign(new Error('timeout'), { code: 'timeout' }); } })).resolves.toBeUndefined();
  });
});
