import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectTransport } from '../../src/transports/direct.js';
import { FileConflictError, FileService } from '../../src/files/file-service.js';
import type { FileTransport } from '../../src/transports/file-transport.js';

const directories: string[] = [];
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }); });

async function harness(maxReadBytes = 1024) {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-files-')); directories.push(root);
  const transport = new DirectTransport({ id: 'direct-test', contextId: 'host', root });
  return { root, files: new FileService([transport], { maxReadBytes }) };
}

describe('logical filesystem', () => {
  it('pages directories, classifies symlinks, and reads text and binary on demand', async () => {
    const { root, files } = await harness();
    await writeFile(path.join(root, 'a.txt'), 'hello');
    await writeFile(path.join(root, 'b.bin'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, 'c.txt'), 'last');
    await import('node:fs/promises').then(fs => fs.symlink('a.txt', path.join(root, 'link')));
    const first = await files.list({ contextId: 'host', path: '/' }, { limit: 2 });
    expect(first.items).toHaveLength(2); expect(first.nextCursor).toBeTruthy();
    const second = await files.list({ contextId: 'host', path: '/' }, { limit: 10, cursor: first.nextCursor });
    expect([...first.items, ...second.items]).toContainEqual(expect.objectContaining({ name: 'link', type: 'symlink' }));
    expect(await files.read({ contextId: 'host', path: '/a.txt' })).toMatchObject({ text: 'hello', binary: false, route: expect.objectContaining({ kind: 'direct' }) });
    expect(await files.read({ contextId: 'host', path: '/b.bin' })).toMatchObject({ binary: true, bytes: 3 });
  });

  it('writes atomically with a fingerprint precondition and cleans temporary files', async () => {
    const { root, files } = await harness();
    await writeFile(path.join(root, 'edit.txt'), 'before');
    const opened = await files.read({ contextId: 'host', path: '/edit.txt' });
    const saved = await files.write({ contextId: 'host', path: '/edit.txt' }, Buffer.from('after'), opened.fingerprint);
    expect(await readFile(path.join(root, 'edit.txt'), 'utf8')).toBe('after');
    expect(saved.fingerprint).not.toBe(opened.fingerprint);
    expect((await readdir(root)).filter(name => name.includes('.atlas-'))).toEqual([]);
    await expect(files.write({ contextId: 'host', path: '/edit.txt' }, Buffer.from('stale'), opened.fingerprint)).rejects.toBeInstanceOf(FileConflictError);
  });

  it('returns metadata rather than loading files over the configured limit', async () => {
    const { root, files } = await harness(4);
    await writeFile(path.join(root, 'large.txt'), '12345');
    expect(await files.read({ contextId: 'host', path: '/large.txt' })).toMatchObject({ tooLarge: true, bytes: 5, content: undefined, text: undefined });
  });

  it('falls through a failed structured adapter to effective terminal authority', async () => {
    const { root } = await harness(); await writeFile(path.join(root, 'visible.txt'), 'terminal-visible');
    const direct = new DirectTransport({ id: 'backing', contextId: 'remote', root });
    const base = { contextId: 'remote', deviceId: 'device-1', effectiveIdentity: 'remote', privilege: 'user' as const, observedAt: new Date().toISOString(), available: true, operations: ['list', 'stat', 'read', 'write'] as const };
    const adapter = { ...base, id: 'adapter', kind: 'adapter' as const, list: async () => { throw Object.assign(new Error('outside binding'), { code: 'binding_denied' }); }, stat: (value: string) => direct.stat(value), read: (value: string) => direct.read(value), atomicWrite: (value: string, content: Buffer, mode?: number) => direct.atomicWrite(value, content, mode) } as FileTransport;
    const terminal = { ...base, id: 'terminal', kind: 'terminal' as const, list: (value: string) => direct.list(value), stat: (value: string) => direct.stat(value), read: (value: string) => direct.read(value), atomicWrite: (value: string, content: Buffer, mode?: number) => direct.atomicWrite(value, content, mode) } as FileTransport;
    expect(await new FileService([adapter, terminal]).list({ contextId: 'remote', path: '/' })).toMatchObject({ route: { kind: 'terminal' }, items: [expect.objectContaining({ name: 'visible.txt' })] });
  });
});
