import { describe, expect, it, vi } from 'vitest';
import { AtlasToolExecutor } from '../../src/agent-tools/executor.js';
import { AtlasToolRegistry } from '../../src/agent-tools/registry.js';

const scope = { profile: 'local', teamId: 'team-1', projectId: 'project-1', deviceId: 'device-1' };

describe('AtlasToolExecutor', () => {
  it('executes a scoped read-only filesystem action and returns a normalized tool result', async () => {
    const list = vi.fn(async () => ({ items: [{ name: 'README.md', type: 'file' }], nextCursor: null }));
    const executor = new AtlasToolExecutor({
      registry: new AtlasToolRegistry(),
      resolveScope: async () => scope,
      acquireFiles: async () => ({ service: { list }, release: vi.fn() })
    });
    await expect(executor.execute({ toolId: 'atlas.files.list', input: { path: '/' }, scope })).resolves.toMatchObject({ status: 'succeeded', toolId: 'atlas.files.list', result: { items: [{ name: 'README.md' }] } });
    expect(list).toHaveBeenCalledWith({ contextId: 'device:device-1', path: '/' }, expect.any(Object));
  });

  it('denies cross-project scope and offline devices before running an adapter', async () => {
    const acquireFiles = vi.fn();
    const executor = new AtlasToolExecutor({ registry: new AtlasToolRegistry(), resolveScope: async () => scope, acquireFiles });
    await expect(executor.execute({ toolId: 'atlas.files.list', input: { path: '/' }, scope: { ...scope, projectId: 'other' } })).rejects.toMatchObject({ code: 'device_scope_mismatch' });
    const offline = new AtlasToolExecutor({ registry: new AtlasToolRegistry(), resolveScope: async () => { throw Object.assign(new Error('offline'), { code: 'device_offline' }); }, acquireFiles });
    await expect(offline.execute({ toolId: 'atlas.files.list', input: { path: '/' }, scope })).rejects.toMatchObject({ code: 'device_offline' });
    expect(acquireFiles).not.toHaveBeenCalled();
  });
});
