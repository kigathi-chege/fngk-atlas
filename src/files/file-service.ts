import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AccessTarget } from '../domain/access.js';
import { OperationResolver } from '../domain/access.js';
import type { TransportEntry } from '../transports/direct.js';
import type { FileSearchOptions, FileTransport } from '../transports/file-transport.js';
import type { FileSearchResult } from './name-search.js';

export class FileConflictError extends Error { readonly code = 'file_conflict'; }
export interface FilePage { items: TransportEntry[]; nextCursor: string | null; route: FileTransport }

function fingerprint(content: Uint8Array): string { return createHash('sha256').update(content).digest('hex'); }
function cursorName(cursor?: string | null): string { if (!cursor) return ''; try { return Buffer.from(cursor, 'base64url').toString('utf8'); } catch { return ''; } }
function isCancelled(error: unknown, signal?: AbortSignal): boolean {
  const value = error as { code?: string; name?: string };
  return Boolean(signal?.aborted) || value.code === 'cancelled' || value.name === 'AbortError';
}

export class FileService {
  readonly resolver: OperationResolver;
  readonly maxReadBytes: number;
  constructor(readonly transports: FileTransport[], options: { maxReadBytes?: number } = {}) {
    this.resolver = new OperationResolver(transports); this.maxReadBytes = options.maxReadBytes ?? 2 * 1024 * 1024;
  }

