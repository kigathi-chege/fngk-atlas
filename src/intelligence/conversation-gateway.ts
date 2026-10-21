export interface CalculatorConversationGateway {
  health(): Promise<{ available: boolean; message?: string }>;
  create(input: { engine?: string; references?: unknown[] }): Promise<unknown>;
  message(conversationId: string, input: unknown): Promise<unknown>;
  cancel(conversationId: string): Promise<unknown>;
  steer(conversationId: string, input: unknown): Promise<unknown>;
  events(conversationId: string, cursor?: string): Promise<Response>;
}

/** Calculator's own error code and message, with its HTTP status, instead of a bare status line. */
export async function calculatorError(response: Response): Promise<Error & { code: string; status: number }> {
  const value = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown; message?: unknown };
  const code = typeof value.code === 'string' ? value.code : typeof value.error === 'string' ? value.error : 'calculator_request_failed';
  const message = typeof value.message === 'string' ? value.message : `Calculator returned ${response.status}.`;
  return Object.assign(new Error(message), { code, status: response.status });
}

/**
 * Atlas references describe objects Calculator cannot see (Devices, files,
 * terminals, deployments, ports). Calculator accepts them as client-supplied
 * `external` references, kept apart from its own authorized ones.
 */
export function externalReferences(references: unknown[] = []): unknown[] {
  return (Array.isArray(references) ? references : []).map(value => {
    const reference = value as { type?: unknown; kind?: unknown; id?: unknown; label?: unknown };
    if (reference?.type) return reference;
    return { type: 'external', source: 'atlas', kind: String(reference?.kind ?? ''), id: String(reference?.id ?? ''), label: String(reference?.label ?? reference?.id ?? '') };
  });
}

/** Server-only Calculator bridge. Its credential is never serialized into the Atlas renderer. */
export class HttpCalculatorConversationGateway implements CalculatorConversationGateway {
  constructor(private readonly origin: string, private readonly token?: string, private readonly fetcher: typeof fetch = fetch) {}
  #url(path: string): URL { return new URL(path, this.origin); }
  #headers(json = true): HeadersInit { return { accept: json ? 'application/json' : 'text/event-stream', ...(json ? { 'content-type': 'application/json' } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }; }
  async #request(path: string, method = 'GET', body?: unknown): Promise<unknown> { const response = await this.fetcher(this.#url(path), { method, headers: this.#headers(), body: body === undefined ? undefined : JSON.stringify(body) }); if (!response.ok) throw await calculatorError(response); return response.json(); }
  async health() { try { const response = await this.fetcher(this.#url('/api/integrations/v1/capabilities'), { headers: this.#headers() }); return response.ok ? { available: true } : { available: false, message: `Calculator returned ${response.status}.` }; } catch (error) { return { available: false, message: (error as Error).message }; } }
  create(input: { engine?: string; references?: unknown[] }) { return this.#request('/api/integrations/v1/signal-sessions', 'POST', { engine: input.engine ?? process.env.ATLAS_CALCULATOR_ENGINE ?? 'codex', references: externalReferences(input.references) }); }
  message(conversationId: string, input: unknown) { const value = (input ?? {}) as { references?: unknown[] }; return this.#request(`/api/integrations/v1/signal-sessions/${encodeURIComponent(conversationId)}/messages`, 'POST', { ...value, references: externalReferences(value.references) }); }
  cancel(conversationId: string) { return this.#request(`/api/integrations/v1/signal-sessions/${encodeURIComponent(conversationId)}/cancel`, 'POST', {}); }
  steer(conversationId: string, input: unknown) { return this.#request(`/api/integrations/v1/signal-sessions/${encodeURIComponent(conversationId)}/steer`, 'POST', input); }
  async events(conversationId: string, cursor?: string) { const url = this.#url(`/api/integrations/v1/conversations/${encodeURIComponent(conversationId)}/events`); if (cursor) url.searchParams.set('cursor', cursor); const response = await this.fetcher(url, { headers: this.#headers(false) }); if (!response.ok || !response.body) throw await calculatorError(response); return response; }
}
