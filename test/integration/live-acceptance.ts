import { once } from 'node:events';
import { readdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';

const atlas = process.env.LIVE_ATLAS_URL;
const fixtureRoot = process.env.LIVE_FIXTURE_ROOT;
if (!atlas || !fixtureRoot) throw new Error('LIVE_ATLAS_URL and LIVE_FIXTURE_ROOT are required');
const evidence: Record<string, unknown> = {};
const check = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(message); };
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${atlas}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const text = await response.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { response, body, text };
}
async function websocket(path: string, send?: (socket: WebSocket, messages: any[]) => Promise<void> | void) {
  const socket = new WebSocket(`${atlas.replace(/^http/, 'ws')}${path}`), messages: any[] = [];
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await once(socket, 'open'); if (send) await send(socket, messages); await once(socket, 'close'); return messages;
}
async function waitFor(messages: any[], predicate: (message: any) => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const found = messages.find(predicate); if (found) return found; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('timed out waiting for live protocol event');
}

const context = await api('/api/fngk/context?profile=live');
check(context.response.ok && context.body.compatible, 'Atlas did not discover a compatible exact-head FNGK');
check(!/credential|cookie|authorization|ticket/i.test(context.text), 'namespace context leaked a secret-bearing field');
const namespace = await api('/api/fngk/namespace?profile=live');
check(namespace.body.protocolVersion === 'fngk.namespace.v1', 'namespace protocol mismatch');
const device = namespace.body.devices.find((value: any) => value.online);
check(device, 'no online disposable Device appeared in the namespace');
const contextId = `device:${device.id}`, encodedContext = encodeURIComponent(contextId), encodedRoot = encodeURIComponent(fixtureRoot);
evidence.namespace = { protocolVersion: namespace.body.protocolVersion, device: { id: device.id, name: device.name, online: device.online } };

const root = await api(`/api/files?contextId=${encodedContext}&path=%2F&limit=25`);
const rootRoutes = await api('/api/contexts/terminals');
check(root.response.ok && root.body.route?.kind === 'terminal', `root was not reached through terminal authority: ${JSON.stringify({ response: root.body, routes: rootRoutes.body })}`);
check(root.body.route?.privilege === 'root', `expected root terminal authority, got ${root.body.route?.effectiveIdentity}`);
const original = await api(`/api/files/content?contextId=${encodedContext}&path=${encodeURIComponent(`${fixtureRoot}/src/server.js`)}`);
if (!(original.response.ok && original.body.text?.includes('classify'))) {
  const diagnostic: any[] = [], socket = new WebSocket(`${atlas.replace(/^http/, 'ws')}/api/fngk/terminals?target=${encodeURIComponent(`device:${device.id}`)}&new=1`);
  socket.on('message', raw => diagnostic.push(JSON.parse(raw.toString()))); await once(socket, 'open'); await waitFor(diagnostic, message => message.type === 'ready');
  socket.send(JSON.stringify({ type: 'command', requestId: 'diagnostic-read', command: `base64 -- '${fixtureRoot.replaceAll("'", "'\\''")}/src/server.js'` })); await waitFor(diagnostic, message => message.type === 'command_state' && message.requestId === 'diagnostic-read' && ['succeeded', 'failed'].includes(message.status));
  socket.send(JSON.stringify({ type: 'detach', requestId: 'diagnostic-done' })); await once(socket, 'close');
  throw new Error(`remote source was not readable: ${JSON.stringify({ response: original.body, output: diagnostic.filter(message => message.type === 'output').map(message => Buffer.from(message.bodyBase64, 'base64').toString('utf8')) })}`);
}
check(original.response.ok && original.body.text?.includes('classify'), `remote source was not readable: ${JSON.stringify(original.body)}`);
await writeFile(`${fixtureRoot}/src/server.js`, `${original.body.text}\n// changed outside Atlas\n`);
const conflict = await api('/api/files/content', { method: 'PUT', body: JSON.stringify({ contextId, path: `${fixtureRoot}/src/server.js`, expectedFingerprint: original.body.fingerprint, contentBase64: Buffer.from(original.body.text).toString('base64') }) });
check(conflict.response.status === 409, 'stale remote write did not conflict');
const current = await api(`/api/files/content?contextId=${encodedContext}&path=${encodeURIComponent(`${fixtureRoot}/src/server.js`)}`);
const savedText = `${current.body.text}\n// saved by Atlas live acceptance\n`;
const saved = await api('/api/files/content', { method: 'PUT', body: JSON.stringify({ contextId, path: `${fixtureRoot}/src/server.js`, expectedFingerprint: current.body.fingerprint, contentBase64: Buffer.from(savedText).toString('base64') }) });
check(saved.response.ok, 'conflict-safe remote save failed');

