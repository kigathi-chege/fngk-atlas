import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAtlasConversationTransport, readServerSentEvents } from '../../src/web/lib/agent-chat.js';

const stream = (...chunks: string[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });

afterEach(() => vi.unstubAllGlobals());

describe('Agent Chat transport', () => {
  it('parses named server-sent events split across chunks and skips heartbeats', async () => {
    const seen: Array<[string, string]> = [];
    await readServerSentEvents(stream(': heartbeat\n\nevent: conversation\ndata: {"id":"e1"', '}\n\nevent: terminal\r\ndata: {"reason":"closed"}\r\n\r\n'), (name, data) => { seen.push([name, data]); });
    expect(seen).toEqual([['conversation', '{"id":"e1"}'], ['terminal', '{"reason":"closed"}']]);
  });

  it('delivers Calculator conversation events, ends on terminal, and sends Atlas headers', async () => {
    vi.stubGlobal('location', { origin: 'http://atlas.test' });
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(stream('event: conversation\ndata: {"id":"e1","cursor":"c1","type":"message.delta","conversationId":"s1"}\n\n', 'event: terminal\ndata: {"reason":"closed"}\n\n'));
    }) as unknown as typeof fetch;
    const transport = createAtlasConversationTransport(fetcher, () => ({ 'x-atlas-capability': 'launch-secret' }));
    const events: unknown[] = [], errors: Error[] = [];
    transport.stream('s1', 'c0', event => events.push(event), error => errors.push(error));
    await vi.waitFor(() => expect(events).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(events[0]).toMatchObject({ id: 'e1', type: 'message.delta' });
    expect(errors).toEqual([]);
    expect(requests[0]).toMatchObject({ url: 'http://atlas.test/api/agent-chat/conversations/s1/events?cursor=c0', headers: { 'x-atlas-capability': 'launch-secret', accept: 'text/event-stream' } });
  });

  it('reports a stream that ends without a terminal event so the panel can resume it', async () => {
    vi.stubGlobal('location', { origin: 'http://atlas.test' });
    const transport = createAtlasConversationTransport((async () => new Response(stream('event: conversation\ndata: {"id":"e1"}\n\n'))) as unknown as typeof fetch, () => ({}));
    const errors: Error[] = [];
    transport.stream('s1', undefined, () => {}, error => errors.push(error));
    await vi.waitFor(() => expect(errors[0]?.message).toMatch(/disconnected/));
  });

  it('sends JSON requests with Atlas headers', async () => {
    const calls: RequestInit[] = [];
    const transport = createAtlasConversationTransport((async (_url: string, init?: RequestInit) => { calls.push(init!); return new Response('{"conversationId":"s9"}'); }) as unknown as typeof fetch, () => ({ 'x-atlas-profile': 'local' }));
    await expect(transport.create({ references: [] })).resolves.toEqual({ conversationId: 's9' });
    expect(calls[0].headers).toMatchObject({ 'x-atlas-profile': 'local', 'content-type': 'application/json' });
  });
});
