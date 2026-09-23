import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverageService } from '../../src/coverage/service.js';
import { FileService } from '../../src/files/file-service.js';
import { DirectTransport } from '../../src/transports/direct.js';

const directories: string[] = [];
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }); });

describe('coverage evidence service', () => {
  it('discovers an existing artifact and attaches revisioned function metrics', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-coverage-')); directories.push(root); await mkdir(path.join(root, 'repo', 'coverage'), { recursive: true });
    await writeFile(path.join(root, 'repo', 'coverage', 'lcov.info'), 'SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n');
    const files = new FileService([new DirectTransport({ id: 'direct', contextId: 'host', root })]);
    const index = { nodes: [{ id: 'fn', type: 'function', path: 'src/a.ts', line: 1, endLine: 2, complexity: 4 }] };
    const result = await new CoverageService(files).ingest({ contextId: 'host', repositoryPath: '/repo', index, revision: 'abc', revisionVerified: true });
    expect(result.artifact).toBe('/repo/coverage/lcov.info');
    expect(result.index.nodes[0]).toMatchObject({ coverage: { fraction: 0.5, revision: 'abc', stale: false }, crap: 6 });
  });
});
