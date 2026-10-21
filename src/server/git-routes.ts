import path from 'node:path';
import { realpathSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CommandExecutor } from '../transports/terminal-command.js';
import { DirectCommandExecutor } from '../transports/direct-command.js';
import { redact } from '../fngk/redaction.js';
import { GitError, GitService, explainSyncFailure, type GitPathMap, type GitRepository, type SyncOperation } from '../git/service.js';
import { LocalLongOperationRunner, TerminalLongOperationRunner, type LongOperationRunner, type TerminalOpener } from '../git/long-operation.js';

/** What a remote context lends the git routes for one request. */
export interface GitRemoteAccess {
  /** The Device Session's queued shell, for quick commands. */
  executor: CommandExecutor;
  /** Opens a dedicated short-lived terminal for fetch, pull, push and clone. */
  openTerminal: TerminalOpener;
  release(): void;
  /** Drop cached directory listings after git changed files. */
  invalidate?(): void;
}

export interface GitRouteDependencies {
  /** The local context's route root (`DirectTransport`). */
  local: { root: string; resolve(logicalPath: string): string };
  remote(contextId: string, claims: Record<string, unknown>, request: FastifyRequest, reply: FastifyReply): Promise<GitRemoteAccess>;
}

interface Access { service: GitService; runner: LongOperationRunner; release(): void; invalidate(): void }

const STATUS: Record<string, number> = {
  confirmation_required: 428, identity_required: 422, empty_message: 400, invalid_message: 400, invalid_identity: 400, invalid_path: 400, invalid_ref: 400,
  invalid_url: 400, invalid_action: 400, invalid_argument: 400, path_escape: 400, not_a_repository: 404, path_not_found: 404, context_not_found: 404, bare_repository: 409,
  nothing_to_commit: 409, nothing_to_discard: 409, conflicted: 409, git_failed: 422, git_missing: 501, git_unavailable: 503, git_protocol_invalid: 502, device_offline: 409,
  device_scope_mismatch: 403, timeout: 504, cancelled: 499, terminal_closed: 502, device_session_unavailable: 503, session_revoked: 409,
};

function signalFor(request: FastifyRequest, reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  request.raw.once('aborted', () => controller.abort());
  reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
  return controller.signal;
}

function send(reply: FastifyReply, error: unknown) {
  const value = error as { code?: string; message?: string; details?: Record<string, unknown> };
  const code = typeof value.code === 'string' ? value.code : 'internal_error';
  const details = error instanceof GitError ? Object.fromEntries(Object.entries(error.details).filter(([key]) => key !== 'stderr' && key !== 'stdout')) : {};
  return reply.code(STATUS[code] ?? 500).send({ error: code, message: redact(value.message ?? 'Git request failed.'), ...details });
}

/** Repository results without the machine's real paths, which the browser does not need. */
function publicRepository(repository: GitRepository) { return { root: repository.root, bare: repository.bare }; }
function strip<T extends { repository: GitRepository }>(value: T) { const { repository, ...rest } = value; return { repository: publicRepository(repository), ...rest }; }

function localPaths(root: string, resolve: (value: string) => string): GitPathMap {
  if (path.resolve(root) === '/') return { toReal: resolve, toLogical: value => value };
  let canonical = path.resolve(root);
  try { canonical = realpathSync(canonical); } catch {}
  const prefixes = [...new Set([path.resolve(root), canonical])];
  return {
    toReal: resolve,
    toLogical(real) {
      for (const prefix of prefixes) {
        if (real === prefix) return '/';
        if (real.startsWith(`${prefix}/`)) return real.slice(prefix.length);
      }
      throw new GitError('path_escape', 'The repository is outside this context’s root.');
    },
  };
}

