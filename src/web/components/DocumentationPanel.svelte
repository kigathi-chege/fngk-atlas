<script lang="ts">
  import { onMount } from 'svelte';
  import type { AtlasDocumentationAction, AtlasDocumentationTopic, DocumentationTopicId } from '../lib/documentation.js';
  import { atlasDocumentation, findDocumentationTopic, loadDocumentationTopic } from '../lib/documentation.js';
  import './DocumentationPanel.css';

  export let params: Record<string, unknown> = {};

  type MarkdownBlock =
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'list'; items: string[] }
    | { kind: 'code'; text: string };
  type InlinePart = { kind: 'text' | 'code'; text: string } | { kind: 'topic'; text: string; topicId: string };

  let search = '';
  let selectedId = 'workspace';
  let appliedTopic: string | undefined;
  let loadedTopicId = '';
  let markdown = '';
  let loadError = '';
  let mounted = false;

  function requestedTopicId(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  function parseMarkdown(source: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    let paragraph: string[] = [];
    let list: string[] = [];
    let code: string[] = [];
    let inCode = false;
    const flushParagraph = () => { if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') }); paragraph = []; };
    const flushList = () => { if (list.length) blocks.push({ kind: 'list', items: list }); list = []; };
    for (const line of lines) {
      if (line.startsWith('```')) {
        flushParagraph(); flushList();
        if (inCode) { blocks.push({ kind: 'code', text: code.join('\n') }); code = []; }
        inCode = !inCode;
      } else if (inCode) code.push(line);
      else if (!line.trim()) { flushParagraph(); flushList(); }
      else if (/^#{1,3}\s+/.test(line)) { flushParagraph(); flushList(); const match = /^(#{1,3})\s+(.+)$/.exec(line)!; blocks.push({ kind: 'heading', level: match[1].length, text: match[2] }); }
      else if (/^[-*]\s+/.test(line)) { flushParagraph(); list.push(line.replace(/^[-*]\s+/, '')); }
      else paragraph.push(line.trim());
    }
    flushParagraph(); flushList();
    if (inCode) blocks.push({ kind: 'code', text: code.join('\n') });
    return blocks;
  }

  function inlineParts(source: string): InlinePart[] {
    const parts: InlinePart[] = [];
    const matcher = /`([^`]+)`|\[([^\]]+)\]\(atlas-doc:([^)]+)\)/g;
    let end = 0;
    for (const match of source.matchAll(matcher)) {
      if (match.index! > end) parts.push({ kind: 'text', text: source.slice(end, match.index) });
      if (match[1] !== undefined) parts.push({ kind: 'code', text: match[1] });
      else parts.push({ kind: 'topic', text: match[2], topicId: match[3] });
      end = match.index! + match[0].length;
    }
    if (end < source.length) parts.push({ kind: 'text', text: source.slice(end) });
    return parts;
  }

  async function loadSelected(topic: AtlasDocumentationTopic) {
    const currentId = topic.id;
    loadedTopicId = currentId;
    markdown = '';
    loadError = '';
    try {
      const value = await loadDocumentationTopic(currentId);
      if (loadedTopicId === currentId) markdown = value ?? '';
    } catch (error) {
      if (loadedTopicId === currentId) loadError = error instanceof Error ? error.message : 'The bundled article could not be read.';
    }
  }

  function selectTopic(id: string) { selectedId = id; }
  function openAction(action: AtlasDocumentationAction) {
    if (selectedTopic) window.dispatchEvent(new CustomEvent('atlas:open-documentation-action', { detail: { topicId: selectedTopic.id, action } }));
  }

  onMount(() => { mounted = true; });

  $: requestedId = requestedTopicId(params.topicId);
  $: if (requestedId !== appliedTopic) { appliedTopic = requestedId; selectedId = requestedId ?? 'workspace'; }
  $: selectedTopic = findDocumentationTopic(selectedId);
  $: visibleTopics = atlasDocumentation.filter(topic => `${topic.title} ${topic.category} ${topic.summary}`.toLowerCase().includes(search.trim().toLowerCase()));
  $: if (mounted && selectedTopic && selectedTopic.id !== loadedTopicId) void loadSelected(selectedTopic);
  $: blocks = parseMarkdown(markdown);
</script>

<section class="panel documentation-panel" aria-label="Atlas documentation">
  <aside class="documentation-topics" aria-label="Documentation topics">
    <header><strong>Documentation</strong><span>Local guide</span></header>
    <label class="documentation-search"><span class="sr-only">Search documentation</span><input bind:value={search} placeholder="Search guides" /></label>
    <nav aria-label="Atlas guides">
      {#each visibleTopics as topic}
        <button class:active={topic.id === selectedId} aria-current={topic.id === selectedId ? 'page' : undefined} on:click={() => selectTopic(topic.id)}>
          <strong>{topic.title}</strong><span>{topic.category}</span>
        </button>
      {:else}<p class="documentation-empty">No matching guides.</p>{/each}
    </nav>
  </aside>
  <article class="documentation-article">
    {#if !selectedTopic}
      <div class="documentation-unavailable" role="status"><h2>Documentation unavailable</h2><p>This guide is not included in this Atlas build. Choose another topic or reopen documentation from the activity rail.</p><button on:click={() => selectTopic('workspace')}>Open workspace guide</button></div>
    {:else}
      <header class="documentation-article-header"><span>{selectedTopic.category}</span><h1>{selectedTopic.title}</h1><p>{selectedTopic.summary}</p></header>
      {#if selectedTopic.actions.length}<div class="documentation-actions" aria-label="Related tools">{#each selectedTopic.actions as action}<button on:click={() => openAction(action)}>{action.label}</button>{/each}</div>{/if}
      {#if loadError}<div class="documentation-unavailable" role="status"><h2>Documentation unavailable</h2><p>{loadError}</p><button on:click={() => { loadedTopicId = ''; }}>Retry</button></div>
      {:else if !markdown}<p class="documentation-loading">Loading local guide…</p>
      {:else}<div class="documentation-markdown">{#each blocks as block}
        {#if block.kind === 'heading'}<svelte:element this={`h${block.level + 1}`}>{@render Inline(block.text)}</svelte:element>
        {:else if block.kind === 'paragraph'}<p>{@render Inline(block.text)}</p>
        {:else if block.kind === 'list'}<ul>{#each block.items as item}<li>{@render Inline(item)}</li>{/each}</ul>
        {:else}<pre><code>{block.text}</code></pre>{/if}
      {/each}</div>{/if}
    {/if}
  </article>
</section>

{#snippet Inline(source: string)}
  {#each inlineParts(source) as part}
    {#if part.kind === 'code'}<code>{part.text}</code>
    {:else if part.kind === 'topic'}<button class="documentation-link" on:click={() => selectTopic(part.topicId)}>{part.text}</button>
    {:else}{part.text}{/if}
  {/each}
{/snippet}
