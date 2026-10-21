import { constants } from 'node:fs';
import { lstat, open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Dirent, Stats } from 'node:fs';
import type { FileSearchMatch, FileSearchOptions } from './file-transport.js';
import { DEFAULT_PRUNE_NAMES, SEARCH_OPERATION_TIMEOUT_MS, budgetFor, nameMatches, prunedMounts, pseudoRootsUnder, rankNameMatches, type FileSearchResult, type SearchStopReason } from '../files/name-search.js';
import { compileQuery, lineMatches, pathFilter } from '../files/text-query.js';

/**
 * Local filesystem search with the same rules as the remote find: pseudo
 * filesystems and pruned names are never entered, only regular non-empty
 * files are read, every filesystem call has a timeout, and the walk stops at
 * its time budget. Nothing here can block the server on a FIFO, a /proc file
 * or a stalled mount.
 */

export interface DirectSearchInput {
  /** Host path of the search root. */
  root: string;
  /** Context path of the search root, used in results. */
  logicalRoot: string;
  query: string;
  options: FileSearchOptions;
  /** Confines symlinked directories for a non-/ route root. */
  contained?: (absolute: string) => Promise<void>;
}

class Stalled extends Error { readonly code = 'search_stalled'; }
/** Resolves the operation or rejects after `ms`; the operation's late result is dropped. */
async function bounded<T>(operation: Promise<T>, ms = SEARCH_OPERATION_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  operation.catch(() => {});
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Stalled('A filesystem call stalled.')), ms); timer.unref(); })]); }
  finally { clearTimeout(timer); }
}

let mountCache: { at: number; text: string } | undefined;
async function mounts(): Promise<string> {
  if (mountCache && Date.now() - mountCache.at < 30_000) return mountCache.text;
  const text = await bounded(readFile('/proc/self/mounts', 'utf8'), 1_000).catch(() => '');
  mountCache = { at: Date.now(), text }; return text;
}
/** Directories that stalled once are skipped by later searches in this process. */
const stalledDirectories = new Set<string>();

const typeOf = (entry: Dirent | Stats): 'directory' | 'file' | 'symlink' | 'other' | undefined => entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isFIFO() || entry.isSocket() || entry.isCharacterDevice() || entry.isBlockDevice() ? 'other' : undefined;

/** Reads a regular file without ever blocking: O_NONBLOCK, fstat check, bounded read. */
async function readRegular(absolute: string, maxBytes: number): Promise<Buffer | undefined> {
  const handle = await bounded(open(absolute, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)));
  try {
    const metadata = await bounded(handle.stat());
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > maxBytes) return undefined;
    const buffer = Buffer.alloc(metadata.size);
    const { bytesRead } = await bounded(handle.read(buffer, 0, metadata.size, 0));
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close().catch(() => {}); }
}

