import { describe, expect, it, vi } from 'vitest';
import { AtlasToolExecutor } from '../../src/agent-tools/executor.js';
import { GrantStore } from '../../src/agent-tools/grants.js';
import { AtlasToolRegistry } from '../../src/agent-tools/registry.js';

const scope = { profile: 'local', teamId: 'team-1', projectId: 'project-1', deviceId: 'device-1' };

describe('AtlasToolExecutor', () => {
  it('executes a scoped read-only filesystem action and returns a normalized tool result', async () => {
    const list = vi.fn(async () => ({ items: [{ name: 'README.md', type: 'file' }], nextCursor: null, route: { executor: { token: 'must-not-leak' } } }));
    const executor = new AtlasToolExecutor({
      registry: new AtlasToolRegistry(),
      resolveScope: async () => scope,
      acquireFiles: async () => ({ service: { list }, release: vi.fn() })
    });
    await expect(executor.execute({ toolId: 'atlas.files.list', input: { path: '/' }, scope })).resolves.toMatchObject({ status: 'succeeded', toolId: 'atlas.files.list', result: { items: [{ name: 'README.md' }] } });
    const result = await executor.execute({ toolId: 'atlas.files.list', input: { path: '/' }, scope });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
    expect((result.result as Record<string, unknown>).route).toBeUndefined();
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

  it('routes each non-mutating workspace tool through its scoped adapter', async () => {
    const acquireTerminal = vi.fn(async () => ({ session: { scope, state: 'ready' }, release: vi.fn() }));
    const inspectDeployments = vi.fn(async () => ({ deployments: [{ id: 'deployment-1' }] }));
    const listPorts = vi.fn(async () => ({ published: [{ port: 3010 }] }));
    const inspectDevice = vi.fn(async () => ({ id: scope.deviceId, name: 'Device one' }));
    const grants = new GrantStore();
    grants.create({ scope, toolIds: ['atlas.terminal.open', 'atlas.terminal.command'], kind: 'conversation', actor: 'test' });
    const runTerminalCommand = vi.fn(async () => ({ exitCode: 0, stdout: 'ready\n', stderr: '' }));
    const executor = new AtlasToolExecutor({
      registry: new AtlasToolRegistry(),
      resolveScope: async () => scope,
      acquireFiles: async () => ({ service: { list: vi.fn(), read: vi.fn() }, release: vi.fn() }),
      acquireTerminal,
      inspectDeployments,
      listPorts,
      inspectDevice,
      runTerminalCommand,
      grants
    });

    await expect(executor.execute({ toolId: 'atlas.terminal.open', input: {}, scope })).resolves.toMatchObject({ status: 'succeeded', result: { session: { state: 'ready' } } });
    await expect(executor.execute({ toolId: 'atlas.terminal.command', input: { command: 'pwd' }, scope })).resolves.toMatchObject({ result: { exitCode: 0, stdout: 'ready\n' } });
    await expect(executor.execute({ toolId: 'atlas.deployment.inspect', input: {}, scope })).resolves.toMatchObject({ result: { deployments: [{ id: 'deployment-1' }] } });
    await expect(executor.execute({ toolId: 'atlas.ports.list', input: {}, scope })).resolves.toMatchObject({ result: { published: [{ port: 3010 }] } });
    await expect(executor.execute({ toolId: 'atlas.device.inspect', input: {}, scope })).resolves.toMatchObject({ result: { name: 'Device one' } });

    expect(acquireTerminal).toHaveBeenCalledWith(scope, undefined);
    expect(runTerminalCommand).toHaveBeenCalledWith(scope, 'pwd', undefined);
    expect(inspectDeployments).toHaveBeenCalledWith(scope, undefined);
    expect(listPorts).toHaveBeenCalledWith(scope, undefined);
    expect(inspectDevice).toHaveBeenCalledWith(scope, undefined);
  });
});
