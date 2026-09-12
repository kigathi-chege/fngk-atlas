import { once } from 'node:events';
import { FngkProcessClient } from '../fngk/process-client.js';
import type { NamespaceDevice, TerminalEvent } from '../fngk/protocol.js';
import { FileService } from '../files/file-service.js';
import { DirectTransport } from '../transports/direct.js';
import type { FileTransport } from '../transports/file-transport.js';
import { FngkTerminalCommandExecutor } from '../transports/terminal-command.js';
import type { CommandExecutor } from '../transports/terminal-command.js';
import { TerminalFileTransport } from '../transports/terminal-file.js';
import { DirectCommandExecutor } from '../transports/direct-command.js';

function deviceTarget(device: NamespaceDevice): string { return typeof device.ref === 'string' ? device.ref : `device:${device.id}`; }
async function matchingEvent(emitter: NodeJS.EventEmitter, predicate: (event: TerminalEvent) => boolean, timeoutMs = 5_000): Promise<TerminalEvent> {
  return await new Promise((resolve, reject) => {
    const receive = (event: TerminalEvent) => { if (predicate(event)) finish(undefined, event); };
    const close = () => finish(Object.assign(new Error('FNGK terminal closed while preparing the context.'), { code: 'terminal_closed' }));
    const finish = (error?: Error, event?: TerminalEvent) => { clearTimeout(timer); emitter.removeListener('event', receive); emitter.removeListener('close', close); error ? reject(error) : resolve(event!); };
    const timer = setTimeout(() => finish(Object.assign(new Error('FNGK terminal context timed out.'), { code: 'timeout' })), timeoutMs); timer.unref();
    emitter.on('event', receive); emitter.once('close', close);
  });
}

export class EffectiveContextService {
  readonly direct: DirectTransport;
  #remote = new Map<string, TerminalFileTransport>();
  constructor(readonly fngk: FngkProcessClient, options: { localRoot?: string } = {}) {
    this.direct = new DirectTransport({ id: 'direct:local', contextId: 'local', root: options.localRoot ?? '/' });
  }
  async contexts() {
    const state = await this.fngk.probe();
    const local = { id: 'local', name: 'Atlas process host', kind: 'local', online: true, routes: [this.#evidence(this.direct)] };
    const devices = (state.namespace?.devices ?? []).map(device => ({ id: `device:${device.id}`, name: device.name, kind: 'fngk-device', online: device.online ?? false, device, routes: this.#remote.has(`device:${device.id}`) ? [this.#evidence(this.#remote.get(`device:${device.id}`)!)] : [] }));
    return { state, contexts: [local, ...devices] };
  }
  #evidence(route: FileTransport) { return { id: route.id, kind: route.kind, deviceId: route.deviceId, effectiveIdentity: route.effectiveIdentity, privilege: route.privilege, observedAt: route.observedAt, available: route.available, operations: route.operations }; }
  async route(contextId: string): Promise<FileTransport> {
    if (contextId === 'local') return this.direct;
    const existing = this.#remote.get(contextId); if (existing) return existing;
    const namespace = await this.fngk.namespace(), deviceId = contextId.startsWith('device:') ? contextId.slice(7) : contextId;
    const device = namespace.devices.find(value => value.id === deviceId); if (!device) throw Object.assign(new Error('FNGK Device is not in the current namespace.'), { code: 'context_not_found' });
    if (device.online === false) throw Object.assign(new Error('FNGK Device is offline.'), { code: 'device_offline' });
    const terminal = this.fngk.openTerminal(deviceTarget(device), { newSession: true });
    await Promise.race([once(terminal, 'ready'), once(terminal, 'error').then(([error]) => Promise.reject(error))]);
    const modeChanged = matchingEvent(terminal, event => event.type === 'collaboration' && event.eventType === 'mode' && event.mode === 'queue');
    terminal.setMode('queue', 'atlas-context-mode'); await modeChanged;
    const executor = new FngkTerminalCommandExecutor(terminal);
    let identity = 'remote-shell', privilege: FileTransport['privilege'] = 'unknown';
    try { const result = await executor.execute(`id -u; id -un`); const [uid, name] = result.output.toString('utf8').trim().split(/\r?\n/); identity = name ? `${name} (uid:${uid})` : `uid:${uid}`; privilege = uid === '0' ? 'root' : 'user'; } catch {}
    const route = new TerminalFileTransport({ id: `terminal:${device.id}`, contextId, deviceId: device.id, identity, privilege, executor });
    this.#remote.set(contextId, route); return route;
  }
  async files(contextId: string): Promise<FileService> { return new FileService([await this.route(contextId)]); }
  async commandExecutor(contextId: string): Promise<CommandExecutor> { const route = await this.route(contextId); if (route instanceof TerminalFileTransport) return route.executor; if (route instanceof DirectTransport) return new DirectCommandExecutor(); throw Object.assign(new Error('This context has no command route.'), { code: 'route_unavailable' }); }
  async commandPath(contextId: string, logicalPath: string): Promise<string> { const route = await this.route(contextId); return route instanceof DirectTransport ? route.resolve(logicalPath) : logicalPath; }
  activeTerminals() { return [...this.#remote.entries()].map(([contextId, route]) => ({ contextId, route: this.#evidence(route), sessionId: route.executor instanceof FngkTerminalCommandExecutor ? route.executor.session.sessionId : undefined })); }
  release(contextId: string, stop = false): boolean {
    const route = this.#remote.get(contextId); if (!route) return false;
    if (route.executor instanceof FngkTerminalCommandExecutor) stop ? route.executor.session.stop('atlas-release') : route.executor.session.detach('atlas-release');
    this.#remote.delete(contextId); return true;
  }
  close(): void { for (const route of this.#remote.values()) route.executor instanceof FngkTerminalCommandExecutor && route.executor.session.detach('atlas-shutdown'); this.#remote.clear(); }
}
