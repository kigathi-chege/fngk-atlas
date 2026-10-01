import type { FileService } from '../files/file-service.js';
import type { DeviceScope } from '../device-sessions/types.js';
import type { AtlasToolRequest, AtlasToolResult } from './contracts.js';
import { AtlasToolRegistry } from './registry.js';

type FilesLease = { service: Pick<FileService, 'list' | 'read'>; release(): void };
export class AtlasToolExecutor {
  constructor(private readonly dependencies: { registry: AtlasToolRegistry; resolveScope(scope: DeviceScope, signal?: AbortSignal): Promise<DeviceScope>; acquireFiles(scope: DeviceScope): Promise<FilesLease>; }) {}
  async execute(request: AtlasToolRequest): Promise<AtlasToolResult> {
    const descriptor = this.dependencies.registry.describe(request.toolId);
    if (!descriptor) throw Object.assign(new Error(`Unknown Atlas tool: ${request.toolId}`), { code: 'tool_not_found' });
    const input = this.dependencies.registry.validate(request.toolId, request.input);
    const scope = await this.dependencies.resolveScope(request.scope, request.signal);
    if (JSON.stringify(scope) !== JSON.stringify(request.scope)) throw Object.assign(new Error('The requested scope is not authorized.'), { code: 'device_scope_mismatch' });
    if (descriptor.id === 'atlas.files.list' || descriptor.id === 'atlas.files.read') {
      const lease = await this.dependencies.acquireFiles(scope);
      try {
        const target = { contextId: `device:${scope.deviceId}`, path: String(input.path) };
        const result = descriptor.id === 'atlas.files.list'
          ? await lease.service.list(target, { cursor: typeof input.cursor === 'string' ? input.cursor : null, limit: typeof input.limit === 'number' ? input.limit : undefined, signal: request.signal })
          : await lease.service.read(target, { signal: request.signal });
        return { toolId: descriptor.id, status: 'succeeded', result };
      } finally { lease.release(); }
    }
    throw Object.assign(new Error(`${descriptor.id} is not yet available through the guarded executor.`), { code: 'tool_unavailable' });
  }
}
