import { describe, expect, it } from 'vitest';
import { correlateRuntime } from '../../src/correlation/runtime-code.js';

describe('runtime-to-code evidence', () => {
  it('links processes and ports only when paths or process identifiers provide evidence', () => {
    const index = { nodes: [
      { id: 'repo', type: 'repository', root: '/srv/signal', path: '/srv/signal' },
      { id: 'package', type: 'package', parent: 'repo', path: '.' },
      { id: 'module', type: 'module', parent: 'package', path: 'src/server.ts' },
    ] };
    const runtime = [
      { id: 'process:12', type: 'process', metadata: { pid: 12, cwd: '/srv/signal', command: 'node /srv/signal/src/server.ts' } },
      { id: 'port:4317', type: 'port', metadata: { pid: 12, protocol: 'tcp' } },
      { id: 'process:99', type: 'process', metadata: { pid: 99, command: 'unrelated' } },
    ];
    const edges = correlateRuntime(index, runtime);
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'process:12', target: 'repo', type: 'runtime_in', confidence: 'high', evidence: expect.objectContaining({ kind: 'cwd' }) }),
      expect.objectContaining({ source: 'process:12', target: 'module', type: 'loads', confidence: 'high', evidence: expect.objectContaining({ kind: 'command_path' }) }),
      expect.objectContaining({ source: 'port:4317', target: 'process:12', type: 'served_by', confidence: 'exact' }),
    ]));
    expect(edges.some(edge => edge.source === 'process:99')).toBe(false);
  });
});
