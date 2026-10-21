import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CommandExecutor } from '../transports/terminal-command.js';
import { posixQuote } from '../transports/posix.js';
import { captured, decodeCaptured, git, GIT_STATUS, streamed } from './shell.js';
import { BRANCH_FORMAT, LOG_FORMAT, parseBlame, parseBranches, parseDiff, parseLog, parseStatus, statusGroups, statusLetter, type GitStatus, type GitStatusEntry } from './parsers.js';

export type SyncOperation = 'fetch' | 'pull' | 'push';
export interface SyncInput { remote?: unknown; branch?: unknown; force?: unknown; confirm?: unknown; setUpstream?: unknown; mode?: unknown; all?: unknown }

export class GitError extends Error {
  constructor(readonly code: string, message: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = 'GitError'; }
}

/** Maps between the context's logical paths and the machine's real paths. */
export interface GitPathMap { toReal(logical: string): string; toLogical(real: string): string }
const identity: GitPathMap = { toReal: value => value, toLogical: value => value };

export interface GitRepository {
  /** Logical path of the work tree's top level. */
  root: string;
  /** Real path on the machine, for display only. */
  realRoot: string;
  gitDir: string;
  bare: boolean;
}

export interface GitServiceOptions {
  paths?: GitPathMap;
  /** Per-command timeout; the queued Device Session allows 30 seconds. */
  timeoutMs?: number;
  /** Largest blob `show` returns. */
  maxShowBytes?: number;
  /** Shared discovery results, so a remote Device is not asked again on every call. */
  discoveryCache?: Map<string, { value: GitRepository | undefined; expiresAt: number }>;
}

export interface GitRunOptions { stdin?: Buffer; signal?: AbortSignal; allowStatus?: number[]; timeoutMs?: number }

const MAX_LOG = 500;

function notRepository(stderr: string): boolean { return /not a git repository/i.test(stderr); }

/** Human-readable reason from git's stderr, without hint noise. */
export function gitMessage(stderr: string, fallback: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('hint:'));
  const fatal = lines.find(line => /^(fatal|error):/.test(line));
  return (fatal ?? lines[0] ?? fallback).replace(/^(fatal|error):\s*/, '').slice(0, 500);
}

/** A repository-relative path that cannot escape the work tree or smuggle options. */
export function safeRelative(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new GitError('invalid_path', 'A repository path is required.');
  const normalized = path.posix.normalize(value);
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) throw new GitError('invalid_path', 'The path is outside the repository.');
  return normalized === '.' ? '.' : normalized;
}

