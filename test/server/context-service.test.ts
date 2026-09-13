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
});
