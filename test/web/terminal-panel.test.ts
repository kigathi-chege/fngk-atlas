import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
const root=resolve(import.meta.dirname,'../..');
describe('TerminalPanel observability',()=>it('publishes terminal connection lifecycle without recording input or output',async()=>{
 const source=await readFile(resolve(root,'src/web/components/TerminalPanel.svelte'),'utf8');
 expect(source).toContain("import {atlasEvents}");expect(source).toContain("type:'terminal.command'");expect(source).toContain('atlasEvents.resolve(eventId');expect(source).toContain('atlasEvents.fail(eventId');expect(source).not.toContain('bodyBase64});atlasEvents');expect(source).toContain('terminalReady && socket?.readyState === WebSocket.OPEN');expect(source).toContain('terminalReady = true;');expect(source).toContain('function scheduleReconnect()');expect(source).toContain("else if (value.type === 'error')");expect(source).toContain('scheduleReconnect();');
}));
