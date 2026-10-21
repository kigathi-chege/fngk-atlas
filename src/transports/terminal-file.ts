import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { TransportEntry } from './direct.js';
import type { CommandExecutor } from './terminal-command.js';
import type { FileSearchMatch, FileSearchOptions, FileStat, FileTransport, SafeWriteOptions } from './file-transport.js';
import { VERSION_SLOTS, parseVersionMeta, validSlot, versionKey, type FileVersion, type VersionStore } from '../files/versions.js';
import { compileQuery, grepArguments, lineMatches, pathFilter } from '../files/text-query.js';
import { posixQuote } from './posix.js';
import { DEFAULT_PRUNE_NAMES, NETWORK_FS_TYPES, PSEUDO_FS_TYPES, budgetFor, escapeGlob, isPathQuery, pseudoRootsUnder, rankNameMatches, type FileSearchResult, type SearchStopReason } from '../files/name-search.js';
import { remoteSearchLane } from './search-lane.js';

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

export interface RemoteFindPlan { root: string; maxDepth: number; pruneNames: string[]; prunePaths?: string[]; include: string[]; exclude: string[]; seconds: number }
const CONTENT_TIME_MARK = 'ATLAS_TIME', FILES_TIME_MARK = 'ATLAS_TIME';
// Runs "$@" for at most $1 seconds: timeout(1) where it works (coreutils and
// modern busybox), otherwise a watchdog subshell. stdin goes through fd 6 because dash gives
// a background command /dev/null even with an explicit `<&0`.
const BUDGET_FUNCTION = `atlas_budget() { atlas_s=$1; shift; if command -v timeout >/dev/null 2>&1 && timeout 1 true >/dev/null 2>&1; then timeout "$atlas_s" "$@"; return; fi; exec 6<&0; "$@" <&6 6<&- & atlas_p=$!; exec 6<&-; ( trap 'kill "$atlas_w" 2>/dev/null; exit 0' TERM; sleep "$atlas_s" & atlas_w=$!; wait "$atlas_w"; kill -TERM "$atlas_p" 2>/dev/null ) & atlas_k=$!; wait "$atlas_p"; atlas_r=$?; kill "$atlas_k" 2>/dev/null; wait "$atlas_k" 2>/dev/null; return "$atlas_r"; }`;
// Emits a marker when a budgeted command was stopped by its timer.
const MARK_FUNCTION = `atlas_mark() { case "$1" in 124|137|143) printf "$2";; esac; }`;
const MOUNT_TYPES = [...PSEUDO_FS_TYPES, ...NETWORK_FS_TYPES].map(type => type.replace(/\./g, '\\.')).join('|');
/**
 * Adds `-o -path <mount>` to "$@" for every pseudo or network filesystem
 * mounted below the root. Mount points with escaped characters are skipped.
 * IFS is set to a newline without putting a newline in the command line.
 */
function mountPrunes(root: string): string {
  const pattern = root === '/' ? '/?*' : `${posixQuote(root.replace(/\/+$/, ''))}/?*`;
  return `set --; IFS=$(printf '\\n.'); IFS=\${IFS%.}; for atlas_m in $(awk ${posixQuote(`$3 ~ /^(${MOUNT_TYPES})$/ && $2 !~ /\\\\/ { print $2 }`)} /proc/mounts 2>/dev/null); do case "$atlas_m" in ${pattern}) set -- "$@" -o -path "$atlas_m";; esac; done; unset IFS`;
}
/** Pseudo roots under the root, pruned directory names, user excludes, then the mounts in "$@". */
export function pruneGroup(plan: Pick<RemoteFindPlan, 'root' | 'pruneNames' | 'prunePaths' | 'exclude'>): string {
  const paths = [...new Set([...pseudoRootsUnder(plan.root), ...(plan.prunePaths ?? []).filter(value => value.startsWith('/') && value !== plan.root)])];
  const tests = [...paths.map(value => `-path ${posixQuote(value)}`), ...plan.pruneNames.map(name => `-name ${posixQuote(name)}`), ...plan.exclude.map(glob => findTest(plan.root, glob))];
  // No file name contains '/', so this never matches; it keeps the group valid.
  if (!tests.length) tests.push(`-name '/'`);
  return `\\( ${tests.join(' -o ')} "$@" \\) -prune -o `;
}
/** The find test for a name query: `-iname` on the name, or `-ipath` when the query contains '/'. */
export function nameQueryTest(query: string): string {
  const value = query.trim(), glob = posixQuote(`*${escapeGlob(value)}*`);
  return isPathQuery(value) ? `-ipath ${glob}` : `-iname ${glob}`;
}
/**
 * Name search in one isolated subshell. find does the matching, `head` caps
 * the matches (not the entries visited), and the whole walk is bounded by the
 * time budget. Records are `<type><path>\0\n`; `T\0\n` means the budget ran out.
 * GNU find prints with -printf; busybox find falls back to -exec printf.
 */
