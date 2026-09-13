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
      sessions: [],
    }) + '\n');
  }
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
