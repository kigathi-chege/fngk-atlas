import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { FngkProcessClient } from '../../src/fngk/process-client.js';

const fixture = path.resolve('test/fixtures/fngk.mjs');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function harness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'fngk-atlas-server-'));
  const app = await createApp({ fngk: new FngkProcessClient({ binary: fixture }), dbPath: path.join(directory, 'atlas.db') });
  cleanups.push(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return app;
}

describe('Atlas FNGK-native server', () => {
  it('exposes process context and namespace without accepting credentials', async () => {
    const app = await harness();
    const context = await app.inject({ method: 'GET', url: '/api/fngk/context?profile=work' });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({ installed: true, compatible: true, profile: 'work' });
    expect(context.body).not.toMatch(/credential|cookie|operator-secret/);

    const namespace = await app.inject({ method: 'GET', url: '/api/fngk/namespace?profile=work' });
    expect(namespace.json()).toMatchObject({ protocolVersion: 'fngk.namespace.v1', profile: { name: 'work' } });
    expect((await app.inject({method:'GET',url:'/api/fngk/sessions?profile=work'})).json()).toMatchObject({profile:{name:'work'},sessions:[]});
    expect((await app.inject({method:'POST',url:'/api/fngk/sessions/session-1/actions',payload:{action:'stop'}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/fngk/sessions/session-1/actions',payload:{action:'rename',title:'Build shell',profile:'work'}})).json()).toMatchObject({protocolVersion:'fngk.session.v1',action:'rename'});
    const world = await app.inject({ method: 'GET', url: '/api/graph?lens=world&contextId=local' });
    expect(world.statusCode).toBe(200);expect(world.json().nodes).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'profile' }),expect.objectContaining({ type: 'device', label: 'kigathi' })]));
    expect((await app.inject({ method: 'POST', url: '/api/fngk/connect', payload: { session: 'never-accept-this' } })).statusCode).toBe(404);
  });

  it('relays a terminal as WebSocket JSONL events', async () => {
    const app = await harness();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(address.replace(/^http/, 'ws') + '/api/fngk/terminals?target=kigathi&new=1');
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    while (!messages.some(message => message.type === 'ready')) await once(socket, 'message');
    socket.send(JSON.stringify({ type: 'command', requestId: 'test-1', command: 'npm test' }));
    while (!messages.some(message => message.type === 'command_state')) await once(socket, 'message');
    expect(messages).toContainEqual(expect.objectContaining({ type: 'command_state', requestId: 'test-1', status: 'succeeded' }));
    socket.send(JSON.stringify({ type: 'detach', requestId: 'done' }));
    await once(socket, 'close');
  });

  it('scopes terminal sessions to one Device and reports lifecycle counts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fngk-atlas-sessions-'));
    const app = await createApp({ fngk: new FngkProcessClient({ binary: fixture, env: { FNGK_FIXTURE_MODE: 'session-list' } }), dbPath: path.join(directory, 'atlas.db') });
    cleanups.push(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });

    const response = await app.inject({ method: 'GET', url: '/api/fngk/sessions?deviceId=device-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessions: [
        { id: 'session-live', deviceId: 'device-1' },
        { id: 'session-detached', deviceId: 'device-1' },
        { id: 'session-archived', deviceId: 'device-1' },
      ],
      counts: { total: 3, active: 2, live: 1, detached: 1, archived: 1 },
    });
  });

  it('requires explicit confirmation and streams a guided FNGK update', async () => {
    const app = await harness();
    expect((await app.inject({ method: 'POST', url: '/api/fngk/update', payload: {} })).statusCode).toBe(409);
    const response = await app.inject({ method: 'POST', url: '/api/fngk/update', payload: { confirm: true } });
    expect(response.statusCode).toBe(200);
    const events = response.body.trim().split('\n').map(line => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({ type: 'output', line: 'downloaded' }),
      expect.objectContaining({ type: 'output', line: 'installed' }),
      expect.objectContaining({ type: 'complete', context: expect.objectContaining({ compatible: true }) }),
    ]);
  });

  it('browses, conflict-checks, saves, and scans the process-visible machine context', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fngk-atlas-local-context-'));
    await import('node:fs/promises').then(async fs => { await fs.mkdir(path.join(directory, 'repo', '.git'), { recursive: true }); await fs.mkdir(path.join(directory, 'repo', 'coverage'), { recursive: true }); await fs.writeFile(path.join(directory, 'repo', 'package.json'), '{"name":"local","scripts":{"coverage":"vitest --coverage"}}'); await fs.writeFile(path.join(directory, 'repo', 'index.ts'), 'export function local(){return true;}'); await fs.writeFile(path.join(directory, 'repo', 'coverage', 'lcov.info'), 'SF:index.ts\nDA:1,1\nend_of_record\n'); });
    const app = await createApp({ fngk: new FngkProcessClient({ binary: fixture }), dbPath: path.join(directory, 'atlas.db'), localRoot: directory });
    cleanups.push(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
    const listed = await app.inject({ method: 'GET', url: '/api/files?contextId=local&path=/' });
    expect(listed.json()).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ name: 'repo', type: 'directory' })]), route: expect.objectContaining({ kind: 'direct' }) });
    const opened = (await app.inject({ method: 'GET', url: '/api/files/content?contextId=local&path=/repo/index.ts' })).json();
    expect(opened.text).toContain('return true');
    const saved = await app.inject({ method: 'PUT', url: '/api/files/content', payload: { contextId: 'local', path: '/repo/index.ts', contentBase64: Buffer.from('export function local(){return false;}').toString('base64'), expectedFingerprint: opened.fingerprint } });
    expect(saved.statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/files/content', payload: { contextId: 'local', path: '/repo/index.ts', contentBase64: Buffer.from('stale').toString('base64'), expectedFingerprint: opened.fingerprint } })).statusCode).toBe(409);

    const address = await app.listen({ host: '127.0.0.1', port: 0 }), socket = new WebSocket(address.replace(/^http/, 'ws') + '/api/discovery/scan?contextId=local'), batches: any[] = [];
    socket.on('message', raw => batches.push(JSON.parse(raw.toString()))); await once(socket, 'close');
    expect(batches.flatMap(batch => batch.entities ?? [])).toContainEqual(expect.objectContaining({ type: 'repository', path: '/repo' }));
    const evidence = (await app.inject({ method: 'GET', url: '/api/discovery/entities?contextId=local' })).json();
    expect(evidence.entities).toContainEqual(expect.objectContaining({ type: 'package', path: '/repo/package.json' }));
    const analysisSocket = new WebSocket(address.replace(/^http/, 'ws') + '/api/analysis/repository?contextId=local&path=/repo'), analysisMessages: any[] = [];
    analysisSocket.on('message', raw => analysisMessages.push(JSON.parse(raw.toString()))); await once(analysisSocket, 'close');
    expect(analysisMessages).toContainEqual(expect.objectContaining({ type: 'analysis_complete', index: expect.objectContaining({ summary: expect.objectContaining({ functions: 1 }) }), coverage: '/repo/coverage/lcov.info' }));
    expect((await app.inject({ method: 'GET', url: '/api/coverage/commands?contextId=local&repositoryPath=/repo' })).json().commands).toContainEqual(expect.objectContaining({ command: 'npm run coverage', producesCoverage: true }));
    const coverage = await app.inject({ method: 'POST', url: '/api/coverage/ingest', payload: { contextId: 'local', repositoryPath: '/repo', revision: 'abc' } });
    expect(coverage.json()).toMatchObject({ evidence: { format: 'lcov', revision: 'abc' }, summary: { functions: 0 } });
    const refreshed = await app.inject({ method: 'POST', url: '/api/coverage/refresh', payload: { contextId: 'local', repositoryPath: '/repo', command: 'true' } });
    expect(refreshed.json()).toMatchObject({ run: { status: 'succeeded' }, coverage: { artifact: '/repo/coverage/lcov.info', verified: true } });
    const graph = (await app.inject({ method: 'GET', url: '/api/graph' })).json();
    expect(graph.nodes.find((node: any) => node.name === 'local')).toMatchObject({ coverage: { fraction: 1, stale: false }, crap: 1 });
    const lens = (await app.inject({ method: 'GET', url: '/api/graph?lens=code&budget=2&layers=contains,calls' })).json();
    expect(lens).toMatchObject({ counts: { visibleNodes: 3, totalNodes: expect.any(Number) }, breadcrumbs: [] });
    expect(lens.nodes).toContainEqual(expect.objectContaining({ type: 'aggregate' }));
    const machine = (await app.inject({ method: 'GET', url: '/api/graph?lens=machine&budget=500&contextId=local' })).json();
    expect(machine.nodes).toContainEqual(expect.objectContaining({ type: 'process', metadata: expect.objectContaining({ pid: expect.any(Number) }) }));
    const otherContext = (await app.inject({ method: 'GET', url: '/api/graph?lens=code&contextId=device:other' })).json();
    expect(otherContext.index.contextId).toBe('device:other');
    expect(otherContext.nodes.some((node: any) => node.type === 'function')).toBe(false);

    expect((await app.inject({method:'POST',url:'/api/files',payload:{contextId:'local',path:'/repo/new',type:'directory'}})).statusCode).toBe(201);
    expect((await app.inject({method:'POST',url:'/api/files',payload:{contextId:'local',path:'/repo/new/readme.txt',type:'file',contentBase64:Buffer.from('Atlas searchable content').toString('base64')}})).statusCode).toBe(201);
    const searched=(await app.inject({method:'GET',url:'/api/files/search?contextId=local&path=/repo&query=searchable&mode=all'})).json();
    expect(searched.matches).toContainEqual(expect.objectContaining({path:'/repo/new/readme.txt',line:1}));
    expect((await app.inject({method:'PATCH',url:'/api/files',payload:{contextId:'local',path:'/repo/new/readme.txt',destination:'/repo/new/renamed.txt'}})).statusCode).toBe(200);
    const trashed=await app.inject({method:'DELETE',url:'/api/files',payload:{contextId:'local',path:'/repo/new/renamed.txt'}});
    expect(trashed.json()).toMatchObject({permanent:false,restoreAvailable:true,restorePath:expect.stringMatching(/^\/\.atlas-trash\//),route:expect.objectContaining({kind:'direct'})});
    expect((await app.inject({method:'POST',url:'/api/files/restore',payload:{contextId:'local',path:trashed.json().restorePath}})).statusCode).toBe(200);
    expect((await app.inject({method:'DELETE',url:'/api/files',payload:{contextId:'local',path:'/repo/new/renamed.txt',permanent:true,confirm:true}})).statusCode).toBe(200);
    expect((await app.inject({method:'DELETE',url:'/api/files',payload:{contextId:'local',path:'/repo',permanent:true}})).statusCode).toBe(409);
    expect((await app.inject({method:'DELETE',url:'/api/files',payload:{contextId:'local',path:'//',permanent:true,confirm:true}})).statusCode).toBe(400);
    const operations=(await app.inject({method:'GET',url:'/api/operations?contextId=local'})).json();
    expect(operations.items).toContainEqual(expect.objectContaining({type:'file.trash',summary:expect.objectContaining({path:'/repo/new/renamed.txt'})}));
    const indexedSearch=(await app.inject({method:'GET',url:'/api/search?contextId=local&q=local'})).json();
    expect(indexedSearch.items).toContainEqual(expect.objectContaining({type:'function',repositoryRoot:'/repo',contextId:'local'}));
  });
});
