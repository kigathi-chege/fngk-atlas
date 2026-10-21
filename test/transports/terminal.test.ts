import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { FngkProcessClient } from '../../src/fngk/process-client.js';
import { FngkTerminalCommandExecutor, type CommandExecutor, type CommandResult } from '../../src/transports/terminal-command.js';
import { TerminalFileTransport } from '../../src/transports/terminal-file.js';
import { FileConflictError, FileService } from '../../src/files/file-service.js';
import { DirectCommandExecutor } from '../../src/transports/direct-command.js';
import { versionKey } from '../../src/files/versions.js';

const fixture = path.resolve('test/fixtures/fngk.mjs');

// Signal only runs commands on queue-mode sessions; real callers switch first.
async function queueReady(terminal: ReturnType<FngkProcessClient['openTerminal']>) {
  await once(terminal, 'ready');
  const changed = once(terminal, 'collaboration');
  terminal.setMode('queue', 'test-queue-mode');
  await changed;
}

describe('terminal-backed effective access', () => {
  it('does not send a command after its lease-owned request was already aborted', async () => {
    const controller = new AbortController(); controller.abort();
    class Session extends EventEmitter { sendCommand() { throw new Error('a cancelled request must not reach the terminal'); } interrupt() {} }
    await expect(new FngkTerminalCommandExecutor(new Session() as any).execute('printf payload', { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('reports the framed command status, not the always-successful wrapper line', async () => {
    class Session extends EventEmitter {
      sendCommand(command: string, requestId: string) {
        const frame = command.match(/__ATLAS_BEGIN_([A-Za-z0-9_]+)__/)![1];
        queueMicrotask(() => {
          this.emit('event', { type: 'output', protocolVersion: 'fngk.terminal.v1', bodyBase64: Buffer.from(`\n__ATLAS_BEGIN_${frame}__\nln: exists\n__ATLAS_END_${frame}__:1\n`).toString('base64') });
          this.emit('event', { type: 'command_state', protocolVersion: 'fngk.terminal.v1', requestId, status: 'succeeded', exitCode: 0 });
        });
        return true;
      }
    }
    await expect(new FngkTerminalCommandExecutor(new Session() as any).execute('ln a b')).resolves.toEqual({ output: Buffer.from('ln: exists'), exitCode: 1 });
  });

  it('surfaces a matching FNGK protocol error without interrupting the shared terminal', async () => {
    class Session extends EventEmitter {
      interrupt = vi.fn();
      sendCommand(_command: string, requestId: string) {
        queueMicrotask(() => this.emit('event', {
          type: 'error', protocolVersion: 'fngk.terminal.v1', requestId,
          code: 'command_rejected', message: 'Filesystem access was rejected.',
        }));
        return true;
      }
    }
    const session = new Session();
    await expect(new FngkTerminalCommandExecutor(session as any).execute('find /')).rejects.toMatchObject({
      code: 'command_rejected', message: 'Filesystem access was rejected.',
    });
    expect(session.interrupt).not.toHaveBeenCalled();
  });

  it('extracts only framed output from a normal FNGK terminal command', async () => {
    const terminal = new FngkProcessClient({ binary: fixture }).openTerminal('device-1', { newSession: true });
    await queueReady(terminal);
    const result = await new FngkTerminalCommandExecutor(terminal).execute('printf payload');
    expect(result).toEqual({ output: Buffer.from('framed payload'), exitCode: 0 });
    terminal.detach('done'); await once(terminal, 'close');
  });

  it('extracts framed output from a real PTY CRLF stream', async () => {
    const terminal = new FngkProcessClient({ binary: fixture, env: { FNGK_FIXTURE_MODE: 'terminal-crlf' } }).openTerminal('device-1', { newSession: true });
    await queueReady(terminal);
    const result = await new FngkTerminalCommandExecutor(terminal).execute('printf payload');
    expect(result).toEqual({ output: Buffer.from('framed payload'), exitCode: 0 });
    terminal.detach('done'); await once(terminal, 'close');
  });

  it('waits for output that arrives after command completion', async () => {
    const terminal = new FngkProcessClient({ binary: fixture, env: { FNGK_FIXTURE_MODE: 'terminal-reordered' } }).openTerminal('device-1', { newSession: true });
    await queueReady(terminal);
    const result = await new FngkTerminalCommandExecutor(terminal).execute('printf payload');
    expect(result).toEqual({ output: Buffer.from('framed payload'), exitCode: 0 });
    terminal.detach('done'); await once(terminal, 'close');
  });

  it('closes a terminal transport through a detach handshake', async () => {
    const terminal = new FngkProcessClient({ binary: fixture }).openTerminal('device-1', { newSession: true });
    await once(terminal, 'ready');
    expect(terminal.close('device-session-idle')).toBe(true);
    await once(terminal, 'close');
    expect(terminal.closed).toBe(true);
  });

  it('uses read-only inline probes and provides terminal fallback outside adapter roots', async () => {
    const commands: string[] = [];
    const executor: CommandExecutor = { execute: async command => {
      commands.push(command);
      if (command.startsWith('stat ')) return { output: Buffer.from('5 644\n'), exitCode: 0 };
      if (/(^|then )base64 /.test(command)) return { output: Buffer.from(Buffer.from('hello').toString('base64')), exitCode: 0 };
      if (/(^|then )find /.test(command)) return { output: Buffer.from(Buffer.from(['a.txt', 'f', '5', '1789200000', '644', ''].join('\0')).toString('base64')), exitCode: 0 };
      return { output: Buffer.alloc(0), exitCode: 0 };
    } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', identity: 'root', privilege: 'root', executor });
    const files = new FileService([transport]);
    expect(await files.read({ contextId: 'remote', path: '/root/a.txt' })).toMatchObject({ text: 'hello', route: expect.objectContaining({ kind: 'terminal', effectiveIdentity: 'root' }) });
    expect(await files.list({ contextId: 'remote', path: '/root' })).toMatchObject({ items: [expect.objectContaining({ name: 'a.txt', type: 'file' })] });
    expect(commands.every(command => !command.includes('.atlas-') && !command.includes('mktemp'))).toBe(true);
  });

  it('does not mistake malformed terminal directory output for an empty directory', async () => {
    const executor: CommandExecutor = { execute: async () => ({ output: Buffer.from('this is not a base64 directory record!'), exitCode: 0 }) };
    const files = new FileService([new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor })]);
    await expect(files.list({ contextId: 'remote', path: '/' })).rejects.toMatchObject({
      code: 'route_unavailable',
      causes: [expect.objectContaining({ code: 'filesystem_protocol_invalid' })],
    });
  });

  it('quotes shell-sensitive paths for bounded terminal filesystem operations', async () => {
    const commands: string[] = [];
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return { output: Buffer.alloc(0), exitCode: 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    await transport.createDirectory("/tmp/atlas it's safe");
    expect(commands).toEqual([`mkdir -- '/tmp/atlas it'"'"'s safe'`]);
  });

  it('bounds terminal content search before invoking grep', async () => {
    const commands: string[] = [];
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return { output: Buffer.alloc(0), exitCode: 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    await transport.search('/srv/atlas', 'needle', { mode: 'content', maxEntries: 12, maxDepth: 3, maxFileBytes: 2048 });
    expect(commands[0]).toContain("find -H '/srv/atlas' -xdev -mindepth 1 -maxdepth 3 -type f -size -2048c -print0 | head -z -n 12 | xargs -0 -r sh -c");
    expect(commands[0]).not.toContain('grep -R');
  });

  it('uses exclusive linking for nonempty terminal file creation', async () => {
    const commands: string[] = [];
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return command.includes('ln --') ? { output: Buffer.alloc(0), exitCode: 1 } : { output: Buffer.alloc(0), exitCode: 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    await expect(transport.createFile('/existing.txt', Buffer.from('new'))).rejects.toMatchObject({ code: 'remote_command_failed' });
    expect(commands.some(command => command.includes('ln --'))).toBe(true);
    expect(commands.join('\n')).not.toContain('mv -f');
  });

  // Mirrors the Device agent: one long-lived shell, each command wrapped as
  // `{ cmd\n}; printf <marker> $?`. Catches bashisms and leaked shell state.
  class PersistentShell implements CommandExecutor {
    readonly child: ChildProcessWithoutNullStreams;
    #buffer = '';
    #waiting?: (value: CommandResult) => void;
    constructor(shell: string, cwd: string, env: NodeJS.ProcessEnv) {
      this.child = spawn(shell, [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
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

  for (const shell of ['bash', 'dash']) it(`runs every file operation in one persistent ${shell} without breaking it`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-terminal-file-')), state = await mkdtemp(path.join(tmpdir(), 'atlas-terminal-state-'));
    const sh = new PersistentShell(shell, root, { ...process.env, XDG_STATE_HOME: state });
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor: sh });
    const at = (name: string) => path.join(root, name);
    try {
      await writeFile(at('kept.txt'), 'original greeting');
      expect((await transport.list(root)).map(entry => entry.name)).toEqual(['kept.txt']);
      const fifo = await mkdtemp(path.join(tmpdir(), 'atlas-terminal-fifo-'));
      try {
        await sh.execute(`mkfifo ${fifo}/pipe`);
        expect(await transport.list(fifo)).toMatchObject([{ name: 'pipe', type: 'other' }]);
        await sh.execute(`ln -s ${fifo} ${root}/linked`);
        expect(await transport.list(at('linked'))).toMatchObject([{ name: 'pipe', path: path.join(at('linked'), 'pipe') }]);
        await sh.execute(`rm ${root}/linked`);
      } finally { await rm(fifo, { recursive: true, force: true }); }
      expect((await transport.read(at('kept.txt'))).toString()).toBe('original greeting');
      await expect(transport.list(at('missing'))).rejects.toMatchObject({ code: 'path_not_found' });
      await expect(transport.read(at('missing.txt'))).rejects.toMatchObject({ code: 'path_not_found' });
      await transport.createFile(at('fresh.txt'), Buffer.from('fresh'));
      await transport.createFile(at('empty.txt'));
      await expect(transport.createFile(at('kept.txt'), Buffer.from('clobbered'))).rejects.toMatchObject({ code: 'file_conflict' });
      await expect(transport.createFile(at('kept.txt'))).rejects.toMatchObject({ code: 'file_conflict' });
      await expect(transport.move(at('fresh.txt'), at('kept.txt'))).rejects.toMatchObject({ code: 'file_conflict' });
      expect(await readFile(at('kept.txt'), 'utf8')).toBe('original greeting');
      await transport.move(at('fresh.txt'), at('moved.txt'));
      await transport.atomicWrite(at('moved.txt'), Buffer.from('rewritten'), 0o644);
      expect(await readFile(at('moved.txt'), 'utf8')).toBe('rewritten');
      expect(await transport.search(root, 'moved', { mode: 'name' })).toEqual([{ path: at('moved.txt'), type: 'file' }]);
      expect(await transport.search(root, 'greeting', { mode: 'content' })).toMatchObject([{ path: at('kept.txt'), line: 1 }]);
      await expect(transport.search(at('missing'), 'x', { mode: 'name' })).rejects.toMatchObject({ code: 'path_not_found' });
      const { restorePath } = await transport.trash(at('moved.txt'));
      expect(await readdir(root)).not.toContain('moved.txt');
      await transport.restore(restorePath);
      expect((await readdir(root)).sort()).toEqual(['empty.txt', 'kept.txt', 'moved.txt']);
      const flags = await sh.execute('printf %s "$-"');
      expect(flags.exitCode).toBe(0);
      expect(flags.output.toString()).not.toMatch(/[eu]/);
    } finally { sh.child.kill(); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); }
  });

  const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const shellState = async (sh: CommandExecutor) => (await sh.execute('printf "%s|%s|%s|%s|%s" "$-" "$(umask)" "$PWD" "${target-unset}${real-unset}${enc-unset}" "$(command -v atlas_sha || echo none)"')).output.toString();

  for (const shell of ['bash', 'dash']) it(`saves safely through one persistent ${shell}: conflicts, symlinks, modes, hardlinks and versions`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-safe-save-')), state = await mkdtemp(path.join(tmpdir(), 'atlas-safe-state-'));
    const sh = new PersistentShell(shell, root, { ...process.env, XDG_STATE_HOME: state });
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor: sh });
    const files = new FileService([transport]);
    const at = (name: string) => path.join(root, name);
    try {
      const before = await shellState(sh);
      // Creating files must not leak noclobber or umask into the shared shell.
      await transport.createFile(at('created-empty.txt')); await transport.createFile(at('created.txt'), Buffer.from('x'));
      expect(await shellState(sh)).toBe(before);
      await sh.execute('set -C');
      await writeFile(at('a.txt'), 'v0'); await chmod(at('a.txt'), 0o751);
      let fingerprint = sha('v0');
      for (const next of ['v1', 'v2', 'v3', 'v4']) { const saved = await files.write({ contextId: 'remote', path: at('a.txt') }, Buffer.from(next), fingerprint); fingerprint = saved.fingerprint; }
      expect(await readFile(at('a.txt'), 'utf8')).toBe('v4');
      expect((await stat(at('a.txt'))).mode & 0o777).toBe(0o751);
      // Only three previous versions are kept, newest first.
      const versions = await transport.versions.list(at('a.txt'));
      expect(versions.map(value => [value.slot, value.fingerprint, value.bytes])).toEqual([[1, sha('v3'), 2], [2, sha('v2'), 2], [3, sha('v1'), 2]]);
      expect((await transport.versions.read(at('a.txt'), 3)).toString()).toBe('v1');
      expect(await readdir(path.join(state, 'fngk-atlas', 'versions', versionKey(at('a.txt'))))).toEqual(['1', '1.meta', '2', '2.meta', '3', '3.meta', 'path.b64']);
      // Restoring is itself a versioned, guarded write.
      const restored = await files.restoreVersion({ contextId: 'remote', path: at('a.txt') }, { slot: 3 }, fingerprint);
      expect(await readFile(at('a.txt'), 'utf8')).toBe('v1');
      expect((await transport.versions.list(at('a.txt')))[0].fingerprint).toBe(sha('v4'));
      fingerprint = restored.fingerprint;

      // Someone else writes between open and save: the guarded replace refuses.
      await writeFile(at('a.txt'), 'changed elsewhere');
      await expect(files.write({ contextId: 'remote', path: at('a.txt') }, Buffer.from('mine'), fingerprint)).rejects.toBeInstanceOf(FileConflictError);
      expect(await readFile(at('a.txt'), 'utf8')).toBe('changed elsewhere');
      expect((await transport.versions.list(at('a.txt')))[0].fingerprint).toBe(sha('v4'));
      // A deleted file is a conflict too, not a silent re-create.
      await rm(at('a.txt'));
      await expect(files.write({ contextId: 'remote', path: at('a.txt') }, Buffer.from('mine'), fingerprint)).rejects.toBeInstanceOf(FileConflictError);
      await expect(stat(at('a.txt'))).rejects.toMatchObject({ code: 'ENOENT' });

      // Symlinks are written through to the resolved file and stay links.
      await mkdir(at('real')); await writeFile(at('real/target.txt'), 'linked'); await symlink('real/target.txt', at('link.txt'));
      await files.write({ contextId: 'remote', path: at('link.txt') }, Buffer.from('through the link'), sha('linked'));
      expect((await lstat(at('link.txt'))).isSymbolicLink()).toBe(true);
      expect(await readFile(at('real/target.txt'), 'utf8')).toBe('through the link');
      // Hardlinks keep sharing the inode.
      await writeFile(at('hard-a.txt'), 'shared'); await link(at('hard-a.txt'), at('hard-b.txt'));
      await files.write({ contextId: 'remote', path: at('hard-a.txt') }, Buffer.from('both see this'), sha('shared'));
      expect(await readFile(at('hard-b.txt'), 'utf8')).toBe('both see this');
      expect((await stat(at('hard-a.txt'))).ino).toBe((await stat(at('hard-b.txt'))).ino);
      // A multi-chunk upload decodes intact.
      const large = Buffer.from('x'.repeat(40_000) + 'end');
      await writeFile(at('large.txt'), 'small');
      await files.write({ contextId: 'remote', path: at('large.txt') }, large, sha('small'));
      expect(await readFile(at('large.txt'))).toEqual(large);

      // No temporaries or staging files are left behind, and the shell is unchanged.
      const leftovers = (await readdir(root, { recursive: true })).filter(name => String(name).includes('.atlas-'));
      expect(leftovers).toEqual([]);
      expect(await readdir(path.join(state, 'fngk-atlas', 'staging'))).toEqual([]);
      // Every write above ran under a noclobber shell set by someone else.
      await sh.execute('set +C');
      expect(await shellState(sh)).toBe(before);
      expect(before).not.toMatch(/^[^|]*[euC]/);
    } finally { sh.child.kill(); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); }
  });

  for (const shell of ['bash', 'dash']) it(`leaves umask, options and redirection behaviour of a persistent ${shell} untouched by createFile and writes`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-shell-state-')), state = await mkdtemp(path.join(tmpdir(), 'atlas-shell-state-xdg-'));
    const sh = new PersistentShell(shell, root, { ...process.env, XDG_STATE_HOME: state });
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor: sh }), files = new FileService([transport]);
    const snapshot = async () => (await sh.execute('umask; set -o | sort; printf "%s" "$-"')).output.toString();
    try {
      await sh.execute('umask 022');
      const before = await snapshot();
      await transport.createFile(path.join(root, 'empty.txt'));
      await transport.createFile(path.join(root, 'full.txt'), Buffer.from('full'));
      await transport.atomicWrite(path.join(root, 'full.txt'), Buffer.from('atomic'), 0o644);
      await files.write({ contextId: 'remote', path: path.join(root, 'full.txt') }, Buffer.from('guarded'), sha('atomic'));
      expect(await snapshot()).toBe(before);
      // noclobber did not leak: overwriting an existing file still works, and
      // a new file gets the shell's own umask, not 077.
      expect((await sh.execute(`printf x > ${path.join(root, 'full.txt')}`)).exitCode).toBe(0);
      expect(await readFile(path.join(root, 'full.txt'), 'utf8')).toBe('x');
      await sh.execute(`printf y > ${path.join(root, 'plain.txt')}`);
      expect((await stat(path.join(root, 'plain.txt'))).mode & 0o777).toBe(0o644);
    } finally { sh.child.kill(); await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); }
  });

  it('keeps the same guarantees through the local DirectCommandExecutor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-direct-exec-')), state = await mkdtemp(path.join(tmpdir(), 'atlas-direct-state-'));
    const previous = process.env.XDG_STATE_HOME; process.env.XDG_STATE_HOME = state;
    try {
      const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'local-shell', deviceId: 'local', executor: new DirectCommandExecutor() });
      await writeFile(path.join(root, 'b.txt'), 'one'); await symlink('b.txt', path.join(root, 'b-link'));
      await transport.safeWrite(path.join(root, 'b-link'), Buffer.from('two'), { expectedFingerprint: sha('one') });
      await expect(transport.safeWrite(path.join(root, 'b-link'), Buffer.from('three'), { expectedFingerprint: sha('one') })).rejects.toMatchObject({ code: 'file_conflict' });
      expect(await readFile(path.join(root, 'b.txt'), 'utf8')).toBe('two');
      expect((await lstat(path.join(root, 'b-link'))).isSymbolicLink()).toBe(true);
      expect((await transport.versions.list(path.join(root, 'b-link'))).map(value => value.fingerprint)).toEqual([sha('one')]);
    } finally { if (previous === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previous; await rm(root, { recursive: true, force: true }); await rm(state, { recursive: true, force: true }); }
  });

  it('checks the fingerprint and rotates versions in the same command as the replace', async () => {
    const commands: string[] = [];
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return { output: Buffer.alloc(0), exitCode: command.includes('base64 -d') ? 73 : 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    await expect(transport.safeWrite('/srv/a.txt', Buffer.from('x'), { expectedFingerprint: sha('y') })).rejects.toMatchObject({ code: 'file_conflict' });
    const replace = commands.find(command => command.includes('base64 -d'))!;
    expect(replace.indexOf(`[ "$current" = "$expected" ]`)).toBeGreaterThan(0);
    expect(replace.indexOf(`[ "$current" = "$expected" ]`)).toBeLessThan(replace.indexOf('fngk-atlas/versions'));
    expect(replace.indexOf('fngk-atlas/versions')).toBeLessThan(replace.indexOf('mv -f -- "$tmp" "$real"'));
    expect(replace).toContain('readlink -f');
    expect(replace).toContain('openssl dgst -sha256');
    expect(replace.startsWith('( ')).toBe(true);
    expect(commands.at(-1)).toMatch(/^\( rm -f -- /);
  });

  it('builds POSIX content search with flags, globs and columns', async () => {
    const commands: string[] = [];
    const output = Buffer.from('/srv/app/src/a.ts\x003:  const fooBar = foo;\n/srv/app/src/b.js\x001:foo\n').toString('base64');
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return { output: Buffer.from(output), exitCode: 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    const matches = await transport.search('/srv/app', 'foo', { mode: 'content', wholeWord: true, caseSensitive: false, include: ['*.ts'], exclude: ['node_modules', 'dist/**'] });
    expect(commands[0]).toContain(`\\( -name 'node_modules' -o -path '/srv/app/dist/*' \\) -prune -o -type f \\( -name '*.ts' \\)`);
    expect(commands[0]).not.toContain('--include');
    expect(commands[0]).toContain(`grep -ZInH -m 8 -F -i -w -e '"'"'foo'"'"' "$@"`);
    // b.js is dropped by the exact glob check; fooBar is not a whole word.
    expect(matches).toEqual([expect.objectContaining({ path: '/srv/app/src/a.ts', line: 3, column: 18, length: 3 })]);
    await transport.search('/srv/app', String.raw`\bfoo\d+`, { mode: 'content', regex: true, caseSensitive: true });
    expect(commands[1]).toContain(`-E -e '"'"'foo[0-9]+'"'"'`);
  });

  it('uses bounded structured NUL records for terminal name search', async () => {
    const commands: string[] = [];
    const encoded = Buffer.from('/srv/atlas/name:with\nnewline\0d\0').toString('base64');
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return { output: Buffer.from(encoded), exitCode: 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    await expect(transport.search('/srv/atlas', 'name', { mode: 'name', maxEntries: 12 })).resolves.toEqual([{ path: '/srv/atlas/name:with\nnewline', type: 'directory' }]);
    expect(commands[0]).toContain('-printf');
    expect(commands[0]).toContain('head -z -n 24');
    expect(commands[0]).not.toContain('pipefail');
  });

  it('moves remote paths into a private recoverable vault and restores them', async () => {
    const commands: string[] = [];
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return { output: Buffer.alloc(0), exitCode: 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    const trashed = await transport.trash("/srv/atlas/it's here.txt");
    expect(trashed.restorePath).toMatch(/^\/\.atlas-trash\/[0-9a-f-]{36}$/);
    expect(commands[0]).toContain('fngk-atlas/trash');
    expect(commands[0]).toContain("'/srv/atlas/it'\"'\"'s here.txt'");
    await transport.restore(trashed.restorePath);
    expect(commands[1]).toContain('original.b64');
    expect(commands[1]).toContain('mv -- "$payload" "$original"');
  });
});
