import { randomUUID } from 'node:crypto';
import type { TerminalEvent } from '../fngk/protocol.js';
import { TerminalSession } from '../fngk/terminal-session.js';
import { framedCommand } from './posix.js';

export interface CommandResult { output: Buffer; exitCode: number }
export interface CommandExecutor { execute(command: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<CommandResult> }

export class FngkTerminalCommandExecutor implements CommandExecutor {
  constructor(readonly session: TerminalSession, readonly timeoutMs = 30_000) {}
  async execute(command: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CommandResult> {
    const requestId = randomUUID(), frameId = requestId.replaceAll('-', '_'), chunks: Buffer[] = [];
    return await new Promise<CommandResult>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, result?: CommandResult) => {
        if (settled) return; settled = true; clearTimeout(timer);
        this.session.off('event', receive); this.session.off('close', close); options.signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(result!);
      };
      const receive = (event: TerminalEvent) => {
        if ((event.type === 'output' || event.type === 'replay') && typeof event.bodyBase64 === 'string') chunks.push(Buffer.from(event.bodyBase64, 'base64'));
        if (event.type === 'command_state' && event.requestId === requestId && (event.status === 'succeeded' || event.status === 'failed')) {
          const all = Buffer.concat(chunks).toString('utf8'), begin = `__ATLAS_BEGIN_${frameId}__\n`, end = `\n__ATLAS_END_${frameId}__:`;
          const start = all.lastIndexOf(begin), finishAt = all.indexOf(end, Math.max(0, start));
          if (start < 0 || finishAt < 0) return finish(Object.assign(new Error('Terminal command output frame was incomplete.'), { code: 'frame_incomplete' }));
          const output = Buffer.from(all.slice(start + begin.length, finishAt));
          const exitCode = Number(event.exitCode ?? all.slice(finishAt + end.length).match(/^(-?\d+)/)?.[1] ?? 1);
          finish(undefined, { output, exitCode });
        }
      };
      const close = () => finish(Object.assign(new Error('Terminal closed during command.'), { code: 'terminal_closed' }));
      const cancel = () => { this.session.interrupt(requestId); finish(Object.assign(new Error('Terminal command cancelled.'), { code: 'cancelled' })); };
      const timer = setTimeout(() => { this.session.interrupt(requestId); finish(Object.assign(new Error('Terminal command timed out.'), { code: 'timeout' })); }, options.timeoutMs ?? this.timeoutMs); timer.unref();
      this.session.on('event', receive); this.session.once('close', close); options.signal?.addEventListener('abort', cancel, { once: true });
      if (!this.session.sendCommand(framedCommand(command, frameId), requestId)) finish(Object.assign(new Error('Terminal is not writable.'), { code: 'terminal_closed' }));
    });
  }
}
