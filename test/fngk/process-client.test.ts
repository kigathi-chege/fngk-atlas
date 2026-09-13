import { once } from 'node:events';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FngkProcessClient, FngkProcessError } from '../../src/fngk/process-client.js';

const fixture = path.resolve('test/fixtures/fngk.mjs');

describe('FngkProcessClient', () => {
  it('probes the installed binary and consumes the secret-free namespace protocol', async () => {
    const client = new FngkProcessClient({ binary: fixture });
    const state = await client.probe('work');
    expect(state).toMatchObject({ binary: fixture, installed: true, compatible: true, version: '1.4.0', profile: 'work', namespaceProtocol: 'fngk.namespace.v1' });
    expect(state.namespace?.devices).toEqual([expect.objectContaining({ id: 'device-1', name: 'kigathi', online: true })]);
  });

  it('reports unsupported protocols without accepting their data', async () => {
    const client = new FngkProcessClient({ binary: fixture, env: { FNGK_FIXTURE_MODE: 'unsupported' } });
    await expect(client.namespace()).rejects.toMatchObject({ code: 'unsupported_protocol' });
    await expect(client.probe()).resolves.toMatchObject({ installed: true, compatible: false, reason: 'unsupported_protocol' });
  });

  it('times out, cancels, and redacts subprocess failures', async () => {
    const timeoutClient = new FngkProcessClient({ binary: fixture, timeoutMs: 30, env: { FNGK_FIXTURE_MODE: 'timeout' } });
    await expect(timeoutClient.namespace()).rejects.toMatchObject({ code: 'timeout' });

    const controller = new AbortController();
    const pending = new FngkProcessClient({ binary: fixture, timeoutMs: 5_000, env: { FNGK_FIXTURE_MODE: 'timeout' } }).namespace(undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });

    const secretClient = new FngkProcessClient({ binary: fixture, env: { FNGK_FIXTURE_MODE: 'secret-error' } });
    const error = await secretClient.namespace().catch(value => value as FngkProcessError);
    expect(error.code).toBe('process_failed');
    expect(error.message).not.toMatch(/operator-secret|browser-secret|terminal-secret/);
  });

  it('opens a typed bidirectional JSONL terminal with safe argv', async () => {
    const client = new FngkProcessClient({ binary: fixture });
    const terminal = client.openTerminal('device name; touch /tmp/nope', { newSession: true, profile: 'work' });
    const [ready] = await once(terminal, 'ready');
    expect(ready).toMatchObject({ protocolVersion: 'fngk.terminal.v1', sessionId: 'session-1' });
    expect(ready.argv).toEqual(['device name; touch /tmp/nope', '--new', '--profile', 'work', '--stdio-json']);

    terminal.sendCommand('npm test', 'run-1');
    const [completed] = await once(terminal, 'command_state');
    expect(completed).toMatchObject({ requestId: 'run-1', status: 'succeeded', exitCode: 0 });
    terminal.resize(140, 42, 'resize-1');
    const [ack] = await once(terminal, 'input_ack');
    expect(ack).toMatchObject({ requestId: 'resize-1' });
    terminal.detach('detach-1');
    await once(terminal, 'close');
  });

  it('lists and invokes native Files bindings without exposing credentials', async () => {
    const client=new FngkProcessClient({binary:fixture});
    await expect(client.fileBindings('work')).resolves.toMatchObject({protocolVersion:'fngk.files.v1',profile:{name:'work'},bindings:[{id:'binding-1',deviceId:'device-1',root:'/workspace'}]});
    const invoked=await client.invokeFileBinding('binding-1','filesystem.list',{path:'.',limit:20},{profile:'work'});
    expect(invoked.output).toMatchObject({input:{path:'.',limit:20},argv:['files','invoke','binding-1','filesystem.list','--json','--profile','work']});
  });
});
