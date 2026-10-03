import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceSessionManager, type DeviceSessionFactory } from '../../src/device-sessions/manager.js';
import type { DeviceScope } from '../../src/device-sessions/types.js';
import { createApp } from '../../src/server/app.js';
import { FngkProcessClient } from '../../src/fngk/process-client.js';

const scope: DeviceScope = { profile: 'atlas', teamId: 'team-a', projectId: 'project-a', deviceId: 'device-a' };
const managers: DeviceSessionManager[] = [];

class FakeTerminalSession extends EventEmitter {
  closed = false;
  sessionId?: string;
  closeReasons: string[] = [];

  close(reason = 'closed'): boolean {
    if (this.closed) return false;
    this.closed = true;
    this.closeReasons.push(reason);
    this.emit('close', { code: 0, signal: null });
    return true;
  }
}

class ScopedFngkClient extends FngkProcessClient {
  visibleDevices: Array<Record<string, unknown>> = [
    { id: 'device-a', name: 'alpha', online: true, teamId: 'team-a', projectId: 'project-a' },
    { id: 'device-b', name: 'bravo', online: true, teamId: 'team-b', projectId: 'project-b' },
  ];

  constructor() { super({ binary: 'unused-for-device-session-route-test' }); }

  override async namespace(profile?: string): Promise<any> {
    return {
      protocolVersion: 'fngk.namespace.v1',
      generatedAt: '2026-09-29T00:00:00.000Z',
      profile: { name: profile ?? 'atlas' },
      devices: this.visibleDevices,
      connections: [],
      sessions: [],
      resources: [],
    };
  }

  override openTerminal(): any {
    const session = new FakeTerminalSession();
    queueMicrotask(() => { session.sessionId = `fake-${Date.now()}`; session.emit('ready', { type: 'ready' }); });
    return session;
  }
}

function factory(behavior: (session: FakeTerminalSession, attempt: number) => void = session => {
  queueMicrotask(() => { session.sessionId = 'fake-session'; session.emit('ready', { type: 'ready' }); });
}): { factory: DeviceSessionFactory; sessions: FakeTerminalSession[] } {
  const sessions: FakeTerminalSession[] = [];
  return {
    sessions,
    factory: async () => {
      const session = new FakeTerminalSession();
      sessions.push(session);
      behavior(session, sessions.length);
      return session as never;
    },
  };
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.close()));
});

