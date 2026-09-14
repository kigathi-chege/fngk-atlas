import { spawn } from 'node:child_process';
import { FILES_PROTOCOL, NAMESPACE_PROTOCOL, PROCESS_PROTOCOL, SESSION_PROTOCOL, TERMINAL_PROTOCOL, type ManagedProcess, type ManagedProcessLogs, type NativeFileBindings, type NamespaceSnapshot } from './protocol.js';
import { parseNamespace } from './namespace.js';
import { TerminalSession } from './terminal-session.js';
import { redact } from './redaction.js';

export interface FngkProcessClientOptions {
  binary?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface FngkContextState {
  binary: string;
  installed: boolean;
  compatible: boolean;
  version?: string;
  profile?: string;
  namespaceProtocol?: string;
  terminalProtocol?: string;
  daemon: 'reachable' | 'unknown';
  login: 'authenticated' | 'required' | 'unknown';
  reason?: string;
  namespace?: NamespaceSnapshot;
}

export class FngkProcessError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode?: number | null) {
    super(redact(message));
    this.name = 'FngkProcessError';
  }
}

export class FngkProcessClient {
  readonly binary: string;
  readonly timeoutMs: number;
  readonly env: NodeJS.ProcessEnv;

  constructor(options: FngkProcessClientOptions = {}) {
    this.binary = options.binary ?? process.env.FNGK_BIN ?? 'fngk';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.env = { ...process.env, ...options.env };
  }

