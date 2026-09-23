import {describe,expect,it} from 'vitest';
import {DiagnosticRegistry} from '../../src/diagnostics/registry.js';

describe('diagnostic registry',()=>{
  it('keeps redacted bounded output and emits linked session updates',()=>{
    const registry=new DiagnosticRegistry({outputLimit:24});
    const changed:any[]=[];
    registry.on('changed',value=>changed.push(value));
    const session=registry.create({kind:'live-project',contextId:'device:one',command:'npm start',terminalSessionId:'terminal-1'});
    registry.append(session.id,'stdout','prefix password=secret-token and tail');
    registry.append(session.id,'stderr','Authorization: Bearer operator-secret');
    const current=registry.get(session.id)!;
    expect(current.terminalSessionId).toBe('terminal-1');
    expect(current.stdout).not.toMatch(/secret-token/);
    expect(current.stderr).not.toMatch(/operator-secret/);
    expect(current.stdout.length).toBeLessThanOrEqual(24);
    expect(changed.length).toBeGreaterThanOrEqual(3);
  });
});
