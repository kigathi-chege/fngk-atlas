import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpCalculatorConversationGateway } from '../../src/intelligence/conversation-gateway.js';
import { createApp } from '../../src/server/app.js';
import { FngkProcessClient } from '../../src/fngk/process-client.js';

describe('Calculator conversation gateway', () => {
  it('keeps the Calculator credential server-side while proxying scoped conversation requests', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const gateway = new HttpCalculatorConversationGateway('https://calculator.example', 'secret-token', async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ session: { id: 'conversation-1' } }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    await gateway.create({ engine: 'codex', references: [{ kind: 'device', id: 'device:one', label: 'one' }] });
    expect(calls[0].url).toBe('https://calculator.example/api/integrations/v1/signal-sessions');
    expect(calls[0].init?.headers).toMatchObject({ authorization: 'Bearer secret-token' });
    expect(calls[0].init?.body).toContain('device:one');
  });

  it('exposes configured conversation actions through Atlas without exposing the provider origin', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'atlas-agent-chat-'));
    const calls: string[] = [];
    const gateway = {
      health: async () => ({ available: true }),
      create: async () => ({ session: { id: 'conversation-1' } }),
      message: async (id: string) => (calls.push(`message:${id}`), { accepted: true }),
      cancel: async (id: string) => (calls.push(`cancel:${id}`), { cancelled: true }),
      steer: async (id: string) => (calls.push(`steer:${id}`), { accepted: true }),
      events: async () => new Response('event: conversation\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    };
    const app = await createApp({ fngk: new FngkProcessClient({ binary: path.resolve('test/fixtures/fngk.mjs') }), dbPath: path.join(directory, 'atlas.db'), calculatorConversationGateway: gateway });
    try {
      expect((await app.inject('/api/agent-chat/status')).json()).toMatchObject({ configured: true, health: { available: true } });
      expect((await app.inject({ method: 'POST', url: '/api/agent-chat/conversations', payload: {} })).json()).toMatchObject({ conversationId: 'conversation-1' });
      expect((await app.inject({ method: 'POST', url: '/api/agent-chat/conversations/conversation-1/messages', payload: { text: 'hello' } })).statusCode).toBe(202);
      expect((await app.inject({ method: 'POST', url: '/api/agent-chat/conversations/conversation-1/cancel' })).statusCode).toBe(200);
      expect(calls).toEqual(['message:conversation-1', 'cancel:conversation-1']);
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
