import { createHash } from 'node:crypto';
import path from 'node:path';
import { DirectTransport } from '../transports/direct.js';
import type { FileTransport } from '../transports/file-transport.js';
import { TerminalFileTransport } from '../transports/terminal-file.js';
import { DirectCommandExecutor } from '../transports/direct-command.js';
import { RuntimeDiscovery } from './runtime-discovery.js';

export interface DiscoveryContext { id: string; route: FileTransport; deviceId?: string }
export interface DiscoveredEntity { id: string; contextId: string; type: string; name: string; path: string; metadata?: Record<string, unknown> }
export interface DiscoveryBatch { entities: DiscoveredEntity[]; errors: Array<{ path: string; code: string }>; scanned: number; complete: boolean; partial: boolean }

const ignoredTrees = new Set(['node_modules', 'vendor', '.git', '.svelte-kit', 'dist', 'build', 'target', '__pycache__']);
const virtualRoots = new Set(['/proc', '/sys', '/dev', '/run', '/snap']);
const manifests = new Map([['package.json', 'npm'], ['go.mod', 'go'], ['composer.json', 'composer'], ['pyproject.toml', 'python'], ['requirements.txt', 'python'], ['Cargo.toml', 'cargo']]);
const identifier = (contextId: string, type: string, itemPath: string) => createHash('sha256').update(`${contextId}\0${type}\0${itemPath}`).digest('hex').slice(0, 32);

export class HostDiscovery {
  readonly maxEntries: number;
  readonly maxDepth: number;
  readonly batchSize: number;
  constructor(options: { maxEntries?: number; maxDepth?: number; batchSize?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 10_000; this.maxDepth = options.maxDepth ?? 8; this.batchSize = options.batchSize ?? 100;
  }

  async *scan(context: DiscoveryContext, signal?: AbortSignal): AsyncIterable<DiscoveryBatch> {
    const queue: Array<{ path: string; depth: number }> = [{ path: '/', depth: 0 }], pending: DiscoveredEntity[] = [], errors: Array<{ path: string; code: string }> = [];
    let scanned = 0, partial = false;
    if (signal?.aborted) throw Object.assign(new Error('Discovery cancelled.'), { code: 'cancelled' });
    pending.push({ id: identifier(context.id, 'filesystem', '/'), contextId: context.id, type: 'filesystem', name: '/', path: '/', metadata: { routeId: context.route.id, effectiveIdentity: context.route.effectiveIdentity, privilege: context.route.privilege } });
    const executor = context.route instanceof TerminalFileTransport ? context.route.executor : context.route instanceof DirectTransport ? new DirectCommandExecutor() : undefined;
    if (executor) pending.push(...await new RuntimeDiscovery(executor).scan(context.id, context.route.id, signal));
    while (pending.length >= this.batchSize) yield { entities: pending.splice(0, this.batchSize), errors: [], scanned, complete: false, partial };
    while (queue.length && scanned < this.maxEntries) {
      if (signal?.aborted) throw Object.assign(new Error('Discovery cancelled.'), { code: 'cancelled' });
      const current = queue.shift()!;
      if (current.depth >= this.maxDepth || virtualRoots.has(current.path)) continue;
      let entries;
      try { entries = await context.route.list(current.path); }
      catch (error) { errors.push({ path: current.path, code: String((error as { code?: string }).code ?? 'list_failed') }); partial = true; continue; }
      const repository = entries.some(entry => entry.name === '.git');
      if (repository) pending.push({ id: identifier(context.id, 'repository', current.path), contextId: context.id, type: 'repository', name: path.posix.basename(current.path) || '/', path: current.path, metadata: { routeId: context.route.id } });
      for (const entry of entries) {
        if (++scanned > this.maxEntries) { partial = true; break; }
        if (entry.name !== '.git') pending.push({ id: identifier(context.id, entry.type, entry.path), contextId: context.id, type: entry.type, name: entry.name, path: entry.path, metadata: { bytes: entry.bytes, modifiedAt: entry.modifiedAt, mode: entry.mode, routeId: context.route.id } });
        const ecosystem = manifests.get(entry.name);
        if (ecosystem) pending.push({ id: identifier(context.id, 'package', entry.path), contextId: context.id, type: 'package', name: entry.name, path: entry.path, metadata: { ecosystem, routeId: context.route.id } });
        if (entry.type === 'directory' && !ignoredTrees.has(entry.name) && !virtualRoots.has(entry.path)) queue.push({ path: entry.path, depth: current.depth + 1 });
        if (pending.length >= this.batchSize) yield { entities: pending.splice(0), errors: errors.splice(0), scanned, complete: false, partial };
      }
    }
    if (queue.length) partial = true;
    yield { entities: pending, errors, scanned, complete: true, partial };
  }
}