export async function directSearch(input: DirectSearchInput): Promise<FileSearchResult> {
  const { options, query } = input, started = Date.now(), budgetMs = budgetFor(options), deadline = started + budgetMs;
  const mode = options.mode ?? 'all', names = mode !== 'content' && !options.filesOnly, contents = mode !== 'name';
  const limit = options.filesOnly ? Math.min(5_000, Math.max(1, options.limit ?? 200)) : Math.min(500, Math.max(1, options.limit ?? 200));
  const maxFileBytes = Math.min(2 * 1024 * 1024, Math.max(1, options.maxFileBytes ?? 1024 * 1024)), maxEntries = Math.min(1_000_000, Math.max(1, options.maxEntries ?? 1_000_000)), maxDepth = Math.min(64, Math.max(0, options.maxDepth ?? 32));
  const perFile = Math.min(500, Math.max(1, options.maxMatchesPerFile ?? 500)), nameCap = Math.min(5_000, Math.max(500, limit * 4));
  const accept = pathFilter(options.include ?? [], options.exclude ?? []), relative = (value: string) => path.posix.relative(input.logicalRoot, value);
  const pruneNames = new Set(options.pruneNames ?? DEFAULT_PRUNE_NAMES);
  const hostRoot = input.root, toHost = (logical: string) => path.join(hostRoot, path.posix.relative(input.logicalRoot, logical));
  const prunedPaths = new Set([...pseudoRootsUnder(hostRoot), ...prunedMounts(await mounts(), hostRoot), ...(options.prunePaths ?? []).filter(value => value.startsWith('/')).map(toHost)]);
  const expression = contents && (options.regex || options.wholeWord || options.caseSensitive !== undefined) ? compileQuery({ query, regex: options.regex, wholeWord: options.wholeWord, caseSensitive: options.caseSensitive }) : undefined;
  const wanted = query.toLocaleLowerCase();
  const nameHits: FileSearchMatch[] = [], contentHits: FileSearchMatch[] = [];
  let examined = 0, reason: SearchStopReason | undefined;
  const cancelled = () => { if (options.signal?.aborted) throw Object.assign(new Error('Filesystem search was cancelled.'), { code: 'cancelled' }); };
  const full = () => (names ? nameHits.length >= nameCap : false) || (contents && !names ? contentHits.length >= limit : false);
  const queue: Array<{ absolute: string; logical: string; depth: number }> = [{ absolute: hostRoot, logical: input.logicalRoot, depth: 0 }];
  // Breadth first, so shallow results arrive before the budget runs out.
  walk: while (queue.length) {
    cancelled();
    if (Date.now() >= deadline) { reason = 'time'; break; }
    const current = queue.shift()!;
    if (stalledDirectories.has(current.absolute)) continue;
    // One bounded call per directory: a stalled mount costs one timeout, not one per entry.
    let entries: Dirent[];
    try { if (current.depth > 0) await input.contained?.(current.absolute); entries = await bounded(readdir(current.absolute, { withFileTypes: true })); }
    catch (error) { if (error instanceof Stalled) { stalledDirectories.add(current.absolute); reason ??= 'stalled'; } continue; }
    {
      for (const [index, entry] of entries.entries()) {
        if ((index & 255) === 0) { cancelled(); if (Date.now() >= deadline) { reason = 'time'; break walk; } }
        if (examined++ >= maxEntries) { reason = 'entries'; break walk; }
        const absolute = path.join(current.absolute, entry.name), logical = path.posix.join(current.logical, entry.name);
        let type = typeOf(entry), size: number | undefined;
        if (!type) { try { const metadata = await bounded(lstat(absolute)); type = typeOf(metadata); size = metadata.size; } catch { continue; } }
        if (type === 'directory' && (pruneNames.has(entry.name) || prunedPaths.has(absolute))) continue;
        const kind = type === 'directory' ? 'directory' as const : 'file' as const;
        if (!accept(relative(logical), kind)) continue;
        if (type === 'directory' && current.depth < maxDepth) queue.push({ absolute, logical, depth: current.depth + 1 });
        if (names && type !== 'other' && nameMatches(query, entry.name, logical)) { nameHits.push({ path: logical, type: kind }); if (nameHits.length >= nameCap) { reason = 'limit'; break walk; } }
        // Only regular files are ever opened: never FIFOs, sockets, devices or symlinks.
        if (!contents || type !== 'file' || contentHits.length >= limit) continue;
        if (size === undefined) { try { const metadata = await bounded(lstat(absolute)); if (!metadata.isFile()) continue; size = metadata.size; } catch { continue; } }
        // Zero-size files have no content, and pseudo files report zero while blocking on read.
        if (size === 0 || size > maxFileBytes) continue;
        if (Date.now() >= deadline) { reason = 'time'; break walk; }
        let content: Buffer | undefined;
        try { content = await readRegular(absolute, maxFileBytes); } catch (error) { if (error instanceof Stalled) reason ??= 'stalled'; continue; }
        if (!content || content.includes(0)) continue;
        const lines = content.toString('utf8').split(/\r?\n/);
        if (options.filesOnly) { if (expression ? lines.some(line => lineMatches(line, expression, 1).length) : lines.some(line => line.toLocaleLowerCase().includes(wanted))) contentHits.push({ path: logical, type: 'file' }); }
        else for (let index = 0, found = 0; index < lines.length && contentHits.length < limit && found < perFile; index++) {
          if (!expression) { const column = lines[index].toLocaleLowerCase().indexOf(wanted); if (column >= 0) { found++; contentHits.push({ path: logical, type: 'file', line: index + 1, column: column + 1, length: query.length, preview: lines[index].trim().slice(0, 240) }); } continue; }
          for (const hit of lineMatches(lines[index], expression, perFile - found)) { found++; contentHits.push({ path: logical, type: 'file', line: index + 1, column: hit.column, length: hit.length, preview: lines[index].trim().slice(0, 240) }); if (contentHits.length >= limit) break; }
        }
        if (contentHits.length >= limit) { reason ??= 'limit'; if (!names || full()) break walk; }
      }
    }
  }
  const ranked = rankNameMatches(query, nameHits);
  if (ranked.length > limit) reason ??= 'limit';
  const matches = [...ranked.slice(0, limit), ...contentHits].slice(0, limit);
  if (names && contents && ranked.length + contentHits.length > limit) reason ??= 'limit';
  return { matches, truncated: Boolean(reason), ...(reason ? { reason } : {}), examined, elapsedMs: Date.now() - started };
}
