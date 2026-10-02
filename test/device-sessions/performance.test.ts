import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { DeviceSessionManager } from '../../src/device-sessions/manager.js';
import { FilesystemCache } from '../../src/device-sessions/filesystem-cache.js';
import { FileService } from '../../src/files/file-service.js';

const scope = { profile: 'local', teamId: 'team-1', projectId: 'project-1', deviceId: 'device-1' };

describe('agent workspace performance instrumentation', () => {
  it('records a cold and warm filesystem action against one session and one handshake', async () => {
    let handshakes = 0, requests = 0;
    const sessions = new DeviceSessionManager({ idleTtlMs: 60_000, createSession: () => {
      handshakes += 1;
      const terminal = new EventEmitter() as EventEmitter & { sessionId: string; close(): boolean };
      terminal.sessionId = 'persistent-session'; terminal.close = () => (terminal.emit('close'), true); queueMicrotask(() => terminal.emit('ready'));
      return terminal as any;
    } });
    const cache = new FilesystemCache({ sessions, service: async value => new FileService([{ id: 'fixture', kind: 'terminal', contextId: `device:${value.deviceId}`, deviceId: value.deviceId, effectiveIdentity: 'fixture', privilege: 'unknown', observedAt: new Date().toISOString(), available: true, operations: ['list', 'stat', 'read', 'write'], covers: () => true, list: async () => { requests += 1; return [{ name: 'readme.md', path: '/readme.md', type: 'file', bytes: 1, modifiedAt: new Date().toISOString(), mode: 0o644 }]; }, stat: async () => ({ size: 1, mode: 0o644 }), read: async () => Buffer.from('x'), atomicWrite: async () => {} }]) });
    const cold = await cache.list(scope, '/');
    const warm = await cache.list(scope, '/');
    const opened = await cache.read(scope, '/readme.md');
    expect({ cold: cold.cacheHit, warm: warm.cacheHit, sessionId: opened.sessionId, handshakes, requests, telemetry: cache.diagnostics(scope) }).toMatchObject({ cold: false, warm: true, sessionId: 'persistent-session', handshakes: 1, requests: 1, telemetry: { handshakeCount: 1, cacheHits: 1, cacheMisses: 2 } });
    await sessions.close();
  });
});
