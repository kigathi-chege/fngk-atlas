import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { TransportEntry } from './direct.js';
import type { CommandExecutor } from './terminal-command.js';
import type { FileSearchMatch, FileSearchOptions, FileStat, FileTransport, SafeWriteOptions } from './file-transport.js';
import { VERSION_SLOTS, parseVersionMeta, validSlot, versionKey, type FileVersion, type VersionStore } from '../files/versions.js';
import { compileQuery, grepArguments, lineMatches, pathFilter } from '../files/text-query.js';
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
// Atlas' private state on the Device, alongside the trash vault. Always used
// inside double quotes so the expansion happens on the Device.
const STATE_DIR = '${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}/fngk-atlas';
// sha256 of a file with whichever tool the Device has. Empty output fails the check.
const SHA_FUNCTION = `atlas_sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum < "$1" | cut -d ' ' -f 1; elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 < "$1" | sed 's/^.*= *//'; elif command -v busybox >/dev/null 2>&1; then busybox sha256sum < "$1" | cut -d ' ' -f 1; else return 1; fi; }; atlas_hex() { [ "\${#1}" -eq 64 ] && case "$1" in *[!0-9a-f]*) false;; *) true;; esac; }`;

/** Builds a find test for one glob: `-name` for file-name globs, `-path` otherwise. */
export function findTest(root: string, glob: string): string {
  const value = glob.replace(/\/+$/, '');
  if (!value.includes('/') || /^\*\*\/[^/]*$/.test(value)) return `-name ${posixQuote(value.replace(/^\*\*\//, ''))}`;
  return `-path ${posixQuote(`${root.replace(/\/$/, '')}/${value.replace(/^\.\//, '').replace(/^\*\*\//, '*/').replace(/\*\*/g, '*')}`)}`;
}

interface SafeWriteScript { path: string; staging: string; suffix: string; expected: string; fingerprint: string; mode: string; keep: boolean; key: string }
/** One subshell: resolve, verify, rotate versions, then replace. Exit 73 on a changed file. */
export function safeWriteScript(input: SafeWriteScript): string {
  const rotate = Array.from({ length: VERSION_SLOTS - 1 }, (_, index) => VERSION_SLOTS - 1 - index).map(slot => `if [ -f "$vdir/${slot}" ]; then mv -f -- "$vdir/${slot}" "$vdir/${slot + 1}" || fail 1; mv -f -- "$vdir/${slot}.meta" "$vdir/${slot + 1}.meta" 2>/dev/null || rm -f -- "$vdir/${slot + 1}.meta"; fi`).join('; ');
  return isolated([
    'umask 077', SHA_FUNCTION,
    `target=${posixQuote(input.path)}; enc=${input.staging}; expected=${posixQuote(input.expected)}; incoming=${posixQuote(input.fingerprint)}; tmp=; current=`,
    `fail() { rm -f -- "$enc"; [ -z "$tmp" ] || rm -f -- "$tmp"; exit "$1"; }`,
    // Write through symlinks to the file they resolve to.
    `real=$target; if [ -L "$target" ]; then real=$(readlink -f "$target") && [ -n "$real" ] || fail 1; fi`,
    `if [ -e "$real" ] && [ ! -f "$real" ]; then fail 1; fi`,
    `if [ -n "$expected" ]; then [ -f "$real" ] || fail ${CONFLICT_STATUS}; current=$(atlas_sha "$real"); atlas_hex "$current" || fail 1; [ "$current" = "$expected" ] || fail ${CONFLICT_STATUS}; fi`,
    `dir=$(dirname -- "$real") && base=$(basename -- "$real") || fail 1; tmp="$dir/.$base.atlas-${input.suffix}.tmp"`,
    `base64 -d "$enc" > "$tmp" || fail 1`,
    `links=1; owner=; if [ -f "$real" ]; then mode=$(stat -c %a -- "$real") && owner=$(stat -c %u:%g -- "$real") && links=$(stat -c %h -- "$real") || fail 1; else mode=${posixQuote(input.mode)}; fi`,
    `chmod "$mode" "$tmp" || fail 1`,
    `if [ -n "$owner" ] && [ "$(stat -c %u:%g -- "$tmp")" != "$owner" ]; then chown "$owner" "$tmp" 2>/dev/null || true; fi`,
    ...(input.keep ? [
      `if [ -f "$real" ]; then [ -n "$current" ] || current=$(atlas_sha "$real"); atlas_hex "$current" || fail 1; if [ "$current" != "$incoming" ]; then vroot="${STATE_DIR}/versions"; vdir="$vroot/${input.key}"; mkdir -p -- "$vdir" && chmod 700 "$vroot" "$vdir" || fail 1; rm -f -- "$vdir/${VERSION_SLOTS}" "$vdir/${VERSION_SLOTS}.meta"; ${rotate}; cat -- "$real" > "$vdir/1.tmp" && printf '%s %s %s %s\\n' "$(date +%s)" "$(stat -c %Y -- "$real")" "$(stat -c %s -- "$real")" "$current" > "$vdir/1.meta.tmp" && mv -f -- "$vdir/1.tmp" "$vdir/1" && mv -f -- "$vdir/1.meta.tmp" "$vdir/1.meta" && printf '%s' ${posixQuote(Buffer.from(input.path).toString('base64'))} > "$vdir/path.b64" || fail 1; fi; fi`,
    ] : []),
    // Hardlinked files are rewritten in place so every link sees the change.
    `if [ "$links" -gt 1 ]; then cat -- "$tmp" > "$real" || fail 1; rm -f -- "$tmp"; else mv -f -- "$tmp" "$real" || fail 1; fi`,
    `rm -f -- "$enc"`,
  ].join('; '));
}

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
  async atomicWrite(logicalPath: string, content: Buffer, mode = 0o600): Promise<void> { await this.safeWrite(logicalPath, content, { mode, keepVersions: false }); }
  /**
   * Uploads into the Device's private Atlas state directory, then decodes,
   * verifies and replaces in one subshell: the fingerprint check, version
   * rotation and `mv` run back to back in the same queued command, so no other
   * Atlas write can interleave. Symlinks are written through to their target,
   * the mode (and ownership, where permitted) is preserved, and hardlinked
   * files are rewritten in place rather than replaced.
   */
  async safeWrite(logicalPath: string, content: Buffer, options: SafeWriteOptions = {}): Promise<void> {
    if (!logicalPath.startsWith('/')) throw Object.assign(new Error('Path must be absolute.'), { code: 'invalid_path' });
    if (options.expectedFingerprint !== undefined && !/^[0-9a-f]{64}$/.test(options.expectedFingerprint)) throw Object.assign(new Error('The file changed after it was opened.'), { code: 'file_conflict' });
    const suffix = randomUUID(), staging = `"${STATE_DIR}/staging/${suffix}.b64"`;
    try {
      await this.#run(isolated(`umask 077; mkdir -p -- "${STATE_DIR}/staging" && : > ${staging}`));
      const base64 = content.toString('base64');
      for (let offset = 0; offset < base64.length; offset += 12_000) await this.#run(`printf '%s' ${posixQuote(base64.slice(offset, offset + 12_000))} >> ${staging}`);
      await this.#run(safeWriteScript({ path: logicalPath, staging, suffix, expected: options.expectedFingerprint ?? '', fingerprint: createHash('sha256').update(content).digest('hex'), mode: ((options.mode ?? 0o600) & 0o7777).toString(8), keep: options.keepVersions !== false, key: versionKey(logicalPath) }));
    } catch (error) {
      await this.executor.execute(isolated(`rm -f -- ${staging}`)).catch(() => {});
      if ((error as { code?: string }).code === 'file_conflict') throw Object.assign(new Error('The file changed after it was opened.'), { code: 'file_conflict', exitCode: CONFLICT_STATUS });
      throw error;
    }
  }
  readonly versions: VersionStore = {
    list: async (logicalPath, options = {}) => {
      const directory = `"${STATE_DIR}/versions/${versionKey(logicalPath)}"`;
      const output = await this.#run(isolated(`d=${directory}; for n in ${Array.from({ length: VERSION_SLOTS }, (_, index) => index + 1).join(' ')}; do if [ -f "$d/$n" ] && [ -f "$d/$n.meta" ]; then printf '%s ' "$n"; head -n 1 "$d/$n.meta"; fi; done; true`), options);
      return output.toString('utf8').split('\n').map(line => { const [slot, ...rest] = line.trim().split(' '); return slot ? parseVersionMeta(Number(slot), rest.join(' ')) : undefined; }).filter((value): value is FileVersion => Boolean(value));
    },
    read: async (logicalPath, slot, options = {}) => {
      const file = `"${STATE_DIR}/versions/${versionKey(logicalPath)}/${validSlot(slot)}"`;
      const output = await this.#run(onlyIf(`[ -f ${file} ]`, `base64 ${file} | tr -d '\\n'`), options);
      return Buffer.from(output.toString('utf8').trim(), 'base64');
    },
  };
  async search(logicalPath: string, query: string, options: FileSearchOptions = {}): Promise<FileSearchMatch[]> {
    if(options.signal?.aborted)throw Object.assign(new Error('Filesystem search was cancelled.'),{code:'cancelled'});
    const limit=Math.min(options.filesOnly?5_000:500,Math.max(1,options.limit??200)),mode=options.mode??'all',root=posixQuote(logicalPath),maxDepth=Math.min(32,Math.max(0,options.maxDepth??12)),maxEntries=Math.min(20_000,Math.max(1,options.maxEntries??5_000)),maxFileBytes=Math.min(2*1024*1024,Math.max(1,options.maxFileBytes??1024*1024)),perFile=Math.min(500,Math.max(1,options.maxMatchesPerFile??8));
    const include=options.include??[],exclude=options.exclude??[],accept=pathFilter(include,exclude),relative=(value:string)=>path.posix.relative(logicalPath,value);
    // Prefilter in find (POSIX -name/-path, no grep --include), then apply
    // the exact glob semantics to the results in JS.
    const prune=exclude.length?`\\( ${exclude.map(glob=>findTest(logicalPath,glob)).join(' -o ')} \\) -prune -o `:'',includeTest=include.length?` \\( ${include.map(glob=>findTest(logicalPath,glob)).join(' -o ')} \\)`:'';
    const run=async(command:string)=>{const result=await this.executor.execute(onlyIf(readableDirectory(logicalPath),isolated(command)),{signal:options.signal,timeoutMs:options.filesOnly?30_000:10_000});if(result.exitCode===MISSING_STATUS)throw Object.assign(new Error('The path does not exist or is not readable on the Device.'),{code:'path_not_found',exitCode:result.exitCode});if(result.exitCode!==0)throw Object.assign(new Error(`Remote command failed with exit code ${result.exitCode}.`),{code:'remote_command_failed',exitCode:result.exitCode});return Buffer.from(result.output.toString('utf8').trim(),'base64').toString('utf8')};
    const matches:FileSearchMatch[]=[];
    if(mode!=='content'&&!options.filesOnly){const text=await run(`find -H ${root} -xdev -mindepth 1 -maxdepth ${maxDepth} ${prune}\\( -type d -o -type f \\) -printf '%p\\0%y\\0' | head -z -n ${maxEntries*2} | base64 | tr -d '\\n'`),fields=text.split('\0');fields.pop();for(let index=0;index+1<fields.length&&matches.length<limit;index+=2){const [value,kind]=fields.slice(index,index+2),type=kind==='d'?'directory' as const:'file' as const;if(!accept(relative(value),type))continue;if(path.posix.basename(value).toLocaleLowerCase().includes(query.toLocaleLowerCase()))matches.push({path:value,type});}}
    if(mode==='name'||matches.length>=limit)return matches;
    const textQuery={query,regex:options.regex,wholeWord:options.wholeWord,caseSensitive:options.caseSensitive??true},expression=options.regex||options.wholeWord||options.caseSensitive===false?compileQuery(textQuery):undefined;
    const grep=grepArguments(textQuery).map((arg,index,all)=>index===all.length-1?posixQuote(arg):arg).join(' '),candidates=`find -H ${root} -xdev -mindepth 1 -maxdepth ${maxDepth} ${prune}-type f${includeTest} -size -${maxFileBytes}c -print0 | head -z -n ${maxEntries}`;
    if(options.filesOnly){const script=`grep -lZI ${grep} "$@" 2>/dev/null; status=$?; [ "$status" -eq 0 ] || [ "$status" -eq 1 ]`,text=await run(`${candidates} | xargs -0 -r sh -c ${posixQuote(script)} sh | head -z -n ${limit} | base64 | tr -d '\\n'`);for(const value of text.split('\0'))if(value&&accept(relative(value)))matches.push({path:value,type:'file'});return matches;}
    const script=`grep -ZInH -m ${perFile} ${grep} "$@" 2>/dev/null; status=$?; [ "$status" -eq 0 ] || [ "$status" -eq 1 ]`,text=await run(`${candidates} | xargs -0 -r sh -c ${posixQuote(script)} sh | head -n ${limit*4} | base64 | tr -d '\\n'`);let cursor=0;
    while(cursor<text.length&&matches.length<limit){const nul=text.indexOf('\0',cursor);if(nul<0)break;const value=text.slice(cursor,nul),end=text.indexOf('\n',nul+1),body=text.slice(nul+1,end<0?text.length:end),colon=body.indexOf(':');cursor=end<0?text.length:end+1;if(colon<=0||!accept(relative(value)))continue;const line=Number(body.slice(0,colon)),content=body.slice(colon+1);
      if(!expression){const column=content.indexOf(query);matches.push({path:value,type:'file',line,column:column<0?1:column+1,length:query.length,preview:content.trim().slice(0,240)});continue;}
      for(const hit of lineMatches(content,expression,perFile)){matches.push({path:value,type:'file',line,column:hit.column,length:hit.length,preview:content.trim().slice(0,240)});if(matches.length>=limit)break;}}
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