  async #run(args: string[], signal?: AbortSignal, input?:string): Promise<string> {
    return await new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, { env: this.env, stdio: [input===undefined?'ignore':'pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', settled = false;
      const finish = (error?: FngkProcessError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(stdout);
      };
      const cancel = () => { child.kill('SIGTERM'); finish(new FngkProcessError('cancelled', 'FNGK operation was cancelled.')); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new FngkProcessError('timeout', `FNGK operation timed out after ${this.timeoutMs}ms.`)); }, this.timeoutMs);
      timer.unref();
      if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
      child.stdout!.on('data', chunk => {
        stdout += chunk.toString('utf8');
        if (stdout.length > 4 * 1024 * 1024) { child.kill('SIGTERM'); finish(new FngkProcessError('output_limit', 'FNGK output exceeded 4 MiB.')); }
      });
      child.stderr!.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-64 * 1024); });
      child.on('error', error => finish(new FngkProcessError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'binary_missing' : 'process_error', error.message)));
      child.on('close', code => {
        if (code === 0) return finish();
        const normalized = stderr.toLowerCase();
        const failure = normalized.includes('authentication_required') || normalized.includes('authentication required') ? 'authentication_required'
          : normalized.includes('daemon') && (normalized.includes('unavailable') || normalized.includes('not running')) ? 'daemon_unavailable'
            : 'process_failed';
        finish(new FngkProcessError(failure, stderr || `FNGK exited with code ${code}.`, code));
      });
      if(input!==undefined){child.stdin!.end(input);}
    });
  }

  async fileBindings(profile?:string,signal?:AbortSignal):Promise<NativeFileBindings>{
    const args=['files','--json'];if(profile)args.push('--profile',profile);
    const value=JSON.parse((await this.#run(args,signal)).trim()) as NativeFileBindings;
    if(value.protocolVersion!==FILES_PROTOCOL||!value.profile||!Array.isArray(value.bindings))throw new FngkProcessError('unsupported_protocol','FNGK returned an unsupported Files protocol.');
    return value;
  }

  async invokeFileBinding(bindingId:string,capability:string,input:Record<string,unknown>,options:{profile?:string;confirm?:boolean;signal?:AbortSignal}={}):Promise<{protocolVersion:typeof FILES_PROTOCOL;output:any}>{
    const args=['files','invoke',bindingId,capability,'--json'];if(options.profile)args.push('--profile',options.profile);if(options.confirm)args.push('--yes');
    const value=JSON.parse((await this.#run(args,options.signal,JSON.stringify(input))).trim());
    if(value.protocolVersion!==FILES_PROTOCOL)throw new FngkProcessError('unsupported_protocol','FNGK returned an unsupported Files protocol.');return value;
  }

  async sessionAction(sessionId:string,action:'rename'|'restart'|'stop'|'archive'|'restore',options:{profile?:string;title?:string;confirm?:boolean;signal?:AbortSignal}={}){
    const args=['sessions',sessionId,action,'--json'];if(options.profile)args.push('--profile',options.profile);if(options.title)args.push('--title',options.title);if(options.confirm)args.push('--yes');
    const value=JSON.parse((await this.#run(args,options.signal)).trim());if(value.protocolVersion!==SESSION_PROTOCOL)throw new FngkProcessError('unsupported_protocol','FNGK returned an unsupported terminal session protocol.');return value;
  }

  async managedProcesses(deviceId:string,profile?:string,signal?:AbortSignal):Promise<ManagedProcess[]> { const args=['processes',deviceId,'list','--json']; if(profile)args.push('--profile',profile); const value=JSON.parse((await this.#run(args,signal)).trim()); if(value.protocolVersion!==PROCESS_PROTOCOL||!Array.isArray(value.result))throw new FngkProcessError('unsupported_protocol','FNGK returned an unsupported process protocol.'); return value.result; }
  async createManagedProcess(deviceId:string,definition:Record<string,unknown>,options:{profile?:string;signal?:AbortSignal}={}):Promise<ManagedProcess> { const args=['processes',deviceId,'create','--json']; if(options.profile)args.push('--profile',options.profile); const value=JSON.parse((await this.#run(args,options.signal,JSON.stringify(definition))).trim()); if(value.protocolVersion!==PROCESS_PROTOCOL||!value.result?.id)throw new FngkProcessError('unsupported_protocol','FNGK returned an unsupported process protocol.'); return value.result; }
  async managedProcessAction(processId:string,action:'start'|'stop'|'restart',options:{profile?:string;signal?:AbortSignal}={}):Promise<unknown> { const args=['processes',processId,action,'--json']; if(options.profile)args.push('--profile',options.profile); const value=JSON.parse((await this.#run(args,options.signal)).trim()); if(value.protocolVersion!==PROCESS_PROTOCOL)throw new FngkProcessError('unsupported_protocol','FNGK returned an unsupported process protocol.'); return value.result; }
  async managedProcessLogs(processId:string,options:{profile?:string;runId?:string;after?:number;limit?:number;signal?:AbortSignal}={}):Promise<ManagedProcessLogs> { const args=['processes',processId,'logs','--json']; if(options.runId)args.push('--run-id',options.runId); if(options.after!==undefined)args.push('--after',String(options.after)); if(options.limit!==undefined)args.push('--limit',String(options.limit)); if(options.profile)args.push('--profile',options.profile); const value=JSON.parse((await this.#run(args,options.signal)).trim()); if(value.protocolVersion!==PROCESS_PROTOCOL||!value.result)throw new FngkProcessError('unsupported_protocol','FNGK returned an unsupported process protocol.'); return value.result; }

  async namespace(profile?: string, signal?: AbortSignal): Promise<NamespaceSnapshot> {
    const args = ['status', '--json'];
    if (profile) args.push('--profile', profile);
    try { return parseNamespace((await this.#run(args, signal)).trim()); }
    catch (error) {
      if (error instanceof FngkProcessError) throw error;
      const value = error as { code?: string; message?: string };
      throw new FngkProcessError(value.code ?? 'invalid_namespace', value.message ?? 'FNGK returned an invalid namespace document.');
    }
  }

  async probe(profile?: string, signal?: AbortSignal): Promise<FngkContextState> {
    let version: string;
    try {
      const raw = await this.#run(['version'], signal);
      version = raw.match(/v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/)?.[1] ?? raw.trim();
    } catch (error) {
      const reason = error instanceof FngkProcessError ? error.code : 'probe_failed';
      return { binary: this.binary, installed: reason !== 'binary_missing', compatible: false, daemon: 'unknown', login: 'unknown', reason };
    }
    try {
      const namespace = await this.namespace(profile, signal);
      return { binary: this.binary, installed: true, compatible: true, version, profile: namespace.profile.name, namespaceProtocol: NAMESPACE_PROTOCOL, terminalProtocol: TERMINAL_PROTOCOL, daemon: 'reachable', login: 'authenticated', namespace };
    } catch (error) {
      const reason = error instanceof FngkProcessError ? error.code : String((error as { code?: string }).code ?? 'namespace_failed');
      return { binary: this.binary, installed: true, compatible: false, version, profile, daemon: 'unknown', login: reason === 'authentication_required' ? 'required' : 'unknown', reason };
    }
  }

  openTerminal(target: string, options: { newSession?: boolean; sessionId?: string; profile?: string; signal?: AbortSignal } = {}): TerminalSession {
    const args = [target];
    if (options.newSession) args.push('--new');
    if (options.sessionId) args.push('--session', options.sessionId);
    if (options.profile) args.push('--profile', options.profile);
    args.push('--stdio-json');
    return new TerminalSession({ binary: this.binary, args, env: this.env, signal: options.signal });
  }

  async update(onOutput: (line: string) => void, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.binary, ['update'], { env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let settled = false, stderr = '';
      const finish = (error?: FngkProcessError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve();
      };
      const cancel = () => { child.kill('SIGTERM'); finish(new FngkProcessError('cancelled', 'FNGK update was cancelled.')); };
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new FngkProcessError('timeout', `FNGK update timed out after ${this.timeoutMs}ms.`)); }, Math.max(this.timeoutMs, 120_000));
      timer.unref();
      if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
      for (const stream of [child.stdout, child.stderr]) {
        const lines = stream.setEncoding('utf8');
        let buffered = '';
        lines.on('data', chunk => {
          if (stream === child.stderr) stderr = (stderr + chunk).slice(-64 * 1024);
          buffered += chunk;
          const parts = buffered.split(/\r?\n/); buffered = parts.pop() ?? '';
          for (const line of parts) if (line) onOutput(redact(line));
        });
        lines.on('end', () => { if (buffered) onOutput(redact(buffered)); });
      }
      child.on('error', error => finish(new FngkProcessError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'binary_missing' : 'process_error', error.message)));
      child.on('close', code => code === 0 ? finish() : finish(new FngkProcessError('process_failed', stderr || `FNGK update exited with code ${code}.`, code)));
    });
  }
}
