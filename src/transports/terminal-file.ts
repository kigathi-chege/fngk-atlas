import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { TransportEntry } from './direct.js';
import type { CommandExecutor } from './terminal-command.js';
import type { FileStat, FileTransport } from './file-transport.js';
import { posixQuote } from './posix.js';

export interface TerminalFileTransportOptions { id: string; contextId: string; deviceId: string; identity?: string; privilege?: AccessRoute['privilege']; executor: CommandExecutor }

export class TerminalFileTransport implements FileTransport {
  readonly kind = 'terminal' as const; readonly id: string; readonly contextId: string; readonly deviceId: string;
  readonly effectiveIdentity: string; readonly privilege: AccessRoute['privilege']; readonly observedAt = new Date().toISOString(); readonly available = true;
  readonly operations: Operation[] = ['list', 'stat', 'read', 'write', 'execute', 'processes', 'containers'];
  readonly executor: CommandExecutor;
  constructor(options: TerminalFileTransportOptions) { this.id = options.id; this.contextId = options.contextId; this.deviceId = options.deviceId; this.effectiveIdentity = options.identity ?? 'remote-shell'; this.privilege = options.privilege ?? 'unknown'; this.executor = options.executor; }
  covers(target: AccessTarget): boolean { return target.contextId === this.contextId && Boolean(target.path?.startsWith('/')); }
  async #run(command: string): Promise<Buffer> { const result = await this.executor.execute(command); if (result.exitCode !== 0) throw Object.assign(new Error(`Remote command failed with exit code ${result.exitCode}.`), { code: 'remote_command_failed', exitCode: result.exitCode }); return result.output; }

  async list(logicalPath: string): Promise<TransportEntry[]> {
    const format = `%f\\0%y\\0%s\\0%T@\\0%m\\0`;
    const output = await this.#run(`find ${posixQuote(logicalPath)} -mindepth 1 -maxdepth 1 -printf ${posixQuote(format)} | base64 | tr -d '\\n'`);
    const fields = Buffer.from(output.toString('utf8').trim(), 'base64').toString('utf8').split('\0'); fields.pop();
    const entries: TransportEntry[] = [];
    for (let index = 0; index + 4 < fields.length; index += 5) {
      const [name, kind, bytes, modified, mode] = fields.slice(index, index + 5);
      entries.push({ name, path: path.posix.join(logicalPath, name), type: kind === 'd' ? 'directory' : kind === 'f' ? 'file' : kind === 'l' ? 'symlink' : 'other', bytes: Number(bytes), modifiedAt: new Date(Number(modified) * 1000).toISOString(), mode: Number.parseInt(mode, 8) });
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }
  async stat(logicalPath: string): Promise<FileStat> { const output = await this.#run(`stat -c '%s %a' -- ${posixQuote(logicalPath)}`); const [size, mode] = output.toString('utf8').trim().split(/\s+/); return { size: Number(size), mode: Number.parseInt(mode, 8) }; }
  async read(logicalPath: string): Promise<Buffer> { const output = await this.#run(`base64 -- ${posixQuote(logicalPath)} | tr -d '\\n'`); return Buffer.from(output.toString('utf8').trim(), 'base64'); }
  async atomicWrite(logicalPath: string, content: Buffer, mode = 0o600): Promise<void> {
    const suffix = randomUUID(), temporary = `${logicalPath}.atlas-${suffix}.tmp`, encoded = `${temporary}.b64`;
    try {
      await this.#run(`umask 077; : > ${posixQuote(encoded)}`);
      const base64 = content.toString('base64');
      for (let offset = 0; offset < base64.length; offset += 12_000) await this.#run(`printf '%s' ${posixQuote(base64.slice(offset, offset + 12_000))} >> ${posixQuote(encoded)}`);
      await this.#run(`base64 -d ${posixQuote(encoded)} > ${posixQuote(temporary)} && chmod ${posixQuote((mode & 0o777).toString(8))} ${posixQuote(temporary)} && mv -f ${posixQuote(temporary)} ${posixQuote(logicalPath)} && rm -f ${posixQuote(encoded)}`);
    } catch (error) {
      await this.executor.execute(`rm -f ${posixQuote(temporary)} ${posixQuote(encoded)}`).catch(() => {}); throw error;
    }
  }
}
