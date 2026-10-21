import path from 'node:path';
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { CommandExecutor, CommandResult } from '../../src/transports/terminal-command.js';
import { GitService } from '../../src/git/service.js';
import { LocalLongOperationRunner } from '../../src/git/long-operation.js';

// Mirrors the Device agent: one long-lived shell, each command wrapped as
// `{ cmd\n}; printf <marker> $?`. Catches bashisms and leaked shell state.
class PersistentShell implements CommandExecutor {
  readonly child: ChildProcessWithoutNullStreams;
  #buffer = '';
  #waiting?: (value: CommandResult) => void;
  constructor(shell: string, cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(shell, [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.setMaxListeners(0);
    this.child.stdout.on('data', chunk => { this.#buffer += chunk.toString('utf8'); this.#drain(); });
  }
  #drain() {
    const end = this.#buffer.indexOf('\u001f'), start = this.#buffer.lastIndexOf('\u001e', end);
    if (end < 0 || start < 0 || !this.#waiting) return;
    const output = this.#buffer.slice(0, start), exitCode = Number(this.#buffer.slice(start + 1, end));
    this.#buffer = this.#buffer.slice(end + 1);
    const resolve = this.#waiting; this.#waiting = undefined;
    resolve({ output: Buffer.from(output), exitCode });
  }
  async execute(command: string): Promise<CommandResult> {
    if (this.child.exitCode !== null) throw new Error('shell exited');
    return await new Promise<CommandResult>((resolve, reject) => {
      this.#waiting = resolve;
      this.child.once('exit', () => reject(new Error('shell exited')));
      this.child.stdin.write(`{ ${command}\n}; printf '\\036%s\\037' "$?"\n`);
    });
  }
}

const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });

for (const shell of ['bash', 'dash']) describe(`git through one persistent ${shell}`, () => {
  it('runs status, diff, stage, commit, branches, discard and stash without touching shell state', async () => {
    const base = await mkdtemp(path.join(tmpdir(), 'atlas-git-')), state = path.join(base, 'state'), repo = path.join(base, 'repo'), remote = path.join(base, 'remote.git');
    await mkdir(repo); await mkdir(state);
    // No global identity: Atlas must ask for one rather than guess.
    const env = { ...process.env, XDG_STATE_HOME: state, HOME: base, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: '', GIT_COMMITTER_NAME: '', EMAIL: '' };
    for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete (env as Record<string, unknown>)[key];
    const sh = new PersistentShell(shell, base, env);
    const service = new GitService(sh);
    try {
      expect(await service.discover(base)).toBeUndefined();
      run(base, 'init', '-q', '--bare', remote);
      run(repo, 'init', '-q', '-b', 'main');
      await writeFile(path.join(repo, 'a file.txt'), 'one\ntwo\n');
      await writeFile(path.join(repo, 'café ☕.md'), 'unicode\n');
      await mkdir(path.join(repo, 'src'));
      await writeFile(path.join(repo, 'src', 'main.ts'), 'export const x = 1;\n');

      const discovered = await service.discover(path.join(repo, 'src'));
      expect(discovered).toMatchObject({ root: repo, bare: false });
      let status = await service.status(path.join(repo, 'src'));
      expect(status.branch).toMatchObject({ head: 'main', unborn: true });
      expect(status.entries.map(entry => [entry.path, entry.groups[0]]).sort()).toEqual([['a file.txt', 'untracked'], ['café ☕.md', 'untracked'], ['src/main.ts', 'untracked']]);
      expect(status.entries.find(entry => entry.path === 'src/main.ts')?.logicalPath).toBe(path.join(repo, 'src/main.ts'));

      await service.stage(repo, ['a file.txt', 'café ☕.md', 'src']);
      status = await service.status(repo);
      expect(status.entries.every(entry => entry.groups.includes('staged'))).toBe(true);
      await service.unstage(repo, ['café ☕.md']);
      expect((await service.status(repo)).entries.find(entry => entry.path === 'café ☕.md')?.kind).toBe('untracked');
      await service.stage(repo, ['café ☕.md']);

      await expect(service.commit(repo, { message: 'first' })).rejects.toMatchObject({ code: 'identity_required' });
      await expect(service.setIdentity(repo, { name: 'Ada', email: 'not-an-email' })).rejects.toMatchObject({ code: 'invalid_identity' });
      await service.setIdentity(repo, { name: "Ada O'Lovelace", email: 'ada@example.test' });
      expect(await service.identity(repo)).toMatchObject({ name: "Ada O'Lovelace", email: 'ada@example.test', configured: true });
      // Quotes, a leading dash and a second paragraph reach git untouched through stdin.
      const message = "-first 'quoted' \"double\" $HOME `tick`\n\nBody paragraph.";
      const committed = await service.commit(repo, { message });
      expect(committed.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(run(repo, 'log', '-1', '--format=%B').trim()).toBe(message);
      await expect(service.commit(repo, { message: 'nothing' })).rejects.toMatchObject({ code: 'nothing_to_commit' });

      await writeFile(path.join(repo, 'a file.txt'), 'one\nTWO\nthree\n');
      const diff = await service.diff(repo, { path: 'a file.txt' });
      expect(diff.files[0]).toMatchObject({ oldPath: 'a file.txt', newPath: 'a file.txt' });
      expect(diff.files[0].hunks[0].lines.filter(line => line.type !== 'context').map(line => line.type + line.text)).toEqual(['deletetwo', 'addTWO', 'addthree']);
      expect((await service.show(repo, { path: 'a file.txt' })).text).toBe('one\ntwo\n');
      expect((await service.show(repo, { path: 'a file.txt', ref: ':' })).text).toBe('one\ntwo\n');
      expect(await service.show(repo, { path: 'missing.txt' })).toMatchObject({ exists: false, text: '' });
      expect((await service.log(repo)).commits.map(commit => commit.subject)).toEqual(["-first 'quoted' \"double\" $HOME `tick`"]);
      expect((await service.blame(repo, { path: 'a file.txt' })).lines.map(line => line.uncommitted)).toEqual([false, true, true]);

      await service.createBranch(repo, { name: 'feature/x' });
      expect((await service.status(repo)).branch.head).toBe('feature/x');
      await expect(service.switchBranch(repo, { branch: 'main' })).rejects.toMatchObject({ code: 'confirmation_required' });
      await service.switchBranch(repo, { branch: 'main', confirm: true });
      expect((await service.branches(repo)).branches.map(branch => [branch.name, branch.current])).toEqual(expect.arrayContaining([['main', true], ['feature/x', false]]));
      await expect(service.createBranch(repo, { name: '--force' })).rejects.toMatchObject({ code: 'invalid_ref' });
      await expect(service.deleteBranch(repo, { name: 'feature/x', force: true })).rejects.toMatchObject({ code: 'confirmation_required' });
      await service.deleteBranch(repo, { name: 'feature/x', force: true, confirm: true });

      await writeFile(path.join(repo, 'new untracked.txt'), 'scratch\n');
      await expect(service.discard(repo, { paths: ['a file.txt'] })).rejects.toMatchObject({ code: 'confirmation_required' });
      const discarded = await service.discard(repo, { paths: ['a file.txt', 'new untracked.txt'], confirm: true });
      expect(await readFile(path.join(repo, 'a file.txt'), 'utf8')).toBe('one\ntwo\n');
      expect(await readdir(repo)).not.toContain('new untracked.txt');
      expect(discarded.backup.startsWith(path.join(state, 'fngk-atlas', 'git-backups'))).toBe(true);
      expect(await readFile(path.join(discarded.backup, 'worktree.patch'), 'utf8')).toContain('+TWO');
      expect((await stat(path.join(discarded.backup, 'untracked.tar'))).size).toBeGreaterThan(0);
      // Restored files keep normal permissions; only the vault is private.
      expect((await stat(path.join(repo, 'a file.txt'))).mode & 0o044).not.toBe(0);
      expect((await stat(discarded.backup)).mode & 0o077).toBe(0);

      await writeFile(path.join(repo, 'a file.txt'), 'stashed\n');
      await service.stash(repo, { action: 'push', message: 'wip' });
      expect((await service.stash(repo, { action: 'list' })).stashes).toMatchObject([{ name: 'stash@{0}', subject: expect.stringContaining('wip') }]);
      await service.stash(repo, { action: 'pop' });
      expect(await readFile(path.join(repo, 'a file.txt'), 'utf8')).toBe('stashed\n');

      // A long operation streams output through the same POSIX framing.
      run(repo, 'remote', 'add', 'origin', remote);
      const sync = await service.syncCommand(repo, 'push', { remote: 'origin', branch: 'main', setUpstream: true });
      const pushed = await sh.execute(sync.command);
      expect(pushed.exitCode).toBe(0);
      expect(pushed.output.toString()).toMatch(/main -> main/);
      expect((await service.status(repo)).branch).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 });
      const output: string[] = [];
      const fetched = await new LocalLongOperationRunner().run((await service.syncCommand(repo, 'fetch', { remote: 'origin' })).command, { onOutput: text => output.push(text) });
      expect(fetched.exitCode).toBe(0);

      // The shared shell is exactly as it was: same directory, no options, no leaked variables.
      const probe = await sh.execute('printf "%s|%s|%s|%s|%s|%s" "$(pwd)" "$-" "${t-unset}" "${s-unset}" "${GIT_SSH_COMMAND-unset}" "${v-unset}"');
      const [cwd, flags, ...leaked] = probe.output.toString().split('|');
      expect(cwd).toBe(base);
      expect(flags).not.toMatch(/[eu]/);
      expect(leaked).toEqual(['unset', 'unset', 'unset', 'unset']);
    } finally { sh.child.kill(); await rm(base, { recursive: true, force: true }); }
  }, 30_000);
});
