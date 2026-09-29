import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AccessTarget } from '../domain/access.js';
import { OperationResolver } from '../domain/access.js';
import type { TransportEntry } from '../transports/direct.js';
import type { FileSearchOptions, FileTransport } from '../transports/file-transport.js';

export class FileConflictError extends Error { readonly code = 'file_conflict'; }
export interface FilePage { items: TransportEntry[]; nextCursor: string | null; route: FileTransport }

function fingerprint(content: Uint8Array): string { return createHash('sha256').update(content).digest('hex'); }
function cursorName(cursor?: string | null): string { if (!cursor) return ''; try { return Buffer.from(cursor, 'base64url').toString('utf8'); } catch { return ''; } }

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
    return Object.assign(new Error(`Every available route failed to ${operation} this path.`), { code: 'route_unavailable', causes: errors.map(error => ({ code: (error as { code?: string }).code, message: (error as Error).message })) });
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
    } catch (error) { errors.push(error); }
    throw this.#unavailable('list', errors);
  }

  async read(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, options: { signal?: AbortSignal } = {}) {
    target = this.#target(target);
    const errors: unknown[] = [];
    for (const route of this.#routes(target, 'read')) try {
      const metadata = await route.stat(target.path, { signal: options.signal });
      if (metadata.size > this.maxReadBytes) return { path: target.path, bytes: metadata.size, tooLarge: true as const, binary: false, fingerprint: undefined, content: undefined, text: undefined, route };
      const content = await route.read(target.path, { signal: options.signal }), binary = content.includes(0);
      return { path: target.path, bytes: content.length, tooLarge: false as const, binary, fingerprint: fingerprint(content), content: binary ? content : undefined, text: binary ? undefined : content.toString('utf8'), route };
    } catch (error) { errors.push(error); }
    throw this.#unavailable('read', errors);
  }

  async write(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, content: Buffer, expectedFingerprint: string) {
    target = this.#target(target);
    const errors: unknown[] = [];
    for (const route of this.#routes(target, 'write')) try {
      const current = await route.read(target.path), currentFingerprint = fingerprint(current);
      if (currentFingerprint !== expectedFingerprint) throw new FileConflictError('The file changed after it was opened.');
      const metadata = await route.stat(target.path); await route.atomicWrite(target.path, content, metadata.mode);
      return { path: target.path, bytes: content.length, fingerprint: fingerprint(content), route };
    } catch (error) { if (error instanceof FileConflictError) throw error; errors.push(error); }
    throw this.#unavailable('write', errors);
  }
  #protect(value:string){const normalized=this.#target({contextId:'validation',path:value}).path;if(normalized==='/'||normalized.trim()===''||normalized==='/.atlas-trash'||normalized.startsWith('/.atlas-trash/'))throw Object.assign(new Error('The context root and recovery vault cannot be changed.'),{code:'protected_path'});return normalized;}
  async search(target:Required<Pick<AccessTarget,'contextId'|'path'>>,query:string,options:FileSearchOptions={}){target=this.#target(target);if(options.signal?.aborted)throw Object.assign(new Error('Filesystem search was cancelled.'),{code:'cancelled'});if(!query.trim())return {matches:[],route:this.#routes(target,'search')[0]};const errors:unknown[]=[];for(const route of this.#routes(target,'search'))try{if(!route.search)continue;return {matches:await route.search(target.path,query,{...options,limit:Math.min(500,Math.max(1,options.limit??200)),maxEntries:Math.min(20_000,Math.max(1,options.maxEntries??5_000)),maxDepth:Math.min(32,Math.max(0,options.maxDepth??12))}),route};}catch(error){if((error as {code?:string}).code==='cancelled')throw error;errors.push(error)}throw this.#unavailable('search',errors)}
  async createFile(target:Required<Pick<AccessTarget,'contextId'|'path'>>,content=Buffer.alloc(0)){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'create'))try{if(!route.createFile)continue;await route.createFile(target.path,content);return {path:target.path,bytes:content.length,fingerprint:fingerprint(content),route};}catch(error){if(['EEXIST','file_conflict'].includes((error as {code?:string}).code??''))throw new FileConflictError('A file already exists at this path.');errors.push(error)}throw this.#unavailable('create',errors)}
  async createDirectory(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'create'))try{if(!route.createDirectory)continue;await route.createDirectory(target.path);return {path:target.path,route};}catch(error){errors.push(error)}throw this.#unavailable('create',errors)}
  async move(target:Required<Pick<AccessTarget,'contextId'|'path'>>,destination:string){target=this.#target(target);target={...target,path:this.#protect(target.path)};destination=this.#protect(destination);const errors:unknown[]=[];for(const route of this.#routes(target,'move'))try{if(!route.move)continue;await route.move(target.path,destination);return {path:target.path,destination,route};}catch(error){if((error as {code?:string}).code==='file_conflict')throw error;errors.push(error)}throw this.#unavailable('move',errors)}
  async trash(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'trash'))try{if(!route.trash)continue;const result=await route.trash(target.path);return {path:target.path,restoreAvailable:Boolean(route.restore&&route.operations.includes('restore')),restorePath:result?.restorePath,route};}catch(error){if(['path_escape','invalid_trash_record','trash_recovery_preserved'].includes((error as {code?:string}).code??''))throw error;errors.push(error)}throw this.#unavailable('trash',errors)}
  async restore(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);const errors:unknown[]=[];for(const route of this.#routes(target,'restore'))try{if(!route.restore)continue;await route.restore(target.path);return {path:target.path,route};}catch(error){if(['path_escape','invalid_trash_record'].includes((error as {code?:string}).code??''))throw error;errors.push(error)}throw this.#unavailable('restore',errors)}
  async remove(target:Required<Pick<AccessTarget,'contextId'|'path'>>){target=this.#target(target);target={...target,path:this.#protect(target.path)};const errors:unknown[]=[];for(const route of this.#routes(target,'delete'))try{if(!route.remove)continue;await route.remove(target.path);return {path:target.path,route};}catch(error){errors.push(error)}throw this.#unavailable('delete',errors)}
}