const discovery = await websocket(`/api/discovery/scan?contextId=${encodedContext}&root=${encodedRoot}&maxEntries=200&maxDepth=5`);
check(discovery.some(message => message.complete === true), 'bounded remote discovery did not complete');
check(discovery.flatMap(message => message.entities ?? []).some((entity: any) => entity.type === 'process'), 'terminal discovery did not report runtime processes');
const analysis = await websocket(`/api/analysis/repository?contextId=${encodedContext}&path=${encodedRoot}`);
check(analysis.some(message => message.type === 'analysis_complete' && message.index?.summary?.functions >= 1), 'remote repository analysis did not complete');
const execution = await api(`/api/graph?contextId=${encodedContext}&lens=execution&layers=loads,runtime_in,served_by,contains&budget=500`);
check(execution.body.edges.some((edge: any) => edge.type === 'loads' && edge.evidence?.kind === 'command_path'), 'process-to-code evidence link is missing');

const coverage = await api('/api/coverage/refresh', { method: 'POST', body: JSON.stringify({ contextId, repositoryPath: fixtureRoot, command: 'npm run coverage' }) });
check(coverage.response.ok && coverage.body.coverage?.verified, 'coverage run was not verified');
const code = await api(`/api/graph?contextId=${encodedContext}&lens=code&budget=500`);
check(code.body.nodes.some((node: any) => node.type === 'function' && typeof node.crap === 'number' && node.coverage?.stale === false), 'verified coverage did not produce CRAP');

const terminalMessages: any[] = [];
const terminal = new WebSocket(`${atlas.replace(/^http/, 'ws')}/api/fngk/terminals?target=${encodeURIComponent(`device:${device.id}`)}&new=1`);
terminal.on('message', raw => terminalMessages.push(JSON.parse(raw.toString()))); await once(terminal, 'open');
await waitFor(terminalMessages, message => message.type === 'ready');
terminal.send(JSON.stringify({ type: 'mode', requestId: 'queue-mode', mode: 'queue' }));
await waitFor(terminalMessages, message => message.type === 'collaboration' && message.mode === 'queue');
terminal.send(JSON.stringify({ type: 'command', requestId: 'run-ok', command: "printf 'atlas-live-terminal\\n'" }));
check((await waitFor(terminalMessages, message => message.type === 'command_state' && message.requestId === 'run-ok' && ['succeeded', 'failed'].includes(message.status))).status === 'succeeded', 'terminal command failed');
terminal.send(JSON.stringify({ type: 'command', requestId: 'run-interrupt', command: 'sleep 30' }));
await waitFor(terminalMessages, message => message.type === 'command_state' && message.requestId === 'run-interrupt' && message.status === 'running');
terminal.send(JSON.stringify({ type: 'interrupt', requestId: 'interrupt-1' }));
await waitFor(terminalMessages, message => message.type === 'command_state' && message.requestId === 'run-interrupt' && ['succeeded', 'failed'].includes(message.status));
terminal.send(JSON.stringify({ type: 'detach', requestId: 'terminal-done' })); await once(terminal, 'close');

const activeBefore = await api('/api/contexts/terminals'); const priorSession = activeBefore.body.items.find((item: any) => item.contextId === contextId)?.sessionId;
const released = await api(`/api/contexts/${encodedContext}/release`, { method: 'POST', body: '{}' }); check(released.body.released, 'remote context did not disconnect');
const stale = await api(`/api/discovery/entities?contextId=${encodedContext}`); check(stale.body.entities.some((entity: any) => entity.stale === true), 'disconnected evidence was not marked stale');
const reopened = await api(`/api/files?contextId=${encodedContext}&path=${encodedRoot}&limit=10`); check(reopened.response.ok, 'remote context did not reconnect');
const activeAfter = await api('/api/contexts/terminals'); const nextSession = activeAfter.body.items.find((item: any) => item.contextId === contextId)?.sessionId;
check(nextSession && nextSession !== priorSession, 'reconnect did not establish a fresh terminal session');
await websocket(`/api/discovery/scan?contextId=${encodedContext}&root=${encodedRoot}&maxEntries=200&maxDepth=5`);
const fresh = await api(`/api/discovery/entities?contextId=${encodedContext}`); check(fresh.body.entities.every((entity: any) => entity.stale === false), 'successful rescan did not refresh stale evidence');
const leftovers = (await readdir(fixtureRoot)).filter(name => name.includes('.atlas-') || name.endsWith('.b64'));
check(leftovers.length === 0, `helper artifacts remained: ${leftovers.join(', ')}`);
evidence.acceptance = { rootRoute: root.body.route, conflict: conflict.body.error, processCodeEdges: execution.body.edges.filter((edge: any) => edge.type === 'loads').length, coverage: coverage.body.coverage, terminalEvents: terminalMessages.map(message => message.type), reconnect: { priorSession, nextSession }, helperArtifacts: leftovers };
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
