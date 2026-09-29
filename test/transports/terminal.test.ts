import { once } from 'node:events';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FngkProcessClient } from '../../src/fngk/process-client.js';
import { FngkTerminalCommandExecutor, type CommandExecutor } from '../../src/transports/terminal-command.js';
import { TerminalFileTransport } from '../../src/transports/terminal-file.js';
import { FileService } from '../../src/files/file-service.js';

const fixture = path.resolve('test/fixtures/fngk.mjs');

describe('terminal-backed effective access', () => {
  it('extracts only framed output from a normal FNGK terminal command', async () => {
    const terminal = new FngkProcessClient({ binary: fixture }).openTerminal('device-1', { newSession: true });
    await once(terminal, 'ready');
    const result = await new FngkTerminalCommandExecutor(terminal).execute('printf payload');
    expect(result).toEqual({ output: Buffer.from('framed payload'), exitCode: 0 });
    terminal.detach('done'); await once(terminal, 'close');
  });

  it('extracts framed output from a real PTY CRLF stream', async () => {
    const terminal = new FngkProcessClient({ binary: fixture, env: { FNGK_FIXTURE_MODE: 'terminal-crlf' } }).openTerminal('device-1', { newSession: true });
    await once(terminal, 'ready');
    const result = await new FngkTerminalCommandExecutor(terminal).execute('printf payload');
    expect(result).toEqual({ output: Buffer.from('framed payload'), exitCode: 0 });
    terminal.detach('done'); await once(terminal, 'close');
  });

  it('waits for output that arrives after command completion', async () => {
    const terminal = new FngkProcessClient({ binary: fixture, env: { FNGK_FIXTURE_MODE: 'terminal-reordered' } }).openTerminal('device-1', { newSession: true });
    await once(terminal, 'ready');
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
      if (command.startsWith('base64 ')) return { output: Buffer.from(Buffer.from('hello').toString('base64')), exitCode: 0 };
      if (command.startsWith('find ')) return { output: Buffer.from(Buffer.from(['a.txt', 'f', '5', '1789200000', '644', ''].join('\0')).toString('base64')), exitCode: 0 };
      return { output: Buffer.alloc(0), exitCode: 0 };
    } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', identity: 'root', privilege: 'root', executor });
    const files = new FileService([transport]);
    expect(await files.read({ contextId: 'remote', path: '/root/a.txt' })).toMatchObject({ text: 'hello', route: expect.objectContaining({ kind: 'terminal', effectiveIdentity: 'root' }) });
    expect(await files.list({ contextId: 'remote', path: '/root' })).toMatchObject({ items: [expect.objectContaining({ name: 'a.txt', type: 'file' })] });
    expect(commands.every(command => !command.includes('.atlas-') && !command.includes('mktemp'))).toBe(true);
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
    expect(commands[0]).toContain("find '/srv/atlas' -xdev -mindepth 1 -maxdepth 3 -type f -size -2048c -print0 | head -z -n 12 | xargs -0 -r sh -c");
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

  it('uses bounded structured NUL records for terminal name search', async () => {
    const commands: string[] = [];
    const encoded = Buffer.from('/srv/atlas/name:with\nnewline\0d\0').toString('base64');
    const executor: CommandExecutor = { execute: async command => { commands.push(command); return { output: Buffer.from(encoded), exitCode: 0 }; } };
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'remote', deviceId: 'device-1', executor });
    await expect(transport.search('/srv/atlas', 'name', { mode: 'name', maxEntries: 12 })).resolves.toEqual([{ path: '/srv/atlas/name:with\nnewline', type: 'directory' }]);
    expect(commands[0]).toContain('-printf');
    expect(commands[0]).toContain('head -z -n 24');
    expect(commands[0]).toContain('pipefail');
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
