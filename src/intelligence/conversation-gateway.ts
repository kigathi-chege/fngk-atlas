export interface CalculatorConversationGateway {
  health(): Promise<{ available: boolean; message?: string }>;
  create(input: { engine?: string; references?: unknown[] }): Promise<unknown>;
  message(conversationId: string, input: unknown): Promise<unknown>;
  cancel(conversationId: string): Promise<unknown>;
  steer(conversationId: string, input: unknown): Promise<unknown>;
  events(conversationId: string, cursor?: string): Promise<Response>;
}

/** Server-only Calculator bridge. Its credential is never serialized into the Atlas renderer. */
export class HttpCalculatorConversationGateway implements CalculatorConversationGateway {
  constructor(private readonly origin: string, private readonly token?: string, private readonly fetcher: typeof fetch = fetch) {}
  #url(path: string): URL { return new URL(path, this.origin); }
  #headers(json = true): HeadersInit { return { accept: json ? 'application/json' : 'text/event-stream', ...(json ? { 'content-type': 'application/json' } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }; }
  async #request(path: string, method = 'GET', body?: unknown): Promise<unknown> { const response = await this.fetcher(this.#url(path), { method, headers: this.#headers(), body: body === undefined ? undefined : JSON.stringify(body) }); if (!response.ok) throw new Error(`Calculator returned ${response.status}.`); return response.json(); }
  async health() { try { const response = await this.fetcher(this.#url('/api/integrations/v1/capabilities'), { headers: this.#headers() }); return response.ok ? { available: true } : { available: false, message: `Calculator returned ${response.status}.` }; } catch (error) { return { available: false, message: (error as Error).message }; } }
  create(input: { engine?: string; references?: unknown[] }) { return this.#request('/api/integrations/v1/signal-sessions', 'POST', { engine: input.engine ?? process.env.ATLAS_CALCULATOR_ENGINE ?? 'codex', references: input.references ?? [] }); }
  message(conversationId: string, input: unknown) { return this.#request(`/api/integrations/v1/signal-sessions/${encodeURIComponent(conversationId)}/messages`, 'POST', input); }
  cancel(conversationId: string) { return this.#request(`/api/integrations/v1/signal-sessions/${encodeURIComponent(conversationId)}/cancel`, 'POST', {}); }
  steer(conversationId: string, input: unknown) { return this.#request(`/api/integrations/v1/signal-sessions/${encodeURIComponent(conversationId)}/steer`, 'POST', input); }
  async events(conversationId: string, cursor?: string) { const url = this.#url(`/api/integrations/v1/conversations/${encodeURIComponent(conversationId)}/events`); if (cursor) url.searchParams.set('cursor', cursor); const response = await this.fetcher(url, { headers: this.#headers(false) }); if (!response.ok || !response.body) throw new Error(`Calculator event stream returned ${response.status}.`); return response; }
}
