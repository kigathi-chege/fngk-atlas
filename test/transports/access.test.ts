import { describe, expect, it } from 'vitest';
import { OperationResolver, type AccessRoute } from '../../src/domain/access.js';
import { posixQuote, framedCommand } from '../../src/transports/posix.js';

const route = (kind: AccessRoute['kind'], operations: AccessRoute['operations'], available = true): AccessRoute => ({
  id: `${kind}-1`, kind, contextId: 'host-1', deviceId: kind === 'direct' ? undefined : 'device-1',
  effectiveIdentity: kind === 'terminal' ? 'root' : 'atlas', privilege: kind === 'terminal' ? 'root' : 'user',
  observedAt: '2026-09-12T12:00:00.000Z', available, operations,
});

describe('effective access routing', () => {
  it('orders viable routes per operation without treating adapters as a ceiling', () => {
    const resolver = new OperationResolver([
      route('terminal', ['list', 'read', 'write', 'execute']),
      route('adapter', ['list', 'read']),
      route('direct', ['list', 'read', 'write']),
    ]);
    expect(resolver.resolve({ contextId: 'host-1', path: '/srv/app' }, 'read').map(value => value.kind)).toEqual(['direct', 'terminal', 'adapter']);
    expect(resolver.resolve({ contextId: 'host-1', path: '/srv/app' }, 'execute').map(value => value.kind)).toEqual(['terminal']);
  });

  it('prefers terminal authority over a native adapter on remote contexts', () => {
    const resolver = new OperationResolver([route('adapter', ['read']), route('terminal', ['read'])]);
    expect(resolver.resolve({ contextId: 'host-1', path: '/srv/app' }, 'read').map(value => value.kind)).toEqual(['terminal', 'adapter']);
  });

  it('skips unavailable routes while retaining their evidence', () => {
    const resolver = new OperationResolver([route('direct', ['read'], false), route('terminal', ['read'])]);
    expect(resolver.resolve({ contextId: 'host-1', path: '/' }, 'read')).toEqual([expect.objectContaining({ kind: 'terminal' })]);
    expect(resolver.routes()).toContainEqual(expect.objectContaining({ kind: 'direct', available: false }));
  });
});

describe('POSIX probes', () => {
  it('quotes hostile paths as one shell argument and frames output in memory', () => {
    expect(posixQuote("/tmp/a b'$(touch nope)\nfile")).toBe("'/tmp/a b'\"'\"'$(touch nope)\nfile'");
    const framed = framedCommand("printf '%s' safe", 'request-7');
    expect(framed).toContain('__ATLAS_BEGIN_request_7__');
    expect(framed).toContain('__ATLAS_END_request_7__');
    expect(framed).not.toMatch(/>\s*\/tmp|cat\s*>/);
  });
});
