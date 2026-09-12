import { lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AccessRoute, AccessTarget, Operation } from '../domain/access.js';

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
  readonly operations: Operation[] = ['list', 'stat', 'read', 'write', 'execute', 'processes', 'containers'];
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
}
