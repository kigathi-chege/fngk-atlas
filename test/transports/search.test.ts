import path from 'node:path';
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { CommandExecutor, CommandResult } from '../../src/transports/terminal-command.js';
import { TerminalFileTransport, nameQueryTest, pruneGroup } from '../../src/transports/terminal-file.js';
import { DirectTransport } from '../../src/transports/direct.js';
import { SearchLane } from '../../src/transports/search-lane.js';
import { escapeGlob, nameTier, prunedMounts, pseudoRootsUnder, rankNameMatches } from '../../src/files/name-search.js';

describe('name search rules', () => {
  it('escapes glob metacharacters so queries match literally', () => {
    expect(escapeGlob('a*b?c[d]e\\f')).toBe('a\\*b\\?c\\[d\\]e\\\\f');
    expect(nameQueryTest('sample')).toBe(`-iname '*sample*'`);
    expect(nameQueryTest(" it's*")).toBe(`-iname '*it'"'"'s\\**'`);
    expect(nameQueryTest('src/web')).toBe(`-ipath '*src/web*'`);
  });

  it('prunes pseudo roots only below the root, plus names, extra paths and excludes', () => {
    expect(pseudoRootsUnder('/')).toEqual(['/proc', '/sys', '/dev', '/run', '/snap']);
    expect(pseudoRootsUnder('/home/me')).toEqual([]);
    expect(pseudoRootsUnder('/proc')).toEqual([]);
    expect(pruneGroup({ root: '/', pruneNames: ['node_modules'], exclude: [] })).toBe(`\\( -path '/proc' -o -path '/sys' -o -path '/dev' -o -path '/run' -o -path '/snap' -o -name 'node_modules' "$@" \\) -prune -o `);
    expect(pruneGroup({ root: '/srv', pruneNames: [], prunePaths: ['/srv/cache', '/srv'], exclude: ['*.log'] })).toBe(`\\( -path '/srv/cache' -o -name '*.log' "$@" \\) -prune -o `);
    expect(pruneGroup({ root: '/srv', pruneNames: [], exclude: [] })).toBe(`\\( -name '/' "$@" \\) -prune -o `);
  });

  it('finds pseudo and network mounts below the root in /proc/self/mounts', () => {
    const mounts = ['overlay / overlay rw 0 0', 'proc /proc proc rw 0 0', 'tmpfs /dev tmpfs rw 0 0', '/dev/sda1 /home/me/projects ext4 rw 0 0', 'server:/x /home/me/nfs nfs4 rw 0 0', 'sysfs /home/me/odd\\040dir sysfs rw 0 0'].join('\n');
    expect(prunedMounts(mounts, '/')).toEqual(['/home/me/nfs', '/home/me/odd dir', '/proc']);
    expect(prunedMounts(mounts, '/home/me')).toEqual(['/home/me/nfs', '/home/me/odd dir']);
    expect(prunedMounts(mounts, '/home/me/nfs')).toEqual([]);
  });

  it('ranks exact names, then prefixes, then substrings, then path matches; files and shorter paths first', () => {
    const items = ['/a/b/c/my-sample.txt', '/a/sample-app', '/a/b/sample.txt', '/sample.d/x.txt', '/z/sample', '/a/samples.md'].map(value => ({ path: value, type: value.endsWith('sample-app') || value === '/z/sample' ? 'directory' : 'file' }));
    expect(rankNameMatches('sample', items).map(item => item.path)).toEqual(['/a/b/sample.txt', '/z/sample', '/a/samples.md', '/a/sample-app', '/a/b/c/my-sample.txt', '/sample.d/x.txt']);
    expect(nameTier('rc/web', '/repo/src/web/app.ts')).toBe(4);
    expect(nameTier('src/web', '/repo/src/web/app.ts')).toBe(3);
    expect(nameTier('web/app.ts', '/repo/src/web/app.ts')).toBe(3);
  });
});

describe('search lane', () => {
  it('runs at most one task per key and only the newest waiting one next', async () => {
    const lane = new SearchLane(), started: string[] = [];
    let release!: () => void;
    const first = lane.run('k', async () => { started.push('a'); await new Promise<void>(resolve => { release = resolve; }); return 'a'; });
    const second = lane.run('k', async () => { started.push('b'); return 'b'; });
    const third = lane.run('k', async () => { started.push('c'); return 'c'; });
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    expect(started).toEqual(['a']);
    release();
    await expect(first).resolves.toBe('a');
    await expect(third).resolves.toBe('c');
    expect(started).toEqual(['a', 'c']);
  });

  it('releases an aborted caller at once but keeps the lane busy until the task ends', async () => {
    const lane = new SearchLane(), controller = new AbortController();
    let release!: () => void;
    const running = lane.run('k', () => new Promise<string>(resolve => { release = () => resolve('done'); }), controller.signal);
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect(lane.busy('k')).toBe(true);
    const waiting = new AbortController(), next = lane.run('k', async () => 'never', waiting.signal);
    waiting.abort();
    await expect(next).rejects.toMatchObject({ code: 'cancelled' });
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(lane.busy('k')).toBe(false);
  });
});