export function registerGitRoutes(app: FastifyInstance, dependencies: GitRouteDependencies): void {
  const caches = new Map<string, Map<string, { value: GitRepository | undefined; expiresAt: number }>>();
  const cacheFor = (key: string) => { let value = caches.get(key); if (!value) { value = new Map(); caches.set(key, value); } return value; };
  const localPathMap = localPaths(dependencies.local.root, value => dependencies.local.resolve(value));

  const acquire = async (input: Record<string, unknown>, request: FastifyRequest, reply: FastifyReply): Promise<Access> => {
    const contextId = typeof input.contextId === 'string' && input.contextId ? input.contextId : 'local';
    const profile = String(request.headers['x-atlas-profile'] ?? input.profile ?? '');
    const discoveryCache = cacheFor(`${profile}\0${contextId}`);
    if (contextId === 'local') {
      const service = new GitService(new DirectCommandExecutor(25_000, 32 * 1024 * 1024), { paths: localPathMap, discoveryCache });
      return { service, runner: new LocalLongOperationRunner(), release: () => {}, invalidate: () => {} };
    }
    const remote = await dependencies.remote(contextId, input, request, reply);
    return { service: new GitService(remote.executor, { discoveryCache }), runner: new TerminalLongOperationRunner(remote.openTerminal), release: () => remote.release(), invalidate: () => remote.invalidate?.() };
  };

  /** Folder for the request: `root`, or the folder holding `file`. */
  const folder = (input: Record<string, unknown>) => {
    const value = typeof input.root === 'string' && input.root ? input.root : typeof input.file === 'string' && input.file ? path.posix.dirname(input.file) : '';
    if (!value.startsWith('/') || value.includes('\0')) throw new GitError('invalid_path', 'Choose a folder inside a repository.');
    return path.posix.normalize(value);
  };
  /** Repository-relative path from `path`, or from an absolute `file`. */
  const relative = async (service: GitService, input: Record<string, unknown>, signal: AbortSignal): Promise<string | undefined> => {
    if (typeof input.path === 'string' && input.path) return input.path;
    if (typeof input.file !== 'string' || !input.file) return undefined;
    const repository = await service.discover(folder(input), { signal });
    if (!repository) throw new GitError('not_a_repository', 'This file is not inside a git repository.');
    const file = path.posix.normalize(input.file), prefix = repository.root === '/' ? '/' : `${repository.root}/`;
    if (!file.startsWith(prefix)) throw new GitError('path_escape', 'The file is outside its repository.');
    return file.slice(prefix.length);
  };

  type Handler = (access: Access, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
  const route = (method: 'GET' | 'POST', url: string, handler: Handler, mutation = false) => {
    app.route({ method, url, handler: async (request, reply) => {
      const input = (method === 'GET' ? request.query : request.body ?? {}) as Record<string, unknown>;
      let access: Access | undefined;
      try {
        access = await acquire(input, request, reply);
        const result = await handler(access, input, signalFor(request, reply));
        if (mutation) access.invalidate();
        return reply.send(result);
      } catch (error) {
        if (mutation) access?.invalidate();
        return send(reply, error);
      } finally { access?.release(); }
    } });
  };

  // A probe: views ask it about folders that may not exist, may not be
  // repositories, or may sit on a Device without git. It answers 200 either
  // way so background decoration never reads as a failure.
  app.get('/api/git/repository', async (request, reply) => {
    const input = request.query as Record<string, unknown>;
    let access: Access | undefined;
    try {
      access = await acquire(input, request, reply);
      const repository = await access.service.discover(folder(input), { signal: signalFor(request, reply) });
      return reply.send({ repository: repository ? publicRepository(repository) : null });
    } catch (error) {
      const value = error as { code?: string; message?: string };
      return reply.send({ repository: null, unavailable: { code: typeof value.code === 'string' ? value.code : 'git_unavailable', message: redact(value.message ?? 'Git is unavailable here.') } });
    } finally { access?.release(); }
  });
  route('GET', '/api/git/status', async ({ service }, input, signal) => {
    const repository = await service.discover(folder(input), { signal });
    if (!repository || repository.bare) return { repository: null };
    return strip(await service.status(folder(input), { signal }));
  });
  route('GET', '/api/git/diff', async ({ service }, input, signal) => strip(await service.diff(folder(input), { path: await relative(service, input, signal), staged: input.staged === '1' || input.staged === 'true', context: input.context === undefined ? undefined : Number(input.context), signal })));
  route('GET', '/api/git/show', async ({ service }, input, signal) => {
    const file = await relative(service, input, signal);
    if (!file) throw new GitError('invalid_path', 'Choose a file.');
    return strip(await service.show(folder(input), { path: file, ref: typeof input.ref === 'string' && input.ref ? input.ref : undefined, signal }));
  });
  route('GET', '/api/git/log', async ({ service }, input, signal) => strip(await service.log(folder(input), { limit: Number(input.limit) || undefined, skip: Number(input.skip) || undefined, path: await relative(service, input, signal), ref: typeof input.ref === 'string' && input.ref ? input.ref : undefined, signal })));
  route('GET', '/api/git/blame', async ({ service }, input, signal) => {
    const file = await relative(service, input, signal);
    if (!file) throw new GitError('invalid_path', 'Choose a file.');
    return strip(await service.blame(folder(input), { path: file, signal }));
  });
  route('GET', '/api/git/branches', async ({ service }, input, signal) => strip(await service.branches(folder(input), { signal })));
  route('GET', '/api/git/identity', async ({ service }, input, signal) => strip(await service.identity(folder(input), { signal })));
  route('POST', '/api/git/identity', async ({ service }, input, signal) => strip(await service.setIdentity(folder(input), { name: input.name, email: input.email }, { signal })));
  route('POST', '/api/git/stage', async ({ service }, input, signal) => strip(await service.stage(folder(input), input.paths, { signal })), true);
  route('POST', '/api/git/unstage', async ({ service }, input, signal) => strip(await service.unstage(folder(input), input.paths, { signal })), true);
  route('POST', '/api/git/commit', async ({ service }, input, signal) => strip(await service.commit(folder(input), { message: input.message, amend: input.amend, all: input.all }, { signal })), true);
  route('POST', '/api/git/branches', async ({ service }, input, signal) => strip(await service.createBranch(folder(input), { name: input.name, startPoint: input.startPoint, switch: input.switch }, { signal })), true);
  route('POST', '/api/git/branches/delete', async ({ service }, input, signal) => strip(await service.deleteBranch(folder(input), { name: input.name, force: input.force, confirm: input.confirm }, { signal })), true);
  route('POST', '/api/git/switch', async ({ service }, input, signal) => strip(await service.switchBranch(folder(input), { branch: input.branch, confirm: input.confirm }, { signal })), true);
  route('POST', '/api/git/discard', async ({ service }, input, signal) => strip(await service.discard(folder(input), { paths: input.paths, includeStaged: input.includeStaged, confirm: input.confirm }, { signal })), true);
  route('POST', '/api/git/stash', async ({ service }, input, signal) => strip(await service.stash(folder(input), input as Record<string, unknown>, { signal })), true);

  /**
   * Long operations reply with NDJSON: `start`, any number of `output` lines
   * while git runs, then `done` with the exit status and a readable message.
   * Validation and confirmation failures are ordinary JSON errors.
   */
  const stream = (url: string, prepare: (access: Access, input: Record<string, unknown>, signal: AbortSignal) => Promise<{ command: string; operation: string; args?: string[]; timeoutMs?: number }>) => {
    app.post(url, async (request, reply) => {
      const input = (request.body ?? {}) as Record<string, unknown>, signal = signalFor(request, reply);
      let access: Access | undefined, prepared: Awaited<ReturnType<typeof prepare>>;
      try {
        access = await acquire(input, request, reply);
        prepared = await prepare(access, input, signal);
      } catch (error) { access?.release(); return send(reply, error); }
      // The shared Device Session is no longer needed; the runner has its own terminal.
      access.release();
      reply.hijack();
      reply.raw.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      const write = (value: Record<string, unknown>) => { if (!reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(value)}\n`); };
      write({ type: 'start', operation: prepared.operation, ...(prepared.args ? { args: prepared.args } : {}) });
      const started = Date.now();
      try {
        const result = await access.runner.run(prepared.command, { signal, timeoutMs: prepared.timeoutMs, onOutput: text => write({ type: 'output', text: redact(text) }) });
        const ok = result.exitCode === 0;
        write({ type: 'done', ok, exitCode: result.exitCode, elapsedMs: Date.now() - started, message: ok ? `${prepared.operation} finished.` : explainSyncFailure(prepared.operation, redact(result.output), result.exitCode) });
      } catch (error) {
        const value = error as { code?: string; message?: string };
        write({ type: 'done', ok: false, exitCode: null, elapsedMs: Date.now() - started, error: value.code ?? 'git_failed', message: redact(value.message ?? 'The git operation failed.') });
      } finally { access.invalidate(); reply.raw.end(); }
    });
  };
  for (const operation of ['fetch', 'pull', 'push'] as SyncOperation[]) {
    stream(`/api/git/${operation}`, async ({ service }, input, signal) => {
      const prepared = await service.syncCommand(folder(input), operation, input, { signal });
      return { command: prepared.command, operation, args: prepared.args };
    });
  }
  stream('/api/git/clone', async ({ service }, input) => {
    const prepared = service.cloneCommand({ url: input.url, destination: input.destination });
    return { command: prepared.command, operation: 'clone' };
  });
}
