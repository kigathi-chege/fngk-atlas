import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { TransportEntry } from './direct.js';
import type { CommandExecutor } from './terminal-command.js';
import type { FileSearchMatch, FileSearchOptions, FileStat, FileTransport } from './file-transport.js';
import { posixQuote } from './posix.js';

export interface TerminalFileTransportOptions { id: string; contextId: string; deviceId: string; identity?: string; privilege?: AccessRoute['privilege']; executor: CommandExecutor; onUnavailable?:(error:unknown)=>void }

// Commands run in the Device Session's shared, long-lived shell, which may be
// dash or busybox sh rather than bash. They must stay POSIX and must never
// change that shell's state: no top-level `exit`, `set -e`, or `set -o`.
// Reserved statuses are raised from a subshell, which keeps the shell alive
// while the frame still reports them.
const CONFLICT_STATUS = 73, MISSING_STATUS = 66;
const unlessExists = (target: string, command: string) => `if [ -e ${posixQuote(target)} ] || [ -L ${posixQuote(target)} ]; then (exit ${CONFLICT_STATUS}); else ${command}; fi`;
// Pipelines report the last command's status, so a failing find or base64
// would otherwise look like an empty directory or an empty file.
const onlyIf = (test: string, command: string) => `if ${test}; then ${command}; else (exit ${MISSING_STATUS}); fi`;
const readableDirectory = (target: string) => `[ -d ${posixQuote(target)} ] && [ -r ${posixQuote(target)} ] && [ -x ${posixQuote(target)} ]`;
const isolated = (script: string) => `( ${script} )`;

function directoryProtocolError(message: string): Error {
  return Object.assign(new Error(message), { code: 'filesystem_protocol_invalid' });
}

/**
 * The terminal route intentionally uses a NUL-delimited, base64 encoded
 * directory protocol. Buffer.from is forgiving of malformed base64, which
 * would otherwise turn a broken terminal reply into a believable empty tree.
 */
