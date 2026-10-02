import { describe, expect, it } from 'vitest';
import { DeviceLifecycleService } from '../../src/lifecycle/service.js';

const source = (overrides: Record<string, unknown> = {}) => ({
  profiles: async () => ({
    profiles: [{ name: 'local', current: true, mode: 'user', paired: true, operatorAuthorized: true, daemon: 'running' }],
  }),
  contexts: async () => ({
    contexts: [{ id: 'device:one', name: 'Build host', kind: 'fngk-device', online: true }],
  }),
  ...overrides,
});

describe('DeviceLifecycleService', () => {
  it('selects exactly one usable profile for an online device', async () => {
    const lifecycle = new DeviceLifecycleService(source());
    await expect(lifecycle.inspect('device:one')).resolves.toMatchObject({
      contextId: 'device:one',
      state: 'inspection-unavailable',
      profile: { name: 'local' },
      profileSelection: 'automatic',
    });
  });

  it('keeps a profile ambiguous instead of selecting one arbitrarily', async () => {
    const lifecycle = new DeviceLifecycleService(source({
      profiles: async () => ({ profiles: [
        { name: 'local', current: true, mode: 'user', paired: true, operatorAuthorized: true, daemon: 'running' },
        { name: 'work', current: false, mode: 'user', paired: true, operatorAuthorized: true, daemon: 'running' },
      ] }),
    }));
    await expect(lifecycle.inspect('device:one')).resolves.toMatchObject({ state: 'needs-profile', profileSelection: 'required' });
  });

  it('reports distinct offline, sign-in, and daemon recovery states', async () => {
    await expect(new DeviceLifecycleService(source({ contexts: async () => ({ contexts: [{ id: 'device:one', kind: 'fngk-device', online: false }] }) })).inspect('device:one')).resolves.toMatchObject({ state: 'offline' });
    await expect(new DeviceLifecycleService(source({ profiles: async () => ({ profiles: [{ name: 'local', current: true, mode: 'user', paired: true, operatorAuthorized: false, daemon: 'running' }] }) })).inspect('device:one')).resolves.toMatchObject({ state: 'needs-login' });
    await expect(new DeviceLifecycleService(source({ profiles: async () => ({ profiles: [{ name: 'local', current: true, mode: 'user', paired: false, operatorAuthorized: true, daemon: 'stopped' }] }) })).inspect('device:one')).resolves.toMatchObject({ state: 'inspection-unavailable' });
  });
});
