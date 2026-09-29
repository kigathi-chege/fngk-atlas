import type { AccessRoute } from '../domain/access.js';
import type { TransportEntry } from './direct.js';

export interface FileStat { size: number; mode: number }
export interface FileSearchMatch { path: string; type: 'file' | 'directory'; line?: number; preview?: string }
export interface FileSearchOptions { mode?: 'name' | 'content' | 'all'; limit?: number; maxFileBytes?: number; maxEntries?: number; maxDepth?: number; signal?: AbortSignal }
export interface FileTrashResult { restorePath?: string }
export interface FileTransport extends AccessRoute {
  list(path: string, options?: { signal?: AbortSignal }): Promise<TransportEntry[]>;
  stat(path: string, options?: { signal?: AbortSignal }): Promise<FileStat>;
  read(path: string, options?: { signal?: AbortSignal }): Promise<Buffer>;
  atomicWrite(path: string, content: Buffer, mode?: number): Promise<void>;
  search?(path: string, query: string, options?: FileSearchOptions): Promise<FileSearchMatch[]>;
  createFile?(path: string, content?: Buffer): Promise<void>;
  createDirectory?(path: string): Promise<void>;
  move?(path: string, destination: string): Promise<void>;
  trash?(path: string): Promise<FileTrashResult | void>;
  restore?(restorePath: string): Promise<void>;
  remove?(path: string): Promise<void>;
}
