import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { FngkTerminalCommandExecutor } from '../../src/transports/terminal-command.js';
import { TerminalFileTransport } from '../../src/transports/terminal-file.js';

/**
 * Behaves like a queue-mode Signal session: commands run one after another,
 * and an interrupt is a bare Ctrl-C that fails whichever command is running.
 * Each command takes `delayMs` unless released earlier.
 */
class QueueSession extends EventEmitter {
  queue: Array<{ command: string; requestId: string }> = [];
  running?: { command: string; requestId: string; timer: NodeJS.Timeout };
  sent: string[] = []; interrupts = 0; failedByInterrupt: string[] = [];
  constructor(readonly delayMs: (command: string) => number) { super(); }
  sendCommand(command: string, requestId: string) { this.sent.push(command); this.queue.push({ command, requestId }); this.#next(); return true; }
  interrupt() {
    this.interrupts++;
    const current = this.running; if (!current) return true;
    clearTimeout(current.timer); this.running = undefined; this.failedByInterrupt.push(current.command);
    this.emit('event', { type: 'command_state', protocolVersion: 'fngk.terminal.v1', requestId: current.requestId, status: 'failed', exitCode: 130 });
    this.#next(); return true;
  }
  #next() {
    if (this.running || !this.queue.length) return;
    const item = this.queue.shift()!, frame = item.command.match(/__ATLAS_BEGIN_([A-Za-z0-9_]+)__/)![1];
    const timer = setTimeout(() => {
      this.running = undefined;
      const body = item.command.includes('base64 -d') ? '' : item.command.includes('find -H') ? Buffer.from('').toString('base64') : 'ok';
      this.emit('event', { type: 'output', protocolVersion: 'fngk.terminal.v1', bodyBase64: Buffer.from(`\n__ATLAS_BEGIN_${frame}__\n${body}\n__ATLAS_END_${frame}__:0\n`).toString('base64') });
      this.emit('event', { type: 'command_state', protocolVersion: 'fngk.terminal.v1', requestId: item.requestId, status: 'succeeded', exitCode: 0 });
      this.#next();
    }, this.delayMs(item.command));
    this.running = { ...item, timer };
  }
}

describe('cancelling terminal commands', () => {
  it('cancels a listing while a save is queued behind it, and the save still succeeds', async () => {
    const session = new QueueSession(command => command.includes('-maxdepth 1') ? 150 : 5);
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'cancel', deviceId: 'device-1', executor: new FngkTerminalCommandExecutor(session as never) });
    const listing = new AbortController();
    const list = transport.list('/srv', { signal: listing.signal });
    const save = transport.safeWrite('/srv/a.txt', Buffer.from('saved'), {});
    await new Promise(resolve => setTimeout(resolve, 20));
    listing.abort();
    await expect(list).rejects.toMatchObject({ code: 'cancelled' });
    await expect(save).resolves.toBeUndefined();
    expect(session.interrupts).toBe(0);
    expect(session.failedByInterrupt).toEqual([]);
    expect(session.sent.some(command => command.includes('base64 -d'))).toBe(true);
  });

  it('cancels a listing queued behind a running save without failing the save', async () => {
    const session = new QueueSession(command => command.includes('base64 -d') ? 150 : 5);
    const transport = new TerminalFileTransport({ id: 'terminal', contextId: 'cancel-2', deviceId: 'device-1', executor: new FngkTerminalCommandExecutor(session as never) });
    const save = transport.safeWrite('/srv/a.txt', Buffer.from('saved'), {});
    await new Promise(resolve => setTimeout(resolve, 40));
    const listing = new AbortController(), list = transport.list('/srv', { signal: listing.signal });
    listing.abort();
    await expect(list).rejects.toMatchObject({ code: 'cancelled' });
    await expect(save).resolves.toBeUndefined();
    expect(session.interrupts).toBe(0);
    expect(session.sent.some(command => command.includes('-maxdepth 1'))).toBe(false);
  });

  it('drops a command cancelled while it waits in Atlas without sending it', async () => {
    const session = new QueueSession(() => 50), executor = new FngkTerminalCommandExecutor(session as never), waiting = new AbortController();
    const first = executor.execute('printf first');
    const second = executor.execute('printf second', { signal: waiting.signal });
    waiting.abort();
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    await expect(first).resolves.toMatchObject({ exitCode: 0 });
    await expect(executor.execute('printf third')).resolves.toMatchObject({ exitCode: 0 });
    expect(session.sent.map(command => command.match(/printf (first|second|third)/)?.[1])).toEqual(['first', 'third']);
    expect(session.interrupts).toBe(0);
  });

  it('interrupts only its own timed-out command and holds the next until it completes', async () => {
    const session = new QueueSession(command => command.includes('slow') ? 10_000 : 5), executor = new FngkTerminalCommandExecutor(session as never);
    const slow = executor.execute('printf slow', { timeoutMs: 30 });
    const next = executor.execute('printf next');
    await expect(slow).rejects.toMatchObject({ code: 'timeout' });
    await expect(next).resolves.toMatchObject({ exitCode: 0 });
    expect(session.failedByInterrupt).toEqual([expect.stringContaining('printf slow')]);
  });
});
