import { describe, expect, it } from 'vitest';
import { AtlasToolRegistry } from '../../src/agent-tools/registry.js';

describe('AtlasToolRegistry', () => {
  it('projects every descriptor once to MCP, slash, command, and documentation surfaces', () => {
    const registry = new AtlasToolRegistry();
    const tools = registry.list();
    expect(new Set(tools.map(tool => tool.id)).size).toBe(tools.length);
    const files = registry.describe('atlas.files.list');
    expect(files).toMatchObject({ id: 'atlas.files.list', risk: 'read', documentationTarget: 'files' });
    expect(files?.mcp.name).toBe('atlas.files.list');
    expect(files?.slash.command).toBe('/files.list');
    expect(files?.command.id).toBe('atlas.files.list');
  });

  it('rejects unknown tool identifiers and malformed JSON-schema parameters', () => {
    const registry = new AtlasToolRegistry();
    expect(() => registry.validate('shell.exec', {})).toThrow(/unknown/i);
    expect(() => registry.validate('atlas.files.read', { path: 'relative.txt' })).toThrow(/path/i);
    expect(registry.validate('atlas.files.read', { path: '/README.md' })).toEqual({ path: '/README.md' });
  });
});
