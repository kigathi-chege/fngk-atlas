import { createHash } from 'node:crypto';
import type { AccessTarget } from '../domain/access.js';
import { OperationResolver } from '../domain/access.js';
import type { TransportEntry } from '../transports/direct.js';
import type { FileTransport } from '../transports/file-transport.js';

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

  #routes(target: AccessTarget, operation: 'list' | 'stat' | 'read' | 'write'): FileTransport[] {
    const routes = this.resolver.resolve(target, operation).filter(value => this.transports.includes(value as FileTransport)) as FileTransport[];
    if (!routes.length) throw Object.assign(new Error(`No route can ${operation} this path.`), { code: 'route_unavailable' });
    return routes;
  }
  #unavailable(operation: string, errors: unknown[]): Error {
    return Object.assign(new Error(`Every available route failed to ${operation} this path.`), { code: 'route_unavailable', causes: errors.map(error => ({ code: (error as { code?: string }).code, message: (error as Error).message })) });
  }

  async list(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, options: { limit?: number; cursor?: string | null } = {}): Promise<FilePage> {
    const limit = Math.min(500, Math.max(1, options.limit ?? 100)), after = cursorName(options.cursor), errors: unknown[] = [];
    for (const route of this.#routes(target, 'list')) try {
      const all = await route.list(target.path), cursorIndex = after ? all.findIndex(item => item.name === after) : -1, values = all.slice(cursorIndex + 1);
      const items = values.slice(0, limit), nextCursor = values.length > limit ? Buffer.from(items.at(-1)!.name).toString('base64url') : null;
      return { items, nextCursor, route };
    } catch (error) { errors.push(error); }
    throw this.#unavailable('list', errors);
  }

  async read(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>) {
    const errors: unknown[] = [];
    for (const route of this.#routes(target, 'read')) try {
      const metadata = await route.stat(target.path);
      if (metadata.size > this.maxReadBytes) return { path: target.path, bytes: metadata.size, tooLarge: true as const, binary: false, fingerprint: undefined, content: undefined, text: undefined, route };
      const content = await route.read(target.path), binary = content.includes(0);
      return { path: target.path, bytes: content.length, tooLarge: false as const, binary, fingerprint: fingerprint(content), content: binary ? content : undefined, text: binary ? undefined : content.toString('utf8'), route };
    } catch (error) { errors.push(error); }
    throw this.#unavailable('read', errors);
  }

  async write(target: Required<Pick<AccessTarget, 'contextId' | 'path'>>, content: Buffer, expectedFingerprint: string) {
    const errors: unknown[] = [];
    for (const route of this.#routes(target, 'write')) try {
      const current = await route.read(target.path), currentFingerprint = fingerprint(current);
      if (currentFingerprint !== expectedFingerprint) throw new FileConflictError('The file changed after it was opened.');
      const metadata = await route.stat(target.path); await route.atomicWrite(target.path, content, metadata.mode);
      return { path: target.path, bytes: content.length, fingerprint: fingerprint(content), route };
    } catch (error) { if (error instanceof FileConflictError) throw error; errors.push(error); }
    throw this.#unavailable('write', errors);
  }
}
