import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { FngkTerminalCommandExecutor, type CommandExecutor, type CommandResult } from '../transports/terminal-command.js';
import type { TerminalEvent } from '../fngk/protocol.js';
import type { TerminalSession } from '../fngk/terminal-session.js';
import type { DeviceScope, DeviceSessionOperation, DeviceSessionSnapshot, DeviceSessionState, DeviceSessionStateEvent } from './types.js';

export type DeviceSessionFactory = (scope: Readonly<DeviceScope>, signal: AbortSignal) => Promise<TerminalSession> | TerminalSession;

export interface DeviceSessionManagerOptions {
  createSession: DeviceSessionFactory;
  idleTtlMs?: number;
  reconnectAttempts?: number;
}

type Entry = {
  key: string;
  scope: Readonly<DeviceScope>;
  state: DeviceSessionState;
  terminal?: TerminalSession;
  executor?: FngkTerminalCommandExecutor;
  connecting?: Promise<void>;
  reconnecting?: Promise<void>;
  leases: Set<DeviceSessionLease>;
  streams: Set<DeviceSessionSubstream>;
  cancellations: Map<string, AbortController>;
  idleTimer?: NodeJS.Timeout;
  handshakeCount: number;
  cacheEpoch: number;
  connectedAt?: string;
  lastFailure?: { code: string; message: string; occurredAt: string };
  ignoredTerminals: Set<TerminalSession>;
};

function scopeKey(scope: DeviceScope): string {
  return JSON.stringify([scope.profile, scope.teamId ?? null, scope.projectId ?? null, scope.deviceId]);
}

function invalidScope(scope: DeviceScope): Error | undefined {
  for (const value of [scope.profile, scope.teamId, scope.projectId, scope.deviceId]) {
    if (value !== undefined && (typeof value !== 'string' || !value || value.length > 256 || /[\x00-\x1f]/.test(value))) {
      return Object.assign(new Error('A Device Session scope contains an invalid access identifier.'), { code: 'invalid_device_scope' });
    }
  }
  return undefined;
}

function copyScope(scope: DeviceScope): Readonly<DeviceScope> {
  const error = invalidScope(scope);
  if (error) throw error;
  return Object.freeze({ profile: scope.profile, ...(scope.teamId === undefined ? {} : { teamId: scope.teamId }), ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }), deviceId: scope.deviceId });
}

function asFailure(error: unknown): { code: string; message: string; occurredAt: string } {
  const value = error as { code?: unknown; message?: unknown };
  return { code: typeof value.code === 'string' ? value.code : 'session_connection_failed', message: typeof value.message === 'string' ? value.message : 'Device Session connection failed.', occurredAt: new Date().toISOString() };
}

