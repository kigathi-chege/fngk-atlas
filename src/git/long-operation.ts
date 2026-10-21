import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { TerminalEvent } from '../fngk/protocol.js';
import type { TerminalSession } from '../fngk/terminal-session.js';
import { framedCommand } from '../transports/posix.js';

/**
 * Fetch, pull, push and clone can take minutes and wait on the network. They
 * must not hold the Device Session's shared command queue (every file
 * operation would stall behind them) or run into its 30 second limit.
 *
 * Remote long operations therefore open their own short-lived FNGK terminal:
 * a fresh `--new --stdio-json` session in queue mode that runs exactly one
 * framed command, streams its output, and is stopped afterwards. This keeps
 * the same POSIX framing, authorization scope and audit trail as every other
 * Device command, needs no Device-side install, and isolates a hung network
 * operation completely. (Managed processes were the alternative, but they are
 * persistent, logged definitions meant for services, and their logs are polled
 * rather than streamed.)
 */
export interface LongOperationResult { exitCode: number; output: string }
export interface LongOperationOptions { onOutput?: (text: string) => void; signal?: AbortSignal; timeoutMs?: number }
export interface LongOperationRunner { run(command: string, options?: LongOperationOptions): Promise<LongOperationResult> }

const DEFAULT_TIMEOUT = 15 * 60_000, KEEP_OUTPUT = 256 * 1024;

function failure(code: string, message: string): Error { return Object.assign(new Error(message), { code }); }
const tail = (value: string) => value.length > KEEP_OUTPUT ? value.slice(-KEEP_OUTPUT) : value;

/** Runs on the Atlas host through `/bin/sh`, streaming stdout and stderr. */
export class LocalLongOperationRunner implements LongOperationRunner {
  async run(command: string, options: LongOperationOptions = {}): Promise<LongOperationResult> {
    if (options.signal?.aborted) throw failure('cancelled', 'The git operation was cancelled.');
    return await new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      let output = '', settled = false;
      const kill = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); } };
      const finish = (error?: Error, exitCode?: number) => {
        if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
        error ? reject(error) : resolve({ exitCode: exitCode ?? 1, output });
      };
      const cancel = () => { kill(); finish(failure('cancelled', 'The git operation was cancelled.')); };
      const timer = setTimeout(() => { kill(); finish(failure('timeout', 'The git operation timed out.')); }, options.timeoutMs ?? DEFAULT_TIMEOUT); timer.unref();
      options.signal?.addEventListener('abort', cancel, { once: true });
      const receive = (chunk: Buffer) => { const text = chunk.toString('utf8').replace(/\r\n?/g, '\n'); output = tail(output + text); options.onOutput?.(text); };
      child.stdout.on('data', receive); child.stderr.on('data', receive);
      child.on('error', error => finish(error));
      child.on('close', code => finish(undefined, code ?? 1));
    });
  }
}

export type TerminalOpener = (signal: AbortSignal) => TerminalSession;

/** Runs one command in a dedicated, short-lived FNGK terminal and stops it afterwards. */
export class TerminalLongOperationRunner implements LongOperationRunner {
  constructor(readonly open: TerminalOpener, readonly readyTimeoutMs = 15_000) {}

  async run(command: string, options: LongOperationOptions = {}): Promise<LongOperationResult> {
    if (options.signal?.aborted) throw failure('cancelled', 'The git operation was cancelled.');
    const controller = new AbortController(), terminal = this.open(controller.signal);
    try {
      await this.#ready(terminal, options.signal);
      return await this.#execute(terminal, command, options);
    } finally {
      // Stop, never detach: a detached session would linger on the Device.
      if (!terminal.closed && !terminal.stop('atlas-git-operation-done')) controller.abort();
      setTimeout(() => { if (!terminal.closed) controller.abort(); }, 5_000).unref();
    }
  }

