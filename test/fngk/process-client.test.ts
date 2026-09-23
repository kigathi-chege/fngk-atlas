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

  it('runs terminal lifecycle actions through the installed FNGK profile', async()=>{
    const value=await new FngkProcessClient({binary:fixture}).sessionAction('session-1','rename',{profile:'work',title:'Build shell'});
    expect(value).toMatchObject({protocolVersion:'fngk.session.v1',action:'rename',result:{id:'session-1',title:'Build shell'}});
  });

  it('continues managed process logs from the last consumed sequence',async()=>{
    const value:any=await new FngkProcessClient({binary:fixture}).managedProcessLogs('process-1',{profile:'work',after:7,limit:50});
    expect(value.argv).toEqual(['processes','process-1','logs','--json','--after','7','--limit','50','--profile','work']);
  });

  it('probes and publishes a managed process without opening a terminal',async()=>{
    const value:any=await new FngkProcessClient({binary:fixture}).managedProcessOperation('process-1','probe',{port:8080,protocol:'http',path:'/'},{profile:'work'});
    expect(value).toMatchObject({input:{port:8080,protocol:'http',path:'/'},argv:['processes','process-1','probe','--json','--profile','work']});
  });

  it('uses the retained deployment protocol for plans, releases, events, and rollback',async()=>{
    const client=new FngkProcessClient({binary:fixture});
    const created:any=await client.createDeployment('device-1',{name:'web',repositoryPath:'/srv/web',environment:'production',commitSha:'a'.repeat(40),manifest:{version:'fngk.project.v1'}},{profile:'work'});
    expect(created).toMatchObject({deployment:{id:'deployment-1'},release:{id:'release-1'}});
    const event:any=await client.deploymentEvent('release-1',{event:'health.passed',status:'healthy'},{profile:'work'});
    expect(event.argv).toEqual(['deployments','release-1','event','--json','--profile','work']);
    await expect(client.rollbackDeployment('deployment-1',{profile:'work'})).resolves.toMatchObject({target:{id:'release-1'}});
  });

  it('delegates v2 plan transitions to Signal instead of a terminal',async()=>{
    const client=new FngkProcessClient({binary:fixture,env:{FNGK_FIXTURE_DEPLOYMENT_PROTOCOL:'fngk.deployment.v2'}});
    const value:any=await client.deploymentAction('deployment-1','execute',2,{profile:'work'});
    expect(value).toMatchObject({input:{planRevision:2},argv:['deployments','deployment-1','execute','--json','--profile','work']});
  });

  it('brokers deployment secret envelopes without putting plaintext in argv',async()=>{
    const client=new FngkProcessClient({binary:fixture}),envelope={ephemeralPublicKey:'key',salt:'salt',nonce:'nonce',ciphertext:'ciphertext'};
    await expect(client.deploymentSecretKey('device-1',{profile:'work'})).resolves.toMatchObject({credentialPublicKey:'device-public-key'});
    const stored:any=await client.storeDeploymentSecret('device-1',envelope,{profile:'work'});expect(stored).toMatchObject({vaultBindingId:'deployment-vault:reference',input:{secretEnvelope:envelope}});expect(stored.argv.join(' ')).not.toContain('ciphertext');
    const rotated:any=await client.rotateDeploymentSecret('device-1','deployment-vault:reference',envelope,{profile:'work'});expect(rotated.argv).toEqual(['deployments','device-1','secret-rotate','--json','--binding','deployment-vault:reference','--profile','work']);
  });

  it('requests a verified Device-side source snapshot',async()=>{const value:any=await new FngkProcessClient({binary:fixture}).snapshotDeploymentSource('device-1','/srv/app',{profile:'work'});expect(value).toMatchObject({protocolVersion:'fngk.source.v1',kind:'device-directory',verified:true,input:{path:'/srv/app'},argv:['deployments','device-1','source-snapshot','--json','--profile','work']})});

  it('invokes native Device Surfaces without a relay or sidecar',async()=>{
    const client=new FngkProcessClient({binary:fixture});
    await expect(client.resourceSurface('resource-1',{profile:'work'})).resolves.toMatchObject({credentialPublicKey:'device-key'});
    const value:any=await client.invokeResourceBinding('binding-1',{capability:'database.catalog',input:{section:'databases'}},{profile:'work'});
    expect(value).toMatchObject({output:{rows:[['postgres']]},argv:['resources','binding-1','invoke','--json','--profile','work']});
  });

  it('governs deployment hostnames through the Connection protocol',async()=>{
    const client=new FngkProcessClient({binary:fixture}),domains:any=await client.connectionDomains('connection-1',{profile:'work'}),custom:any=await client.attachConnectionDomain('connection-1','app.example.com',{profile:'work'});
    expect(domains).toMatchObject({connectionId:'connection-1',generated:'generated.test'});expect(custom.input).toEqual({hostname:'app.example.com'});
  });
});