// Mirrors the Device agent's long-lived shell, as in terminal.test.ts.
class PersistentShell implements CommandExecutor {
  readonly child: ChildProcessWithoutNullStreams;
  #buffer = ''; #waiting?: (value: CommandResult) => void;
  constructor(shell: string, cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(shell, [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', chunk => { this.#buffer += chunk.toString('utf8'); this.#drain(); });
  }
  #drain() {
    const end = this.#buffer.indexOf('\u001f'), start = this.#buffer.lastIndexOf('\u001e', end);
    if (end < 0 || start < 0 || !this.#waiting) return;
    const output = this.#buffer.slice(0, start), exitCode = Number(this.#buffer.slice(start + 1, end));
    this.#buffer = this.#buffer.slice(end + 1);
    const resolve = this.#waiting; this.#waiting = undefined; resolve({ output: Buffer.from(output), exitCode });
  }
  async execute(command: string): Promise<CommandResult> {
    return await new Promise<CommandResult>(resolve => { this.#waiting = resolve; this.child.stdin.write(`{ ${command}\n}; printf '\\036%s\\037' "$?"\n`); });
  }
}

async function tree() {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-search-'));
  // Enough entries ahead of the real match that an entry cap would hide it.
  await mkdir(path.join(root, 'aaa'));
  for (let index = 0; index < 6_000; index++) await writeFile(path.join(root, 'aaa', `f${index}`), '');
  await mkdir(path.join(root, 'proc', 'self'), { recursive: true }); await writeFile(path.join(root, 'proc', 'self', 'sample-in-proc'), 'sample');
  await mkdir(path.join(root, 'node_modules', 'sample-dep'), { recursive: true }); await writeFile(path.join(root, 'node_modules', 'sample-dep', 'index.js'), 'sample');
  await mkdir(path.join(root, 'zz', 'sample-app', 'src'), { recursive: true }); await writeFile(path.join(root, 'zz', 'sample-app', 'src', 'main.ts'), 'export const sampleValue = 1;\n');
  await writeFile(path.join(root, 'zz', 'Sample.TXT'), 'plain sample text\n');
  await writeFile(path.join(root, 'zz', 'odd*[name]?.txt'), 'x');
  execFileSync('mkfifo', [path.join(root, 'zz', 'sample.fifo')]);
  return root;
}
const stateOf = async (sh: CommandExecutor) => (await sh.execute(`printf '%s|' "$-" "$#" "$(umask)" "$PWD" "$(printf '%s' "$IFS" | od -An -c | tr -d ' ')" "$(command -v atlas_budget || echo none)" "$(command -v atlas_mark || echo none)" "\${atlas_m-unset}\${atlas_s-unset}"; set -o | sort | tr '\\n' ' '`)).output.toString();

describe.each(['bash', 'dash'])('remote search through a persistent %s', shell => {
  it('finds names anywhere below the root, prunes pseudo and pruned dirs, skips FIFOs and keeps the shell intact', async () => {
    const root = await tree(), sh = new PersistentShell(shell, root, process.env);
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: `remote-${shell}`, deviceId: 'device-1', executor: sh });
    try {
      await sh.execute('set -- one two; umask 022');
      const before = await stateOf(sh);
      const result = await transport.search(root, 'sample', { mode: 'name', prunePaths: [path.join(root, 'proc')] });
      expect(result.matches.map(match => path.relative(root, match.path))).toEqual(['zz/Sample.TXT', 'zz/sample-app']);
      expect(result.truncated).toBe(false);
      expect(result.elapsedMs).toBeLessThan(3_000);
      expect((await transport.search(root, 'odd*[name]?', { mode: 'name' })).matches.map(match => path.basename(match.path))).toEqual(['odd*[name]?.txt']);
      expect((await transport.search(root, '*', { mode: 'name' })).matches.map(match => path.basename(match.path))).toEqual(['odd*[name]?.txt']);
      expect((await transport.search(root, 'sample-app/src', { mode: 'name' })).matches.map(match => path.relative(root, match.path))).toEqual(['zz/sample-app/src/main.ts', 'zz/sample-app/src']);
      const content = await transport.search(root, 'sample', { mode: 'content', caseSensitive: false, prunePaths: [path.join(root, 'proc')] });
      expect(content.matches.map(match => path.relative(root, match.path)).sort()).toEqual(['zz/Sample.TXT', 'zz/sample-app/src/main.ts']);
      expect(await stateOf(sh)).toBe(before);
    } finally { sh.child.kill(); await rm(root, { recursive: true, force: true }); }
  }, 60_000);

  it('feeds grep through the watchdog fallback when timeout(1) is unusable', async () => {
    const root = await tree(), bin = await mkdtemp(path.join(tmpdir(), 'atlas-search-bin-'));
    await writeFile(path.join(bin, 'timeout'), '#!/bin/sh\nexit 1\n'); await chmod(path.join(bin, 'timeout'), 0o755);
    const sh = new PersistentShell(shell, root, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: `remote-fallback-${shell}`, deviceId: 'device-1', executor: sh });
    try {
      expect((await transport.search(root, 'sampleValue', { mode: 'content' })).matches).toMatchObject([{ path: path.join(root, 'zz', 'sample-app', 'src', 'main.ts'), line: 1 }]);
      expect((await transport.search(root, 'sample-app', { mode: 'name' })).matches).toEqual([{ path: path.join(root, 'zz', 'sample-app'), type: 'directory' }]);
    } finally { sh.child.kill(); await rm(root, { recursive: true, force: true }); await rm(bin, { recursive: true, force: true }); }
  }, 60_000);

  for (const watchdog of [false, true]) it(`stops at the time budget and reports it (${watchdog ? 'watchdog fallback' : 'timeout(1)'})`, async () => {
    const root = await tree(), bin = await mkdtemp(path.join(tmpdir(), 'atlas-search-bin-')), realFind = execFileSync('sh', ['-c', 'command -v find']).toString().trim();
    // A find that hangs before walking, as on a stalled mount. The sleep must
    // not hold the output pipe, just as a killed find no longer does.
    await writeFile(path.join(bin, 'find'), `#!/bin/sh\ncase "$*" in *-maxdepth\\ 0*) exec ${realFind} "$@";; esac\nsleep 20 >/dev/null\nexec ${realFind} "$@"\n`); await chmod(path.join(bin, 'find'), 0o755);
    if (watchdog) { await writeFile(path.join(bin, 'timeout'), '#!/bin/sh\nexit 1\n'); await chmod(path.join(bin, 'timeout'), 0o755); }
    const sh = new PersistentShell(shell, root, { ...process.env, PATH: `${bin}:${process.env.PATH}` });
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: `remote-budget-${shell}-${watchdog}`, deviceId: 'device-1', executor: sh });
    try {
      const before = await stateOf(sh), started = Date.now();
      const result = await transport.search(root, 'sample', { mode: 'name', budgetMs: 1_000 });
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result).toMatchObject({ matches: [], truncated: true, reason: 'time' });
      const content = await transport.search(root, 'sample', { mode: 'content', budgetMs: 1_000 });
      expect(content).toMatchObject({ truncated: true, reason: 'time' });
      expect(await stateOf(sh)).toBe(before);
      const stray = execFileSync('sh', ['-c', `ps -eo args | grep -F ${JSON.stringify(bin)} | grep -v grep || true`]).toString();
      expect(stray).toBe('');
    } finally { sh.child.kill(); await rm(root, { recursive: true, force: true }); await rm(bin, { recursive: true, force: true }); }
  }, 60_000);
});

