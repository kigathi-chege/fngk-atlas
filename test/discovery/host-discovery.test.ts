import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostDiscovery } from '../../src/discovery/host-discovery.js';
import { DirectTransport } from '../../src/transports/direct.js';
import { redactFacts } from '../../src/discovery/redaction.js';

const directories: string[] = [];
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }); });

describe('bounded host discovery', () => {
  it('yields useful repository facts without descending into virtual or dependency trees', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-discovery-')); directories.push(root);
    await mkdir(path.join(root, 'repo', '.git'), { recursive: true });
    await mkdir(path.join(root, 'repo', 'src'), { recursive: true });
    await mkdir(path.join(root, 'repo', 'node_modules', 'noise'), { recursive: true });
    await mkdir(path.join(root, 'proc', '123'), { recursive: true });
    await writeFile(path.join(root, 'repo', 'package.json'), '{"name":"mapped"}');
    await writeFile(path.join(root, 'repo', 'src', 'index.ts'), 'export function mapped() {}');
    await writeFile(path.join(root, 'repo', 'node_modules', 'noise', 'package.json'), '{"name":"noise"}');
    await writeFile(path.join(root, 'proc', '123', 'secret'), 'never scan');
    const discovery = new HostDiscovery({ maxEntries: 100, maxDepth: 6 });
    const batches = [];
    for await (const batch of discovery.scan({ id: 'host', route: new DirectTransport({ id: 'direct', contextId: 'host', root }) })) batches.push(batch);
    const entities = batches.flatMap(batch => batch.entities);
    expect(entities).toContainEqual(expect.objectContaining({ type: 'repository', path: '/repo' }));
    expect(entities).toContainEqual(expect.objectContaining({ type: 'package', path: '/repo/package.json' }));
    expect(entities.some(entity => entity.path.includes('node_modules/noise'))).toBe(false);
    expect(entities.some(entity => entity.path.includes('/proc/123'))).toBe(false);
    expect(batches.at(-1)).toMatchObject({ complete: true, partial: false });
  });

  it('redacts secret values while preserving keys and topology', () => {
    expect(redactFacts({ DATABASE_URL: 'postgres://user:pass@db/app', API_TOKEN: 'secret', PORT: '4317', nested: { password: 'hidden' } })).toEqual({
      DATABASE_URL: '[redacted]', API_TOKEN: '[redacted]', PORT: '4317', nested: { password: '[redacted]' },
    });
  });

  it('cancels before probing the host', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-discovery-cancel-')); directories.push(root);
    const controller = new AbortController(); controller.abort();
    const discovery = new HostDiscovery();
    const consume = async () => { for await (const _batch of discovery.scan({ id: 'host', route: new DirectTransport({ id: 'direct', contextId: 'host', root }) }, controller.signal)) {} };
    await expect(consume()).rejects.toMatchObject({ code: 'cancelled' });
  });
});
