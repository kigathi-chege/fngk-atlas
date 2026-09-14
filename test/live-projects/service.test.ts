import {EventEmitter} from 'node:events';import {describe,expect,it,vi} from 'vitest';import {LiveProjectService} from '../../src/live-projects/service.js';import {DiagnosticRegistry} from '../../src/diagnostics/registry.js';

class TerminalDouble extends EventEmitter {
  constructor(readonly sessionId='terminal-1'){super()}
  commands:Array<{command:string;requestId?:string}>=[];stops:string[]=[];interrupts:string[]=[];
  setMode(){queueMicrotask(()=>this.emit('event',{type:'collaboration',mode:'queue'}));return true}
  sendCommand(command:string,requestId?:string){this.commands.push({command,requestId});queueMicrotask(()=>this.emit('event',{type:'command_state',requestId,status:'running'}));return true}
  stop(requestId?:string){this.stops.push(requestId??'');queueMicrotask(()=>this.emit('close',{}));return true}
  interrupt(requestId?:string){this.interrupts.push(requestId??'');return true}
}

class ManagementTerminal extends TerminalDouble {
  constructor(sessionId:string,readonly failure=false){super(sessionId)}
  sendCommand(command:string,requestId?:string){
    this.commands.push({command,requestId});
    const frame=command.match(/__ATLAS_BEGIN_([A-Za-z0-9_]+)__/i)?.[1];
    const body=this.failure?'relay failed':command.includes('fngk help')?'  fngk publish <port> [--json]                 Publish through the machine daemon\n  fngk unpublish <port> [--json]               Stop one published Device target':command.includes('unpublish')?JSON.stringify({protocolVersion:'fngk.publish.v1',type:'unpublished'}):JSON.stringify({protocolVersion:'fngk.publish.v1',type:'published',connectionId:'connection-1',hostname:'preview.example.test'});
    queueMicrotask(()=>{this.emit('event',{type:'output',bodyBase64:Buffer.from(`__ATLAS_BEGIN_${frame}__\n${body}\n__ATLAS_END_${frame}__:${this.failure?1:0}\n`).toString('base64')});this.emit('event',{type:'command_state',requestId,status:this.failure?'failed':'succeeded',exitCode:this.failure?1:0})});return true;
  }
}

describe('live project lifecycle',()=>{
  it('runs visibly in a Device terminal and publishes and releases through FNGK',async()=>{
    const terminal=new TerminalDouble(),restartedTerminal=new TerminalDouble('terminal-2'),management:Array<ManagementTerminal>=[];let opened=0;
    const fngk:any={probe:async()=>({compatible:true,profile:'local'}),openTerminal:()=>{opened++;if(opened===2)return terminal;if(opened===5)return restartedTerminal;const session=new ManagementTerminal(`management-${management.length+1}`);management.push(session);return session}};
    const service=new LiveProjectService(fngk,{startupMs:1000,ttlMs:60000});
    const session=await service.start({contextId:'device:one',repositoryPath:'/srv/project',command:'npm start',port:8000});
    expect(session).toMatchObject({status:'running',url:'https://preview.example.test',connectionId:'connection-1',terminalSessionId:'terminal-1'});
    expect(terminal.commands[0].command).toBe("cd -- '/srv/project' && exec npm start");expect(management.some(value=>value.commands.some(command=>command.command.includes('fngk publish 8000 --json')))).toBe(true);
    terminal.emit('event',{type:'output',bodyBase64:Buffer.from('server ready\n').toString('base64')});expect(service.get(session.id)?.output).toContain('server ready');
    expect(service.interrupt(session.id)).toBe(true);expect(terminal.interrupts).toHaveLength(1);
    const restarted=await service.restart(session.id);expect(restarted).toMatchObject({status:'running',port:8000});expect(restarted?.id).not.toBe(session.id);
    await expect(service.stop(restarted!.id)).resolves.toBe(true);expect(service.get(restarted!.id)?.status).toBe('stopped');expect(management.some(value=>value.commands.some(command=>command.command.includes('fngk unpublish 8000 --json')))).toBe(true);expect(terminal.stops).toHaveLength(1);expect(restartedTerminal.stops).toHaveLength(1);await service.close();
  });
  it('rejects local contexts and invalid ports before creating a terminal',async()=>{const fngk:any={probe:vi.fn()};const service=new LiveProjectService(fngk);await expect(service.start({contextId:'local',repositoryPath:'/srv',command:'npm start',port:8000})).rejects.toMatchObject({code:'device_context_required'});await expect(service.start({contextId:'device:one',repositoryPath:'/srv',command:'npm start',port:0})).rejects.toMatchObject({code:'invalid_port'})});
  it('returns a linked retained session and diagnostic record when publish fails',async()=>{
    const terminal=new TerminalDouble(),diagnostics=new DiagnosticRegistry();let opened=0;
    const fngk:any={probe:async()=>({compatible:true,profile:'local'}),openTerminal:()=>{opened++;if(opened===1)return new ManagementTerminal('preflight');if(opened===2)return terminal;return new ManagementTerminal(`management-${opened}`,true)}};
    const service=new LiveProjectService(fngk,{diagnostics,startupMs:1000,ttlMs:60000});
    const pending=service.start({contextId:'device:one',repositoryPath:'/srv/project',command:'npm start',port:8000});void pending.catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,0));
    terminal.emit('event',{type:'output',bodyBase64:Buffer.from('boot log').toString('base64')});
    await expect(pending).rejects.toMatchObject({code:'project_start_failed',liveProjectSession:expect.objectContaining({status:'failed',terminalSessionId:'terminal-1'}),diagnosticSessionId:expect.any(String)});
    const record=diagnostics.list()[0];expect(record.stdout).toContain('boot log');expect(record.status).toBe('failed');
  });
  it('rejects an outdated Device CLI before starting the project command',async()=>{
    const old=new ManagementTerminal('preflight');old.sendCommand=(command:string,requestId?:string)=>{old.commands.push({command,requestId});const frame=command.match(/__ATLAS_BEGIN_([A-Za-z0-9_]+)__/i)?.[1];queueMicrotask(()=>{old.emit('event',{type:'output',bodyBase64:Buffer.from(`__ATLAS_BEGIN_${frame}__\nfngk <port>\n__ATLAS_END_${frame}__:0\n`).toString('base64')});old.emit('event',{type:'command_state',requestId,status:'succeeded',exitCode:0})});return true};const fngk:any={probe:async()=>({compatible:true,profile:'local'}),openTerminal:()=>old};const service=new LiveProjectService(fngk,{startupMs:1000});await expect(service.start({contextId:'device:one',repositoryPath:'/srv/project',command:'npm start',port:8000})).rejects.toMatchObject({code:'incompatible_cli'});expect(old.commands).toHaveLength(1);
  });
});
