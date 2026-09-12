import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { RawData } from 'ws';
import { analyze } from '../analyzer.js';
import { Store } from '../store.js';
import { runFunction } from '../sandbox.js';
import { observeLocalProcesses } from '../runtime.js';
import { FngkProcessClient, FngkProcessError } from '../fngk/process-client.js';
import type { TerminalInput } from '../fngk/protocol.js';
import { EffectiveContextService } from './context-service.js';
import { HostDiscovery } from '../discovery/host-discovery.js';
import { EvidenceStore } from '../store/evidence-store.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const terminalInputs = new Set(['input', 'command', 'resize', 'interrupt', 'mode', 'control_request', 'control_resolve', 'nested_approval_resolve', 'detach', 'stop']);

interface CreateAppOptions {
  fngk?: FngkProcessClient;
  dbPath?: string;
  root?: string;
  localRoot?: string;
  logger?: boolean;
}

function processError(error: unknown): { statusCode: number; body: Record<string, unknown> } {
  if (error instanceof FngkProcessError) {
    const statusCode = error.code === 'binary_missing' || error.code === 'daemon_unavailable' ? 503 : error.code === 'authentication_required' ? 401 : error.code === 'unsupported_protocol' ? 409 : error.code === 'timeout' ? 504 : 502;
    return { statusCode, body: { error: error.code, message: error.message } };
  }
  const value = error as { code?: string; message?: string };
  const code = value.code ?? 'internal_error';
  const statusCode = code === 'context_not_found' ? 404 : code === 'device_offline' || code === 'route_unavailable' ? 409 : code === 'invalid_path' || code === 'path_escape' ? 400 : code === 'cancelled' ? 499 : 500;
  return { statusCode, body: { error: code, message: value.message ?? 'Unexpected error.' } };
}

