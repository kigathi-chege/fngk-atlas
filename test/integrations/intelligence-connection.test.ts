import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IntelligenceConnectionService, normalizeIntelligenceOrigin } from '../../src/integrations/intelligence-connection.js';

const KEY = 'isc_abcdefghijklmnopqrstuvwxyz012345';
const servers: Server[] = [];
afterEach(() => { while (servers.length) servers.pop()!.close(); vi.restoreAllMocks(); });
async function fake(accept: string[] = [KEY]) {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    const ok = accept.some(key => request.headers.authorization === `Bearer ${key}`);
    response.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }); response.end(ok ? '{"models":[]}' : '{"error":{"code":"unauthorized"}}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  return { origin: `http://127.0.0.1:${(server.address() as any).port}`, seen };
}
const dir = () => mkdtempSync(join(tmpdir(), 'atlas-intel-'));

describe('IntelligenceConnectionService', () => {
  it('verifies, stores encrypted, and reports only a fingerprint', async () => {
    const d = dir(), upstream = await fake(), service = new IntelligenceConnectionService(join(d, 'atlas.db'), {});
    expect(service.status()).toMatchObject({ configured: false, source: null });
    const status = await service.connect({ key: KEY, origin: upstream.origin, workspaceId: 'team-a' });
    expect(upstream.seen).toEqual(['GET /api/intelligence/exec/models']);
    expect(status).toMatchObject({ configured: true, source: 'stored', origin: upstream.origin, workspaceId: 'team-a' });
    expect(status.keyHint).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(status)).not.toContain(KEY.slice(4, 12));
    expect(service.bearer()).toBe(KEY);
    const file = join(d, 'intelligence-connection.json');
    expect(readFileSync(file, 'utf8')).not.toContain(KEY);
    expect(statSync(file).mode & 0o777).toBe(0o600); expect(statSync(join(d, 'credentials.key')).mode & 0o777).toBe(0o600);
    expect(new IntelligenceConnectionService(join(d, 'atlas.db'), {}).status().source).toBe('stored');
  });
  it('shares credentials.key with the calculator connection without disturbing it', async () => {
    const d = dir(), upstream = await fake(), service = new IntelligenceConnectionService(join(d, 'atlas.db'), {});
    await service.connect({ key: KEY, origin: upstream.origin });
    expect(readdirSync(d).sort()).toEqual(['credentials.key', 'intelligence-connection.json']);
  });
  it('refuses invalid inputs without echoing them and without calling Intelligence', async () => {
    const d = dir(), upstream = await fake(), service = new IntelligenceConnectionService(join(d, 'atlas.db'), {});
    const bad = [
      { key: 'nope' }, { key: `${KEY} x` }, { key: `${KEY}\n` }, { key: 'isc_short' }, { key: 'isc_' + 'a'.repeat(300) }, { key: 42 }, {},
      { key: KEY, origin: 'http://intelligence.example.org' }, { key: KEY, origin: 'https://user:pw@intelligence.example.org' },
      { key: KEY, origin: 'https://intelligence.example.org/path' }, { key: KEY, origin: 'https://intelligence.example.org/?q=1' },
      { key: KEY, origin: upstream.origin, workspaceId: 'bad id!' }, { key: KEY, origin: upstream.origin, workspaceId: 'a'.repeat(65) },
    ];
    for (const input of bad) {
      const error = await service.connect(input as any).then(() => null, value => value as Error);
      expect(error, JSON.stringify(input)).not.toBeNull();
      expect(error!.message).not.toContain(KEY); expect((error as any).code).toBe('intelligence_connection_invalid');
    }
    expect(upstream.seen).toEqual([]); expect(service.status().configured).toBe(false);
  });
  it('accepts http only for localhost origins', () => {
    expect(normalizeIntelligenceOrigin('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeIntelligenceOrigin('http://intelligence.localhost')).toBe('http://intelligence.localhost');
    expect(normalizeIntelligenceOrigin('https://intelligence.nipate.africa/')).toBe('https://intelligence.nipate.africa');
    expect(() => normalizeIntelligenceOrigin('http://example.org')).toThrow();
    expect(() => normalizeIntelligenceOrigin('ftp://localhost')).toThrow();
  });
  it('does not store a key Intelligence rejects or cannot be reached', async () => {
    const d = dir(), upstream = await fake(['isc_someotherkey000000000']), service = new IntelligenceConnectionService(join(d, 'atlas.db'), {});
    const rejected = await service.connect({ key: KEY, origin: upstream.origin }).catch(error => error);
    expect(rejected.code).toBe('intelligence_key_rejected'); expect(rejected.message).not.toContain(KEY);
    const unreachable = await service.connect({ key: KEY, origin: 'http://127.0.0.1:1' }).catch(error => error);
    expect(unreachable.code).toBe('intelligence_unreachable'); expect(unreachable.message).not.toContain(KEY);
    expect(service.status().configured).toBe(false); expect(readdirSync(d)).not.toContain('intelligence-connection.json');
  });
  it('prefers the stored connection over the environment, falls back to it, and disconnect clears only the stored one', async () => {
    const d = dir(), upstream = await fake(), envKey = 'isc_environmentkey00000000000';
    const env = { ATLAS_INTELLIGENCE_KEY: envKey, ATLAS_INTELLIGENCE_URL: 'https://env.example.org', ATLAS_INTELLIGENCE_WORKSPACE: 'envws' };
    const service = new IntelligenceConnectionService(join(d, 'atlas.db'), env);
    expect(service.status()).toMatchObject({ configured: true, source: 'environment', origin: 'https://env.example.org', workspaceId: 'envws' });
    expect(service.bearer()).toBe(envKey);
    await service.connect({ key: KEY, origin: upstream.origin });
    expect(service.status()).toMatchObject({ source: 'stored', origin: upstream.origin, workspaceId: 'atlas' });
    expect(service.bearer()).toBe(KEY); expect(service.provider()!.origin).toBe(upstream.origin);
    expect(service.disconnect()).toMatchObject({ configured: true, source: 'environment' });
    expect(service.bearer()).toBe(envKey);
    const bare = new IntelligenceConnectionService(join(d, 'atlas.db'), {});
    expect(bare.status()).toMatchObject({ configured: false }); expect(bare.provider()).toBeUndefined();
  });
});