describe('DeviceSessionManager', () => {
  it('deduplicates concurrent leases for one exact device scope', async () => {
    const connection = factory();
    const manager = new DeviceSessionManager({ createSession: connection.factory, idleTtlMs: 1_000 });
    managers.push(manager);

    const [first, second] = await Promise.all([manager.acquire(scope), manager.acquire({ ...scope })]);

    expect(connection.sessions).toHaveLength(1);
    expect(manager.snapshot(scope)).toMatchObject({ scope, leaseCount: 2, state: 'ready', owner:'atlas-internal', purpose:'device-session' });
    first.release();
    second.release();
  });

  it('never shares a connection across profile, team, project, or device scopes', async () => {
    const connection = factory();
    const manager = new DeviceSessionManager({ createSession: connection.factory, idleTtlMs: 1_000 });
    managers.push(manager);

    const leases = await Promise.all([
      manager.acquire(scope),
      manager.acquire({ ...scope, profile: 'other-profile' }),
      manager.acquire({ ...scope, teamId: 'team-b' }),
      manager.acquire({ ...scope, projectId: 'project-b' }),
      manager.acquire({ ...scope, deviceId: 'device-b' }),
    ]);

    expect(connection.sessions).toHaveLength(5);
    expect(leases.map(lease => lease.scope)).toEqual([
      scope,
      { ...scope, profile: 'other-profile' },
      { ...scope, teamId: 'team-b' },
      { ...scope, projectId: 'project-b' },
      { ...scope, deviceId: 'device-b' },
    ]);
    for (const lease of leases) lease.release();
  });

  it('closes an idle connection after its lease TTL', async () => {
    const connection = factory();
    const manager = new DeviceSessionManager({ createSession: connection.factory, idleTtlMs: 15 });
    managers.push(manager);
    const lease = await manager.acquire(scope);

    lease.release();
    await new Promise(resolve => setTimeout(resolve, 40));

    expect(connection.sessions[0].closed).toBe(true);
    expect(manager.snapshot(scope)).toBeUndefined();
  });

  it('shares the in-progress reconnect with a concurrent acquire for the same exact scope', async () => {
    const connection = factory((session, attempt) => {
      setTimeout(() => { session.sessionId = `fake-${attempt}`; session.emit('ready', { type: 'ready' }); }, attempt === 1 ? 0 : 20);
    });
    const manager = new DeviceSessionManager({ createSession: connection.factory, idleTtlMs: 1_000 });
    managers.push(manager);
    const first = await manager.acquire(scope);

    connection.sessions[0].emit('error', Object.assign(new Error('network lost'), { code: 'network_lost' }));
    await new Promise(resolve => setTimeout(resolve, 1));
    const concurrent = manager.acquire(scope);
    const second = await concurrent;

    expect(connection.sessions).toHaveLength(2);
    first.release();
    second.release();
  });

  it('revokes a scope by closing every leased substream without affecting another scope', async () => {
    const connection = factory();
    const manager = new DeviceSessionManager({ createSession: connection.factory, idleTtlMs: 1_000 });
    managers.push(manager);
    const primary = await manager.acquire(scope);
    const sibling = await manager.acquire(scope);
    const other = await manager.acquire({ ...scope, deviceId: 'device-b' });
    const firstStream = primary.subscribe();
    const secondStream = sibling.subscribe();

    await manager.revoke(scope, 'operator_revoked');

    expect(firstStream.closed).toBe(true);
    expect(secondStream.closed).toBe(true);
    expect(connection.sessions[0].closed).toBe(true);
    expect(connection.sessions[1].closed).toBe(false);
    expect(() => primary.commandExecutor()).toThrow(expect.objectContaining({ code: 'session_revoked' }));
    other.release();
  });

  it('reports ready then reconnecting then failed after a connection failure and never replays a caller operation', async () => {
    const connection = factory((session, attempt) => {
      setTimeout(() => {
        if (attempt === 1) { session.sessionId = 'fake-session'; session.emit('ready', { type: 'ready' }); }
        else session.emit('error', Object.assign(new Error('network lost'), { code: 'network_lost' }));
      }, 0);
    });
    const manager = new DeviceSessionManager({ createSession: connection.factory, idleTtlMs: 1_000, reconnectAttempts: 1 });
    managers.push(manager);
    const states: string[] = [];
    manager.on('state', event => states.push(event.state));
    const lease = await manager.acquire(scope);
    let attempts = 0, cancelled = false;
    const operation = lease.run(async ({ signal }) => await new Promise<never>((_resolve, reject) => {
      attempts += 1;
      signal.addEventListener('abort', () => {
        cancelled = true;
        reject(Object.assign(new Error('operation outcome unknown'), { code: 'outcome_unknown' }));
      }, { once: true });
    }));

    connection.sessions[0].emit('error', Object.assign(new Error('network lost'), { code: 'network_lost' }));
    const outcome = await Promise.race([operation.then(() => 'settled', () => 'settled'), new Promise(resolve => setTimeout(() => resolve('timed_out'), 40))]);
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(attempts).toBe(1);
    expect(cancelled).toBe(true);
    expect(outcome).toBe('settled');
    expect(states).toEqual(expect.arrayContaining(['ready', 'reconnecting', 'failed']));
    expect(manager.snapshot(scope)).toMatchObject({ state: 'failed', leaseCount: 1 });
    lease.release();
  });

  it('resolves the requested device scope before scoping diagnostics lifecycle controls', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fngk-atlas-device-sessions-'));
    const app = await createApp({
      fngk: new FngkProcessClient({ binary: path.resolve('test/fixtures/fngk.mjs') }),
      dbPath: path.join(directory, 'atlas.db'),
    });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/device-sessions?profile=atlas' })).json()).toEqual({ items: [] });
      const reconnect = await app.inject({ method: 'POST', url: '/api/device-sessions/reconnect', payload: { profile: 'atlas', deviceId: 'device-1' } });
      expect(reconnect.statusCode).toBe(200);
      expect(reconnect.json()).toMatchObject({ session: { scope: { profile: 'atlas', deviceId: 'device-1' }, state: 'ready' } });
      const clear = await app.inject({ method: 'POST', url: '/api/device-sessions/cache/clear', payload: { profile: 'atlas', deviceId: 'device-1' } });
      expect(clear.json()).toMatchObject({ session: { cacheEpoch: 1 } });
      expect((await app.inject({ method: 'POST', url: '/api/device-sessions/revoke', payload: { profile: 'atlas', deviceId: 'device-1' } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/device-sessions/reconnect', payload: { profile: 'atlas', deviceId: 'unknown-device' } })).statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not list a persisted session after its device access is no longer authorized', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fngk-atlas-device-session-list-'));
    const fngk = new ScopedFngkClient();
    const app = await createApp({ fngk, dbPath: path.join(directory, 'atlas.db') });
    try {
      for (const input of [
        { profile: 'atlas', deviceId: 'device-a', teamId: 'team-a', projectId: 'project-a' },
        { profile: 'atlas', deviceId: 'device-b', teamId: 'team-b', projectId: 'project-b' },
      ]) expect((await app.inject({ method: 'POST', url: '/api/device-sessions/reconnect', payload: input })).statusCode).toBe(200);

      fngk.visibleDevices = [fngk.visibleDevices[0]];
      const listed = await app.inject({ method: 'GET', url: '/api/device-sessions?profile=atlas' });

      expect(listed.json()).toMatchObject({ items: [expect.objectContaining({ scope: expect.objectContaining({ deviceId: 'device-a', teamId: 'team-a', projectId: 'project-a' }) })] });
      expect(listed.json().items).toHaveLength(1);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
