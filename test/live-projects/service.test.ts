import {EventEmitter} from 'node:events';import {describe,expect,it,vi} from 'vitest';import {LiveProjectService} from '../../src/live-projects/service.js';

class TerminalDouble extends EventEmitter {
  sessionId='terminal-1';commands:Array<{command:string;requestId?:string}>=[];stops:string[]=[];interrupts:string[]=[];
  setMode(){queueMicrotask(()=>this.emit('event',{type:'collaboration',mode:'queue'}));return true}
  sendCommand(command:string,requestId?:string){this.commands.push({command,requestId});queueMicrotask(()=>this.emit('event',{type:'command_state',requestId,status:'running'}));return true}
  stop(requestId?:string){this.stops.push(requestId??'');queueMicrotask(()=>this.emit('close',{}));return true}
  interrupt(requestId?:string){this.interrupts.push(requestId??'');return true}
}

describe('live project lifecycle',()=>{
  it('runs visibly in a Device terminal and publishes and releases through FNGK',async()=>{
    const terminal=new TerminalDouble(),execute=vi.fn(async(command:string)=>({output:Buffer.from(command.startsWith('fngk publish')?JSON.stringify({protocolVersion:'fngk.publish.v1',type:'published',connectionId:'connection-1',hostname:'preview.example.test'}):JSON.stringify({protocolVersion:'fngk.publish.v1',type:'unpublished'})),exitCode:0}));
    const fngk:any={probe:async()=>({compatible:true,profile:'local'}),openTerminal:()=>terminal};
    const service=new LiveProjectService(fngk,async()=>({execute}),{startupMs:1000,ttlMs:60000});
    const session=await service.start({contextId:'device:one',repositoryPath:'/srv/project',command:'npm start',port:8000});
    expect(session).toMatchObject({status:'running',url:'https://preview.example.test',connectionId:'connection-1',terminalSessionId:'terminal-1'});
    expect(terminal.commands[0].command).toBe("cd -- '/srv/project' && exec npm start");expect(execute).toHaveBeenCalledWith('fngk publish 8000 --json',{timeoutMs:30000});
    terminal.emit('event',{type:'output',bodyBase64:Buffer.from('server ready\n').toString('base64')});expect(service.get(session.id)?.output).toContain('server ready');
    expect(service.interrupt(session.id)).toBe(true);expect(terminal.interrupts).toHaveLength(1);
    const restarted=await service.restart(session.id);expect(restarted).toMatchObject({status:'running',port:8000});expect(restarted?.id).not.toBe(session.id);
    await expect(service.stop(restarted!.id)).resolves.toBe(true);expect(service.get(restarted!.id)?.status).toBe('stopped');expect(execute).toHaveBeenLastCalledWith('fngk unpublish 8000 --json',{timeoutMs:30000});expect(terminal.stops).toHaveLength(2);await service.close();
  });
  it('rejects local contexts and invalid ports before creating a terminal',async()=>{const fngk:any={probe:vi.fn()};const service=new LiveProjectService(fngk,vi.fn() as any);await expect(service.start({contextId:'local',repositoryPath:'/srv',command:'npm start',port:8000})).rejects.toMatchObject({code:'device_context_required'});await expect(service.start({contextId:'device:one',repositoryPath:'/srv',command:'npm start',port:0})).rejects.toMatchObject({code:'invalid_port'})});
});
