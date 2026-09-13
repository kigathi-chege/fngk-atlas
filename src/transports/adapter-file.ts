import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { TransportEntry } from './direct.js';
import type { FileSearchMatch, FileSearchOptions, FileStat, FileTransport } from './file-transport.js';

export interface AdapterFileOperations { list(path: string): Promise<TransportEntry[]>; stat(path: string): Promise<FileStat>; read(path: string): Promise<Buffer>; write(path: string, content: Buffer, mode?: number): Promise<void>; search?(path:string,query:string,options?:FileSearchOptions):Promise<FileSearchMatch[]>; createFile?(path:string,content?:Buffer):Promise<void>; createDirectory?(path:string):Promise<void>; move?(path:string,destination:string):Promise<void>; trash?(path:string):Promise<{restorePath?:string}|void>; restore?(path:string):Promise<void>; remove?(path:string):Promise<void> }
export class AdapterFileTransport implements FileTransport {
  readonly kind = 'adapter' as const; readonly observedAt = new Date().toISOString(); readonly available = true; readonly operations: Operation[];
  constructor(readonly id: string, readonly contextId: string, readonly deviceId: string, readonly effectiveIdentity: string, readonly privilege: AccessRoute['privilege'], readonly adapter: AdapterFileOperations, readonly root = '/') {this.operations=['list','stat','read','write',...(adapter.search?['search' as const]:[]),...(adapter.createFile||adapter.createDirectory?['create' as const]:[]),...(adapter.move?['move' as const]:[]),...(adapter.trash?['trash' as const]:[]),...(adapter.restore?['restore' as const]:[]),...(adapter.remove?['delete' as const]:[])];}
  covers(target: AccessTarget): boolean { return target.contextId === this.contextId && Boolean(target.path === this.root || target.path?.startsWith(`${this.root.replace(/\/$/, '')}/`)); }
  list(path: string) { return this.adapter.list(path); } stat(path: string) { return this.adapter.stat(path); } read(path: string) { return this.adapter.read(path); } atomicWrite(path: string, content: Buffer, mode?: number) { return this.adapter.write(path, content, mode); }
  search(path:string,query:string,options?:FileSearchOptions){if(!this.adapter.search)throw Object.assign(new Error('Search is not available.'),{code:'unsupported_operation'});return this.adapter.search(path,query,options)}
  createFile(path:string,content?:Buffer){if(!this.adapter.createFile)throw Object.assign(new Error('Create is not available.'),{code:'unsupported_operation'});return this.adapter.createFile(path,content)}
  createDirectory(path:string){if(!this.adapter.createDirectory)throw Object.assign(new Error('Create is not available.'),{code:'unsupported_operation'});return this.adapter.createDirectory(path)}
  move(path:string,destination:string){if(!this.adapter.move)throw Object.assign(new Error('Move is not available.'),{code:'unsupported_operation'});return this.adapter.move(path,destination)}
  trash(path:string){if(!this.adapter.trash)throw Object.assign(new Error('Trash is not available.'),{code:'unsupported_operation'});return this.adapter.trash(path)}
  restore(path:string){if(!this.adapter.restore)throw Object.assign(new Error('Restore is not available.'),{code:'unsupported_operation'});return this.adapter.restore(path)}
  remove(path:string){if(!this.adapter.remove)throw Object.assign(new Error('Delete is not available.'),{code:'unsupported_operation'});return this.adapter.remove(path)}
}