function sessionError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A closed-on-release event stream that shares the underlying scoped terminal. */
export class DeviceSessionSubstream extends EventEmitter {
  #closed = false;
  constructor(readonly id: string, readonly scope: Readonly<DeviceScope>, private readonly releaseStream: (stream: DeviceSessionSubstream) => void) { super(); }
  get closed(): boolean { return this.#closed; }
  release(): void { this.close('released'); }
  close(reason = 'closed'): void {
    if (this.#closed) return;
    this.#closed = true;
    this.releaseStream(this);
    this.emit('close', { reason });
    this.removeAllListeners('event');
  }
  /** @internal */
  deliver(event: TerminalEvent): void { if (!this.#closed) this.emit('event', event); }
}

export class DeviceSessionLease {
  #released = false;
  /** @internal */
  constructor(readonly id: string, readonly scope: Readonly<DeviceScope>, private readonly manager: DeviceSessionManager) {}
  get released(): boolean { return this.#released; }
  release(): void { if (!this.#released) { this.#released = true; this.manager.release(this); } }
  commandExecutor(expectedScope: DeviceScope = this.scope): CommandExecutor { return this.manager.commandExecutor(this, expectedScope); }
  subscribe(listener?: (event: TerminalEvent) => void, expectedScope: DeviceScope = this.scope): DeviceSessionSubstream {
    return this.manager.subscribe(this, expectedScope, listener);
  }
  run<T>(operation: DeviceSessionOperation<T>, options: { signal?: AbortSignal; scope?: DeviceScope } = {}): Promise<T> {
    return this.manager.run(this, options.scope ?? this.scope, operation, options.signal);
  }
}

/**
 * Owns terminal lifetime. A lease is permanently tied to its canonical scope;
 * callers must acquire a fresh lease for a different authorization context.
 */
export class DeviceSessionManager extends EventEmitter {
  readonly idleTtlMs: number;
  readonly reconnectAttempts: number;
  #entries = new Map<string, Entry>();

  constructor(private readonly options: DeviceSessionManagerOptions) {
    super();
    this.idleTtlMs = Math.max(0, options.idleTtlMs ?? 30_000);
    this.reconnectAttempts = Math.max(1, options.reconnectAttempts ?? 1);
  }

  async acquire(scope: DeviceScope): Promise<DeviceSessionLease> {
    const normalized = copyScope(scope), key = scopeKey(normalized);
    let entry = this.#entries.get(key);
    if (!entry || entry.state === 'revoked' || entry.state === 'closed') {
      entry = this.#entry(normalized, key);
      this.#entries.set(key, entry);
    }
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = undefined; }
    if (entry.state !== 'ready') {
      const reconnecting = entry.reconnecting;
      if (reconnecting) await reconnecting;
    }
    if (entry.state !== 'ready') {
      entry.connecting ??= this.#establish(entry, 'connecting').finally(() => { entry!.connecting = undefined; });
      await entry.connecting;
    }
    if (entry.state !== 'ready') throw sessionError(entry.lastFailure?.code ?? 'device_session_unavailable', entry.lastFailure?.message ?? 'The Device Session is unavailable.');
    const lease = new DeviceSessionLease(randomUUID(), entry.scope, this);
    entry.leases.add(lease);
    return lease;
  }

  release(lease: DeviceSessionLease): boolean {
    const entry = this.#entryFor(lease, lease.scope, false);
    if (!entry || !entry.leases.delete(lease)) return false;
    if (entry.leases.size === 0 && entry.state === 'ready') this.#scheduleIdleClose(entry);
    return true;
  }

  async reconnect(scope: DeviceScope): Promise<DeviceSessionSnapshot | undefined> {
    const normalized = copyScope(scope);
    const entry = this.#entries.get(scopeKey(normalized));
    if (!entry) {
      const lease = await this.acquire(normalized);
      const value = this.snapshot(normalized);
      lease.release();
      return value;
    }
    if (!entry || entry.state === 'revoked' || entry.state === 'closed') return undefined;
    await this.#recover(entry, 'operator_reconnect');
    return this.snapshot(entry.scope);
  }

  async revoke(scope: DeviceScope, reason = 'revoked'): Promise<boolean> {
    const entry = this.#entries.get(scopeKey(copyScope(scope)));
    if (!entry || entry.state === 'revoked') return false;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    for (const cancellation of entry.cancellations.values()) cancellation.abort();
    entry.cancellations.clear();
    for (const stream of [...entry.streams]) stream.close(reason);
    entry.leases.clear();
    this.#closeTerminal(entry, reason);
    this.#transition(entry, 'revoked', reason);
    return true;
  }

  clearCache(scope: DeviceScope): DeviceSessionSnapshot | undefined {
    const entry = this.#entries.get(scopeKey(copyScope(scope)));
    if (!entry) return undefined;
    entry.cacheEpoch += 1;
    this.#emit({ type: 'cache_cleared', scope: entry.scope, state: entry.state, occurredAt: new Date().toISOString() });
    return this.#snapshot(entry);
  }

  snapshot(): DeviceSessionSnapshot[];
  snapshot(scope: DeviceScope): DeviceSessionSnapshot | undefined;
  snapshot(scope?: DeviceScope): DeviceSessionSnapshot[] | DeviceSessionSnapshot | undefined {
    if (scope) {
      const entry = this.#entries.get(scopeKey(copyScope(scope)));
      return entry ? this.#snapshot(entry) : undefined;
    }
    return [...this.#entries.values()].map(entry => this.#snapshot(entry));
  }

  commandExecutor(lease: DeviceSessionLease, expectedScope: DeviceScope): CommandExecutor {
    this.#entryFor(lease, expectedScope);
    return {
      execute: async (command: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CommandResult> =>
        await this.run(lease, expectedScope, async ({ session, signal }) =>
          await new FngkTerminalCommandExecutor(session).execute(command, { ...options, signal }), options.signal),
    };
  }

  subscribe(lease: DeviceSessionLease, expectedScope: DeviceScope, listener?: (event: TerminalEvent) => void): DeviceSessionSubstream {
    const entry = this.#entryFor(lease, expectedScope);
    if (!entry) throw sessionError('session_released', 'The Device Session lease is no longer active.');
    const stream = new DeviceSessionSubstream(randomUUID(), entry.scope, value => entry.streams.delete(value));
    if (listener) stream.on('event', listener);
    entry.streams.add(stream);
    return stream;
  }

  async run<T>(lease: DeviceSessionLease, expectedScope: DeviceScope, operation: DeviceSessionOperation<T>, sourceSignal?: AbortSignal): Promise<T> {
    const entry = this.#entryFor(lease, expectedScope);
    if (!entry) throw sessionError('session_released', 'The Device Session lease is no longer active.');
    const terminal = entry.terminal;
    if (!terminal) throw sessionError('device_session_unavailable', 'The Device Session has no active terminal.');
    const controller = new AbortController(), operationId = randomUUID();
    const cancel = () => controller.abort();
    if (sourceSignal?.aborted) controller.abort(); else sourceSignal?.addEventListener('abort', cancel, { once: true });
    entry.cancellations.set(operationId, controller);
    try {
      // Deliberately no retry: an interrupted mutation has an unknown outcome.
      return await operation({ session: terminal, signal: controller.signal });
    } finally {
      entry.cancellations.delete(operationId);
      sourceSignal?.removeEventListener('abort', cancel);
    }
  }

  async close(): Promise<void> {
    for (const entry of this.#entries.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      for (const cancellation of entry.cancellations.values()) cancellation.abort();
      for (const stream of [...entry.streams]) stream.close('manager_closed');
      this.#closeTerminal(entry, 'manager_closed');
      this.#transition(entry, 'closed', 'manager_closed');
    }
    this.#entries.clear();
  }

  #entry(scope: Readonly<DeviceScope>, key: string): Entry {
    return { key, scope, state: 'connecting', leases: new Set(), streams: new Set(), cancellations: new Map(), handshakeCount: 0, cacheEpoch: 0, ignoredTerminals: new Set() };
  }

  #entryFor(lease: DeviceSessionLease, expectedScope: DeviceScope, requireReady = true): Entry | undefined {
    const expected = copyScope(expectedScope), key = scopeKey(expected);
    if (key !== scopeKey(lease.scope)) throw sessionError('device_scope_mismatch', 'A Device Session lease cannot be used outside its exact scope.');
    const entry = this.#entries.get(key);
    if (!entry || !entry.leases.has(lease)) {
      const state = entry?.state;
      if (state === 'revoked') throw sessionError('session_revoked', 'The Device Session was revoked.');
      if (requireReady) throw sessionError('session_released', 'The Device Session lease is no longer active.');
      return undefined;
    }
    if (requireReady && entry.state !== 'ready') throw sessionError(entry.state === 'revoked' ? 'session_revoked' : 'device_session_unavailable', 'The Device Session is not ready for this operation.');
    return entry;
  }

  async #establish(entry: Entry, state: 'connecting' | 'reconnecting'): Promise<void> {
    this.#transition(entry, state);
    const controller = new AbortController();
    try {
      const terminal = await this.options.createSession(entry.scope, controller.signal);
      await this.#waitForReady(terminal);
      if (entry.state === 'revoked' || entry.state === 'closed') { this.#terminate(terminal, 'session_no_longer_needed'); return; }
      entry.terminal = terminal;
      entry.executor = new FngkTerminalCommandExecutor(terminal);
      entry.handshakeCount += 1;
      entry.connectedAt = new Date().toISOString();
      const failure = (error: unknown) => { if (!entry.ignoredTerminals.delete(terminal)) void this.#recover(entry, asFailure(error).code); };
      terminal.on('error', failure);
      terminal.once('close', () => failure(sessionError('terminal_closed', 'The Device Session terminal closed.')));
      terminal.on('event', event => { for (const stream of entry.streams) stream.deliver(event); });
      this.#transition(entry, 'ready');
    } catch (error) {
      entry.lastFailure = asFailure(error);
      this.#transition(entry, entry.lastFailure.code === 'device_offline' ? 'offline' : 'failed', entry.lastFailure.code);
      throw error;
    }
  }

  async #recover(entry: Entry, reason: string): Promise<void> {
    if (entry.state === 'revoked' || entry.state === 'closed' || entry.reconnecting) return await entry.reconnecting;
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = undefined; }
    for (const cancellation of entry.cancellations.values()) cancellation.abort();
    this.#closeTerminal(entry, reason);
    entry.reconnecting = (async () => {
      let error: unknown;
      for (let attempt = 0; attempt < this.reconnectAttempts; attempt += 1) {
        try { await this.#establish(entry, 'reconnecting'); return; }
        catch (failure) { error = failure; }
      }
      if (error) entry.lastFailure = asFailure(error);
    })().finally(() => { entry.reconnecting = undefined; });
    return await entry.reconnecting;
  }

  #waitForReady(terminal: TerminalSession): Promise<void> {
    // TerminalSession records its session id before emitting ready. This also
    // handles a factory that resolves after its child process became ready.
    if (terminal.sessionId) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        terminal.off('ready', ready); terminal.off('error', failure); terminal.off('close', closed);
        error ? reject(error) : resolve();
      };
      const ready = () => finish();
      const failure = (error: unknown) => finish(error);
      const closed = () => finish(sessionError('terminal_closed', 'The Device Session terminal closed before becoming ready.'));
      terminal.once('ready', ready); terminal.once('error', failure); terminal.once('close', closed);
    });
  }

  #scheduleIdleClose(entry: Entry): void {
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = undefined;
      if (entry.leases.size || entry.state !== 'ready') return;
      this.#closeTerminal(entry, 'idle_ttl');
      this.#transition(entry, 'closed', 'idle_ttl');
      if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
    }, this.idleTtlMs);
    entry.idleTimer.unref();
  }

  #closeTerminal(entry: Entry, reason: string): void {
    const terminal = entry.terminal;
    entry.terminal = undefined;
    entry.executor = undefined;
    if (!terminal) return;
    entry.ignoredTerminals.add(terminal);
    this.#terminate(terminal, reason);
  }

  #terminate(terminal: TerminalSession, reason: string): void {
    const closable = terminal as TerminalSession & { close?: (requestId?: string) => boolean };
    if (typeof closable.close === 'function') closable.close(`atlas-device-session:${reason}`);
    else closable.detach(`atlas-device-session:${reason}`);
  }

  #transition(entry: Entry, state: DeviceSessionState, reason?: string): void {
    entry.state = state;
    this.#emit({ type: 'state', scope: entry.scope, state, ...(reason ? { reason } : {}), occurredAt: new Date().toISOString() });
  }

  #emit(event: DeviceSessionStateEvent): void { this.emit('state', event); }
  #snapshot(entry: Entry): DeviceSessionSnapshot {
    return { scope: entry.scope, state: entry.state, leaseCount: entry.leases.size, activeStreams: entry.streams.size, ...(entry.terminal?.sessionId ? { sessionId: entry.terminal.sessionId } : {}), handshakeCount: entry.handshakeCount, cacheEpoch: entry.cacheEpoch, ...(entry.connectedAt ? { connectedAt: entry.connectedAt } : {}), ...(entry.lastFailure ? { lastFailure: entry.lastFailure } : {}) };
  }
}
