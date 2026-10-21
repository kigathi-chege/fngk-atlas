import { randomUUID } from 'node:crypto';
import type { TerminalEvent } from '../fngk/protocol.js';
import { TerminalSession } from '../fngk/terminal-session.js';
import { framedCommand } from './posix.js';

export interface CommandResult { output: Buffer; exitCode: number }
export interface CommandExecutor { execute(command: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<CommandResult> }

const cancelledError = () => Object.assign(new Error('Terminal command cancelled.'), { code: 'cancelled' });
/** After a timeout interrupt, how long the slot stays held waiting for the command to report completion. */
const INTERRUPT_GRACE_MS = 5_000;

/**
 * Commands on one terminal session run one at a time, queued here in Atlas.
 *
 * Signal runs a queue-mode session's commands in order, and an interrupt
 * there is a bare Ctrl-C that fails whichever command is running: the CLI does
 * not carry the request id. If Atlas handed every command to Signal at once,
 * cancelling one would send Ctrl-C to some other command, possibly a save.
 * Keeping the queue in Atlas means:
 *  - a command cancelled while it waits here is dropped without sending anything;
 *  - a command cancelled while it runs is left to finish and its result is
 *    discarded, so the caller is released at once and nothing is interrupted;
 *  - the only interrupt ever sent is for a timed-out command, which is then
 *    the single Atlas command on the session, and the slot stays held until
 *    it reports completion so the Ctrl-C cannot land on the next one.
 */
const lanes = new WeakMap<object, { tail: Promise<void> }>();

export class FngkTerminalCommandExecutor implements CommandExecutor {
  constructor(readonly session: TerminalSession, readonly timeoutMs = 30_000) {}

  async execute(command: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CommandResult> {
    if (options.signal?.aborted) throw cancelledError();
    const lane = lanes.get(this.session) ?? { tail: Promise.resolve() };
    lanes.set(this.session, lane);
    let release!: () => void;
    const slot = new Promise<void>(resolve => { release = resolve; }), previous = lane.tail;
    lane.tail = previous.then(() => slot);
    const aborted = new Promise<'aborted'>(resolve => { if (options.signal?.aborted) resolve('aborted'); options.signal?.addEventListener('abort', () => resolve('aborted'), { once: true }); });
    // Waiting in Atlas: an abort drops the command, nothing is sent.
    if (await Promise.race([previous.then(() => 'ready' as const), aborted]) === 'aborted') { void previous.then(release); throw cancelledError(); }
    const running = this.#send(command, options.timeoutMs ?? this.timeoutMs);
    void running.settled.then(release);
    // Running on the Device: an abort releases the caller; the command finishes on its own.
    const outcome = await Promise.race([running.result, aborted]);
    if (outcome === 'aborted') { running.result.catch(() => {}); throw cancelledError(); }
    return outcome;
  }

  #send(command: string, timeoutMs: number): { result: Promise<CommandResult>; settled: Promise<void> } {
    const requestId = randomUUID(), frameId = requestId.replaceAll('-', '_'), chunks: Buffer[] = [];
    let markSettled!: () => void;
    const settled = new Promise<void>(resolve => { markSettled = resolve; });
    const result = new Promise<CommandResult>((resolve, reject) => {
      let finished = false, remoteDone = false, completion: TerminalEvent | undefined, grace: NodeJS.Timeout | undefined;
      const detach = () => { this.session.off('event', receive); this.session.off('close', close); clearTimeout(timer); clearTimeout(grace); markSettled(); };
      // The caller's outcome; listeners stay until the Device reports completion.
      const finish = (error?: Error, value?: CommandResult) => { if (finished) return; finished = true; if (error) reject(error); else resolve(value!); if (remoteDone) detach(); };
      const remoteFinished = () => { remoteDone = true; if (finished) detach(); };
      const tryFinish = () => {
        if (!completion) return;
        const all = Buffer.concat(chunks).toString('utf8').replaceAll('\r\n', '\n'), begin = `__ATLAS_BEGIN_${frameId}__\n`, end = `\n__ATLAS_END_${frameId}__:`;
        const start = all.lastIndexOf(begin), finishAt = all.indexOf(end, Math.max(0, start));
        if (start < 0 || finishAt < 0) return;
        const output = Buffer.from(all.slice(start + begin.length, finishAt));
        // The frame carries the wrapped command's own status. Signal's exitCode
        // is the whole line's, which ends in printf and is therefore always 0.
        const framed = all.slice(finishAt + end.length).match(/^(-?\d+)/)?.[1];
        finish(undefined, { output, exitCode: Number(framed ?? completion.exitCode ?? 1) });
      };
      const receive = (event: TerminalEvent) => {
        if (event.type === 'error' && event.requestId === requestId) {
          finish(Object.assign(new Error(typeof event.message === 'string' ? event.message : 'FNGK terminal command failed.'), { code: typeof event.code === 'string' ? event.code : 'terminal_command_failed' }));
          remoteFinished(); return;
        }
        if (finished && remoteDone) return;
        if ((event.type === 'output' || event.type === 'replay') && typeof event.bodyBase64 === 'string' && !finished) chunks.push(Buffer.from(event.bodyBase64, 'base64'));
        if (event.type === 'command_state' && event.requestId === requestId && (event.status === 'succeeded' || event.status === 'failed')) { completion = event; remoteFinished(); }
        if (!finished) tryFinish();
      };
      const close = () => { finish(Object.assign(new Error('Terminal closed during command.'), { code: 'terminal_closed' })); remoteFinished(); };
      const timer = setTimeout(() => {
        // Ours is the only Atlas command on the session, so this Ctrl-C is ours.
        this.session.interrupt(requestId);
        finish(Object.assign(new Error('Terminal command timed out.'), { code: 'timeout' }));
        grace = setTimeout(remoteFinished, INTERRUPT_GRACE_MS); grace.unref();
      }, timeoutMs); timer.unref();
      this.session.on('event', receive); this.session.once('close', close);
      if (!this.session.sendCommand(framedCommand(command, frameId), requestId)) { finish(Object.assign(new Error('Terminal is not writable.'), { code: 'terminal_closed' })); remoteFinished(); }
    });
    return { result, settled };
  }
}
