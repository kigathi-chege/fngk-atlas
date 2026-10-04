import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Agent Chat observability', () => {
  it('records tool-grant and revoke outcomes without persisting tool payloads', async () => {
    const source = await readFile(resolve(root, 'src/web/components/AgentChatPanel.svelte'), 'utf8');

    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type: 'agent.tool-grant'");
    expect(source).toContain("type: 'agent.tool-revoke'");
    expect(source).toContain('atlasEvents.begin');
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
    expect(source).not.toContain('metadata: { tool');
  });
});
