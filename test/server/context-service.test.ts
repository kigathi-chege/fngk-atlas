import {EventEmitter} from 'node:events';
import {describe,expect,it} from 'vitest';
import {EffectiveContextService} from '../../src/server/context-service.js';

class TerminalDouble extends EventEmitter {
  sessionId='session';
  constructor(){super();queueMicrotask(()=>this.emit('ready',{type:'ready',sessionId:this.sessionId}));}
  setMode(){queueMicrotask(()=>this.emit('event',{type:'collaboration',eventType:'mode',mode:'queue'}));return true;}
  sendCommand(){return false;}
  detach(){return true;}
  stop(){return true;}
  interrupt(){return true;}
}

describe('effective context route lifecycle',()=>{
  it('isolates simultaneous profile discovery and remote routes',async()=>{
    const probes:string[]=[],opened:string[]=[],namespaces:string[]=[];
    const fngk={
      probe:async(profile:string)=>{probes.push(profile);await new Promise(resolve=>setTimeout(resolve,5));return{compatible:true,profile,namespace:{devices:[]}}},
      fileBindings:async(profile:string)=>({profile:{name:profile},bindings:[]}),
      namespace:async(profile:string)=>{namespaces.push(profile);return{devices:[{id:'online',online:true}]}},
      openTerminal:(_target:string,options:any)=>{opened.push(options.profile);return new TerminalDouble()}
    };
    const contexts=new EffectiveContextService(fngk as any);
    const [a,b]=await Promise.all([contexts.contexts({profile:'a'}),contexts.contexts({profile:'b'})]);
    expect(a.state.profile).toBe('a');expect(b.state.profile).toBe('b');
    expect(probes).toEqual(['a','b']);
    const left=await contexts.route('device:online','a'),right=await contexts.route('device:online','b');
    expect(left).not.toBe(right);expect(opened).toEqual(['a','b']);expect(namespaces).toEqual(['a','b']);
    contexts.close();
  });
  it('coalesces and briefly caches namespace and file-binding discovery',async()=>{
    let probes=0,bindings=0;
    const fngk={
      probe:async()=>{probes++;await new Promise(resolve=>setTimeout(resolve,5));return{compatible:true,profile:'local',namespace:{devices:[]}}},
      fileBindings:async()=>{bindings++;return{profile:{name:'local'},bindings:[]}},
    };
    const contexts=new EffectiveContextService(fngk as any,{contextCacheMs:10_000});
    const [left,right]=await Promise.all([contexts.contexts(),contexts.contexts()]);
    expect(left).toBe(right);expect(probes).toBe(1);expect(bindings).toBe(1);
    await contexts.contexts();expect(probes).toBe(1);
    await contexts.contexts({force:true});expect(probes).toBe(2);expect(bindings).toBe(2);
    contexts.close();
  });
  it('evicts a cached terminal route when its underlying session closes',async()=>{
    const sessions:TerminalDouble[]=[];
    const fngk={
      namespace:async()=>({devices:[{id:'online',ref:'device:online',name:'machine',online:true}]}),
      openTerminal:()=>{const session=new TerminalDouble();sessions.push(session);return session;},
    };
    const contexts=new EffectiveContextService(fngk as any);
    const first=await contexts.route('device:online');
    sessions[0].emit('close',{code:1});
    const second=await contexts.route('device:online');
    expect(second).not.toBe(first);
    expect(sessions).toHaveLength(2);
    contexts.close();
  });
  it('evicts a cached terminal route after a transport-level command failure',async()=>{
    const sessions:TerminalDouble[]=[];
    const fngk={namespace:async()=>({devices:[{id:'online',ref:'device:online',name:'machine',online:true}]}),fileBindings:async()=>({profile:{name:'local'},bindings:[]}),openTerminal:()=>{const session=new TerminalDouble();sessions.push(session);return session;}};
    const contexts=new EffectiveContextService(fngk as any);
    await expect((await contexts.files('device:online')).read({contextId:'device:online',path:'/missing'})).rejects.toMatchObject({code:'route_unavailable'});
    await contexts.route('device:online');expect(sessions).toHaveLength(2);contexts.close();
  });
});
