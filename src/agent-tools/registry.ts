import type { AtlasToolDescriptor, AtlasToolId, AtlasToolRisk } from './contracts.js';

type Definition = Omit<AtlasToolDescriptor, 'mcp' | 'slash' | 'command'>;
const definitions: Definition[] = [
  { id: 'atlas.files.list', title: 'List files', risk: 'read', documentationTarget: 'files', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', pattern: '^/' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false } },
  { id: 'atlas.files.read', title: 'Read file', risk: 'read', documentationTarget: 'files', inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string', pattern: '^/' } }, additionalProperties: false } },
  { id: 'atlas.terminal.open', title: 'Open terminal', risk: 'execute', documentationTarget: 'terminals', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { id: 'atlas.terminal.command', title: 'Run terminal command', risk: 'execute', documentationTarget: 'terminals', inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string', minLength: 1, maxLength: 4096 } }, additionalProperties: false } },
  { id: 'atlas.deployment.inspect', title: 'Inspect deployments', risk: 'read', documentationTarget: 'deployments', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { id: 'atlas.ports.list', title: 'List HTTP ports', risk: 'read', documentationTarget: 'live-projects', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { id: 'atlas.device.inspect', title: 'Inspect device', risk: 'read', documentationTarget: 'devices', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
];
function ensure(condition: unknown, message: string, code = 'tool_input_invalid'): asserts condition { if (!condition) throw Object.assign(new Error(message), { code }); }

export class AtlasToolRegistry {
  #tools = new Map<AtlasToolId, AtlasToolDescriptor>(definitions.map(definition => [definition.id, {
    ...definition,
    mcp: { name: definition.id, description: definition.title, inputSchema: definition.inputSchema },
    slash: { command: `/${definition.id.slice('atlas.'.length)}`, label: definition.title },
    command: { id: definition.id, label: definition.title }
  }]));
  list(): AtlasToolDescriptor[] { return [...this.#tools.values()]; }
  describe(id: string): AtlasToolDescriptor | undefined { return this.#tools.get(id as AtlasToolId); }
  validate(id: string, value: unknown): Record<string, unknown> {
    const descriptor = this.describe(id); ensure(descriptor, `Unknown Atlas tool: ${id}`, 'tool_not_found');
    ensure(value && typeof value === 'object' && !Array.isArray(value), 'Tool input must be an object.');
    const input = value as Record<string, unknown>, schema = descriptor.inputSchema as any, properties = schema.properties ?? {};
    for (const key of Object.keys(input)) ensure(key in properties, `Unexpected tool input: ${key}`);
    for (const key of schema.required ?? []) ensure(key in input, `Tool input requires ${key}.`);
    for (const [key, rule] of Object.entries<any>(properties)) {
      const item = input[key]; if (item === undefined) continue;
      if (rule.type === 'string') { ensure(typeof item === 'string', `${key} must be a string.`); const text = item as string; if (rule.pattern === '^/') ensure(text.startsWith('/'), `${key} must be an absolute path.`); if (rule.minLength) ensure(text.length >= rule.minLength, `${key} is too short.`); if (rule.maxLength) ensure(text.length <= rule.maxLength, `${key} is too long.`); }
      if (rule.type === 'integer') { ensure(typeof item === 'number' && Number.isInteger(item) && item >= (rule.minimum ?? -Infinity) && item <= (rule.maximum ?? Infinity), `${key} must be an in-range integer.`); }
    }
    return structuredClone(input);
  }
}
export type { AtlasToolRisk };
