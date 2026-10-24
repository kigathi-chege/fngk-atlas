import {describe,expect,it} from 'vitest';
import type {AtlasEvent} from '../../src/web/lib/atlas-events.js';
import {eventReport,formatDuration,summarize} from '../../src/web/lib/status-activity.js';

const at=(seconds:number)=>new Date(Date.UTC(2026,9,24,8,0,seconds)).toISOString();
const event=(id:string,patch:Partial<AtlasEvent>):AtlasEvent=>({id,type:'filesystem.list',title:id,state:'success',createdAt:at(0),updatedAt:at(1),source:'local',pinned:false,...patch});

describe('status bar summary',()=>{
  it('lists running work newest first and counts errors since they were last seen',()=>{
    const items=[event('old-error',{state:'error',createdAt:at(0),updatedAt:at(2)}),event('run-a',{state:'pending',createdAt:at(3),updatedAt:undefined}),event('new-error',{state:'error',createdAt:at(4),updatedAt:at(6)}),event('run-b',{state:'pending',createdAt:at(7),updatedAt:undefined})];
    const summary=summarize(items,{seenAt:Date.parse(at(3))});
    expect(summary.running.map(item=>item.id)).toEqual(['run-b','run-a']);
    expect(summary.unseenErrors.map(item=>item.id)).toEqual(['new-error']);
    expect(summary.latest?.id).toBe('new-error');
  });
  it('drops a failure from the bar once later work in the same context succeeds',()=>{
    const items=[
      event('offline',{state:'error',contextId:'device:1',message:'Device is offline',createdAt:at(0),updatedAt:at(1)}),
      event('listed',{contextId:'device:1',createdAt:at(5),updatedAt:at(6)}),
      event('other-device',{state:'error',contextId:'device:2',createdAt:at(2),updatedAt:at(3)}),
    ];
    expect(summarize(items).unseenErrors.map(item=>item.id)).toEqual(['other-device']);
    expect(summarize(items,{contextId:'device:1'}).latest?.id).toBe('listed');
  });
  it('measures the Device round trip from recent successful reads on that Device only',()=>{
    const items=[
      event('a',{contextId:'device:1',createdAt:at(0),updatedAt:at(2)}),
      event('b',{contextId:'device:1',createdAt:at(10),updatedAt:at(11)}),
      event('c',{contextId:'device:1',createdAt:at(20),updatedAt:at(24)}),
      event('other',{contextId:'device:2',createdAt:at(30),updatedAt:at(50)}),
      event('failed',{contextId:'device:1',state:'error',createdAt:at(40),updatedAt:at(55)}),
      event('save',{contextId:'device:1',type:'file.save',createdAt:at(60),updatedAt:at(70)}),
    ];
    expect(summarize(items,{contextId:'device:1'}).roundTripMs).toBe(2000);
    expect(summarize(items,{contextId:'local'}).roundTripMs).toBeUndefined();
  });
  it('formats durations and a copyable report',()=>{
    expect([formatDuration(240),formatDuration(1830),formatDuration(75_000)]).toEqual(['240ms','1.8s','1m 15s']);
    expect(eventReport(event('Listing /opt',{state:'error',contextId:'device:1',message:'Listing /opt timed out twice (15s each).',metadata:{route:'terminal'}}))).toBe(
      'Listing /opt — error\ntype: filesystem.list\nstarted: 2026-10-24T08:00:00.000Z\ntook: 1.0s\ncontext: device:1\nmessage: Listing /opt timed out twice (15s each).\nroute: terminal');
  });
});