describe('local search', () => {
  it('never blocks on FIFOs or zero-size pseudo files and applies the same prunes', async () => {
    const root = await tree();
    // A zero-size regular file stands in for /proc files, which report size 0.
    await writeFile(path.join(root, 'zz', 'sample-empty'), '');
    const transport = new DirectTransport({ id: 'direct', contextId: 'local', root });
    try {
      const names = await transport.search('/', 'sample', { mode: 'name', prunePaths: ['/proc'] });
      expect(names.matches.map(match => match.path)).toEqual(['/zz/Sample.TXT', '/zz/sample-empty', '/zz/sample-app']);
      expect(names).toMatchObject({ truncated: false });
      expect(names.examined).toBeGreaterThan(6_000);
      const content = await Promise.race([transport.search('/', 'sample', { mode: 'all', caseSensitive: false, prunePaths: ['/proc'] }), new Promise((_, reject) => setTimeout(() => reject(new Error('search blocked')), 10_000))]) as Awaited<ReturnType<DirectTransport['search']>>;
      expect(content.matches.filter(match => match.line).map(match => match.path).sort()).toEqual(['/zz/Sample.TXT', '/zz/sample-app/src/main.ts']);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);

  it('stops at its time budget and says so', async () => {
    const root = await tree(), transport = new DirectTransport({ id: 'direct', contextId: 'local', root });
    try {
      const result = await transport.search('/', 'nothing-matches-this', { mode: 'name', budgetMs: 100 });
      expect(result.elapsedMs).toBeLessThan(2_000);
      if (result.truncated) expect(result.reason).toBe('time');
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60_000);
});