export function remoteNameSearchCommand(plan: RemoteFindPlan, query: string, cap: number): string {
  const root = posixQuote(plan.root), start = `find -H ${root} -mindepth 1 -maxdepth ${plan.maxDepth} ${pruneGroup(plan)}`, match = nameQueryTest(query);
  const gnu = `${start}${match} \\( -type d -o -type f -o -type l \\) -printf '%y%p\\0\\n'`;
  // busybox runs no `-exec … +` inside parentheses, so the branches stay ungrouped.
  const portable = `${start}${match} -type d -exec printf 'd%s\\000\\n' {} + -o ${match} \\( -type f -o -type l \\) -exec printf 'f%s\\000\\n' {} +`;
  return isolated(`set -f; ${BUDGET_FUNCTION}; ${MARK_FUNCTION}; ${mountPrunes(plan.root)}; { if find ${root} -maxdepth 0 -printf '' >/dev/null 2>&1; then atlas_budget ${plan.seconds} ${gnu}; else atlas_budget ${plan.seconds} ${portable}; fi 2>/dev/null; atlas_mark "$?" 'T\\000\\n'; } | head -n ${cap} | base64 | tr -d '\\n'`);
}
/**
 * Content search: budgeted find feeds budgeted xargs/grep. The find status is
 * carried out of the pipeline on fd 5 so a timeout marker is written only
 * after grep has finished, never interleaved with its output. GNU grep prints
 * `path\0line:text` with -Z; busybox grep has no -Z, so a per-file loop
 * prints the same records. Files-only records are `path\0\n` either way.
 */
