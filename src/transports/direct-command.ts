import { spawn } from 'node:child_process';
import type { CommandExecutor, CommandResult } from './terminal-command.js';

export class DirectCommandExecutor implements CommandExecutor {
  constructor(readonly timeoutMs = 10_000, readonly maxBytes = 4 * 1024 * 1024) {}
  async execute(command: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CommandResult> {
    return await new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-lc', command], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = Buffer.alloc(0), settled = false;
      const finish = (error?: Error, result?: CommandResult) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); error ? reject(error) : resolve(result!); };
      const cancel = () => { child.kill('SIGTERM'); finish(Object.assign(new Error('Command cancelled.'), { code: 'cancelled' })); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish(Object.assign(new Error('Command timed out.'), { code: 'timeout' })); }, options.timeoutMs ?? this.timeoutMs); timer.unref();
      options.signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', chunk => { output = Buffer.concat([output, chunk]); if (output.length > this.maxBytes) { child.kill('SIGTERM'); finish(Object.assign(new Error('Command output limit exceeded.'), { code: 'output_limit' })); } });
      child.on('error', error => finish(error)); child.on('close', code => finish(undefined, { output, exitCode: code ?? 1 }));
    });
  }
}