  async #ready(terminal: TerminalSession, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const requestId = `atlas-git-mode-${randomUUID()}`;
      let settled = false, modeRequested = false;
      const finish = (error?: Error) => {
        if (settled) return; settled = true; clearTimeout(timer);
        terminal.off('ready', ready); terminal.off('collaboration', changed); terminal.off('terminal_error', rejected); terminal.off('error', failed); terminal.off('close', closed); signal?.removeEventListener('abort', cancelled);
        error ? reject(error) : resolve();
      };
      // Signal runs `command` frames only in queue mode; new sessions start exclusive.
      const ready = () => { if (modeRequested) return; modeRequested = true; if (!terminal.setMode('queue', requestId)) finish(failure('terminal_closed', 'The git terminal closed before it was ready.')); };
      const changed = (event: TerminalEvent) => { if (event.eventType === 'mode' && event.mode === 'queue') finish(); };
      const rejected = (event: TerminalEvent) => { if (event.requestId === requestId) finish(failure(typeof event.code === 'string' ? event.code : 'queue_unavailable', 'The Device did not accept the git terminal.')); };
      const failed = (error: Error) => finish(Object.assign(error, { code: (error as { code?: string }).code ?? 'terminal_failed' }));
      const closed = () => finish(failure('terminal_closed', 'The git terminal closed before it was ready.'));
      const cancelled = () => finish(failure('cancelled', 'The git operation was cancelled.'));
      const timer = setTimeout(() => finish(failure('timeout', 'The Device did not open a terminal for the git operation in time.')), this.readyTimeoutMs);
      terminal.on('ready', ready); terminal.on('collaboration', changed); terminal.on('terminal_error', rejected); terminal.once('error', failed); terminal.once('close', closed); signal?.addEventListener('abort', cancelled, { once: true });
      if (terminal.sessionId) ready();
    });
  }

  async #execute(terminal: TerminalSession, command: string, options: LongOperationOptions): Promise<LongOperationResult> {
    const requestId = randomUUID(), frame = requestId.replaceAll('-', '_');
    const begin = `__ATLAS_BEGIN_${frame}__\n`, end = `\n__ATLAS_END_${frame}__:`;
    return await new Promise<LongOperationResult>((resolve, reject) => {
      let buffer = '', started = false, emitted = 0, output = '', settled = false, completed = false;
      const finish = (error?: Error, exitCode?: number) => {
        if (settled) return; settled = true; clearTimeout(timer);
        terminal.off('event', receive); terminal.off('close', closed); options.signal?.removeEventListener('abort', cancel);
        error ? reject(error) : resolve({ exitCode: exitCode ?? 1, output });
      };
      const emit = (text: string) => { if (!text) return; output = tail(output + text); options.onOutput?.(text); };
      const drain = () => {
        if (!started) {
          const at = buffer.indexOf(begin);
          if (at < 0) { buffer = buffer.slice(-begin.length); return; }
          started = true; buffer = buffer.slice(at + begin.length); emitted = 0;
        }
        const stop = buffer.indexOf(end);
        if (stop >= 0) {
          emit(buffer.slice(emitted, stop));
          const status = /^(-?\d+)\n/.exec(buffer.slice(stop + end.length));
          if (status) finish(undefined, Number(status[1]));
          else emitted = stop;
          return;
        }
        // Hold back what could be the start of the end marker.
        const safe = Math.max(emitted, buffer.length - end.length);
        emit(buffer.slice(emitted, safe)); emitted = safe;
        if (emitted > 64 * 1024) { buffer = buffer.slice(emitted); emitted = 0; }
      };
      const receive = (event: TerminalEvent) => {
        if (event.type === 'error' && event.requestId === requestId) { finish(failure(typeof event.code === 'string' ? event.code : 'terminal_command_failed', typeof event.message === 'string' ? event.message : 'The Device rejected the git operation.')); return; }
        if ((event.type === 'output' || event.type === 'replay') && typeof event.bodyBase64 === 'string') {
          buffer += Buffer.from(event.bodyBase64, 'base64').toString('utf8').replace(/\r\n?/g, '\n');
          drain();
        }
        if (event.type === 'command_state' && event.requestId === requestId && (event.status === 'succeeded' || event.status === 'failed')) completed = true;
        // A completion without a framed status means the shell lost the frame.
        if (completed && !settled && started === false && event.type === 'command_state') setTimeout(() => finish(failure('terminal_protocol_invalid', 'The git terminal ended without reporting a status.')), 2_000).unref();
      };
      const closed = () => finish(failure('terminal_closed', 'The git terminal closed during the operation.'));
      const cancel = () => { terminal.interrupt(requestId); finish(failure('cancelled', 'The git operation was cancelled.')); };
      const timer = setTimeout(() => { terminal.interrupt(requestId); finish(failure('timeout', 'The git operation timed out.')); }, options.timeoutMs ?? DEFAULT_TIMEOUT); timer.unref();
      terminal.on('event', receive); terminal.once('close', closed); options.signal?.addEventListener('abort', cancel, { once: true });
      if (!terminal.sendCommand(framedCommand(command, frame), requestId)) finish(failure('terminal_closed', 'The git terminal is not writable.'));
    });
  }
}