export function remoteContentSearchCommand(plan: RemoteFindPlan, grep: string, options: { maxFileBytes: number; filesOnly: boolean; cap: number; perFile?: number }): string {
  const includeTest = plan.include.length ? ` \\( ${plan.include.map(glob => findTest(plan.root, glob)).join(' -o ')} \\)` : '';
  const candidates = `find -H ${posixQuote(plan.root)} -mindepth 1 -maxdepth ${plan.maxDepth} ${pruneGroup(plan)}-type f${includeTest} -size -${options.maxFileBytes}c -print0`;
  const ok = 'status=$?; [ "$status" -eq 0 ] || [ "$status" -eq 1 ]', perFile = options.perFile ?? 8;
  const [gnu, portable] = options.filesOnly
    ? [`grep -lZI ${grep} "$@" 2>/dev/null | xargs -0 -r printf '%s\\000\\n'; true`, `for f do if grep -q ${grep} "$f" 2>/dev/null; then printf '%s\\000\\n' "$f"; fi; done; true`]
    : [`grep -ZInH -m ${perFile} ${grep} "$@" 2>/dev/null; ${ok}`, `for f do grep -n -m ${perFile} ${grep} "$f" 2>/dev/null | while IFS= read -r l; do printf '%s\\000%s\\n' "$f" "$l"; done; done; true`];
  const mark = options.filesOnly ? `'${FILES_TIME_MARK}\\000\\n'` : `'\\000${CONTENT_TIME_MARK}\\n'`;
  return isolated(`set -f; ${BUDGET_FUNCTION}; ${MARK_FUNCTION}; ${mountPrunes(plan.root)}; if printf 'x\\n' | grep -Z x >/dev/null 2>&1; then atlas_g=${posixQuote(gnu)}; else atlas_g=${posixQuote(portable)}; fi; { atlas_fs=$( { { atlas_budget ${plan.seconds} ${candidates} 2>/dev/null; printf '%s' "$?" >&5; } | atlas_budget ${plan.seconds + 2} xargs -0 -r sh -c "$atlas_g" sh >&4; } 5>&1 ); atlas_xs=$?; atlas_mark "$atlas_fs" ${mark}; atlas_mark "$atlas_xs" ${mark}; } 4>&1 | head -n ${options.cap} | base64 | tr -d '\\n'`);
}
interface SafeWriteScript { path: string; staging: string; suffix: string; expected: string; fingerprint: string; mode: string; keep: boolean; key: string }
/** One subshell: resolve, verify, rotate versions, then replace. Exit 73 on a changed file. */
export function safeWriteScript(input: SafeWriteScript): string {
  const rotate = Array.from({ length: VERSION_SLOTS - 1 }, (_, index) => VERSION_SLOTS - 1 - index).map(slot => `if [ -f "$vdir/${slot}" ]; then mv -f -- "$vdir/${slot}" "$vdir/${slot + 1}" || fail 1; mv -f -- "$vdir/${slot}.meta" "$vdir/${slot + 1}.meta" 2>/dev/null || rm -f -- "$vdir/${slot + 1}.meta"; fi`).join('; ');
  return isolated([
    // A shared shell may carry noclobber or errexit from elsewhere; this
    // subshell must not depend on them.
    'set +C +e', 'umask 077', SHA_FUNCTION,
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
  async home(options: { signal?: AbortSignal } = {}): Promise<string> { const value = (await this.#run(`printf '%s' "\${HOME:-/}"`, options)).toString('utf8').trim(); return value.startsWith('/') ? value : '/'; }
  async search(logicalPath: string, query: string, options: FileSearchOptions = {}): Promise<FileSearchResult> {
    if(options.signal?.aborted)throw Object.assign(new Error('Filesystem search was cancelled.'),{code:'cancelled'});
    const mode=options.mode??'all',kind=mode==='name'?'name':options.filesOnly?'files':'content';
    // One search per Device and kind at a time; see SearchLane.
    return await remoteSearchLane.run(`${this.contextId}\u0000${kind}`,()=>this.#search(logicalPath,query,options),options.signal);
  }
  async #search(logicalPath: string, query: string, options: FileSearchOptions): Promise<FileSearchResult> {
    const started=Date.now(),mode=options.mode??'all',budgetMs=budgetFor(options),seconds=Math.max(1,Math.ceil(budgetMs/1000));
    const limit=Math.min(options.filesOnly?5_000:500,Math.max(1,options.limit??200)),maxDepth=Math.min(64,Math.max(0,options.maxDepth??32)),maxFileBytes=Math.min(2*1024*1024,Math.max(1,options.maxFileBytes??1024*1024)),perFile=Math.min(500,Math.max(1,options.maxMatchesPerFile??8));
    const include=options.include??[],exclude=options.exclude??[],accept=pathFilter(include,exclude),relative=(value:string)=>path.posix.relative(logicalPath,value);
    const plan:RemoteFindPlan={root:logicalPath,maxDepth,pruneNames:options.pruneNames??[...DEFAULT_PRUNE_NAMES],prunePaths:options.prunePaths,exclude,include,seconds};
    const run=async(command:string,timeoutMs:number)=>{const result=await this.executor.execute(onlyIf(readableDirectory(logicalPath),command),{timeoutMs});if(result.exitCode===MISSING_STATUS)throw Object.assign(new Error('The path does not exist or is not readable on the Device.'),{code:'path_not_found',exitCode:result.exitCode});if(result.exitCode!==0)throw Object.assign(new Error(`Remote command failed with exit code ${result.exitCode}.`),{code:'remote_command_failed',exitCode:result.exitCode});return Buffer.from(result.output.toString('utf8').trim(),'base64').toString('utf8')};
    const finish=(matches:FileSearchMatch[],reason?:SearchStopReason):FileSearchResult=>({matches,truncated:Boolean(reason),...(reason?{reason}:{}),elapsedMs:Date.now()-started});
    if(mode!=='content'&&!options.filesOnly){
      const cap=Math.min(5_000,Math.max(500,limit*4)),text=await run(remoteNameSearchCommand(plan,query,cap),(seconds+10)*1000),records=text.split('\0\n');records.pop();
      let timedOut=false;const found:FileSearchMatch[]=[];
      for(const record of records){if(record==='T'){timedOut=true;continue}const kind=record[0],value=record.slice(1),type=kind==='d'?'directory' as const:'file' as const;if(!value.startsWith('/')||!accept(relative(value),type))continue;found.push({path:value,type})}
      const ranked=rankNameMatches(query,found),reason:SearchStopReason|undefined=records.filter(record=>record!=='T').length>=cap||ranked.length>limit?'limit':timedOut?'time':undefined;
      if(mode==='name'||ranked.length>=limit)return finish(ranked.slice(0,limit),reason);
      const content=await this.#content(plan,query,options,{limit:limit-ranked.length,maxFileBytes,perFile,accept,relative,run});
      return finish([...ranked,...content.matches],reason??content.reason);
    }
    const content=await this.#content(plan,query,options,{limit,maxFileBytes,perFile,accept,relative,run});
    return finish(content.matches,content.reason);
  }
  async #content(plan:RemoteFindPlan,query:string,options:FileSearchOptions,input:{limit:number;maxFileBytes:number;perFile:number;accept:ReturnType<typeof pathFilter>;relative:(value:string)=>string;run:(command:string,timeoutMs:number)=>Promise<string>}):Promise<{matches:FileSearchMatch[];reason?:SearchStopReason}>{
    const {limit,maxFileBytes,perFile,accept,relative,run}=input,matches:FileSearchMatch[]=[],timeoutMs=(plan.seconds+15)*1000;
    const textQuery={query,regex:options.regex,wholeWord:options.wholeWord,caseSensitive:options.caseSensitive??true},expression=options.regex||options.wholeWord||options.caseSensitive===false?compileQuery(textQuery):undefined;
    const grep=grepArguments(textQuery).map((arg,index,all)=>index===all.length-1?posixQuote(arg):arg).join(' ');
    if(options.filesOnly){const text=await run(remoteContentSearchCommand(plan,grep,{maxFileBytes,filesOnly:true,cap:limit}),timeoutMs);let timedOut=false,count=0;for(const value of text.split('\0\n')){if(!value)continue;if(value===FILES_TIME_MARK){timedOut=true;continue}count++;if(accept(relative(value)))matches.push({path:value,type:'file'})}return {matches,reason:count>=limit?'limit':timedOut?'time':undefined}}
    const text=await run(remoteContentSearchCommand(plan,grep,{maxFileBytes,filesOnly:false,cap:limit*4,perFile}),timeoutMs);
    let cursor=0,timedOut=false,lines=0;
    while(cursor<text.length){const nul=text.indexOf('\0',cursor);if(nul<0)break;const value=text.slice(cursor,nul),end=text.indexOf('\n',nul+1),body=text.slice(nul+1,end<0?text.length:end),colon=body.indexOf(':');cursor=end<0?text.length:end+1;if(!value&&body===CONTENT_TIME_MARK){timedOut=true;continue}lines++;if(matches.length>=limit||colon<=0||!accept(relative(value)))continue;const line=Number(body.slice(0,colon)),content=body.slice(colon+1);
      if(!expression){const column=content.indexOf(query);matches.push({path:value,type:'file',line,column:column<0?1:column+1,length:query.length,preview:content.trim().slice(0,240)});continue;}
      for(const hit of lineMatches(content,expression,perFile)){matches.push({path:value,type:'file',line,column:hit.column,length:hit.length,preview:content.trim().slice(0,240)});if(matches.length>=limit)break;}}
    return {matches,reason:matches.length>=limit||lines>=limit*4?'limit':timedOut?'time':undefined};
  }
  async createFile(logicalPath:string,content=Buffer.alloc(0)){if(!content.length){await this.#run(unlessExists(logicalPath,isolated(`umask 077; set -C; : > ${posixQuote(logicalPath)}`)));return;}const suffix=randomUUID(),temporary=`${logicalPath}.atlas-${suffix}.tmp`,encoded=`${temporary}.b64`;try{await this.#run(isolated(`umask 077; set -C; : > ${posixQuote(encoded)}`));const base64=content.toString('base64');for(let offset=0;offset<base64.length;offset+=12_000)await this.#run(`printf '%s' ${posixQuote(base64.slice(offset,offset+12_000))} >> ${posixQuote(encoded)}`);await this.#run(unlessExists(logicalPath,isolated(`base64 -d ${posixQuote(encoded)} > ${posixQuote(temporary)} && chmod 600 ${posixQuote(temporary)} && ln -- ${posixQuote(temporary)} ${posixQuote(logicalPath)} && rm -f ${posixQuote(temporary)} ${posixQuote(encoded)}`)));}catch(error){await this.executor.execute(`rm -f ${posixQuote(temporary)} ${posixQuote(encoded)}`).catch(()=>{});throw error;}}
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
