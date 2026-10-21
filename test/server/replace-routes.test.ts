import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { FngkProcessClient } from '../../src/fngk/process-client.js';

const fixture = path.resolve('test/fixtures/fngk.mjs');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function harness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'atlas-replace-')), root = path.join(directory, 'root');
  await mkdir(path.join(root, 'src'), { recursive: true }); await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'src', 'a.ts'), 'const oldName = 1;\nexport { oldName };\n');
  await writeFile(path.join(root, 'src', 'b.ts'), 'oldName();\n');
  await writeFile(path.join(root, 'src', 'c.md'), 'oldName in docs\n');
  await writeFile(path.join(root, 'node_modules', 'dep.ts'), 'oldName\n');
  await writeFile(path.join(root, 'blob.bin'), Buffer.from([0, 1, 2, 0x6f, 0x6c, 0x64]));
  const app = await createApp({ fngk: new FngkProcessClient({ binary: fixture }), dbPath: path.join(directory, 'atlas.db'), localRoot: root });
  cleanups.push(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const post = async (url: string, payload: Record<string, unknown>) => { const response = await app.inject({ method: 'POST', url, payload }); return { status: response.statusCode, body: response.json() }; };
  return { app, root, post };
}

const query = { contextId: 'local', root: '/', query: 'oldName', replacement: 'newName', caseSensitive: true, wholeWord: true, include: '*.ts', exclude: 'node_modules' };

describe('replace across files', () => {
  it('previews hunks per file with fingerprints, honouring globs', async () => {
    const { post } = await harness();
    const preview = await post('/api/files/replace/preview', query);
    expect(preview.status).toBe(200);
    expect(preview.body.files.map((file: any) => [file.path, file.hunks.length, file.fingerprint])).toEqual([['/src/a.ts', 2, sha('const oldName = 1;\nexport { oldName };\n')], ['/src/b.ts', 1, sha('oldName();\n')]]);
    expect(preview.body.files[0].hunks[1]).toMatchObject({ id: 1, line: 2, column: 10, before: 'export { oldName };', after: 'export { newName };' });
    expect(preview.body.totalHunks).toBe(3);
    const found = await post('/api/files/find', { ...query, include: '', exclude: 'node_modules' });
    expect(found.body.files.map((file: any) => `${file.path}:${file.matches.map((match: any) => `${match.line}.${match.column}`).join(',')}`).sort()).toEqual(['/src/a.ts:1.7,2.10', '/src/b.ts:1.1', '/src/c.md:1.1']);
    expect((await post('/api/files/replace/preview', { ...query, query: '(', regex: true })).status).toBe(400);
  });

  it('applies only selected hunks, reports stale fingerprints as conflicts, and undoes from versions', async () => {
    const { app, root, post } = await harness();
    const preview = (await post('/api/files/replace/preview', query)).body;
    const [a, b] = preview.files;
    await writeFile(path.join(root, 'src', 'b.ts'), 'oldName(); // edited meanwhile\n');
    const applied = await post('/api/files/replace/apply', { ...query, edits: [{ path: a.path, expectedFingerprint: a.fingerprint, selectedHunks: [1] }, { path: b.path, expectedFingerprint: b.fingerprint, selectedHunks: [0] }] });
    expect(applied.status).toBe(200);
    expect(applied.body.summary).toEqual({ ok: 1, conflict: 1, failed: 0 });
    expect(applied.body.results[1]).toMatchObject({ path: '/src/b.ts', status: 'conflict' });
    expect(await readFile(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('const oldName = 1;\nexport { newName };\n');
    expect(await readFile(path.join(root, 'src', 'b.ts'), 'utf8')).toBe('oldName(); // edited meanwhile\n');
    const result = applied.body.results[0];
    expect(result).toMatchObject({ status: 'ok', applied: 1, previousFingerprint: a.fingerprint, versioned: true });
    // Re-applying the same preview is now stale.
    const again = await post('/api/files/replace/apply', { ...query, edits: [{ path: a.path, expectedFingerprint: a.fingerprint, selectedHunks: [0] }] });
    expect(again.body.results[0].status).toBe('conflict');
    // Undo: restore the version whose content the replace superseded.
    const undo = await post('/api/files/versions/restore', { contextId: 'local', path: a.path, versionFingerprint: result.previousFingerprint, expectedFingerprint: result.fingerprint });
    expect(undo.status).toBe(200);
    expect(await readFile(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('const oldName = 1;\nexport { oldName };\n');
    // The restore is versioned too, and a stale restore conflicts.
    const versions = (await app.inject({ method: 'GET', url: `/api/files/versions?contextId=local&path=${encodeURIComponent(a.path)}` })).json();
    expect(versions.versions.map((value: any) => value.fingerprint)).toEqual([result.fingerprint, a.fingerprint]);
    expect((await post('/api/files/versions/restore', { contextId: 'local', path: a.path, slot: 1, expectedFingerprint: result.fingerprint })).status).toBe(409);
    expect((await post('/api/files/replace/apply', { ...query, edits: [] })).status).toBe(400);
  });

  it('keeps exactly three previous versions and serves their content', async () => {
    const { app, root, post } = await harness();
    let fingerprint = sha('oldName();\n');
    for (const value of ['one\n', 'two\n', 'three\n', 'four\n', 'five\n']) {
      const response = await app.inject({ method: 'PUT', url: '/api/files/content', payload: { contextId: 'local', path: '/src/b.ts', contentBase64: Buffer.from(value).toString('base64'), expectedFingerprint: fingerprint } });
      expect(response.statusCode).toBe(200); fingerprint = response.json().fingerprint;
    }
    const listed = (await app.inject({ method: 'GET', url: '/api/files/versions?contextId=local&path=/src/b.ts' })).json();
    expect(listed.versions.map((value: any) => [value.slot, value.fingerprint])).toEqual([[1, sha('four\n')], [2, sha('three\n')], [3, sha('two\n')]]);
    expect(listed.versions[0]).toMatchObject({ bytes: 5, replacedAt: expect.any(String) });
    const content = (await app.inject({ method: 'GET', url: '/api/files/versions/content?contextId=local&path=/src/b.ts&slot=3' })).json();
    expect(content).toMatchObject({ text: 'two\n', fingerprint: sha('two\n') });
    expect((await app.inject({ method: 'GET', url: '/api/files/versions/content?contextId=local&path=/src/b.ts&slot=4' })).statusCode).toBe(400);
    const stale = await app.inject({ method: 'PUT', url: '/api/files/content', payload: { contextId: 'local', path: '/src/b.ts', contentBase64: 'eA==', expectedFingerprint: sha('four\n') } });
    expect(stale.statusCode).toBe(409);
    expect(await readFile(path.join(root, 'src', 'b.ts'), 'utf8')).toBe('five\n');
    expect((await post('/api/files/versions/restore', { contextId: 'local', path: '/src/b.ts', slot: 2, expectedFingerprint: fingerprint })).body).toMatchObject({ restoredSlot: 2, restoredFingerprint: sha('three\n') });
    expect(await readFile(path.join(root, 'src', 'b.ts'), 'utf8')).toBe('three\n');
  });
});
