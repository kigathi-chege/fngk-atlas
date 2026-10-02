import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentChatStore } from '../../src/web/lib/agent-chat.js';
import { authorizedSlashCommands } from '../../src/web/lib/atlas-capabilities.js';

const root = resolve(import.meta.dirname, '../..');

describe('Atlas Agent Chat', () => {
  it('keeps safe conversation state and references across panel restoration', () => {
    const storage = new Map<string, string>();
    const first = new AgentChatStore({ scopeKey: 'local:device:alpha', storage });
    first.attach({ kind: 'device', id: 'device:alpha', label: 'alpha' });
    first.attach({ kind: 'file', id: '/srv/app.ts', label: 'app.ts' });
    first.setConversation('conversation-1', 'cursor-7');
    const restored = new AgentChatStore({ scopeKey: 'local:device:alpha', storage });
    expect(restored.snapshot()).toMatchObject({ conversationId: 'conversation-1', cursor: 'cursor-7' });
    expect(restored.snapshot().references).toEqual([
      { kind: 'device', id: 'device:alpha', label: 'alpha' },
      { kind: 'file', id: '/srv/app.ts', label: 'app.ts' },
    ]);
  });

  it('projects only active-scope tools as slash commands', () => {
    expect(authorizedSlashCommands([
      { id: 'atlas.files.read', slash: { command: '/files.read', label: 'Read file' } },
      { id: 'atlas.terminal.command', slash: { command: '/terminal.command', label: 'Run command' } },
    ], new Set(['atlas.files.read']))).toEqual([{ id: 'atlas.files.read', command: '/files.read', label: 'Read file' }]);
  });

  it('exposes a dockable panel, launchers, governed approval controls, and documented tool links', async () => {
    const [panel, approval, host, rail, menu, workbench, details] = await Promise.all([
      readFile(resolve(root, 'src/web/components/AgentChatPanel.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/ToolApprovalCard.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/PanelHost.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/ActivityRail.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/AtlasMenu.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/Workbench.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/DetailsPanel.svelte'), 'utf8'),
    ]);
    expect(panel).toContain('Agent Chat');
    expect(panel).toContain('atlas:open-documentation');
    expect(panel).toContain('removeReference');
    expect(panel).toContain('cancel');
    expect(panel).toContain('scope: scope()');
    expect(panel).toContain("decision === 'allow_once' ? 'once'");
    expect(panel).toContain('transport.steer');
    expect(approval).toContain('allow_once');
    expect(approval).toContain('allow_full_access');
    expect(approval).toContain('onRevoke');
    expect(host).toContain("'agent-chat':()=>import('./AgentChatPanel.svelte')");
    expect(rail).toContain('aria-label="Open Agent Chat"');
    expect(menu).toContain("id:'atlas:open-agent-chat'");
    expect(workbench).toContain("atlas:open-agent-chat");
    expect(workbench).toContain("component:'agent-chat'");
    expect(details).toContain('atlas:agent-chat-reference');
  });
});
