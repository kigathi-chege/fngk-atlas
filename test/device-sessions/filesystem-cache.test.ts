import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { FilesystemCache } from '../../src/device-sessions/filesystem-cache.js';
import { DeviceSessionManager } from '../../src/device-sessions/manager.js';
import { FileService } from '../../src/files/file-service.js';
import type { FileTransport } from '../../src/transports/file-transport.js';

const scope = { profile: 'atlas', teamId: 'team-a', projectId: 'project-a', deviceId: 'device-a' };

class ReadyTerminal extends EventEmitter {
  sessionId = 'session-a';
  close() { this.emit('close'); return true; }
}

function cacheWith(routes: Array<(scope: typeof scope) => FileTransport>) {
  let handshakes = 0;
  const sessions = new DeviceSessionManager({ createSession: () => {
    handshakes += 1;
    const terminal = new ReadyTerminal();
    queueMicrotask(() => terminal.emit('ready'));
    return terminal as any;
  }, idleTtlMs: 60_000 });
  const cache = new FilesystemCache({ sessions, service: async value => new FileService([routes[0](value as typeof scope)]) });
  return { cache, sessions, handshakes: () => handshakes };
}

function route(name: string, onList: (options?: { signal?: AbortSignal }) => Promise<any[]>): FileTransport {
  return {
    id: `terminal:${name}`, kind: 'terminal', contextId: `device:${name}`, deviceId: name,
    effectiveIdentity: 'remote-shell', privilege: 'unknown', observedAt: '2026-09-29T00:00:00.000Z', available: true,
    operations: ['list', 'stat', 'read', 'write'], covers: () => true,
    list: async (_path, options) => await onList(options),
    stat: async () => ({ size: 5, mode: 0o644 }), read: async () => Buffer.from('hello'), atomicWrite: async () => {},
  };
}

describe('FilesystemCache', () => {
  it('reuses one scoped session and one transport request for a warm directory visit', async () => {
    let requests = 0;
    const { cache, sessions, handshakes } = cacheWith([() => route('device-a', async () => {
      requests += 1;
      return [{ name: 'readme.md', path: '/readme.md', type: 'file', bytes: 5, modifiedAt: '2026-09-29T00:00:00.000Z', mode: 0o644 }];
    })]);

    const cold = await cache.list(scope, '/', { limit: 50 });
    const warm = await cache.list(scope, '/', { limit: 50 });

    expect(warm.items).toEqual(cold.items);
    expect(warm.sessionId).toBe(cold.sessionId);
    expect(requests).toBe(1);
    expect(handshakes()).toBe(1);
    expect(sessions.snapshot(scope)).toMatchObject({ handshakeCount: 1 });
    expect(cache.diagnostics(scope)).toMatchObject({ sessionId: 'session-a', handshakeCount: 1, requests: 1, cacheHits: 1, cacheMisses: 1 });
    await sessions.close();
  });

  it('propagates a superseded navigation abort to the typed filesystem operation', async () => {
    let aborted = false;
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    const { cache, sessions } = cacheWith([() => route('device-a', options => new Promise((_, reject) => {
      started();
      options?.signal?.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }, { once: true });
    }))]);
    const controller = new AbortController();
    const pending = cache.list(scope, '/slow', { signal: controller.signal });
    await begun;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(aborted).toBe(true);
    await sessions.close();
  });

  it('never serves a directory entry across profiles or devices', async () => {
    const requests: string[] = [];
    const { cache, sessions } = cacheWith([value => route(value.deviceId, async () => {
      requests.push(`${value.profile}:${value.deviceId}`);
      return [{ name: value.deviceId, path: `/${value.deviceId}`, type: 'directory', bytes: 0, modifiedAt: '2026-09-29T00:00:00.000Z', mode: 0o755 }];
    })]);

    const first = await cache.list(scope, '/');
    const second = await cache.list({ ...scope, profile: 'other', deviceId: 'device-b' }, '/');

    expect(first.items[0]?.name).toBe('device-a');
    expect(second.items[0]?.name).toBe('device-b');
    expect(requests).toEqual(['atlas:device-a', 'other:device-b']);
    await sessions.close();
  });

  it('opens a file on the existing scoped session without a second handshake', async () => {
    const { cache, sessions, handshakes } = cacheWith([() => route('device-a', async () => [])]);
    await cache.list(scope, '/');
    const file = await cache.read(scope, '/readme.md');

    expect(file.text).toBe('hello');
    expect(file.handshakeCount).toBe(1);
    expect(handshakes()).toBe(1);
    await sessions.close();
  });
});
