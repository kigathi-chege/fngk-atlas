import { describe, expect, it } from 'vitest';
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
});
