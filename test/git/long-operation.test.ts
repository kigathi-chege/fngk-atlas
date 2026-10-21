import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TerminalLongOperationRunner } from '../../src/git/long-operation.js';

const event = (type: string, extra: Record<string, unknown> = {}) => ({ type, protocolVersion: 'fngk.terminal.v1', ...extra });
const output = (text: string) => event('output', { bodyBase64: Buffer.from(text).toString('base64') });

/** A Device terminal that echoes the command, then replies in arbitrary chunks. */
class FakeTerminal extends EventEmitter {
  sessionId?: string; closed = false; mode = 'exclusive';
  stop = vi.fn(() => { this.closed = true; queueMicrotask(() => this.emit('close', {})); return true; });
  interrupt = vi.fn(() => true);
  constructor(readonly reply: (frame: string, requestId: string, terminal: FakeTerminal) => void) { super(); queueMicrotask(() => { this.sessionId = 'session-1'; this.emit('ready', event('ready')); }); }
  setMode(mode: string) { this.mode = mode; queueMicrotask(() => this.emit('collaboration', event('collaboration', { eventType: 'mode', mode }))); return true; }
  sendCommand(command: string, requestId: string) {
    if (this.mode !== 'queue') throw new Error('commands need queue mode');
    const frame = /__ATLAS_BEGIN_([A-Za-z0-9_]+)__/.exec(command)![1];
    queueMicrotask(() => { this.emit('event', output(`$ ${command}\r\n`)); this.reply(frame, requestId, this); });
    return true;
  }
}

describe('dedicated terminal for long git operations', () => {
  it('streams output split across chunks and markers, reports the framed status, and stops the terminal', async () => {
    let terminal!: FakeTerminal;
    const runner = new TerminalLongOperationRunner(() => terminal = new FakeTerminal((frame, requestId, self) => {
      const body = `\r\n__ATLAS_BEGIN_${frame}__\r\nCounting objects: 50%\rCounting objects: 100%\r\nTo ../remote.git\r\n\r\n__ATLAS_END_${frame}__:1\r\n`;
      for (let index = 0; index < body.length; index += 7) self.emit('event', output(body.slice(index, index + 7)));
      self.emit('event', event('command_state', { requestId, status: 'succeeded', exitCode: 0 }));
    }) as any);
    const chunks: string[] = [];
    const result = await runner.run('git push', { onOutput: text => chunks.push(text) });
    expect(result.exitCode).toBe(1);
    expect(chunks.join('')).toBe('Counting objects: 50%\nCounting objects: 100%\nTo ../remote.git\n');
    expect(chunks.length).toBeGreaterThan(1);
    expect(terminal.stop).toHaveBeenCalled();
  });

  it('interrupts and stops on cancellation', async () => {
    let terminal!: FakeTerminal;
    const runner = new TerminalLongOperationRunner(() => terminal = new FakeTerminal((frame, _id, self) => self.emit('event', output(`\n__ATLAS_BEGIN_${frame}__\nwaiting…`))) as any);
    const controller = new AbortController();
    const pending = runner.run('git fetch', { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(terminal.interrupt).toHaveBeenCalled();
    expect(terminal.stop).toHaveBeenCalled();
  });

  it('fails clearly when the Device rejects the dedicated terminal', async () => {
    class Rejecting extends FakeTerminal { setMode(_mode: string) { queueMicrotask(() => this.emit('close', {})); return true; } }
    const runner = new TerminalLongOperationRunner(() => new Rejecting(() => {}) as any);
    await expect(runner.run('git pull')).rejects.toMatchObject({ code: 'terminal_closed' });
  });
});