  #routes(target: AccessTarget, operation: 'list' | 'stat' | 'read' | 'write' | 'search' | 'create' | 'move' | 'trash' | 'restore' | 'delete'): FileTransport[] {
    const routes = this.resolver.resolve(target, operation).filter(value => this.transports.includes(value as FileTransport)) as FileTransport[];
    if (!routes.length) throw Object.assign(new Error(`No route can ${operation} this path.`), { code: 'route_unavailable' });
    return routes;
  }
  #unavailable(operation: string, errors: unknown[]): Error {
    const causes = errors.map(error => ({ code: (error as { code?: string }).code, message: (error as Error).message }));
    if (causes.length && causes.every(cause => cause.code === 'path_not_found')) return Object.assign(new Error('The path does not exist or is not readable on the Device.'), { code: 'path_not_found', causes });
    return Object.assign(new Error(`Every available route failed to ${operation} this path.`), { code: 'route_unavailable', causes });
  }
  #target(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>): Required<Pick<AccessTarget, 'contextId' | 'path'>> {
    if (typeof target.path !== 'string' || !target.path.startsWith('/') || target.path.includes('\0')) throw Object.assign(new Error('Path must be an absolute, NUL-free context path.'), { code: 'invalid_path' });
    return { ...target, path: path.posix.normalize(target.path) };
  }

  async list(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}): Promise<FilePage> {
    target = this.#target(target);
    const limit = Math.min(500, Math.max(1, options.limit ?? 100)), after = cursorName(options.cursor), errors: unknown[] = [];
    for (const route of this.#routes(target, 'list')) try {
      const all = await route.list(target.path, { signal: options.signal }), cursorIndex = after ? all.findIndex(item => item.name === after) : -1, values = all.slice(cursorIndex + 1);
      const items = values.slice(0, limit), nextCursor = values.length > limit ? Buffer.from(items.at(-1)!.name).toString('base64url') : null;
      return { items, nextCursor, route };
    } catch (error) { if (isCancelled(error, options.signal)) throw error; errors.push(error); }
    throw this.#unavailable('list', errors);
  }

  async read(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, options: { signal?: AbortSignal } = {}) {
    target = this.#target(target);
    const errors: unknown[] = [];
    for (const route of this.#routes(target, 'read')) try {
      const metadata = await route.stat(target.path, { signal: options.signal });
      if (metadata.size > this.maxReadBytes) return { path: target.path, bytes: metadata.size, limitBytes: this.maxReadBytes, tooLarge: true as const, binary: false, fingerprint: undefined, content: undefined, text: undefined, route };
      const content = await route.read(target.path, { signal: options.signal }), binary = content.includes(0);
      return { path: target.path, bytes: content.length, tooLarge: false as const, binary, fingerprint: fingerprint(content), content: binary ? content : undefined, text: binary ? undefined : content.toString('utf8'), route };
    } catch (error) { if (isCancelled(error, options.signal)) throw error; errors.push(error); }
    throw this.#unavailable('read', errors);
  }

  async stat(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, options: { signal?: AbortSignal } = {}) {
    target = this.#target(target);
    const errors: unknown[] = [];
    for (const route of this.#routes(target, 'stat')) try {
      const value = await route.stat(target.path, { signal: options.signal });
      return { path: target.path, size: Number(value.size), mode: Number(value.mode), route };
    } catch (error) { if (isCancelled(error, options.signal)) throw error; errors.push(error); }
    throw this.#unavailable('stat', errors);
  }

  async write(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, content: Buffer, expectedFingerprint: string, options: { keepVersions?: boolean; signal?: AbortSignal } = {}) {
    target = this.#target(target);
    const errors: unknown[] = [];
    for (const route of this.#routes(target, 'write')) try {
      if (route.safeWrite) {
        // The fingerprint check and version rotation happen on the machine
        // holding the file, in the same step as the replace.
        await route.safeWrite(target.path, content, { expectedFingerprint, keepVersions: options.keepVersions !== false });
      } else {
        const current = await route.read(target.path), currentFingerprint = fingerprint(current);
        if (currentFingerprint !== expectedFingerprint) throw new FileConflictError('The file changed after it was opened.');
        const metadata = await route.stat(target.path); await route.atomicWrite(target.path, content, metadata.mode);
      }
      return { path: target.path, bytes: content.length, fingerprint: fingerprint(content), previousFingerprint: expectedFingerprint, versioned: Boolean(route.safeWrite && route.versions && options.keepVersions !== false), route };
    } catch (error) {
      if (error instanceof FileConflictError) throw error;
      if ((error as { code?: string }).code === 'file_conflict') throw new FileConflictError('The file changed after it was opened.');
      if (isCancelled(error, options.signal)) throw error;
      errors.push(error);
    }
    throw this.#unavailable('write', errors);
  }

  #versionRoutes(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>) { return this.#routes(target, 'write').filter(route => route.versions); }
  /** Previous versions Atlas kept for this path, newest first. */
  async versions(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, options: { signal?: AbortSignal } = {}) {
    target = this.#target(target);
    const errors: unknown[] = [];
    for (const route of this.#versionRoutes(target)) try { return { path: target.path, versions: await route.versions!.list(target.path, options), route }; }
    catch (error) { if (isCancelled(error, options.signal)) throw error; errors.push(error); }
    if (!errors.length) throw Object.assign(new Error('No route keeps file versions for this path.'), { code: 'route_unavailable' });
    throw this.#unavailable('list versions of', errors);
  }
  async readVersion(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, slot: number, options: { signal?: AbortSignal } = {}) {
    target = this.#target(target);
    const errors: unknown[] = [];
    for (const route of this.#versionRoutes(target)) try {
      const listed = (await route.versions!.list(target.path, options)).find(value => value.slot === slot);
      if (!listed) throw Object.assign(new Error('No previous version exists in that slot.'), { code: 'path_not_found' });
      const content = await route.versions!.read(target.path, slot, options), value = fingerprint(content);
      if (value !== listed.fingerprint) throw Object.assign(new Error('The version changed while it was read.'), { code: 'file_conflict' });
      return { path: target.path, slot, version: listed, content, binary: content.includes(0), fingerprint: value, route };
    } catch (error) { if (['file_conflict', 'path_not_found'].includes((error as { code?: string }).code ?? '') || isCancelled(error, options.signal)) throw error; errors.push(error); }
    throw this.#unavailable('read a version of', errors);
  }
  /**
   * Restores a kept version through the safe write, so the content it
   * replaces becomes the newest version in turn. `versionFingerprint` picks
   * the version by content, which survives rotation by concurrent saves.
   */
  async restoreVersion(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, selector: { slot?: number; versionFingerprint?: string }, expectedFingerprint?: string, options: { signal?: AbortSignal } = {}) {
    target = this.#target(target);
    let slot = selector.slot;
    if (selector.versionFingerprint) {
      const listed = (await this.versions(target, options)).versions.find(value => value.fingerprint === selector.versionFingerprint);
      if (!listed) throw Object.assign(new Error('That version is no longer kept.'), { code: 'path_not_found' });
      slot = listed.slot;
    }
    if (!slot) throw Object.assign(new Error('A version slot or fingerprint is required.'), { code: 'invalid_version' });
    const version = await this.readVersion(target, slot, options);
    let expected = expectedFingerprint;
    if (!expected) { const current = await this.read(target, options); if (!current.fingerprint) throw Object.assign(new Error('The current file is too large to restore over.'), { code: 'file_too_large' }); expected = current.fingerprint; }
    const written = await this.write(target, version.content, expected, { signal: options.signal });
    return { ...written, restoredSlot: slot, restoredFingerprint: version.fingerprint };
  }
  #protect(value:string){const normalized=this.#target({contextId:'validation',path:value}).path;if(normalized==='/'||normalized.trim()===''||normalized==='/.atlas-trash'||normalized.startsWith('/.atlas-trash/'))throw Object.assign(new Error('The context root and recovery vault cannot be changed.'),{code:'protected_path'});return normalized;}
  /** Home directory of the first route that knows it; `/` otherwise. */
  async home(target:Pick<AccessTarget,'contextId'>,options:{signal?:AbortSignal}={}):Promise<string>{
    for(const route of this.#routes({contextId:target.contextId,path:'/'},'search'))try{if(!route.home)continue;const value=await route.home(options);if(value.startsWith('/')&&!value.includes('\0'))return path.posix.normalize(value)}catch(error){if(isCancelled(error,options.signal))throw error}
    return '/';
  }
  /**
   * Every route reports the same shape: matches plus whether the search
   * stopped early and why. Adapters that return bare matches are complete.
   */
  async search(target:Required<Pick<AccessTarget,'contextId'|'path'>>,query:string,options:FileSearchOptions={}):Promise<FileSearchResult&{route:FileTransport;root:string}>{
    target=this.#target(target);if(options.signal?.aborted)throw Object.assign(new Error('Filesystem search was cancelled.'),{code:'cancelled'});
    if(!query.trim())return {matches:[],truncated:false,elapsedMs:0,route:this.#routes(target,'search')[0],root:target.path};
    const errors:unknown[]=[],started=Date.now();
    for(const route of this.#routes(target,'search'))try{
      if(!route.search)continue;
      const value=await route.search(target.path,query,{...options,limit:Math.min(options.filesOnly?5_000:500,Math.max(1,options.limit??200)),...(options.maxEntries!==undefined?{maxEntries:Math.min(1_000_000,Math.max(1,options.maxEntries))}:{}),maxDepth:Math.min(64,Math.max(0,options.maxDepth??32))});
      const result:FileSearchResult=Array.isArray(value)?{matches:value,truncated:false,elapsedMs:Date.now()-started}:value;
      return {...result,route,root:target.path};
    }catch(error){if(isCancelled(error,options.signal))throw error;errors.push(error)}
    throw this.#unavailable('search',errors)
  }
  async createFile(target:Required<Pick<AccessTarget,'contextId'|'path'>>,content=Buffer.alloc(0)){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'create'))try{if(!route.createFile)continue;await route.createFile(target.path,content);return {path:target.path,bytes:content.length,fingerprint:fingerprint(content),route};}catch(error){if(['EEXIST','file_conflict'].includes((error as {code?:string}).code??''))throw new FileConflictError('A file already exists at this path.');errors.push(error)}throw this.#unavailable('create',errors)}
  async createDirectory(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'create'))try{if(!route.createDirectory)continue;await route.createDirectory(target.path);return {path:target.path,route};}catch(error){errors.push(error)}throw this.#unavailable('create',errors)}
  async move(target:Required<Pick<AccessTarget,'contextId'|'path'>>,destination:string){target=this.#target(target);target={...target,path:this.#protect(target.path)};destination=this.#protect(destination);const errors:unknown[]=[];for(const route of this.#routes(target,'move'))try{if(!route.move)continue;await route.move(target.path,destination);return {path:target.path,destination,route};}catch(error){if((error as {code?:string}).code==='file_conflict')throw error;errors.push(error)}throw this.#unavailable('move',errors)}
  async trash(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'trash'))try{if(!route.trash)continue;const result=await route.trash(target.path);return {path:target.path,restoreAvailable:Boolean(route.restore&&route.operations.includes('restore')),restorePath:result?.restorePath,route};}catch(error){if(['path_escape','invalid_trash_record','trash_recovery_preserved'].includes((error as {code?:string}).code??''))throw error;errors.push(error)}throw this.#unavailable('trash',errors)}
  async restore(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);const errors:unknown[]=[];for(const route of this.#routes(target,'restore'))try{if(!route.restore)continue;await route.restore(target.path);return {path:target.path,route};}catch(error){if(['path_escape','invalid_trash_record'].includes((error as {code?:string}).code??''))throw error;errors.push(error)}throw this.#unavailable('restore',errors)}
  async remove(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'delete'))try{if(!route.remove)continue;await route.remove(target.path);return {path:target.path,route};}catch(error){errors.push(error)}throw this.#unavailable('delete',errors)}
}
