import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FilePage, FileService } from '../files/file-service.js';
import type { DeviceSessionManager, DeviceSessionLease } from './manager.js';
import type { DeviceScope } from './types.js';

type ListOptions = { cursor?: string | null; limit?: number; knownRevision?: string; signal?: AbortSignal; force?: boolean };
type ReadOptions = { knownRevision?: string; signal?: AbortSignal };
type CachedPage = FilePage & { revision: string; sessionId?: string; handshakeCount: number; cacheHit: boolean };
type CachedRead = Awaited<ReturnType<FileService['read']>> & { revision: string; sessionId?: string; handshakeCount: number; cacheHit: boolean };
type PendingPage = { promise: Promise<CachedPage>; controller: AbortController; waiters: number; settled: boolean };

export interface FilesystemCacheDiagnostics { sessionId?: string; handshakeCount: number; requests: number; cacheHits: number; cacheMisses: number; latencyMs: number }
export interface FilesystemCacheOptions {
  sessions: DeviceSessionManager;
  /** Creates a policy-validating FileService backed by this lease's typed executor. */
  service: (scope: Readonly<DeviceScope>, lease: DeviceSessionLease) => Promise<FileService> | FileService;
}

const scopeKey = (scope: DeviceScope) => JSON.stringify([scope.profile, scope.teamId ?? null, scope.projectId ?? null, scope.deviceId]);
const pageKey = (scope: DeviceScope, logicalPath: string, options: ListOptions) => JSON.stringify([scopeKey(scope), path.posix.normalize(logicalPath), options.cursor ?? null, Math.min(500, Math.max(1, options.limit ?? 100))]);
const abortError = () => Object.assign(new Error('Filesystem request was cancelled.'), { code: 'cancelled' });
const revisionFor = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Scoped, revision-aware filesystem metadata cache. File bodies are never
 * retained after a read; only directory pages are cached.
 */
export class FilesystemCache {
  #pages = new Map<string, CachedPage>();
  #pageScopes = new Map<string, string>();
  #pending = new Map<string, PendingPage>();
  #diagnostics = new Map<string, FilesystemCacheDiagnostics>();
  #epochs = new Map<string, number>();

  constructor(private readonly options: FilesystemCacheOptions) {
    options.sessions.on('state', event => {
      if (event.type === 'cache_cleared' || event.state === 'revoked' || event.state === 'closed' || event.state === 'reconnecting') this.invalidate(event.scope);
    });
  }

