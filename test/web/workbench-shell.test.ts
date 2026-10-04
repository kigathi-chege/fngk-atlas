import {describe, expect, it} from 'vitest';
import {isPermanentPanel, isWorkspaceFallbackVisible, shellLayoutVersion} from '../../src/web/lib/workbench-shell.js';

describe('workbench shell contract', () => {
  it('shows the Workspace recovery panel only when no ordinary center panel remains', () => {
    expect(isWorkspaceFallbackVisible([])).toBe(true);
    expect(isWorkspaceFallbackVisible(['file:/srv/a.ts'])).toBe(false);
    expect(isWorkspaceFallbackVisible(['atlas.operations'])).toBe(true);
  });

  it('identifies only retained shell panels as permanent', () => {
    expect(isPermanentPanel('atlas.devices')).toBe(true);
    expect(isPermanentPanel('atlas.inspector')).toBe(true);
    expect(isPermanentPanel('file:/srv/a.ts')).toBe(false);
  });

  it('uses version 8 for the redesigned persisted shell', () => {
    expect(shellLayoutVersion).toBe(8);
  });

  it('hides only the Workspace recovery tab while ordinary center documents exist', async () => {
    const {readFile}=await import('node:fs/promises');
    const {resolve}=await import('node:path');
    const source=await readFile(resolve(import.meta.dirname,'../../src/web/components/Workbench.svelte'),'utf8');
    expect(source).toContain("[data-panel-id=\"atlas.workspace\"]");
    expect(source).toContain("workspaceTab.style.display=showWorkspace?'':'none'");
  });
});
