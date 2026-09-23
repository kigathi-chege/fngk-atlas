import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('searches names and contents and performs conflict-safe filesystem mutations', async () => {
    const { root, files } = await harness();
    await files.createDirectory({ contextId: 'host', path: '/src' });
    await files.createFile({ contextId: 'host', path: '/src/alpha.ts' }, Buffer.from('export const atlasNeedle = 1'));
    expect(await files.search({ contextId: 'host', path: '/' }, 'atlasNeedle')).toMatchObject({ matches: [expect.objectContaining({ path: '/src/alpha.ts', line: 1 })] });
    await files.move({ contextId: 'host', path: '/src/alpha.ts' }, '/src/beta.ts');
    expect(await readFile(path.join(root, 'src', 'beta.ts'), 'utf8')).toContain('atlasNeedle');
    await files.remove({ contextId: 'host', path: '/src/beta.ts' });
    await expect(readFile(path.join(root, 'src', 'beta.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses destructive mutations against the logical root', async () => {
    const { files } = await harness();
    await expect(files.remove({ contextId: 'host', path: '/' })).rejects.toMatchObject({ code: 'protected_path' });
    await expect(files.remove({ contextId: 'host', path: '//' })).rejects.toMatchObject({ code: 'protected_path' });
    await expect(files.move({ contextId: 'host', path: '/' }, '/renamed')).rejects.toMatchObject({ code: 'protected_path' });
  });

  it('bounds and cancels file searches without retaining file contents', async () => {
    const { files } = await harness();
    const controller = new AbortController(); controller.abort();
    await expect(files.search({ contextId: 'host', path: '/' }, 'needle', { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('stops name matching at the requested result limit', async () => {
    const { root, files } = await harness();
    await Promise.all(['needle-a.txt', 'needle-b.txt', 'needle-c.txt'].map(name => writeFile(path.join(root, name), '')));
    expect((await files.search({ contextId: 'host', path: '/' }, 'needle', { mode: 'name', limit: 1 })).matches).toHaveLength(1);
  });

  it('trashes and restores paths when the effective route supports recovery', async () => {
    const { root, files } = await harness();
    await files.createFile({ contextId: 'host', path: '/recover.txt' }, Buffer.from('recover me'));
    const trashed = await files.trash({ contextId: 'host', path: '/recover.txt' });
    expect(trashed).toMatchObject({ restoreAvailable: true, route: { kind: 'direct' } });
    await expect(readFile(path.join(root, 'recover.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await files.restore({ contextId: 'host', path: trashed.restorePath! });
    await expect(readFile(path.join(root, 'recover.txt'), 'utf8')).resolves.toBe('recover me');
  });

  it('does not expose the recovery vault to destructive user operations', async () => {
    const { files } = await harness();
    await files.createFile({ contextId: 'host', path: '/recover.txt' });
    await files.trash({ contextId: 'host', path: '/recover.txt' });
    await expect(files.remove({ contextId: 'host', path: '/.atlas-trash' })).rejects.toMatchObject({ code: 'protected_path' });
  });

  it('restores only an authenticated vault token and never deletes an arbitrary directory', async () => {
    const { root, files } = await harness();
    await files.createDirectory({ contextId: 'host', path: '/attacker' });
    await files.createFile({ contextId: 'host', path: '/attacker/payload' }, Buffer.from('payload'));
    await files.createFile({ contextId: 'host', path: '/attacker/metadata.json' }, Buffer.from(JSON.stringify({ originalPath: '/restored.txt' })));
    await expect(files.restore({ contextId: 'host', path: '/attacker' })).rejects.toMatchObject({ code: 'invalid_trash_record' });
    await expect(readFile(path.join(root, 'attacker', 'payload'), 'utf8')).resolves.toBe('payload');
  });

  it('rejects a symlinked recovery vault without moving the source outside the route root', async () => {
    const { root, files } = await harness();
    const outside = await mkdtemp(path.join(tmpdir(), 'atlas-outside-')); directories.push(outside);
    await writeFile(path.join(root, 'source.txt'), 'keep me');
    await symlink(outside, path.join(root, '.atlas-trash'));
    await expect(files.trash({ contextId: 'host', path: '/source.txt' })).rejects.toMatchObject({ code: 'path_escape' });
    await expect(readFile(path.join(root, 'source.txt'), 'utf8')).resolves.toBe('keep me');
  });

  it('refuses to trash a symlink instead of following it into recovery', async () => {
    const { root, files } = await harness();
    await writeFile(path.join(root, 'source.txt'), 'keep me');
    await symlink('source.txt', path.join(root, 'source-link'));
    await expect(files.trash({ contextId: 'host', path: '/source-link' })).rejects.toMatchObject({ code: 'path_escape' });
    await expect(readFile(path.join(root, 'source.txt'), 'utf8')).resolves.toBe('keep me');
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