/** Branch, remote and ref names Atlas passes to git; leading dashes would read as options. */
export function safeRefName(value: unknown, what = 'branch name'): string {
  if (typeof value !== 'string' || !value.trim()) throw new GitError('invalid_ref', `A ${what} is required.`);
  const name = value.trim();
  // git check-ref-format rules that matter before git sees the value.
  if (name.startsWith('-') || /[\x00-\x20~^:?*[\\\x7f]/.test(name) || name.includes('..') || name.includes('@{') || name.endsWith('.lock') || name.endsWith('/') || name.endsWith('.') || name.startsWith('/') || name.includes('//')) {
    throw new GitError('invalid_ref', `"${name}" is not a valid ${what}.`);
  }
  return name;
}

function requireConfirm(confirm: unknown, message: string): void {
  if (confirm !== true) throw new GitError('confirmation_required', message);
}

/**
 * Runs git on the machine that holds the files, through a CommandExecutor:
 * `DirectCommandExecutor` locally, or the Device Session's queued shell.
 * Only quick commands go through here; fetch, pull, push and clone use the
 * long-operation runner so they never hold the shared queue.
 */
export class GitService {
  readonly paths: GitPathMap;
  readonly timeoutMs: number;
  readonly maxShowBytes: number;
  readonly discoveryCache?: GitServiceOptions['discoveryCache'];
  constructor(readonly executor: CommandExecutor, options: GitServiceOptions = {}) {
    this.discoveryCache = options.discoveryCache;
    this.paths = options.paths ?? identity;
    this.timeoutMs = options.timeoutMs ?? 25_000;
    this.maxShowBytes = options.maxShowBytes ?? 2 * 1024 * 1024;
  }

  /** Run a command body inside `realDirectory`; returns git's stdout bytes. */
  async run(realDirectory: string, body: string, options: GitRunOptions = {}): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
    const result = await this.executor.execute(captured(realDirectory, body, { stdin: options.stdin }), { signal: options.signal, timeoutMs: options.timeoutMs ?? this.timeoutMs });
    if (result.exitCode === GIT_STATUS.missingRoot) throw new GitError('path_not_found', 'The folder does not exist on this machine.');
    if (result.exitCode === GIT_STATUS.tempUnavailable) throw new GitError('git_unavailable', 'The machine has no writable temporary directory for git.');
    const decoded = decodeCaptured(result.output);
    if (result.exitCode === 127 || /git: (command )?not found/.test(decoded.stderr)) throw new GitError('git_missing', 'git is not installed on this machine.');
    if (result.exitCode !== 0 && !(options.allowStatus ?? []).includes(result.exitCode)) {
      if (notRepository(decoded.stderr)) throw new GitError('not_a_repository', 'This folder is not inside a git repository.');
      // Some refusals (nothing to commit) are printed on stdout.
      const stdout = decoded.stdout.toString('utf8');
      throw new GitError('git_failed', gitMessage(decoded.stderr.trim() ? decoded.stderr : stdout, `git exited with status ${result.exitCode}.`), { exitCode: result.exitCode, stderr: decoded.stderr.slice(-4000), stdout: stdout.slice(-4000) });
    }
    return { ...decoded, exitCode: result.exitCode };
  }

  /** Find the repository containing a logical folder, or undefined when there is none. */
  async discover(logicalPath: string, options: { signal?: AbortSignal } = {}): Promise<GitRepository | undefined> {
    const cached = this.discoveryCache?.get(logicalPath);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.#discover(logicalPath, options);
    if (this.discoveryCache) {
      if (this.discoveryCache.size > 500) this.discoveryCache.clear();
      this.discoveryCache.set(logicalPath, { value, expiresAt: Date.now() + 10_000 });
    }
    return value;
  }

  async #discover(logicalPath: string, options: { signal?: AbortSignal }): Promise<GitRepository | undefined> {
    const real = this.paths.toReal(logicalPath);
    try {
      const { stdout } = await this.run(real, git(['rev-parse', '--is-bare-repository', '--absolute-git-dir', '--show-toplevel']), options);
      const [bare, gitDir, toplevel] = stdout.toString('utf8').replace(/\n$/, '').split('\n');
      if (bare === 'true' || !toplevel) return { root: logicalPath, realRoot: real, gitDir, bare: true };
      return { root: this.paths.toLogical(toplevel), realRoot: toplevel, gitDir, bare: false };
    } catch (error) {
      if (error instanceof GitError && error.code === 'not_a_repository') return undefined;
      throw error;
    }
  }

  async #repository(logicalPath: string, signal?: AbortSignal): Promise<GitRepository> {
    const repository = await this.discover(logicalPath, { signal });
    if (!repository) throw new GitError('not_a_repository', 'This folder is not inside a git repository.');
    if (repository.bare) throw new GitError('bare_repository', 'Bare repositories have no working tree to show.');
    return repository;
  }

  /** Status with per-file groups and letters, paths both relative and logical. */
  async status(logicalPath: string, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const { stdout } = await this.run(repository.realRoot, git(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']), options);
    const status = parseStatus(stdout);
    return { repository, ...this.#decorate(repository, status) };
  }

  #decorate(repository: GitRepository, status: GitStatus) {
    const join = (relative: string) => repository.root === '/' ? `/${relative}` : `${repository.root}/${relative}`;
    const entries = status.entries.filter(entry => entry.kind !== 'ignored').map((entry: GitStatusEntry) => ({ ...entry, logicalPath: join(entry.path), groups: statusGroups(entry), letter: statusLetter(entry) }));
    return { branch: status.branch, entries };
  }

  /** Unified diff for the work tree (against the index) or the index (against HEAD). */
  async diff(logicalPath: string, options: { path?: string; staged?: boolean; context?: number; signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const args = ['diff', `-U${Math.min(20, Math.max(0, options.context ?? 3))}`, '--no-ext-diff', '--no-textconv', '--find-renames'];
    if (options.staged) args.push('--cached');
    args.push('--');
    if (options.path) args.push(safeRelative(options.path));
    const { stdout } = await this.run(repository.realRoot, git(args), options);
    return { repository, text: stdout.toString('utf8'), files: parseDiff(stdout) };
  }

  /**
   * A file's content at a revision: `HEAD`, a commit, or `:` for the index.
   * Missing files return `exists: false`, which a diff treats as empty.
   */
  async show(logicalPath: string, options: { path: string; ref?: string; signal?: AbortSignal }) {
    const repository = await this.#repository(logicalPath, options.signal);
    const relative = safeRelative(options.path), ref = options.ref ?? 'HEAD';
    if (ref !== ':' && (ref.startsWith('-') || /[\s\0:]/.test(ref))) throw new GitError('invalid_ref', 'The revision is not valid.');
    const spec = `${ref === ':' ? '' : ref}:${relative}`;
    const body = `if ${git(['cat-file', '-e', spec])} 2>/dev/null; then n=$(${git(['cat-file', '-s', spec])}) && if [ "$n" -gt ${this.maxShowBytes} ]; then (exit ${GIT_STATUS.tooLarge}); else ${git(['cat-file', 'blob', spec])}; fi; else (exit 3); fi`;
    const result = await this.run(repository.realRoot, body, { signal: options.signal, allowStatus: [3, GIT_STATUS.tooLarge] });
    if (result.exitCode === 3) return { repository, path: relative, ref, exists: false, binary: false, tooLarge: false, text: '' };
    if (result.exitCode === GIT_STATUS.tooLarge) return { repository, path: relative, ref, exists: true, binary: false, tooLarge: true, text: '' };
    const binary = result.stdout.includes(0);
    return { repository, path: relative, ref, exists: true, binary, tooLarge: false, text: binary ? '' : result.stdout.toString('utf8') };
  }

  async log(logicalPath: string, options: { limit?: number; skip?: number; path?: string; ref?: string; signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const limit = Math.min(MAX_LOG, Math.max(1, options.limit ?? 50)), skip = Math.max(0, options.skip ?? 0);
    const args = ['log', '-z', `--format=${LOG_FORMAT}`, `--max-count=${limit}`, `--skip=${skip}`];
    if (options.ref) args.push(safeRefName(options.ref, 'revision'));
    args.push('--');
    if (options.path) args.push(safeRelative(options.path));
    // An unborn branch has no history yet; git exits 128 with "does not have any commits".
    try {
      const { stdout } = await this.run(repository.realRoot, git(args), options);
      return { repository, commits: parseLog(stdout) };
    } catch (error) {
      if (error instanceof GitError && /does not have any commits|bad default revision/.test(error.message)) return { repository, commits: [] };
      throw error;
    }
  }

  async blame(logicalPath: string, options: { path: string; ref?: string; signal?: AbortSignal }) {
    const repository = await this.#repository(logicalPath, options.signal);
    const args = ['blame', '--porcelain'];
    if (options.ref) args.push(safeRefName(options.ref, 'revision'));
    args.push('--', safeRelative(options.path));
    const { stdout } = await this.run(repository.realRoot, git(args), options);
    return { repository, lines: parseBlame(stdout) };
  }

  async branches(logicalPath: string, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const { stdout } = await this.run(repository.realRoot, git(['for-each-ref', `--format=${BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes']), options);
    const remotes = await this.run(repository.realRoot, git(['remote']), options);
    return { repository, branches: parseBranches(stdout), remotes: remotes.stdout.toString('utf8').split('\n').filter(Boolean) };
  }

  /** The author git would record, so the commit box can show it before committing. */
  async identity(logicalPath: string, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const read = async (key: string) => (await this.run(repository.realRoot, git(['config', '--get', key]), { ...options, allowStatus: [1] })).stdout.toString('utf8').trim() || undefined;
    const name = await read('user.name'), email = await read('user.email');
    return { repository, name, email, configured: Boolean(name && email) };
  }

  /** Set user.name and user.email for this repository only (never --global). */
  async setIdentity(logicalPath: string, input: { name: unknown; email: unknown }, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const name = typeof input.name === 'string' ? input.name.trim() : '', email = typeof input.email === 'string' ? input.email.trim() : '';
    if (!name || name.length > 200 || /[\n<>]/.test(name)) throw new GitError('invalid_identity', 'Enter an author name.');
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(email) || email.length > 320) throw new GitError('invalid_identity', 'Enter an author email address.');
    await this.run(repository.realRoot, `${git(['config', '--local', 'user.name', name])} && ${git(['config', '--local', 'user.email', email])}`, options);
    return { repository, name, email, configured: true };
  }

  async stage(logicalPath: string, paths: unknown, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal), relative = this.#paths(paths);
    await this.run(repository.realRoot, git(['add', '--all', '--', ...relative]), options);
    return { repository, paths: relative };
  }

  async unstage(logicalPath: string, paths: unknown, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal), relative = this.#paths(paths);
    // `restore --staged` needs HEAD; on an unborn branch, drop the paths from the index instead.
    const body = `if ${git(['rev-parse', '--verify', '--quiet', 'HEAD'])} >/dev/null; then ${git(['restore', '--staged', '--', ...relative])}; else ${git(['rm', '--cached', '--quiet', '-r', '--', ...relative])}; fi`;
    await this.run(repository.realRoot, body, options);
    return { repository, paths: relative };
  }

  #paths(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length) throw new GitError('invalid_path', 'Choose at least one file.');
    if (value.length > 1000) throw new GitError('invalid_path', 'Too many files in one request.');
    return value.map(safeRelative);
  }

  async commit(logicalPath: string, input: { message: unknown; amend?: unknown; all?: unknown }, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const message = typeof input.message === 'string' ? input.message.replace(/\r\n/g, '\n') : '';
    if (!message.trim()) throw new GitError('empty_message', 'Enter a commit message.');
    if (message.length > 64 * 1024) throw new GitError('invalid_message', 'The commit message is too long.');
    const author = await this.identity(logicalPath, options);
    if (!author.configured) throw new GitError('identity_required', 'Set the author name and email for this repository before committing.', { name: author.name, email: author.email });
    const args = ['commit', '--no-verify', '--cleanup=strip', '-F', '-'];
    if (input.amend === true) args.push('--amend');
    if (input.all === true) args.push('--all');
    let result;
    try { result = await this.run(repository.realRoot, git(args), { ...options, stdin: Buffer.from(message, 'utf8') }); }
    catch (error) {
      if (error instanceof GitError && /nothing (added )?to commit|no changes added to commit/i.test(String(error.details.stderr ?? '') + String(error.details.stdout ?? '') + error.message)) throw new GitError('nothing_to_commit', 'There are no staged changes to commit.');
      throw error;
    }
    const head = await this.run(repository.realRoot, git(['rev-parse', 'HEAD']), options);
    return { repository, hash: head.stdout.toString('utf8').trim(), summary: result.stdout.toString('utf8').split('\n')[0] ?? '' };
  }

  async createBranch(logicalPath: string, input: { name: unknown; startPoint?: unknown; switch?: unknown }, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal), name = safeRefName(input.name);
    const start = input.startPoint === undefined || input.startPoint === '' ? [] : [safeRefName(input.startPoint, 'start point')];
    await this.run(repository.realRoot, git(input.switch === false ? ['branch', '--', name, ...start] : ['switch', '-c', name, ...start]), options);
    return { repository, branch: name };
  }

  /** Switch branches. A dirty tree needs confirm, since git may carry or refuse changes. */
  async switchBranch(logicalPath: string, input: { branch: unknown; confirm?: unknown }, options: { signal?: AbortSignal } = {}) {
    const name = safeRefName(input.branch);
    const status = await this.status(logicalPath, options);
    const dirty = status.entries.some(entry => entry.kind !== 'untracked');
    if (dirty) requireConfirm(input.confirm, 'The working tree has uncommitted changes. Confirm to switch anyway.');
    const local = (await this.run(status.repository.realRoot, git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`]), { ...options, allowStatus: [1] })).exitCode === 0;
    // A remote-tracking name (origin/feature) checks out a local tracking branch;
    // a bare name that only exists on one remote is guessed the same way.
    const args = local ? ['switch', name] : name.includes('/') ? ['switch', '--track', name] : ['switch', '--guess', name];
    await this.run(status.repository.realRoot, git(args), options);
    return { repository: status.repository, branch: name, dirty };
  }

  async deleteBranch(logicalPath: string, input: { name: unknown; force?: unknown; confirm?: unknown }, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal), name = safeRefName(input.name);
    if (input.force === true) requireConfirm(input.confirm, `Force-deleting ${name} can lose unmerged commits. Confirm to delete it.`);
    await this.run(repository.realRoot, git(['branch', input.force === true ? '-D' : '-d', '--', name]), options);
    return { repository, branch: name };
  }

  /**
   * Discard changes to files. A backup is written first, on the machine that
   * holds the files, under the Atlas vault: a binary patch of the tracked
   * changes and a tar of untracked files. Nothing is removed if the backup fails.
   */
  async discard(logicalPath: string, input: { paths: unknown; includeStaged?: unknown; confirm?: unknown }, options: { signal?: AbortSignal } = {}) {
    requireConfirm(input.confirm, 'Discarding changes cannot be undone from git. Confirm to discard.');
    const relative = this.#paths(input.paths);
    const status = await this.status(logicalPath, options);
    const inside = (entry: GitStatusEntry, wanted: string) => wanted === '.' || entry.path === wanted || entry.path.startsWith(`${wanted}/`);
    const entries = status.entries.filter(entry => relative.some(wanted => inside(entry, wanted)));
    if (!entries.length) throw new GitError('nothing_to_discard', 'There are no changes to discard for the selected files.');
    if (entries.some(entry => entry.kind === 'unmerged')) throw new GitError('conflicted', 'Resolve or abort the merge before discarding conflicted files.');
    const staged = input.includeStaged === true, local = (value: string) => posixQuote(`./${value}`);
    const untracked = entries.filter(entry => entry.kind === 'untracked').map(entry => entry.path);
    const tracked = entries.filter(entry => entry.kind !== 'untracked' && (staged || entry.worktree !== '.'));
    // With staged changes included, files new to the index are removed and the
    // rest return to HEAD; a staged rename brings back its source.
    const added = staged ? tracked.filter(entry => entry.index === 'A' || entry.kind === 'renamed').map(entry => entry.path) : [];
    const restored = staged ? tracked.filter(entry => !added.includes(entry.path)).map(entry => entry.path).concat(tracked.filter(entry => entry.kind === 'renamed' && entry.index === 'R' && entry.origPath).map(entry => entry.origPath!)) : tracked.map(entry => entry.path);
    const touched = [...added, ...restored];
    if (!touched.length && !untracked.length) throw new GitError('nothing_to_discard', 'Only staged changes remain. Unstage them first, or include staged changes.');
    const token = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const steps = [
      `v="\${XDG_STATE_HOME:-\${HOME:-/tmp}/.local/state}/fngk-atlas/git-backups/${token}"`,
      // Only the vault is private; restored files keep the shell's own umask.
      '(umask 077 && mkdir -p -- "$v")',
      `printf '%s\\n' ${posixQuote(status.repository.realRoot)} > "$v/repository"`,
    ];
    if (touched.length) steps.push(`${git(['diff', '--binary', '--', ...touched])} > "$v/worktree.patch"`);
    if (touched.length && staged) steps.push(`${git(['diff', '--binary', '--cached', '--', ...touched])} > "$v/index.patch"`);
    if (untracked.length) steps.push(`tar -cf "$v/untracked.tar" -- ${untracked.map(local).join(' ')}`);
    if (added.length) steps.push(git(['rm', '--cached', '--quiet', '-f', '--', ...added]), `rm -f -- ${added.map(local).join(' ')}`);
    if (restored.length) {
      if (staged) steps.push(`if ${git(['rev-parse', '--verify', '--quiet', 'HEAD'])} >/dev/null; then ${git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...restored])}; else ${git(['restore', '--worktree', '--', ...restored])}; fi`);
      else steps.push(git(['restore', '--worktree', '--', ...restored]));
    }
    if (untracked.length) steps.push(`rm -f -- ${untracked.map(local).join(' ')}`);
    steps.push(`printf '%s' "$v"`);
    // `&&` stops at the first failure, so nothing is discarded without a backup.
    const { stdout } = await this.run(status.repository.realRoot, steps.join(' && '), options);
    return { repository: status.repository, paths: entries.map(entry => entry.path), backup: stdout.toString('utf8').trim() };
  }

  async stash(logicalPath: string, input: { action?: unknown; message?: unknown; index?: unknown; includeUntracked?: unknown; confirm?: unknown }, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal), action = input.action ?? 'push';
    const ref = () => { const index = Number(input.index ?? 0); if (!Number.isInteger(index) || index < 0) throw new GitError('invalid_ref', 'Choose a stash entry.'); return `stash@{${index}}`; };
    if (action === 'list') {
      const { stdout } = await this.run(repository.realRoot, git(['stash', 'list', '-z', '--format=%gd%x1f%H%x1f%ct%x1f%gs']), options);
      const stashes = stdout.toString('utf8').split('\0').filter(Boolean).map(record => { const [name, hash, at, subject] = record.split('\x1f'); return { name, hash, createdAt: new Date(Number(at) * 1000).toISOString(), subject }; });
      return { repository, stashes };
    }
    if (action === 'push') {
      const args = ['stash', 'push'];
      if (input.includeUntracked === true) args.push('--include-untracked');
      if (typeof input.message === 'string' && input.message.trim()) args.push('-m', input.message.trim().slice(0, 500));
      const { stdout } = await this.run(repository.realRoot, git(args), options);
      return { repository, message: stdout.toString('utf8').trim() };
    }
    if (action === 'pop' || action === 'apply') {
      const { stdout } = await this.run(repository.realRoot, git(['stash', action, '--index', ref()]), options);
      return { repository, message: stdout.toString('utf8').trim() };
    }
    if (action === 'drop') {
      requireConfirm(input.confirm, 'Dropping a stash deletes it. Confirm to drop.');
      const { stdout } = await this.run(repository.realRoot, git(['stash', 'drop', ref()]), options);
      return { repository, message: stdout.toString('utf8').trim() };
    }
    throw new GitError('invalid_action', 'Unknown stash action.');
  }

  /**
   * The command for fetch, pull or push. It is run by a long-operation
   * runner, outside the shared Device Session queue, with output streamed.
   */
  async syncCommand(logicalPath: string, operation: SyncOperation, input: SyncInput = {}, options: { signal?: AbortSignal } = {}) {
    const repository = await this.#repository(logicalPath, options.signal);
    const remote = input.remote === undefined || input.remote === '' ? undefined : safeRefName(input.remote, 'remote name');
    const branch = input.branch === undefined || input.branch === '' ? undefined : safeRefName(input.branch);
    if (branch && !remote) throw new GitError('invalid_ref', 'Choose a remote for the branch.');
    let args: string[];
    if (operation === 'fetch') args = ['fetch', '--progress', '--prune', ...(input.all === true ? ['--all'] : remote ? [remote, ...(branch ? [branch] : [])] : [])];
    else if (operation === 'pull') {
      const mode = input.mode === undefined ? undefined : String(input.mode);
      if (mode !== undefined && !['ff-only', 'merge', 'rebase'].includes(mode)) throw new GitError('invalid_action', 'Pull mode must be ff-only, merge or rebase.');
      args = ['pull', '--progress', ...(mode === 'ff-only' ? ['--ff-only'] : mode === 'merge' ? ['--no-rebase'] : mode === 'rebase' ? ['--rebase'] : []), ...(remote ? [remote, ...(branch ? [branch] : [])] : [])];
    } else if (operation === 'push') {
      if (input.force === true) requireConfirm(input.confirm, 'Force pushing can overwrite commits on the remote. Confirm to force push.');
      args = ['push', '--progress', ...(input.force === true ? ['--force-with-lease'] : []), ...(input.setUpstream === true ? ['--set-upstream'] : []), ...(remote ? [remote, ...(branch ? [branch] : [])] : [])];
    } else throw new GitError('invalid_action', 'Unknown sync operation.');
    return { repository, args, command: streamed(repository.realRoot, git(args)) };
  }

  /** Clone into a new folder; the parent must exist and the folder must not. */
  cloneCommand(input: { url: unknown; destination: unknown }) {
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (!url || url.startsWith('-') || /[\s\x00-\x1f]/.test(url) || url.length > 2048) throw new GitError('invalid_url', 'Enter a repository URL.');
    if (typeof input.destination !== 'string' || !input.destination.startsWith('/') || input.destination.includes('\0')) throw new GitError('invalid_path', 'Choose an absolute destination folder.');
    const destination = path.posix.normalize(input.destination);
    if (destination === '/') throw new GitError('invalid_path', 'Choose a new folder to clone into.');
    const real = this.paths.toReal(destination), parent = path.posix.dirname(real);
    const body = `if [ -e ${posixQuote(real)} ]; then echo 'The destination folder already exists.'; (exit 73); else ${git(['clone', '--progress', '--', url, real])}; fi`;
    return { destination, command: streamed(parent, body) };
  }
}

