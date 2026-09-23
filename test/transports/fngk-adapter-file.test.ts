import { describe, expect, it } from 'vitest';
import type { FngkProcessClient } from '../../src/fngk/process-client.js';
import type { NativeFileBinding } from '../../src/fngk/protocol.js';
import { nativeFileTransport } from '../../src/transports/fngk-adapter-file.js';

const binding: NativeFileBinding = {
  id: 'binding-1', name: 'workspace', resourceId: 'resource-1', deviceId: 'device-1', deviceName: 'host',
  adapterId: 'signal.files', root: '/srv/workspace', readOnly: false,
  capabilities: ['filesystem.list', 'filesystem.read', 'filesystem.trash', 'filesystem.restore'], provenance: 'native-adapter',
};

describe('native FNGK Files transport', () => {
  it('maps logical host paths into the binding and maps adapter results back', async () => {
    const calls: Array<{ capability: string; input: Record<string, unknown>; profile?: string }> = [];
    const client = {
      invokeFileBinding: async (_id: string, capability: string, input: Record<string, unknown>, options: { profile?: string }) => {
        calls.push({ capability, input, profile: options.profile });
        if (capability === 'filesystem.list') return { output: { entries: [{ name: 'index.ts', path: 'src/index.ts', kind: 'file', size: 12, mode: '0644' }] } };
        if (capability === 'filesystem.trash') return { output: { trashId: 'trash-1' } };
        return { output: {} };
      },
    } as unknown as FngkProcessClient;
    const route = nativeFileTransport(client, binding, 'local');
    await expect(route.list('/srv/workspace/src')).resolves.toContainEqual(expect.objectContaining({ path: '/srv/workspace/src/index.ts' }));
    await expect(route.trash('/srv/workspace/src/index.ts')).resolves.toEqual({ restorePath: '/.atlas-trash/trash-1' });
    await route.restore('/.atlas-trash/trash-1');
    expect(calls).toEqual([
      expect.objectContaining({ capability: 'filesystem.list', input: expect.objectContaining({ path: 'src' }), profile: 'local' }),
      expect.objectContaining({ capability: 'filesystem.trash', input: { path: 'src/index.ts' } }),
      expect.objectContaining({ capability: 'filesystem.restore', input: { trashId: 'trash-1' } }),
    ]);
  });

  it('rejects paths outside the native binding before invoking FNGK', async () => {
    const client = { invokeFileBinding: async () => { throw new Error('must not run'); } } as unknown as FngkProcessClient;
    await expect(nativeFileTransport(client, binding).read('/etc/passwd')).rejects.toMatchObject({ code: 'binding_denied' });
  });
});
