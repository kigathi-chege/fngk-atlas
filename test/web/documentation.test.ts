import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atlasDocumentation, documentationTopicIds, findDocumentationTopic, loadDocumentationTopic } from '../../src/web/lib/documentation.js';

describe('Atlas documentation registry', () => {
  it('registers unique local topics with complete metadata', () => {
    expect(documentationTopicIds.length).toBeGreaterThanOrEqual(10);
    expect(new Set(documentationTopicIds).size).toBe(documentationTopicIds.length);
    expect(atlasDocumentation.map(topic => topic.id)).toEqual(documentationTopicIds);
    for (const topic of atlasDocumentation) {
      expect(topic.title.trim()).not.toBe('');
      expect(topic.category.trim()).not.toBe('');
      expect(topic.summary.trim()).not.toBe('');
      expect(topic.relatedPanels.length).toBeGreaterThan(0);
      expect(typeof topic.load).toBe('function');
    }
  });

  it('loads non-empty bundled Markdown for every topic', async () => {
    for (const topic of atlasDocumentation) {
      await expect(loadDocumentationTopic(topic.id)).resolves.toMatch(/\S/);
    }
  });

  it('returns undefined for an unknown topic without throwing', async () => {
    expect(findDocumentationTopic('not-a-topic')).toBeUndefined();
    await expect(loadDocumentationTopic('not-a-topic')).resolves.toBeUndefined();
  });

  it('registers a lazy documentation panel with a recoverable unavailable state', async () => {
    const root = resolve(import.meta.dirname, '../..');
    const host = await readFile(resolve(root, 'src/web/components/PanelHost.svelte'), 'utf8');
    const panel = await readFile(resolve(root, 'src/web/components/DocumentationPanel.svelte'), 'utf8');
    expect(host).toContain("documentation:()=>import('./DocumentationPanel.svelte')");
    expect(panel).toContain('Documentation unavailable');
    expect(panel).toContain('atlas:open-documentation-action');
  });

  it('opens documentation through a validated workbench event instead of the operations dock', async () => {
    const root = resolve(import.meta.dirname, '../..');
    const workbench = await readFile(resolve(root, 'src/web/components/Workbench.svelte'), 'utf8');
    expect(workbench).toContain("const openDocumentation=(event?:Event)=>");
    expect(workbench).toContain("window.addEventListener('atlas:open-documentation',openDocumentation)");
    expect(workbench).toContain("window.addEventListener('atlas:open-documentation-action',openDocumentationAction)");
    expect(workbench).toContain("id='atlas.documentation'");
  });
});
