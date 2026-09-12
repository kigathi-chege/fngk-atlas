import type { AccessRoute } from '../domain/access.js';
import type { TransportEntry } from './direct.js';

export interface FileStat { size: number; mode: number }
export interface FileTransport extends AccessRoute {
  list(path: string): Promise<TransportEntry[]>;
  stat(path: string): Promise<FileStat>;
  read(path: string): Promise<Buffer>;
  atomicWrite(path: string, content: Buffer, mode?: number): Promise<void>;
}
