import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { TERMINAL_PROTOCOL, type TerminalEvent, type TerminalInput } from './protocol.js';
import { redact } from './redaction.js';

export interface TerminalSpawnOptions {
  binary: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export class TerminalSession extends EventEmitter {
  readonly process: ChildProcessWithoutNullStreams;
  readonly args: readonly string[];
  sessionId?: string;
  #closed = false;
  #stderr = '';

  constructor(options: TerminalSpawnOptions) {
    super();
    this.args = Object.freeze([...options.args]);
    this.on('error', () => {});
    this.process = spawn(options.binary, options.args, { env: options.env, stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal });
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', line => this.#receive(line));
    this.process.stderr.on('data', chunk => {
      this.#stderr = (this.#stderr + chunk.toString('utf8')).slice(-64 * 1024);
    });
    this.process.stdin.on('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'EPIPE') { this.#closed = true; return; }
      this.emit('error', Object.assign(new Error(redact(error.message)), { code: 'input_error' }));
    });
    this.process.on('error', error => this.emit('error', Object.assign(new Error(redact(error.message)), { code: error.name === 'AbortError' ? 'cancelled' : 'process_error' })));
    this.process.on('close', (code, signal) => {
      this.#closed = true;
      lines.close();
      if (code && code !== 0) this.emit('error', Object.assign(new Error(redact(this.#stderr || `FNGK terminal exited with code ${code}`)), { code: 'process_failed', exitCode: code }));
      this.emit('close', { code, signal });
    });
  }

  #receive(line: string): void {
    let event: TerminalEvent;
    try {
      event = JSON.parse(line) as TerminalEvent;
    } catch {
      this.emit('error', Object.assign(new Error('FNGK terminal emitted invalid JSONL.'), { code: 'invalid_json' }));
      return;
    }
    if (event.protocolVersion !== TERMINAL_PROTOCOL) {
      this.emit('error', Object.assign(new Error(`Unsupported FNGK terminal protocol: ${String(event.protocolVersion ?? 'missing')}`), { code: 'unsupported_protocol' }));
      this.process.kill();
      return;
    }
    if (event.type === 'ready' && typeof event.sessionId === 'string') this.sessionId = event.sessionId;
    this.emit('event', event);
    this.emit(event.type, event);
  }

  send(message: TerminalInput): boolean {
    if (this.#closed || !this.process.stdin.writable) return false;
    return this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  sendInput(body: Uint8Array, requestId?: string): boolean {
    return this.send({ type: 'input', requestId, bodyBase64: Buffer.from(body).toString('base64') });
  }

  sendCommand(command: string, requestId?: string): boolean {
    return this.send({ type: 'command', requestId, command });
  }

  resize(cols: number, rows: number, requestId?: string): boolean {
    return this.send({ type: 'resize', requestId, cols, rows });
  }

  interrupt(requestId?: string): boolean { return this.send({ type: 'interrupt', requestId }); }
  setMode(mode: 'exclusive' | 'queue' | 'shared', requestId?: string): boolean { return this.send({ type: 'mode', requestId, mode }); }
  requestControl(requestId?: string): boolean { return this.send({ type: 'control_request', requestId }); }
  resolveControl(controlRequestId: string, decision: 'approve' | 'deny', requestId?: string): boolean { return this.send({ type: 'control_resolve', requestId, controlRequestId, decision }); }
  resolveApproval(approvalId: string, decision: 'approve' | 'deny', requestId?: string): boolean { return this.send({ type: 'nested_approval_resolve', requestId, approvalId, decision }); }
  detach(requestId?: string): boolean { return this.send({ type: 'detach', requestId }); }
  stop(requestId?: string): boolean { return this.send({ type: 'stop', requestId }); }
}