/** A readable reason for a failed fetch, pull, push or clone, from git's output. */
export function explainSyncFailure(operation: string, output: string, exitCode: number): string {
  const text = output.toLowerCase();
  const reasons: Array<[RegExp, string]> = [
    [/could not read (username|password)|terminal prompts disabled|authentication failed|invalid username or password|http basic: access denied/, 'The remote needs credentials and none are available on this machine. Configure a credential helper or an SSH key there, then try again.'],
    [/permission denied \(publickey|permission denied, please try again|no supported authentication methods/, 'The remote rejected this machine’s SSH key, or it has none. Add a key on this machine that the remote accepts.'],
    [/host key verification failed/, 'This machine does not trust the remote’s SSH host key yet. Connect once from a terminal on this machine to accept it.'],
    [/could not resolve host|name or service not known|temporary failure in name resolution|could not resolve hostname/, 'This machine cannot resolve the remote’s host name. Check its network and the remote URL.'],
    [/connection timed out|operation timed out|connection refused|network is unreachable/, 'This machine could not connect to the remote.'],
    [/does not appear to be a git repository|repository .* not found|not found/, 'The remote repository was not found. Check the remote URL and your access to it.'],
    [/has no upstream branch|no upstream configured|there is no tracking information/, 'This branch has no upstream yet. Publish it to a remote first.'],
    [/\[rejected\].*\(fetch first\)|\[rejected\].*non-fast-forward|updates were rejected/, 'The remote has commits this branch does not. Pull first, then push again.'],
    [/not possible to fast-forward|diverging branches|need to specify how to reconcile/, 'The branch and its upstream have diverged. Pull with merge or rebase.'],
    [/stale info|\(stale info\)/, 'The remote branch changed since the last fetch, so the force push was refused. Fetch and review it first.'],
    [/conflict/, 'The pull stopped with conflicts. Resolve them in Source Control, then commit.'],
    [/would be overwritten by merge|commit your changes or stash them/, 'Local changes would be overwritten. Commit or stash them first.'],
    [/already exists and is not an empty directory|destination folder already exists/, 'The destination folder already exists.'],
  ];
  for (const [pattern, message] of reasons) if (pattern.test(text)) return message;
  const last = output.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('hint:')).reverse().find(line => /^(fatal|error):/.test(line));
  return last ? last.replace(/^(fatal|error):\s*/, '') : `${operation} failed with status ${exitCode}.`;
}