function requestSignal(request: { raw: NodeJS.EventEmitter }): AbortSignal {
  const controller = new AbortController();
  request.raw.once('aborted', () => controller.abort());
  return controller.signal;
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const root = options.root ?? projectRoot;
  const store = new Store(options.dbPath ?? process.env.ATLAS_DB ?? path.join(root, '.atlas', 'atlas.db'));
  const fngk = options.fngk ?? new FngkProcessClient();
  const contexts = new EffectiveContextService(fngk, { localRoot: options.localRoot });
  const evidence = new EvidenceStore(options.dbPath ?? process.env.ATLAS_DB ?? path.join(root, '.atlas', 'atlas.db'));
  const discovery = new HostDiscovery();
  let activeIndex = store.latestIndex();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 << 20 });
  await app.register(websocket);
  app.addHook('onClose', async () => { contexts.close(); evidence.close(); store.close(); });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:");
    return payload;
  });

  app.get('/api/health', async () => ({ ok: true, version: '0.2.0', activeIndex: activeIndex?.summary ?? null }));
  app.get('/api/fngk/context', async (request, reply) => {
    const profile = String((request.query as { profile?: string }).profile ?? '') || undefined;
    const state = await fngk.probe(profile, requestSignal(request));
    return state.installed ? state : reply.code(503).send(state);
  });
  app.get('/api/fngk/namespace', async (request, reply) => {
    const profile = String((request.query as { profile?: string }).profile ?? '') || undefined;
    try { return await fngk.namespace(profile, requestSignal(request)); }
    catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.get('/api/contexts', async (_request, reply) => {
    try { return await contexts.contexts(); }
    catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.get('/api/contexts/terminals', async () => ({ items: contexts.activeTerminals() }));
  app.post('/api/contexts/:id/release', async (request, reply) => { const id = decodeURIComponent((request.params as { id: string }).id), body = request.body as { stop?: boolean; confirm?: boolean } | undefined, stop = body?.stop === true; if (stop && body?.confirm !== true) return reply.code(409).send({ error: 'confirmation_required' }); return { released: contexts.release(id, stop), contextId: id, stopped: stop }; });

  const routeEvidence = (route: { id: string; kind: string; deviceId?: string; effectiveIdentity: string; privilege: string; observedAt: string }) => ({ id: route.id, kind: route.kind, deviceId: route.deviceId, effectiveIdentity: route.effectiveIdentity, privilege: route.privilege, observedAt: route.observedAt });
  app.get('/api/files', async (request, reply) => {
    const query = request.query as { contextId?: string; path?: string; cursor?: string; limit?: string };
    try { const page = await (await contexts.files(query.contextId ?? 'local')).list({ contextId: query.contextId ?? 'local', path: query.path ?? '/' }, { cursor: query.cursor, limit: Number(query.limit) || 100 }); return { ...page, route: routeEvidence(page.route) }; }
    catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.get('/api/files/content', async (request, reply) => {
    const query = request.query as { contextId?: string; path?: string };
    if (!query.path) return reply.code(400).send({ error: 'path_required' });
    try { const value = await (await contexts.files(query.contextId ?? 'local')).read({ contextId: query.contextId ?? 'local', path: query.path }); return { ...value, contentBase64: value.content?.toString('base64'), content: undefined, route: routeEvidence(value.route) }; }
    catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.put('/api/files/content', async (request, reply) => {
    const body = request.body as { contextId?: string; path?: string; contentBase64?: string; expectedFingerprint?: string };
    if (!body.path || typeof body.contentBase64 !== 'string' || !body.expectedFingerprint) return reply.code(400).send({ error: 'invalid_write' });
    try { const value = await (await contexts.files(body.contextId ?? 'local')).write({ contextId: body.contextId ?? 'local', path: body.path }, Buffer.from(body.contentBase64, 'base64'), body.expectedFingerprint); return { ...value, route: routeEvidence(value.route) }; }
    catch (error) { const value = error as { code?: string }; if (value.code === 'file_conflict') return reply.code(409).send({ error: value.code, message: (error as Error).message }); const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.get('/api/discovery/entities', async (request) => { const contextId = String((request.query as { contextId?: string }).contextId ?? 'local'); return { entities: evidence.entities(contextId), relationships: evidence.relationships(contextId) }; });
  app.get('/api/discovery/scan', { websocket: true }, (socket, request) => {
    const contextId = String((request.query as { contextId?: string }).contextId ?? 'local');
    const controller = new AbortController(); socket.once('close', () => controller.abort());
    void (async () => {
      const route = await contexts.route(contextId), scan = evidence.beginScan({ contextId, routeId: route.id });
      let partial = false;
      for await (const batch of discovery.scan({ id: contextId, route }, controller.signal)) {
        partial ||= batch.partial; evidence.putEntities(scan.id, batch.entities);
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'discovery_batch', scanId: scan.id, ...batch, route: routeEvidence(route) }));
      }
      evidence.completeScan(scan.id, { partial });
      if (socket.readyState === socket.OPEN) socket.close(1000);
    })().catch(error => { if (socket.readyState === socket.OPEN) { socket.send(JSON.stringify({ type: 'error', code: (error as { code?: string }).code ?? 'discovery_failed', message: (error as Error).message })); socket.close(1011); } });
  });

  app.get('/api/fngk/terminals', { websocket: true }, (socket, request) => {
    const query = request.query as { target?: string; new?: string; session?: string; profile?: string };
    const target = String(query.target ?? '').trim();
    if (!target) { socket.send(JSON.stringify({ type: 'error', code: 'target_required', message: 'A Device or Connection target is required.' })); socket.close(1008); return; }
    const session = fngk.openTerminal(target, { newSession: query.new === '1', sessionId: query.session, profile: query.profile });
    session.on('event', event => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
      if (event.type === 'detached' && socket.readyState === socket.OPEN) socket.close(1000);
    });
    session.on('error', error => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'error', code: (error as { code?: string }).code ?? 'terminal_error', message: (error as Error).message }));
    });
    session.on('close', () => { if (socket.readyState === socket.OPEN) socket.close(1000); });
    socket.on('message', (raw: RawData) => {
      try {
        const message = JSON.parse(raw.toString()) as TerminalInput;
        if (!message || !terminalInputs.has(message.type)) throw new Error('unsupported terminal message');
        if (!session.send(message)) throw new Error('terminal session is closed');
      } catch (error) {
        socket.send(JSON.stringify({ type: 'error', code: 'invalid_input', message: (error as Error).message }));
      }
    });
    socket.once('close', () => {
      if (session.process.exitCode === null) {
        session.detach('browser-disconnect');
        const timer = setTimeout(() => session.process.kill('SIGTERM'), 1_000); timer.unref();
      }
    });
  });

  app.post('/api/fngk/update', async (request, reply) => {
    if ((request.body as { confirm?: boolean } | undefined)?.confirm !== true) return reply.code(409).send({ error: 'confirmation_required' });
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    const emit = (value: Record<string, unknown>) => reply.raw.write(`${JSON.stringify(value)}\n`);
    try {
      const signal = requestSignal(request);
      await fngk.update(line => emit({ type: 'output', line }), signal);
      emit({ type: 'complete', context: await fngk.probe(undefined, signal) });
    } catch (error) {
      const result = processError(error); emit({ type: 'error', ...result.body });
    } finally { reply.raw.end(); }
  });

  app.get('/api/state', async () => ({ fngk: await fngk.probe(), index: activeIndex ? { id: activeIndex.id, root: activeIndex.root, summary: activeIndex.summary } : null, runs: store.runs() }));
  app.post('/api/index', async (request, reply) => {
    const body = request.body as { root?: string; maxFiles?: number };
    const target = String(body?.root ?? '');
    if (!path.isAbsolute(target)) return reply.code(400).send({ error: 'root_must_be_absolute' });
    try { activeIndex = await observeLocalProcesses(await analyze(target, { maxFiles: Number(body.maxFiles) || 6000 })); store.saveIndex(activeIndex); return { id: activeIndex.id, root: activeIndex.root, summary: activeIndex.summary }; }
    catch (error) { return reply.code(400).send({ error: 'analysis_failed', message: (error as Error).message }); }
  });
  app.get('/api/graph', async (request, reply) => {
    if (!activeIndex) return reply.code(404).send({ error: 'no_active_index' });
    const queryValue = request.query as { type?: string; q?: string; parent?: string; limit?: string };
    const type = String(queryValue.type ?? ''), query = String(queryValue.q ?? '').toLowerCase(), parent = String(queryValue.parent ?? '');
    let nodes = activeIndex.nodes;
    if (type) nodes = nodes.filter((node: any) => node.type === type);
    if (parent) nodes = nodes.filter((node: any) => node.parent === parent || node.id === parent);
    if (query) nodes = nodes.filter((node: any) => `${node.label} ${node.path ?? ''} ${node.qualifiedName ?? ''}`.toLowerCase().includes(query));
    nodes = nodes.slice(0, Math.min(Number(queryValue.limit) || 2500, 10000));
    const ids = new Set(nodes.map((node: any) => node.id));
    return { index: { id: activeIndex.id, root: activeIndex.root, summary: activeIndex.summary }, nodes, edges: activeIndex.edges.filter((edge: any) => ids.has(edge.source) && ids.has(edge.target)), total: activeIndex.nodes.length, layout: store.layout(activeIndex.id) };
  });
  app.get('/api/nodes/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id, node = activeIndex?.nodes.find((item: any) => item.id === id);
    if (!node) return reply.code(404).send({ error: 'node_not_found' });
    return { node, incoming: activeIndex.edges.filter((edge: any) => edge.target === node.id).slice(0, 100), outgoing: activeIndex.edges.filter((edge: any) => edge.source === node.id).slice(0, 100) };
  });
  app.post('/api/layout', async (request, reply) => {
    if (!activeIndex) return reply.code(404).send({ error: 'no_active_index' });
    const positions = Array.isArray((request.body as any)?.positions) ? (request.body as any).positions.filter((position: any) => typeof position.id === 'string' && Number.isFinite(position.x) && Number.isFinite(position.y)).slice(0, 10000) : [];
    store.saveLayout(activeIndex.id, positions); return { saved: positions.length };
  });
  app.post('/api/run', async (request, reply) => {
    if (!activeIndex) return reply.code(404).send({ error: 'no_active_index' });
    const body = request.body as any;
    if (body?.consent !== true) return reply.code(409).send({ error: 'operation_consent_required' });
    try { const run = await runFunction(activeIndex, String(body.symbolId), body); store.saveRun({ ...run, summary: { truncated: run.truncated, exitCode: run.exitCode } }); return run; }
    catch (error) { const run = { id: randomUUID(), symbolId: String(body?.symbolId ?? ''), mode: 'disposable', status: 'unavailable', summary: { message: (error as Error).message } }; store.saveRun(run); return reply.code(409).send({ error: 'run_unavailable', message: (error as Error).message, run }); }
  });

  const assets = new Map<string, [string, string]>([['/', ['public/index.html', 'text/html; charset=utf-8']], ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']], ['/table.css', ['public/table.css', 'text/css; charset=utf-8']], ['/vendor/cytoscape.js', ['node_modules/cytoscape/dist/cytoscape.min.js', 'text/javascript; charset=utf-8']]]);
  for (const [url, [file, type]] of assets) app.get(url, async (_request, reply) => reply.type(type).send(await readFile(path.join(root, file))));
  return app;
}
