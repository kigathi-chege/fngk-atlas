import { chmod, chown, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { FileSearchOptions, SafeWriteOptions } from './file-transport.js';
import type { FileSearchResult } from '../files/name-search.js';
import { directSearch } from './direct-search.js';
import { VERSION_SLOTS, formatVersionMeta, parseVersionMeta, validSlot, versionKey, type FileVersion, type VersionStore } from '../files/versions.js';

const sha256 = (content: Uint8Array) => createHash('sha256').update(content).digest('hex');
const conflict = () => Object.assign(new Error('The file changed after it was opened.'), { code: 'file_conflict' });

export interface DirectTransportOptions { id: string; contextId: string; root?: string; identity?: string; recoveryRoot?:string; versionsRoot?:string }
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
  readonly recoveryRoot:string;
  readonly versionsRoot:string;
  #writes=new Map<string,Promise<unknown>>();

  constructor(options: DirectTransportOptions) {
    this.id = options.id; this.contextId = options.contextId; this.root = path.resolve(options.root ?? '/');
    this.recoveryRoot=path.resolve(options.recoveryRoot??(this.root==='/'?path.join(process.env.XDG_STATE_HOME??path.join(homedir(),'.local','state'),'fngk-atlas','trash'):path.join(this.root,'.atlas-trash')));
    // Versions live in Atlas' state directory, never inside the browsed root.
    this.versionsRoot=path.resolve(options.versionsRoot??path.join(process.env.XDG_STATE_HOME??path.join(homedir(),'.local','state'),'fngk-atlas','versions'));
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
    const vault = this.recoveryRoot;
    try { await mkdir(vault, { recursive: true, mode: 0o700 }); } catch (error) { throw error; }
    const entry = await lstat(vault);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw Object.assign(new Error('Recovery vault must be a real directory.'), { code: 'path_escape' });
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

  async atomicWrite(logicalPath: string, content: Buffer, mode?: number): Promise<void> { await this.safeWrite(logicalPath, content, { mode, keepVersions: false }); }

  /**
   * Same guarantees as the terminal route: writes are serialized per target in
   * this process, the fingerprint is checked immediately before the replace,
   * symlinks are written through, mode and hardlinks are preserved, and the
   * previous content is rotated into the version vault first.
   */
  async safeWrite(logicalPath: string, content: Buffer, options: SafeWriteOptions = {}): Promise<void> {
    const resolved = this.resolve(logicalPath);
    let real = resolved;
    try { if ((await lstat(resolved)).isSymbolicLink()) real = await realpath(resolved); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; if (options.expectedFingerprint !== undefined) throw conflict(); }
    const parent = path.dirname(real); await mkdir(parent, { recursive: true }); await this.#ensureContained(parent);
    const previous = this.#writes.get(real) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.#replace(logicalPath, real, content, options));
    this.#writes.set(real, current);
    try { await current; } finally { if (this.#writes.get(real) === current) this.#writes.delete(real); }
  }

  async #replace(logicalPath: string, real: string, content: Buffer, options: SafeWriteOptions) {
    let existing: Buffer | undefined, metadata: import("node:fs").Stats | undefined;
    try { metadata = await stat(real); if (!metadata.isFile()) throw Object.assign(new Error('Only regular files can be written.'), { code: 'invalid_path' }); existing = await readFile(real); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (options.expectedFingerprint !== undefined && (!existing || sha256(existing) !== options.expectedFingerprint)) throw conflict();
    const temporary = path.join(path.dirname(real), `.${path.basename(real)}.atlas-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await chmod(temporary, metadata ? metadata.mode & 0o7777 : (options.mode ?? 0o600) & 0o7777);
      if (metadata && typeof process.getuid === 'function' && process.getuid() === 0) await chown(temporary, metadata.uid, metadata.gid).catch(() => {});
      if (existing && metadata && options.keepVersions !== false) await this.#rotate(this.resolve(logicalPath), existing, metadata.mtime, content);
      // Re-check right before the replace: anything that changed the file
      // while the temporary was prepared must surface as a conflict.
      if (options.expectedFingerprint !== undefined && metadata) { const now = await stat(real).catch(() => undefined); if (!now || now.ino !== metadata.ino || now.size !== metadata.size || now.mtimeMs !== metadata.mtimeMs) { if (!now || sha256(await readFile(real)) !== options.expectedFingerprint) throw conflict(); } }
      if (metadata && metadata.nlink > 1) { await writeFile(real, content); return; }
      await rename(temporary, real);
    } finally { await unlink(temporary).catch(() => {}); }
  }

  async #versionDirectory(resolved: string, create: boolean) {
    const directory = path.join(this.versionsRoot, versionKey(resolved));
    if (create) { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(this.versionsRoot, 0o700).catch(() => {}); }
    const entry = await lstat(directory).catch(() => undefined);
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw Object.assign(new Error('Version vault must be a real directory.'), { code: 'path_escape' });
    return entry ? directory : undefined;
  }

  async #rotate(resolved: string, previous: Buffer, modifiedAt: Date, next: Buffer) {
    const fingerprint = sha256(previous); if (fingerprint === sha256(next)) return;
    const directory = (await this.#versionDirectory(resolved, true))!;
    await rm(path.join(directory, String(VERSION_SLOTS)), { force: true }); await rm(path.join(directory, `${VERSION_SLOTS}.meta`), { force: true });
    for (let slot = VERSION_SLOTS - 1; slot >= 1; slot--) {
      try { await rename(path.join(directory, String(slot)), path.join(directory, String(slot + 1))); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      await rename(path.join(directory, `${slot}.meta`), path.join(directory, `${slot + 1}.meta`)).catch(() => rm(path.join(directory, `${slot + 1}.meta`), { force: true }));
    }
    await writeFile(path.join(directory, '1.tmp'), previous, { mode: 0o600 }); await rename(path.join(directory, '1.tmp'), path.join(directory, '1'));
    await writeFile(path.join(directory, '1.meta.tmp'), formatVersionMeta(new Date(), modifiedAt, previous.length, fingerprint), { mode: 0o600 }); await rename(path.join(directory, '1.meta.tmp'), path.join(directory, '1.meta'));
    await writeFile(path.join(directory, 'path.b64'), Buffer.from(resolved).toString('base64'), { mode: 0o600 });
  }

  readonly versions: VersionStore = {
    list: async logicalPath => {
      const directory = await this.#versionDirectory(this.resolve(logicalPath), false); if (!directory) return [];
      const values: FileVersion[] = [];
      for (let slot = 1; slot <= VERSION_SLOTS; slot++) {
        try { await lstat(path.join(directory, String(slot))); const value = parseVersionMeta(slot, await readFile(path.join(directory, `${slot}.meta`), 'utf8')); if (value) values.push(value); } catch {}
      }
      return values;
    },
    read: async (logicalPath, slot) => {
      const directory = await this.#versionDirectory(this.resolve(logicalPath), false);
      if (!directory) throw Object.assign(new Error('No previous version exists.'), { code: 'path_not_found' });
      try { return await readFile(path.join(directory, String(validSlot(slot)))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Object.assign(new Error('No previous version exists.'), { code: 'path_not_found' }); throw error; }
    },
  };

  async home(): Promise<string> {
    const home = path.resolve(homedir());
    if (this.root === '/') return home;
    return home === this.root ? '/' : home.startsWith(`${this.root}${path.sep}`) ? `/${path.relative(this.root, home).split(path.sep).join('/')}` : '/';
  }
  async search(logicalPath: string, query: string, options: FileSearchOptions = {}): Promise<FileSearchResult> {
    const root = this.resolve(logicalPath); await this.#ensureContained(root);
    return await directSearch({ root, logicalRoot: logicalPath, query, options, contained: this.root === '/' ? undefined : absolute => this.#ensureContained(absolute) });
  }
  async createFile(logicalPath: string, content = Buffer.alloc(0)): Promise<void> { const resolved=this.resolve(logicalPath);await this.#ensureContained(path.dirname(resolved));await writeFile(resolved,content,{flag:'wx',mode:0o600}); }
  async createDirectory(logicalPath: string): Promise<void> { const resolved=this.resolve(logicalPath);await this.#ensureContained(path.dirname(resolved));await mkdir(resolved); }
  async move(logicalPath: string, destination: string): Promise<void> { const source=this.resolve(logicalPath),target=this.resolve(destination);await this.#ensureContained(source);await this.#ensureContained(path.dirname(target));try{await lstat(target);throw Object.assign(new Error('Destination already exists.'),{code:'file_conflict'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await rename(source,target); }
  async trash(logicalPath: string): Promise<{ restorePath: string }> {
    const source=this.resolve(logicalPath); await this.#ensureContained(source);
    if((await lstat(source)).isSymbolicLink())throw Object.assign(new Error('Symlinks cannot be moved into the recovery vault.'),{code:'path_escape'});
    const vaultRoot=await this.#recoveryVault(),token=randomUUID(),vault=path.join(vaultRoot,token),payload=path.join(vault,'payload');
    await mkdir(vault,{mode:0o700}); let moved=false,copied=false;
    try {
      try { await rename(source,payload); moved=true; }
      catch(error){
        if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;
        await cp(source,payload,{recursive:true,preserveTimestamps:true,errorOnExist:true,force:false}); copied=true;
      }
      await writeFile(path.join(vault,'metadata.json'),JSON.stringify({token,originalPath:logicalPath}),{mode:0o600,flag:'wx'});
      if(copied){
        try { await rm(source,{recursive:true}); }
        catch(error){throw Object.assign(error as Error,{code:'trash_recovery_preserved',recoveryPath:path.posix.join('/.atlas-trash',token)});}
      }
      return {restorePath:path.posix.join('/.atlas-trash',token)};
    } catch(error) {
      if(moved){
        try{await rename(payload,source);moved=false;}
        catch(rollback){throw Object.assign(error as Error,{code:'trash_recovery_preserved',recoveryPath:path.posix.join('/.atlas-trash',token),rollbackMessage:(rollback as Error).message});}
      }
      if(copied&&(error as {code?:string}).code!=='trash_recovery_preserved')await rm(payload,{recursive:true,force:true}).catch(()=>{});
      if(!moved&&(error as {code?:string}).code!=='trash_recovery_preserved')await rm(vault,{recursive:true,force:true});
      throw error;
    }
  }
  async restore(restorePath: string): Promise<void> { const normalized=path.posix.normalize(restorePath),match=/^\/\.atlas-trash\/([0-9a-f]{8}-[0-9a-f-]{27})$/i.exec(normalized);if(!match)throw Object.assign(new Error('Restore requires a recovery token.'),{code:'invalid_trash_record'});const vaultRoot=await this.#recoveryVault(),vault=path.join(vaultRoot,match[1]),vaultEntry=await lstat(vault);if(!vaultEntry.isDirectory()||vaultEntry.isSymbolicLink()||await realpath(vault)!==path.join(await realpath(vaultRoot),match[1]))throw Object.assign(new Error('Recovery token is unsafe.'),{code:'path_escape'});const metadataPath=await this.#realChild(vault,'metadata.json','file'),payloadPath=path.join(vault,'payload'),payloadEntry=await lstat(payloadPath);if(payloadEntry.isSymbolicLink()||(!payloadEntry.isFile()&&!payloadEntry.isDirectory())||await realpath(payloadPath)!==path.join(await realpath(vault),'payload'))throw Object.assign(new Error('Recovery payload is unsafe.'),{code:'path_escape'});let metadata:{token?:unknown;originalPath?:unknown};try{metadata=JSON.parse(await readFile(metadataPath,'utf8')) as {token?:unknown;originalPath?:unknown};}catch{throw Object.assign(new Error('Trash metadata is invalid.'),{code:'invalid_trash_record'});}if(metadata.token!==match[1]||typeof metadata.originalPath!=='string'||!metadata.originalPath.startsWith('/')||path.posix.normalize(metadata.originalPath)==='/'||metadata.originalPath.includes('\0'))throw Object.assign(new Error('Trash metadata is invalid.'),{code:'invalid_trash_record'});const target=this.resolve(metadata.originalPath);await this.#ensureContained(path.dirname(target));try{await lstat(target);throw Object.assign(new Error('Restore destination already exists.'),{code:'file_conflict'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await rename(payloadPath,target);await rm(vault,{recursive:true,force:true}); }
  async remove(logicalPath: string): Promise<void> { const resolved=this.resolve(logicalPath);await this.#ensureContained(resolved);await rm(resolved,{recursive:true}); }
}
