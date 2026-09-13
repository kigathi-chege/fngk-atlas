import { lstat, mkdir, opendir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { FileSearchMatch, FileSearchOptions } from './file-transport.js';

export interface DirectTransportOptions { id: string; contextId: string; root?: string; identity?: string }
export interface TransportEntry { name: string; path: string; type: 'file' | 'directory' | 'symlink' | 'other'; bytes: number; modifiedAt: string; mode: number }

export class DirectTransport implements AccessRoute {
  readonly kind = 'direct' as const;
  readonly id: string;
  readonly contextId: string;
  readonly effectiveIdentity: string;
  readonly privilege: AccessRoute['privilege'];
  readonly observedAt = new Date().toISOString();
  readonly available = true;
  readonly operations: Operation[] = ['list', 'stat', 'read', 'write', 'search', 'create', 'move', 'trash', 'restore', 'delete', 'execute', 'processes', 'containers'];
  readonly root: string;

  constructor(options: DirectTransportOptions) {
    this.id = options.id; this.contextId = options.contextId; this.root = path.resolve(options.root ?? '/');
    this.effectiveIdentity = options.identity ?? (typeof process.getuid === 'function' ? `uid:${process.getuid()}` : process.env.USER ?? 'local');
    this.privilege = typeof process.getuid === 'function' && process.getuid() === 0 ? 'root' : 'user';
  }

  covers(target: AccessTarget): boolean { return target.contextId === this.contextId && Boolean(target.path?.startsWith('/')); }

  resolve(logicalPath: string): string {
    if (!logicalPath.startsWith('/')) throw Object.assign(new Error('Path must be absolute within its execution context.'), { code: 'invalid_path' });
    const resolved = path.resolve(this.root, `.${path.posix.normalize(logicalPath)}`);
    if (this.root !== '/' && resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) throw Object.assign(new Error('Path escapes the route root.'), { code: 'path_escape' });
    return resolved;
  }

  async #ensureContained(real: string): Promise<void> {
    if (this.root === '/') return;
    const canonicalRoot = await realpath(this.root), canonical = await realpath(real);
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) throw Object.assign(new Error('Symlink escapes the route root.'), { code: 'path_escape' });
  }
  async #recoveryVault(): Promise<string> {
    const vault = path.join(this.root, '.atlas-trash');
    try { await mkdir(vault, { recursive: true, mode: 0o700 }); } catch (error) { throw error; }
    const entry = await lstat(vault);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw Object.assign(new Error('Recovery vault must be a real directory.'), { code: 'path_escape' });
    const canonicalRoot = await realpath(this.root), canonicalVault = await realpath(vault);
    if (canonicalVault !== path.join(canonicalRoot, '.atlas-trash')) throw Object.assign(new Error('Recovery vault escapes its route root.'), { code: 'path_escape' });
    return vault;
  }
  async #realChild(parent: string, name: string, expected: 'file' | 'directory'): Promise<string> {
    const candidate = path.join(parent, name), entry = await lstat(candidate);
    if (entry.isSymbolicLink() || (expected === 'file' ? !entry.isFile() : !entry.isDirectory())) throw Object.assign(new Error('Recovery record contains an unsafe path.'), { code: 'invalid_trash_record' });
    const canonicalParent = await realpath(parent), canonical = await realpath(candidate);
    if (canonical !== path.join(canonicalParent, name)) throw Object.assign(new Error('Recovery record escapes its vault.'), { code: 'path_escape' });
    return candidate;
  }

  async list(logicalPath: string): Promise<TransportEntry[]> {
    const resolved = this.resolve(logicalPath); await this.#ensureContained(resolved);
    const names = await readdir(resolved);
    const entries = await Promise.all(names.map(async name => {
      const absolute = path.join(resolved, name), value = await lstat(absolute);
      return { name, path: path.posix.join(logicalPath, name), type: value.isSymbolicLink() ? 'symlink' as const : value.isDirectory() ? 'directory' as const : value.isFile() ? 'file' as const : 'other' as const, bytes: value.size, modifiedAt: value.mtime.toISOString(), mode: value.mode };
    }));
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  async stat(logicalPath: string) { const resolved = this.resolve(logicalPath); await this.#ensureContained(resolved); return stat(resolved); }
  async read(logicalPath: string): Promise<Buffer> { const resolved = this.resolve(logicalPath); await this.#ensureContained(resolved); return readFile(resolved); }

  async atomicWrite(logicalPath: string, content: Buffer, mode?: number): Promise<void> {
    const resolved = this.resolve(logicalPath), parent = path.dirname(resolved); await this.#ensureContained(parent); await mkdir(parent, { recursive: true });
    const temporary = path.join(parent, `.${path.basename(resolved)}.atlas-${randomUUID()}.tmp`);
    try { await writeFile(temporary, content, { mode: mode === undefined ? 0o600 : mode & 0o777 }); await rename(temporary, resolved); }
    finally { await unlink(temporary).catch(() => {}); }
  }

  async search(logicalPath: string, query: string, options: FileSearchOptions = {}): Promise<FileSearchMatch[]> {
    const root = this.resolve(logicalPath); await this.#ensureContained(root);
    const mode = options.mode ?? 'all', limit = Math.min(500, Math.max(1, options.limit ?? 200)), maxFileBytes = Math.min(2 * 1024 * 1024, Math.max(1, options.maxFileBytes ?? 1024 * 1024)), maxEntries = Math.min(20_000, Math.max(1, options.maxEntries ?? 5_000)), maxDepth = Math.min(32, Math.max(0, options.maxDepth ?? 12));
    const cancelled = () => { if (options.signal?.aborted) throw Object.assign(new Error('Filesystem search was cancelled.'), { code: 'cancelled' }); };
    const wanted = query.toLocaleLowerCase(), matches: FileSearchMatch[] = [], queue = [{ path: logicalPath, depth: 0 }]; let examined = 0;
    while (queue.length && matches.length < limit) {
      cancelled(); const current = queue.shift()!;
      const currentRoot = this.resolve(current.path); await this.#ensureContained(currentRoot);
      const directory = await opendir(currentRoot);
      for await (const value of directory) {
        cancelled(); if (examined++ >= maxEntries) return matches;
        const absolute = path.join(currentRoot, value.name), metadata = await lstat(absolute), entry: TransportEntry = { name: value.name, path: path.posix.join(current.path, value.name), type: metadata.isSymbolicLink() ? 'symlink' : metadata.isDirectory() ? 'directory' : metadata.isFile() ? 'file' : 'other', bytes: metadata.size, modifiedAt: metadata.mtime.toISOString(), mode: metadata.mode };
        if (entry.type === 'directory' && current.depth < maxDepth) queue.push({ path: entry.path, depth: current.depth + 1 });
        if (mode !== 'content' && entry.name.toLocaleLowerCase().includes(wanted)) { matches.push({ path: entry.path, type: entry.type === 'directory' ? 'directory' : 'file' }); if (matches.length >= limit) return matches; }
        if (matches.length >= limit || entry.type !== 'file' || mode === 'name' || entry.bytes > maxFileBytes) continue;
        const content = await this.read(entry.path); if (content.length > maxFileBytes || content.includes(0)) continue;
        const lines = content.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length && matches.length < limit; index++) if (lines[index].toLocaleLowerCase().includes(wanted)) matches.push({ path: entry.path, type: 'file', line: index + 1, preview: lines[index].trim().slice(0, 240) });
      }
    }
    return matches;
  }
  async createFile(logicalPath: string, content = Buffer.alloc(0)): Promise<void> { const resolved=this.resolve(logicalPath);await this.#ensureContained(path.dirname(resolved));await writeFile(resolved,content,{flag:'wx',mode:0o600}); }
  async createDirectory(logicalPath: string): Promise<void> { const resolved=this.resolve(logicalPath);await this.#ensureContained(path.dirname(resolved));await mkdir(resolved); }
  async move(logicalPath: string, destination: string): Promise<void> { const source=this.resolve(logicalPath),target=this.resolve(destination);await this.#ensureContained(source);await this.#ensureContained(path.dirname(target));try{await lstat(target);throw Object.assign(new Error('Destination already exists.'),{code:'file_conflict'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await rename(source,target); }
  async trash(logicalPath: string): Promise<{ restorePath: string }> { const source=this.resolve(logicalPath);await this.#ensureContained(source);if((await lstat(source)).isSymbolicLink())throw Object.assign(new Error('Symlinks cannot be moved into the recovery vault.'),{code:'path_escape'});const vaultRoot=await this.#recoveryVault(),token=randomUUID(),vault=path.join(vaultRoot,token),payload=path.join(vault,'payload');await mkdir(vault,{mode:0o700});let moved=false;try{await rename(source,payload);moved=true;await writeFile(path.join(vault,'metadata.json'),JSON.stringify({token,originalPath:logicalPath}),{mode:0o600,flag:'wx'});return {restorePath:path.posix.join('/.atlas-trash',token)};}catch(error){if(moved){try{await rename(payload,source);moved=false;}catch(rollback){throw Object.assign(error as Error,{code:'trash_recovery_preserved',recoveryPath:path.posix.join('/.atlas-trash',token),rollbackMessage:(rollback as Error).message});}}if(!moved)await rm(vault,{recursive:true,force:true});throw error;} }
  async restore(restorePath: string): Promise<void> { const normalized=path.posix.normalize(restorePath),match=/^\/\.atlas-trash\/([0-9a-f]{8}-[0-9a-f-]{27})$/i.exec(normalized);if(!match)throw Object.assign(new Error('Restore requires a recovery token.'),{code:'invalid_trash_record'});const vaultRoot=await this.#recoveryVault(),vault=path.join(vaultRoot,match[1]),vaultEntry=await lstat(vault);if(!vaultEntry.isDirectory()||vaultEntry.isSymbolicLink()||await realpath(vault)!==path.join(await realpath(vaultRoot),match[1]))throw Object.assign(new Error('Recovery token is unsafe.'),{code:'path_escape'});const metadataPath=await this.#realChild(vault,'metadata.json','file'),payloadPath=path.join(vault,'payload'),payloadEntry=await lstat(payloadPath);if(payloadEntry.isSymbolicLink()||(!payloadEntry.isFile()&&!payloadEntry.isDirectory())||await realpath(payloadPath)!==path.join(await realpath(vault),'payload'))throw Object.assign(new Error('Recovery payload is unsafe.'),{code:'path_escape'});let metadata:{token?:unknown;originalPath?:unknown};try{metadata=JSON.parse(await readFile(metadataPath,'utf8')) as {token?:unknown;originalPath?:unknown};}catch{throw Object.assign(new Error('Trash metadata is invalid.'),{code:'invalid_trash_record'});}if(metadata.token!==match[1]||typeof metadata.originalPath!=='string'||!metadata.originalPath.startsWith('/')||path.posix.normalize(metadata.originalPath)==='/'||metadata.originalPath.includes('\0'))throw Object.assign(new Error('Trash metadata is invalid.'),{code:'invalid_trash_record'});const target=this.resolve(metadata.originalPath);await this.#ensureContained(path.dirname(target));try{await lstat(target);throw Object.assign(new Error('Restore destination already exists.'),{code:'file_conflict'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await rename(payloadPath,target);await rm(vault,{recursive:true,force:true}); }
  async remove(logicalPath: string): Promise<void> { const resolved=this.resolve(logicalPath);await this.#ensureContained(resolved);await rm(resolved,{recursive:true}); }
}
