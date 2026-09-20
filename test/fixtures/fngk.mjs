#!/usr/bin/env node
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const mode = process.env.FNGK_FIXTURE_MODE ?? 'ok';

if (args[0] === 'version') {
  if (mode === 'missing-version') process.exit(17);
  process.stdout.write('fngk v1.4.0\n');
} else if (args[0] === 'status' && args.includes('--json')) {
  if (mode === 'timeout') setTimeout(() => {}, 60_000);
  else if (mode === 'invalid') process.stdout.write('not json\n');
  else if (mode === 'secret-error') {
    process.stderr.write('Authorization: Bearer operator-secret Cookie: session=browser-secret ticket=terminal-secret\n');
    process.exit(9);
  } else {
    process.stdout.write(JSON.stringify({
      protocolVersion: mode === 'unsupported' ? 'fngk.namespace.v9' : 'fngk.namespace.v1',
      generatedAt: '2026-09-12T12:00:00.000Z',
      profile: { name: args[args.indexOf('--profile') + 1] ?? 'default' },
      devices: [{ id: 'device-1', name: 'kigathi', online: true }],
      connections: [],
      resources: mode === 'database-resource' ? [{ id: 'postgres-resource', deviceId: 'device-1', name: 'PostgreSQL', kind: 'postgres.database', status: 'ready', availability: 'available', capabilities: ['schema.read'], attributes: { host: '127.0.0.1', port: 5432 }, lastObservedAt: '2026-09-12T12:00:00.000Z' }] : [],
      sessions: mode === 'session-list' ? [
        { id: 'session-live', title: 'Live shell', status: 'active', deviceId: 'device-1', deviceName: 'kigathi' },
        { id: 'session-detached', title: 'Detached shell', status: 'detached', deviceId: 'device-1', deviceName: 'kigathi' },
        { id: 'session-archived', title: 'Archived shell', status: 'stopped', deviceId: 'device-1', deviceName: 'kigathi', archivedAt: '2026-09-12T11:00:00.000Z' },
        { id: 'session-other', title: 'Other Device', status: 'active', deviceId: 'device-2', deviceName: 'remote' },
      ] : [],
    }) + '\n');
  }
} else if (args[0] === 'files' && args[1] !== 'invoke' && args.includes('--json')) {
  process.stdout.write(JSON.stringify({protocolVersion:'fngk.files.v1',profile:{name:args[args.indexOf('--profile')+1]??'default'},bindings:[{id:'binding-1',name:'Workspace',resourceId:'resource-1',deviceId:'device-1',deviceName:'kigathi',adapterId:'signal.files',root:'/workspace',readOnly:false,capabilities:['*'],provenance:'adopted'}]})+'\n');
} else if (args[0] === 'files' && args[1] === 'invoke' && args.includes('--json')) {
  let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',value=>raw+=value);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({protocolVersion:'fngk.files.v1',output:{argv:args,input:raw?JSON.parse(raw):{}}})+'\n'));
} else if (args[0] === 'sessions' && args.includes('--json')) {
  process.stdout.write(JSON.stringify({protocolVersion:'fngk.session.v1',action:args[2],result:{id:args[1],title:args[args.indexOf('--title')+1],argv:args}})+'\n');
} else if (args[0] === 'processes' && args[2] === 'logs' && args.includes('--json')) {
  process.stdout.write(JSON.stringify({protocolVersion:'fngk.process.v1',action:'logs',result:{run:{id:'run-1',status:'running'},items:[],nextCursor:7,hasMore:false,argv:args}})+'\n');
} else if (args[0] === 'processes' && ['probe','publish','unpublish'].includes(args[2]) && args.includes('--json')) {
  let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',value=>raw+=value);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({protocolVersion:'fngk.process.v1',action:args[2],result:{argv:args,input:raw?JSON.parse(raw):{},...(args[2]==='publish'?{hostname:'preview.test'}:{ready:true})}})+'\n'));
} else if (args[0] === 'deployments' && args.includes('--json')) {
  let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',value=>raw+=value);process.stdin.on('end',()=>{const action=args[2];const base={argv:args,input:raw?JSON.parse(raw):undefined};const result=action==='create'?{...base,deployment:{id:'deployment-1'},release:{id:'release-1'}}:action==='rollback'?{...base,target:{id:'release-1'}}:action==='inspect'?{...base,deployment:{id:args[1]},releases:[],events:[]}:action==='list'?{...base,deployments:[]}:action==='source-snapshot'?{...base,protocolVersion:'fngk.source.v1',kind:'device-directory',locator:'device-cache:sha256:'+'a'.repeat(64),digest:'sha256:'+'a'.repeat(64),bytes:12,files:1,ignoreFiles:['.gitignore'],createdBy:'user-1',createdAt:'2026-09-18T00:00:00.000Z',verified:true}:action==='secret-key'?{...base,credentialPublicKey:'device-public-key'}:action==='secret-store'?{...base,vaultBindingId:'deployment-vault:reference'}:['approve','execute','cancel','retry','secret-rotate','secret-delete'].includes(action)?base:{...base,release:{id:action==='event'?args[1]:'release-2'}};process.stdout.write(JSON.stringify({protocolVersion:process.env.FNGK_FIXTURE_DEPLOYMENT_PROTOCOL??'fngk.deployment.v1',action,result})+'\n')});
} else if (args[0] === 'resources' && args.includes('--json')) {
  let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',value=>raw+=value);process.stdin.on('end',()=>{const action=args[2],base={argv:args,input:raw?JSON.parse(raw):undefined},result=action==='surface'?{...base,credentialPublicKey:'device-key',manifest:{}}:action==='bindings'?{...base,items:[]}:action==='invoke'?{...base,output:{columns:['datname'],rows:[['postgres']]}}:{...base,id:'binding-1'};process.stdout.write(JSON.stringify({protocolVersion:'fngk.surface.v1',action,result})+'\n')});
} else if (args[0] === 'connections' && args.includes('--json')) {
  let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',value=>raw+=value);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({protocolVersion:'fngk.connection.v1',action:args[2],result:{connectionId:args[1],generated:'generated.test',effective:'generated.test',input:raw?JSON.parse(raw):undefined}})+'\n'));
} else if (args[0] === 'tcp' && args.includes('--stdio-json')) {
  process.stdout.write(mode==='human-tcp'?'Signal TCP relay listening on 127.0.0.1:39153\n':JSON.stringify({protocolVersion:'fngk.tcp.v1',type:'ready',listenHost:'127.0.0.1',listenPort:32123,target:args[1],targetPort:Number(args[2]),argv:args})+'\n');
  setInterval(()=>{},60_000);
} else if (args.includes('--stdio-json')) {
  process.stdout.write(JSON.stringify({ type: 'ready', protocolVersion: 'fngk.terminal.v1', sessionId: 'session-1', argv: args }) + '\n');
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.type === 'command') {
      const frame = message.command.match(/__ATLAS_BEGIN_([A-Za-z0-9_]+)__/i)?.[1];
      const completed = () => process.stdout.write(JSON.stringify({ type: 'command_state', protocolVersion: 'fngk.terminal.v1', requestId: message.requestId, status: 'succeeded', exitCode: 0 }) + '\n');
      if (mode === 'terminal-reordered') completed();
      if (frame) {
        const output = `noise\n__ATLAS_BEGIN_${frame}__\nframed payload\n__ATLAS_END_${frame}__:0\nprompt`;
        process.stdout.write(JSON.stringify({ type: 'output', protocolVersion: 'fngk.terminal.v1', bodyBase64: Buffer.from(mode === 'terminal-crlf' ? output.replaceAll('\n', '\r\n') : output).toString('base64') }) + '\n');
      }
      if (mode !== 'terminal-reordered') completed();
    } else if (message.type === 'mode') {
      process.stdout.write(JSON.stringify({ type: 'collaboration', protocolVersion: 'fngk.terminal.v1', eventType: 'mode', mode: message.mode, requestId: message.requestId }) + '\n');
    } else if (message.type === 'detach') {
      process.stdout.write(JSON.stringify({ type: 'detached', protocolVersion: 'fngk.terminal.v1', requestId: message.requestId }) + '\n');
      process.exit(0);
    } else {
      process.stdout.write(JSON.stringify({ type: 'input_ack', protocolVersion: 'fngk.terminal.v1', requestId: message.requestId }) + '\n');
    }
  });
} else if (args[0] === 'update') {
  process.stdout.write('downloaded\ninstalled\n');
} else {
  process.stderr.write(`unexpected argv: ${JSON.stringify(args)}\n`);
  process.exit(2);
}
