import type { DeviceScope } from '../device-sessions/types.js';

export type AtlasToolRisk = 'read' | 'write' | 'execute' | 'admin';
export type AtlasToolId = `atlas.${string}`;
export interface AtlasToolDescriptor {
  id: AtlasToolId; title: string; risk: AtlasToolRisk; documentationTarget: string;
  inputSchema: Record<string, unknown>;
  mcp: { name: string; description: string; inputSchema: Record<string, unknown> };
  slash: { command: string; label: string };
  command: { id: string; label: string };
}
export interface AtlasToolRequest { toolId: string; input: Record<string, unknown>; scope: DeviceScope; signal?: AbortSignal; }
export interface AtlasToolResult { toolId: AtlasToolId; status: 'succeeded' | 'failed' | 'outcome_unknown'; result: unknown; }
