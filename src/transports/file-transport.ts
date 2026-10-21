import type { AccessRoute } from '../domain/access.js';
import type { TransportEntry } from './direct.js';
import type { VersionStore } from '../files/versions.js';

export interface FileStat { size: number; mode: number }
export interface FileSearchMatch { path: string; type: 'file' | 'directory'; line?: number; column?: number; length?: number; preview?: string }
export interface FileSearchOptions {
  mode?: 'name' | 'content' | 'all'; limit?: number; maxFileBytes?: number; maxEntries?: number; maxDepth?: number; signal?: AbortSignal;
  /** Content matching. Unset keeps each transport's historical default. */
  caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean;
  /** Root-relative globs; a glob without `/` matches file names. */
  include?: string[]; exclude?: string[];
  /** Content mode: return each matching file once, without lines. */
  filesOnly?: boolean; maxMatchesPerFile?: number;
}
export interface SafeWriteOptions {
  /** sha256 the file must still have, checked immediately before the replace. */
  expectedFingerprint?: string;
  /** Mode for a file that does not exist yet; existing files keep theirs. */
  mode?: number;
  /** Rotate previous versions (default true). */
  keepVersions?: boolean;
}
export interface FileTrashResult { restorePath?: string }
export interface FileTransport extends AccessRoute {
  list(path: string, options?: { signal?: AbortSignal }): Promise<TransportEntry[]>;
  stat(path: string, options?: { signal?: AbortSignal }): Promise<FileStat>;
  read(path: string, options?: { signal?: AbortSignal }): Promise<Buffer>;
  atomicWrite(path: string, content: Buffer, mode?: number): Promise<void>;
  /** Fingerprint-guarded write through symlinks, preserving mode and hardlinks, with version rotation. */
  safeWrite?(path: string, content: Buffer, options?: SafeWriteOptions): Promise<void>;
  readonly versions?: VersionStore;
  search?(path: string, query: string, options?: FileSearchOptions): Promise<FileSearchMatch[]>;
  createFile?(path: string, content?: Buffer): Promise<void>;
  createDirectory?(path: string): Promise<void>;
  move?(path: string, destination: string): Promise<void>;
  trash?(path: string): Promise<FileTrashResult | void>;
  restore?(restorePath: string): Promise<void>;
  remove?(path: string): Promise<void>;
}
