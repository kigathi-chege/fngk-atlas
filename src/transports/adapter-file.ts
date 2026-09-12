import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';
import type { TransportEntry } from './direct.js';
import type { FileStat, FileTransport } from './file-transport.js';

export interface AdapterFileOperations { list(path: string): Promise<TransportEntry[]>; stat(path: string): Promise<FileStat>; read(path: string): Promise<Buffer>; write(path: string, content: Buffer, mode?: number): Promise<void> }
export class AdapterFileTransport implements FileTransport {
  readonly kind = 'adapter' as const; readonly observedAt = new Date().toISOString(); readonly available = true; readonly operations: Operation[] = ['list', 'stat', 'read', 'write'];
  constructor(readonly id: string, readonly contextId: string, readonly deviceId: string, readonly effectiveIdentity: string, readonly privilege: AccessRoute['privilege'], readonly adapter: AdapterFileOperations, readonly root = '/') {}
  covers(target: AccessTarget): boolean { return target.contextId === this.contextId && Boolean(target.path === this.root || target.path?.startsWith(`${this.root.replace(/\/$/, '')}/`)); }
  list(path: string) { return this.adapter.list(path); } stat(path: string) { return this.adapter.stat(path); } read(path: string) { return this.adapter.read(path); } atomicWrite(path: string, content: Buffer, mode?: number) { return this.adapter.write(path, content, mode); }
}