  async list(scope: DeviceScope, logicalPath: string, options: ListOptions = {}): Promise<CachedPage> {
    if (options.signal?.aborted) throw abortError();
    const key = pageKey(scope, logicalPath, options), existing = this.#pages.get(key);
    if (existing && !options.force && (!options.knownRevision || options.knownRevision === existing.revision)) {
      this.#metric(scope, existing, true, 0);
      return { ...existing, cacheHit: true };
    }
    let pending = this.#pending.get(key);
    if (!pending) {
      const controller = new AbortController();
      const entry = { controller, waiters: 0, settled: false } as PendingPage;
      entry.promise = this.#list(scope, logicalPath, { ...options, signal: controller.signal }).finally(() => {
        entry.settled = true;
        if (this.#pending.get(key) === entry) this.#pending.delete(key);
      });
      pending = entry;
      this.#pending.set(key, pending);
    }
    return await this.#withAbort(key, pending, options.signal);
  }

  async read(scope: DeviceScope, logicalPath: string, options: ReadOptions = {}): Promise<CachedRead> {
    if (options.signal?.aborted) throw abortError();
    const started = performance.now(), lease = await this.options.sessions.acquire(scope);
    try {
      const service = await this.options.service(lease.scope, lease);
      const value = await service.read({ contextId: `device:${lease.scope.deviceId}`, path: logicalPath }, { signal: options.signal });
      const snapshot = this.options.sessions.snapshot(lease.scope);
      const result: CachedRead = { ...value, revision: value.fingerprint ?? revisionFor({ path: value.path, bytes: value.bytes, tooLarge: value.tooLarge }), sessionId: snapshot?.sessionId, handshakeCount: snapshot?.handshakeCount ?? 0, cacheHit: false };
      this.#metric(lease.scope, result, false, performance.now() - started);
      return result;
    } finally { lease.release(); }
  }

  invalidate(scope?: DeviceScope): void {
    const expected = scope ? scopeKey(scope) : undefined;
    if (expected) this.#epochs.set(expected, (this.#epochs.get(expected) ?? 0) + 1);
    for (const key of this.#pages.keys()) if (!expected || this.#pageScopes.get(key) === expected) {
      this.#pages.delete(key); this.#pageScopes.delete(key);
    }
  }
  diagnostics(scope: DeviceScope): FilesystemCacheDiagnostics { return { ...(this.#diagnostics.get(scopeKey(scope)) ?? { handshakeCount: 0, requests: 0, cacheHits: 0, cacheMisses: 0, latencyMs: 0 }) }; }

  async #list(scope: DeviceScope, logicalPath: string, options: ListOptions): Promise<CachedPage> {
    const started = performance.now(), scopedKey = scopeKey(scope), epoch = this.#epochs.get(scopedKey) ?? 0, lease = await this.options.sessions.acquire(scope);
    try {
      const service = await this.options.service(lease.scope, lease);
      const page = await service.list({ contextId: `device:${lease.scope.deviceId}`, path: logicalPath }, { cursor: options.cursor, limit: options.limit, signal: options.signal });
      const snapshot = this.options.sessions.snapshot(lease.scope);
      const result: CachedPage = { ...page, revision: revisionFor({ path: logicalPath, cursor: options.cursor ?? null, items: page.items.map(item => [item.name, item.type, item.bytes, item.modifiedAt, item.mode]) }), sessionId: snapshot?.sessionId, handshakeCount: snapshot?.handshakeCount ?? 0, cacheHit: false };
      const key = pageKey(scope, logicalPath, options);
      if (!options.signal?.aborted && (this.#epochs.get(scopedKey) ?? 0) === epoch) { this.#pages.set(key, result); this.#pageScopes.set(key, scopedKey); }
      this.#metric(lease.scope, result, false, performance.now() - started);
      return result;
    } finally { lease.release(); }
  }

  #metric(scope: DeviceScope, value: { sessionId?: string; handshakeCount: number }, hit: boolean, latencyMs: number): void {
    const key = scopeKey(scope), prior = this.#diagnostics.get(key) ?? { handshakeCount: 0, requests: 0, cacheHits: 0, cacheMisses: 0, latencyMs: 0 };
    this.#diagnostics.set(key, { sessionId: value.sessionId, handshakeCount: value.handshakeCount, requests: prior.requests + (hit ? 0 : 1), cacheHits: prior.cacheHits + Number(hit), cacheMisses: prior.cacheMisses + Number(!hit), latencyMs: hit ? prior.latencyMs : latencyMs });
  }
  async #withAbort<T>(key: string, entry: { promise: Promise<T>; controller: AbortController; waiters: number; settled: boolean }, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw abortError();
    entry.waiters += 1;
    let departed = false;
    const depart = () => {
      if (departed) return;
      departed = true;
      entry.waiters -= 1;
      // A browser navigation/refresh only abandons its own HTTP waiter.  The
      // in-flight command belongs to the shared Device Session: aborting it
      // here cancels the terminal command for a refresh arriving milliseconds
      // later, which presents as a spurious empty/failed filesystem tree.
      // Let the bounded terminal-command timeout settle it and allow the next
      // caller to join this pending request.
    };
    return await new Promise<T>((resolve, reject) => {
      const finish = () => { signal?.removeEventListener('abort', cancel); depart(); };
      const cancel = () => { finish(); reject(abortError()); };
      signal?.addEventListener('abort', cancel, { once: true });
      entry.promise.then(value => { if (!departed) { finish(); resolve(value); } }, error => { if (!departed) { finish(); reject(error); } });
    });
  }
}
