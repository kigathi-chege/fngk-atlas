import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TerminalSession } from '../../src/fngk/terminal-session.js';

describe('TerminalSession protocol events', () => {
  it('keeps ownership and purpose metadata defaults explicit', async () => {
    const source = await readFile(resolve(import.meta.dirname, '../../src/fngk/terminal-session.ts'), 'utf8');
    expect(source).toContain("export type TerminalOwner = 'atlas-user' | 'atlas-internal'");
    expect(source).toContain("this.owner = options.owner ?? 'atlas-internal'");
    expect(source).toContain("this.purpose = options.purpose ?? 'diagnostic'");
  });

  it('does not treat an FNGK protocol error frame as a fatal transport error', async () => {
    const frame = JSON.stringify({ type: 'error', protocolVersion: 'fngk.terminal.v1', code: 'command_rejected', message: 'The command was rejected.' });
    const terminal = new TerminalSession({ binary: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(`${frame}\n`)}); setTimeout(() => process.exit(0), 20);`], env: process.env });
    const protocolErrors: any[] = [], transportErrors: Error[] = [];
    terminal.on('terminal_error', event => protocolErrors.push(event));
    terminal.on('error', error => transportErrors.push(error));
    await once(terminal, 'close');
    expect(protocolErrors).toEqual([expect.objectContaining({ code: 'command_rejected', message: 'The command was rejected.' })]);
    expect(transportErrors).toEqual([]);
  });
});
