import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/server/app.js';
import { FngkProcessClient } from '../../src/fngk/process-client.js';

const fixture = path.resolve('test/fixtures/fngk.mjs');
let app: FastifyInstance, base: string, root: string, remote: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const ndjson = (body: string) => body.trim().split('\n').map(line => JSON.parse(line));

beforeAll(async () => {
  // Tests must not read the developer's own git identity or credentials.
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_NOSYSTEM = '1';
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[key];
  base = await mkdtemp(path.join(tmpdir(), 'atlas-git-routes-'));
  root = path.join(base, 'root'); remote = path.join(base, 'remote.git');
  await mkdir(path.join(root, 'repo'), { recursive: true });
  git(base, 'init', '-q', '--bare', remote);
  git(path.join(root, 'repo'), 'init', '-q', '-b', 'main');
  await writeFile(path.join(root, 'repo', 'readme.md'), 'hello\n');
  app = await createApp({ fngk: new FngkProcessClient({ binary: fixture }), dbPath: path.join(base, 'atlas.db'), localRoot: root });
});
afterAll(async () => { await app?.close(); await rm(base, { recursive: true, force: true }); });

describe('git routes', () => {
  it('reports folders outside any repository without an error', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/git/status?contextId=local&root=/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ repository: null });
    // The discovery probe never fails, even for a folder that does not exist.
    const probe = await app.inject({ method: 'GET', url: '/api/git/repository?contextId=local&root=/missing/folder' });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({ repository: null, unavailable: { code: 'path_not_found' } });
    expect((await app.inject({ method: 'GET', url: '/api/git/repository?contextId=local&root=/repo' })).json()).toEqual({ repository: { root: '/repo', bare: false } });
  });

  it('stages and commits through logical paths, asking for an identity first', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/git/status?contextId=local&root=/repo' });
    expect(status.json()).toMatchObject({ repository: { root: '/repo' }, branch: { head: 'main', unborn: true }, entries: [{ path: 'readme.md', logicalPath: '/repo/readme.md', groups: ['untracked'], letter: 'U' }] });
    expect(JSON.stringify(status.json())).not.toContain(base);
    expect((await app.inject({ method: 'POST', url: '/api/git/stage', payload: { contextId: 'local', root: '/repo', paths: ['readme.md'] } })).statusCode).toBe(200);
    const blocked = await app.inject({ method: 'POST', url: '/api/git/commit', payload: { contextId: 'local', root: '/repo', message: 'first' } });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().error).toBe('identity_required');
    expect((await app.inject({ method: 'POST', url: '/api/git/identity', payload: { contextId: 'local', root: '/repo', name: 'Ada', email: 'ada@example.test' } })).json()).toMatchObject({ configured: true });
    const committed = await app.inject({ method: 'POST', url: '/api/git/commit', payload: { contextId: 'local', root: '/repo', message: 'first commit' } });
    expect(committed.statusCode).toBe(200);
    const log = await app.inject({ method: 'GET', url: '/api/git/log?contextId=local&root=/repo' });
    expect(log.json().commits).toMatchObject([{ subject: 'first commit', authorName: 'Ada' }]);
    const show = await app.inject({ method: 'GET', url: '/api/git/show?contextId=local&file=/repo/readme.md' });
    expect(show.json()).toMatchObject({ exists: true, text: 'hello\n', path: 'readme.md' });
  });

  it('rejects destructive operations that are not confirmed', async () => {
    await writeFile(path.join(root, 'repo', 'readme.md'), 'changed\n');
    git(path.join(root, 'repo'), 'branch', 'other');
    const attempts = [
      { url: '/api/git/discard', payload: { paths: ['readme.md'] } },
      { url: '/api/git/switch', payload: { branch: 'other' } },
      { url: '/api/git/branches/delete', payload: { name: 'other', force: true } },
      { url: '/api/git/push', payload: { remote: 'origin', branch: 'main', force: true } },
      { url: '/api/git/stash', payload: { action: 'drop' } },
    ];
    for (const attempt of attempts) {
      const response = await app.inject({ method: 'POST', url: attempt.url, payload: { contextId: 'local', root: '/repo', ...attempt.payload } });
      expect([attempt.url, response.statusCode, response.json().error]).toEqual([attempt.url, 428, 'confirmation_required']);
    }
    // Nothing was touched.
    expect(await readFile(path.join(root, 'repo', 'readme.md'), 'utf8')).toBe('changed\n');
    expect(git(path.join(root, 'repo'), 'branch', '--list', 'other').trim()).toBe('other');
    expect(git(path.join(root, 'repo'), 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    const discarded = await app.inject({ method: 'POST', url: '/api/git/discard', payload: { contextId: 'local', root: '/repo', paths: ['readme.md'], confirm: true } });
    expect(discarded.statusCode).toBe(200);
    expect(discarded.json().backup).toContain('git-backups');
    expect(await readFile(path.join(root, 'repo', 'readme.md'), 'utf8')).toBe('hello\n');
  });

  it('rejects paths and names that escape the repository or read as options', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/git/stage', payload: { contextId: 'local', root: '/repo', paths: ['../outside'] } })).json().error).toBe('invalid_path');
    expect((await app.inject({ method: 'POST', url: '/api/git/branches', payload: { contextId: 'local', root: '/repo', name: '--orphan' } })).json().error).toBe('invalid_ref');
    expect((await app.inject({ method: 'GET', url: '/api/git/show?contextId=local&root=/repo&path=readme.md&ref=--output=x' })).json().error).toBe('invalid_ref');
  });

  it('streams push progress to a local bare remote', async () => {
    git(path.join(root, 'repo'), 'remote', 'add', 'origin', remote);
    const response = await app.inject({ method: 'POST', url: '/api/git/push', payload: { contextId: 'local', root: '/repo', remote: 'origin', branch: 'main', setUpstream: true } });
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    const events = ndjson(response.body);
    expect(events[0]).toMatchObject({ type: 'start', operation: 'push' });
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: true, exitCode: 0 });
    expect(events.filter(event => event.type === 'output').map(event => event.text).join('')).toMatch(/main -> main/);
    expect(git(remote, 'rev-parse', 'main').trim()).toBe(git(path.join(root, 'repo'), 'rev-parse', 'HEAD').trim());
  });

  it('fails a push fast and readably when the remote wants credentials', async () => {
    const server = createServer((_request, response) => { response.writeHead(401, { 'www-authenticate': 'Basic realm="atlas-test"' }); response.end(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      git(path.join(root, 'repo'), 'remote', 'add', 'locked', `http://127.0.0.1:${port}/repo.git`);
      const started = Date.now();
      const response = await app.inject({ method: 'POST', url: '/api/git/push', payload: { contextId: 'local', root: '/repo', remote: 'locked', branch: 'main' } });
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(ndjson(response.body).at(-1)).toMatchObject({ type: 'done', ok: false, message: expect.stringMatching(/credentials/) });
    } finally { server.close(); }
  });
});
