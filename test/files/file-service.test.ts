import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
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

  it('saves locally through symlinks, keeps mode and hardlinks, and rotates exactly three versions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-files-')), versionsRoot = await mkdtemp(path.join(tmpdir(), 'atlas-versions-')); directories.push(root, versionsRoot);
    const transport = new DirectTransport({ id: 'direct-test', contextId: 'host', root, versionsRoot }), files = new FileService([transport]);
    await writeFile(path.join(root, 'target.txt'), 'v0'); await chmod(path.join(root, 'target.txt'), 0o750); await symlink('target.txt', path.join(root, 'link.txt'));
    let fingerprint = (await files.read({ contextId: 'host', path: '/link.txt' })).fingerprint!;
    for (const next of ['v1', 'v2', 'v3', 'v4']) fingerprint = (await files.write({ contextId: 'host', path: '/link.txt' }, Buffer.from(next), fingerprint)).fingerprint;
    expect((await lstat(path.join(root, 'link.txt'))).isSymbolicLink()).toBe(true);
    expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('v4');
    expect((await stat(path.join(root, 'target.txt'))).mode & 0o777).toBe(0o750);
    const kept = await files.versions({ contextId: 'host', path: '/link.txt' });
    expect(kept.versions.map(value => value.slot)).toEqual([1, 2, 3]);
    expect((await files.readVersion({ contextId: 'host', path: '/link.txt' }, 1)).content.toString()).toBe('v3');
    expect((await files.readVersion({ contextId: 'host', path: '/link.txt' }, 3)).content.toString()).toBe('v1');
    const restored = await files.restoreVersion({ contextId: 'host', path: '/link.txt' }, { versionFingerprint: kept.versions[2].fingerprint }, fingerprint);
    expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('v1');
    expect((await files.readVersion({ contextId: 'host', path: '/link.txt' }, 1)).content.toString()).toBe('v4');
    await expect(files.write({ contextId: 'host', path: '/link.txt' }, Buffer.from('stale'), fingerprint)).rejects.toBeInstanceOf(FileConflictError);
    expect(restored.fingerprint).not.toBe(fingerprint);
    await writeFile(path.join(root, 'hard-a'), 'shared'); await link(path.join(root, 'hard-a'), path.join(root, 'hard-b'));
    await files.write({ contextId: 'host', path: '/hard-a' }, Buffer.from('both'), (await files.read({ contextId: 'host', path: '/hard-a' })).fingerprint!);
    expect(await readFile(path.join(root, 'hard-b'), 'utf8')).toBe('both');
    expect((await readdir(root)).filter(name => name.includes('.atlas-'))).toEqual([]);
    // Concurrent saves from the same opened fingerprint: exactly one wins.
    const base = (await files.read({ contextId: 'host', path: '/hard-a' })).fingerprint!;
    const results = await Promise.allSettled(['one', 'two', 'three'].map(value => files.write({ contextId: 'host', path: '/hard-a' }, Buffer.from(value), base)));
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(value => value.status === 'rejected').every(value => (value as PromiseRejectedResult).reason instanceof FileConflictError)).toBe(true);
  });

  it('searches with case, regex, whole-word and glob options and reports columns', async () => {
    const { root, files } = await harness(64 * 1024);
    await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'src', 'a.ts'), 'const foo = 1;\nconst fooBar = Foo;\n'); await writeFile(path.join(root, 'src', 'b.js'), 'foo\n'); await writeFile(path.join(root, 'node_modules', 'c.ts'), 'foo\n');
    const search = (query: string, options: Record<string, unknown>) => files.search({ contextId: 'host', path: '/' }, query, { mode: 'content', ...options }).then(value => value.matches.map(match => `${match.path}:${match.line}:${match.column}`).sort());
    expect(await search('foo', { wholeWord: true, caseSensitive: true, include: ['*.ts'], exclude: ['node_modules'] })).toEqual(['/src/a.ts:1:7']);
    expect(await search('foo', { wholeWord: true, caseSensitive: false, include: ['src/**'], exclude: ['node_modules'] })).toEqual(['/src/a.ts:1:7', '/src/a.ts:2:16', '/src/b.js:1:1']);
    expect(await search(String.raw`foo\w+`, { regex: true, caseSensitive: true, exclude: ['node_modules'] })).toEqual(['/src/a.ts:2:7']);
    // node_modules is pruned by default; an empty prune list searches it.
    expect((await files.search({ contextId: 'host', path: '/' }, 'foo', { mode: 'content', filesOnly: true, caseSensitive: true })).matches.map(match => match.path).sort()).toEqual(['/src/a.ts', '/src/b.js']);
    expect((await files.search({ contextId: 'host', path: '/' }, 'foo', { mode: 'content', filesOnly: true, caseSensitive: true, pruneNames: [] })).matches.map(match => match.path).sort()).toEqual(['/node_modules/c.ts', '/src/a.ts', '/src/b.js']);
  });

  it('returns metadata rather than loading files over the configured limit', async () => {
    const { root, files } = await harness(4);
    await writeFile(path.join(root, 'large.txt'), '12345');
    expect(await files.read({ contextId: 'host', path: '/large.txt' })).toMatchObject({ tooLarge: true, bytes: 5, limitBytes: 4, content: undefined, text: undefined });
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

  it('preserves a cancelled list request instead of reporting every route unavailable', async () => {
    const cancelled = Object.assign(new Error('Terminal command cancelled.'), { code: 'cancelled' });
    const transport = {
      id: 'cancelled-route', kind: 'terminal', contextId: 'host', available: true,
      operations: ['list'], effectiveIdentity: 'fixture', privilege: 'unknown', observedAt: new Date().toISOString(),
      covers: () => true, list: async () => { throw cancelled; }
    } as unknown as FileTransport;
    await expect(new FileService([transport]).list({ contextId: 'host', path: '/' })).rejects.toMatchObject({ code: 'cancelled', message: 'Terminal command cancelled.' });
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

  it('reports a missing path as not found only when every route agrees', async () => {
    const base = { contextId: 'remote', deviceId: 'device-1', effectiveIdentity: 'remote', privilege: 'user' as const, observedAt: new Date().toISOString(), available: true, operations: ['list', 'stat', 'read', 'write'] as const, stat: async () => ({ size: 0, mode: 0o644 }), read: async () => Buffer.alloc(0), atomicWrite: async () => {} };
    const missing = (id: string) => ({ ...base, id, kind: 'terminal' as const, list: async () => { throw Object.assign(new Error('missing'), { code: 'path_not_found' }); } }) as FileTransport;
    const broken = { ...base, id: 'adapter', kind: 'adapter' as const, list: async () => { throw Object.assign(new Error('adapter down'), { code: 'adapter_failed' }); } } as FileTransport;
    await expect(new FileService([missing('a'), missing('b')]).list({ contextId: 'remote', path: '/gone' })).rejects.toMatchObject({ code: 'path_not_found' });
    await expect(new FileService([broken, missing('b')]).list({ contextId: 'remote', path: '/gone' })).rejects.toMatchObject({ code: 'route_unavailable' });
  });
});
