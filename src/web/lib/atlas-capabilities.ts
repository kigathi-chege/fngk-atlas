export interface AtlasCapability {
  id: string;
  title?: string;
  risk?: 'read' | 'write' | 'execute' | 'admin';
  documentationTarget?: string;
  slash?: { command: string; label: string };
}

export interface AtlasSlashCommand { id: string; command: string; label: string; }

/** The chat never infers permissions: it receives the server's scoped allow-list. */
export function authorizedSlashCommands(tools: AtlasCapability[], allowed: Set<string>): AtlasSlashCommand[] {
  return tools.filter(tool => allowed.has(tool.id) && tool.slash)
    .map(tool => ({ id: tool.id, command: tool.slash!.command, label: tool.slash!.label }))
    .sort((left, right) => left.command.localeCompare(right.command));
}

export async function loadAtlasCapabilities(fetcher: typeof fetch = fetch): Promise<AtlasCapability[]> {
  const response = await fetcher('/api/agent-tools', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Atlas tools are unavailable (${response.status}).`);
  const value = await response.json() as { tools?: AtlasCapability[] };
  return Array.isArray(value.tools) ? value.tools : [];
}
