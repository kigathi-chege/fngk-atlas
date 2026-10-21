import { atlasRequestHeaders } from './api.js';
export type AgentReferenceKind = 'device' | 'file' | 'terminal' | 'deployment' | 'port';
export interface AgentReference { kind: AgentReferenceKind; id: string; label: string; }
export interface AgentChatSnapshot { conversationId?: string; cursor?: string; references: AgentReference[]; }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | Map<string, string>;

function read(storage: StorageLike, key: string): string | null {
  return storage instanceof Map ? storage.get(key) ?? null : storage.getItem(key);
}
function write(storage: StorageLike, key: string, value: string): void {
  if (storage instanceof Map) storage.set(key, value); else storage.setItem(key, value);
}
function browserStorage(): StorageLike { try { return localStorage; } catch { return new Map<string, string>(); } }

/** Persists only user-selected context and a resumable cursor; conversation content and credentials stay remote. */
export class AgentChatStore {
  #key: string; #storage: StorageLike; #state: AgentChatSnapshot;
  constructor(input: { scopeKey: string; storage?: StorageLike }) {
    this.#key = `atlas.agent-chat.v1:${input.scopeKey}`; this.#storage = input.storage ?? browserStorage();
    try { this.#state = JSON.parse(read(this.#storage, this.#key) ?? '{}') as AgentChatSnapshot; } catch { this.#state = { references: [] }; }
    this.#state.references = Array.isArray(this.#state.references) ? this.#state.references.slice(0, 20) : [];
  }
  snapshot(): AgentChatSnapshot { return { ...this.#state, references: this.#state.references.map(reference => ({ ...reference })) }; }
  attach(reference: AgentReference): void { if (!this.#state.references.some(item => item.kind === reference.kind && item.id === reference.id)) this.#state.references.push({ ...reference }); this.#save(); }
  removeReference(reference: Pick<AgentReference, 'kind' | 'id'>): void { this.#state.references = this.#state.references.filter(item => item.kind !== reference.kind || item.id !== reference.id); this.#save(); }
  setConversation(conversationId?: string, cursor?: string): void { this.#state = { ...this.#state, conversationId, cursor }; this.#save(); }
  #save(): void { write(this.#storage, this.#key, JSON.stringify(this.#state)); }
}

export type ConversationEvent = { id: string; cursor: string; type: string; conversationId: string; [key: string]: unknown };
export interface ConversationTransport {
  create(input: { engine?: string; references: AgentReference[] }): Promise<{ conversationId: string }>;
  send(conversationId: string, input: { text: string; references: AgentReference[] }): Promise<void>;
  cancel(conversationId: string): Promise<void>;
  steer(conversationId: string, input: { text: string }): Promise<void>;
  stream(conversationId: string, cursor: string | undefined, onEvent: (event: ConversationEvent) => void, onError: (error: Error) => void): () => void;
}

/** Parses a text/event-stream body into named events (`event:`), ignoring comments and heartbeats. */
export async function readServerSentEvents(body: ReadableStream<Uint8Array>, onEvent: (name: string, data: string) => boolean | void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        let name = 'message'; const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;
          const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon), text = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') name = text; else if (field === 'data') data.push(text);
        }
        if (data.length && onEvent(name, data.join('\n')) === false) return;
      }
    }
  } finally { reader.cancel().catch(() => {}); }
}

export function createAtlasConversationTransport(fetcher: typeof fetch = fetch, headers: () => Record<string, string> = atlasRequestHeaders): ConversationTransport {
  const request = async (url: string, method: string, body?: unknown) => {
    const response = await fetcher(url, { method, headers: { ...headers(), 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) { const value = await response.json().catch(() => ({})) as { message?: string }; throw new Error(value.message ?? `Calculator conversation request failed (${response.status}).`); }
    return response.json().catch(() => ({}));
  };
  return {
    async create(input) { const value = await request('/api/agent-chat/conversations', 'POST', input) as { conversationId?: string; session?: { id?: string } }; const conversationId = value.conversationId ?? value.session?.id; if (!conversationId) throw new Error('Calculator did not return a conversation ID.'); return { conversationId }; },
    async send(conversationId, input) { await request(`/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/messages`, 'POST', input); },
    async cancel(conversationId) { await request(`/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/cancel`, 'POST'); },
    async steer(conversationId, input) { await request(`/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/steer`, 'POST', input); },
    // EventSource cannot send headers (the desktop capability) and only
    // surfaces unnamed events, while Calculator names them `conversation` and
    // ends a stream with `terminal`; read the stream with fetch instead.
    stream(conversationId, cursor, onEvent, onError) {
      const controller = new AbortController(), url = new URL(`/api/agent-chat/conversations/${encodeURIComponent(conversationId)}/events`, location.origin);
      if (cursor) url.searchParams.set('cursor', cursor);
      void (async () => {
        const response = await fetcher(url.toString(), { headers: { ...headers(), accept: 'text/event-stream' }, signal: controller.signal });
        if (!response.ok || !response.body) throw new Error(`Calculator event stream returned ${response.status}.`);
        let ended = false;
        await readServerSentEvents(response.body, (name, data) => {
          if (name === 'terminal') { ended = true; return false; }
          if (name !== 'conversation' && name !== 'message') return;
          try { onEvent(JSON.parse(data) as ConversationEvent); } catch { onError(new Error('Calculator returned an invalid conversation event.')); }
        }, controller.signal);
        if (!ended && !controller.signal.aborted) throw new Error('Conversation stream disconnected; Atlas will resume it when the panel is restored.');
      })().catch(error => { if (!controller.signal.aborted) onError(error instanceof Error ? error : new Error(String(error))); });
      return () => controller.abort();
    }
  };
}