function parseDirectoryRecords(output: Buffer, logicalPath: string): TransportEntry[] {
  const encoded = output.toString('utf8').trim();
  if (!encoded) return [];
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw directoryProtocolError('The Device Session returned malformed directory data.');
  }
  const fields = Buffer.from(encoded, 'base64').toString('utf8').split('\0');
  if (fields.pop() !== '' || fields.length % 5 !== 0) {
    throw directoryProtocolError('The Device Session returned an incomplete directory record.');
  }
  const entries: TransportEntry[] = [];
  for (let index = 0; index < fields.length; index += 5) {
    const [name, kind, bytes, modified, mode] = fields.slice(index, index + 5);
    const size = Number(bytes), modifiedSeconds = Number(modified), parsedMode = Number.parseInt(mode, 8);
    if (!name || name.includes('/') || !['d', 'f', 'l', 'o', 's', 'p', 'b', 'c', 'D'].includes(kind) || !Number.isFinite(size) || size < 0 || !Number.isFinite(modifiedSeconds) || !Number.isFinite(parsedMode)) {
      throw directoryProtocolError('The Device Session returned an invalid directory record.');
    }
    entries.push({ name, path: path.posix.join(logicalPath, name), type: kind === 'd' ? 'directory' : kind === 'f' ? 'file' : kind === 'l' ? 'symlink' : 'other', bytes: size, modifiedAt: new Date(modifiedSeconds * 1000).toISOString(), mode: parsedMode });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export class TerminalFileTransport implements FileTransport {
  readonly kind = 'terminal' as const; readonly id: string; readonly contextId: string; readonly deviceId: string;
  readonly effectiveIdentity: string; readonly privilege: AccessRoute['privilege']; readonly observedAt = new Date().toISOString(); readonly available = true;
  readonly operations: Operation[] = ['list', 'stat', 'read', 'write', 'search', 'create', 'move', 'trash', 'restore', 'delete', 'execute', 'processes', 'containers'];
  readonly executor: CommandExecutor;
  readonly onUnavailable?: (error:unknown)=>void;
  constructor(options: TerminalFileTransportOptions) { this.id = options.id; this.contextId = options.contextId; this.deviceId = options.deviceId; this.effectiveIdentity = options.identity ?? 'remote-shell'; this.privilege = options.privilege ?? 'unknown'; this.executor = options.executor;this.onUnavailable=options.onUnavailable; }
  covers(target: AccessTarget): boolean { return target.contextId === this.contextId && Boolean(target.path?.startsWith('/')); }
  async #run(command: string, options: { signal?: AbortSignal } = {}): Promise<Buffer> { try{const result = await this.executor.execute(command, options); if (result.exitCode === CONFLICT_STATUS) throw Object.assign(new Error('A file already exists at this path.'), { code: 'file_conflict', exitCode: result.exitCode }); if (result.exitCode === MISSING_STATUS) throw Object.assign(new Error('The path does not exist or is not readable on the Device.'), { code: 'path_not_found', exitCode: result.exitCode }); if (result.exitCode !== 0) throw Object.assign(new Error(`Remote command failed with exit code ${result.exitCode}.`), { code: 'remote_command_failed', exitCode: result.exitCode }); return result.output;}catch(error){if(!['remote_command_failed','file_conflict','path_not_found'].includes((error as {code?:string}).code??''))this.onUnavailable?.(error);throw error} }

  async list(logicalPath: string, options: { signal?: AbortSignal } = {}): Promise<TransportEntry[]> {
    const format = `%f\\0%y\\0%s\\0%T@\\0%m\\0`;
    const output = await this.#run(onlyIf(readableDirectory(logicalPath), `find -H ${posixQuote(logicalPath)} -mindepth 1 -maxdepth 1 -printf ${posixQuote(format)} | base64 | tr -d '\\n'`), options);
    return parseDirectoryRecords(output, logicalPath);
  }
  async stat(logicalPath: string, options: { signal?: AbortSignal } = {}): Promise<FileStat> { const output = await this.#run(onlyIf(`[ -e ${posixQuote(logicalPath)} ]`, `stat -c '%s %a' -- ${posixQuote(logicalPath)}`), options); const [size, mode] = output.toString('utf8').trim().split(/\s+/); return { size: Number(size), mode: Number.parseInt(mode, 8) }; }
  async read(logicalPath: string, options: { signal?: AbortSignal } = {}): Promise<Buffer> { const output = await this.#run(onlyIf(`[ -f ${posixQuote(logicalPath)} ] && [ -r ${posixQuote(logicalPath)} ]`, `base64 -- ${posixQuote(logicalPath)} | tr -d '\\n'`), options); return Buffer.from(output.toString('utf8').trim(), 'base64'); }
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
  async search(logicalPath: string, query: string, options: FileSearchOptions = {}): Promise<FileSearchMatch[]> {
    if(options.signal?.aborted)throw Object.assign(new Error('Filesystem search was cancelled.'),{code:'cancelled'});
    const limit=Math.min(500,Math.max(1,options.limit??200)),mode=options.mode??'all',needle=posixQuote(query),root=posixQuote(logicalPath),maxDepth=Math.min(32,Math.max(0,options.maxDepth??12)),maxEntries=Math.min(20_000,Math.max(1,options.maxEntries??5_000)),maxFileBytes=Math.min(2*1024*1024,Math.max(1,options.maxFileBytes??1024*1024)),commands:string[]=[];
    const run=async(command:string)=>{const result=await this.executor.execute(onlyIf(readableDirectory(logicalPath),isolated(command)),{signal:options.signal,timeoutMs:10_000});if(result.exitCode===MISSING_STATUS)throw Object.assign(new Error('The path does not exist or is not readable on the Device.'),{code:'path_not_found',exitCode:result.exitCode});if(result.exitCode!==0)throw Object.assign(new Error(`Remote command failed with exit code ${result.exitCode}.`),{code:'remote_command_failed',exitCode:result.exitCode});return Buffer.from(result.output.toString('utf8').trim(),'base64').toString('utf8')};
    const matches:FileSearchMatch[]=[];
    if(mode!=='content'){const text=await run(`find -H ${root} -xdev -mindepth 1 -maxdepth ${maxDepth} \\( -type d -o -type f \\) -printf '%p\\0%y\\0' | head -z -n ${maxEntries*2} | base64 | tr -d '\\n'`),fields=text.split('\0');fields.pop();for(let index=0;index+1<fields.length&&matches.length<limit;index+=2){const [value,kind]=fields.slice(index,index+2);if(path.posix.basename(value).toLocaleLowerCase().includes(query.toLocaleLowerCase()))matches.push({path:value,type:kind==='d'?'directory':'file'});}}
    if(mode!=='name'&&matches.length<limit){const script=`grep -ZInH -m 8 -F -- ${needle} "$@" 2>/dev/null; status=$?; [ "$status" -eq 0 ] || [ "$status" -eq 1 ]`,text=await run(`find -H ${root} -xdev -mindepth 1 -maxdepth ${maxDepth} -type f -size -${maxFileBytes}c -print0 | head -z -n ${maxEntries} | xargs -0 -r sh -c ${posixQuote(script)} sh | head -n ${limit} | base64 | tr -d '\\n'`);let cursor=0;while(cursor<text.length&&matches.length<limit){const nul=text.indexOf('\0',cursor);if(nul<0)break;const value=text.slice(cursor,nul),end=text.indexOf('\n',nul+1),body=text.slice(nul+1,end<0?text.length:end),colon=body.indexOf(':');if(colon>0)matches.push({path:value,type:'file',line:Number(body.slice(0,colon)),preview:body.slice(colon+1).trim().slice(0,240)});cursor=end<0?text.length:end+1;}}
    return matches;
  }
  async createFile(logicalPath:string,content=Buffer.alloc(0)){if(!content.length){await this.#run(unlessExists(logicalPath,`umask 077; set -C; : > ${posixQuote(logicalPath)}`));return;}const suffix=randomUUID(),temporary=`${logicalPath}.atlas-${suffix}.tmp`,encoded=`${temporary}.b64`;try{await this.#run(`umask 077; set -C; : > ${posixQuote(encoded)}`);const base64=content.toString('base64');for(let offset=0;offset<base64.length;offset+=12_000)await this.#run(`printf '%s' ${posixQuote(base64.slice(offset,offset+12_000))} >> ${posixQuote(encoded)}`);await this.#run(unlessExists(logicalPath,`base64 -d ${posixQuote(encoded)} > ${posixQuote(temporary)} && chmod 600 ${posixQuote(temporary)} && ln -- ${posixQuote(temporary)} ${posixQuote(logicalPath)} && rm -f ${posixQuote(temporary)} ${posixQuote(encoded)}`));}catch(error){await this.executor.execute(`rm -f ${posixQuote(temporary)} ${posixQuote(encoded)}`).catch(()=>{});throw error;}}
  async createDirectory(logicalPath:string){await this.#run(`mkdir -- ${posixQuote(logicalPath)}`);}
  async move(logicalPath:string,destination:string){await this.#run(unlessExists(destination,`mv -- ${posixQuote(logicalPath)} ${posixQuote(destination)}`));}
  async trash(logicalPath:string):Promise<{restorePath:string}>{
    const token=randomUUID(),encoded=Buffer.from(logicalPath).toString('base64');
    await this.#run(isolated(`set -eu; source=${posixQuote(logicalPath)}; vault_root="\${XDG_STATE_HOME:-\${HOME:-/tmp}/.local/state}/fngk-atlas/trash"; vault="$vault_root/${token}"; payload="$vault/payload"; mkdir -p -- "$vault_root"; chmod 700 "$vault_root"; [ ! -L "$source" ]; mkdir -- "$vault"; mv -- "$source" "$payload"; if ! printf '%s' ${posixQuote(encoded)} > "$vault/original.b64"; then mv -- "$payload" "$source" 2>/dev/null || true; rmdir -- "$vault" 2>/dev/null || true; exit 1; fi`));
    return {restorePath:`/.atlas-trash/${token}`};
  }
  async restore(restorePath:string){
    const match=/^\/\.atlas-trash\/([0-9a-f]{8}-[0-9a-f-]{27})$/i.exec(path.posix.normalize(restorePath));
    if(!match)throw Object.assign(new Error('Restore requires a recovery token.'),{code:'invalid_trash_record'});
    const token=match[1];
    await this.#run(isolated(`set -eu; vault_root="\${XDG_STATE_HOME:-\${HOME:-/tmp}/.local/state}/fngk-atlas/trash"; vault="$vault_root/${token}"; payload="$vault/payload"; [ -d "$vault" ] && [ ! -L "$vault" ] && [ -e "$payload" ] && [ ! -L "$payload" ] && [ -f "$vault/original.b64" ] && [ ! -L "$vault/original.b64" ]; original="$(base64 -d -- "$vault/original.b64")"; case "$original" in /*) ;; *) exit 1;; esac; [ "$original" != / ] && [ ! -e "$original" ] && [ ! -L "$original" ]; mv -- "$payload" "$original"; rm -f -- "$vault/original.b64"; rmdir -- "$vault"`));
  }
  async remove(logicalPath:string){await this.#run(`rm -rf -- ${posixQuote(logicalPath)}`);}
}
