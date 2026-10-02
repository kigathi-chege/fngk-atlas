import {describe,expect,it} from 'vitest';
import {PanelRegistry} from '../../src/web/lib/panel-registry.js';

describe('Atlas panel registry',()=>{
  it('retains a reconstructable descriptor while a panel is minimized',()=>{
    const registry=new PanelRegistry();
    registry.remember({id:'file:one',kind:'file',title:'one.ts',params:{contextId:'device:one',path:'/srv/one.ts'}});
    expect(registry.minimize('file:one')).toMatchObject({id:'file:one',minimized:true});
    expect(registry.restore('file:one')).toMatchObject({id:'file:one',minimized:false});
  });

  it('persists only allowlisted reconstruction parameters',()=>{
    const registry=new PanelRegistry();
    registry.remember({id:'file:one',kind:'file',title:'one.ts',params:{contextId:'local',path:'/one.ts',line:4,content:'secret body',terminalOutput:'secret output',token:'secret token',password:'secret password'}});
    const saved=registry.persistable();
    expect(saved).toEqual([{id:'file:one',kind:'file',title:'one.ts',params:{contextId:'local',path:'/one.ts',line:4},minimized:false}]);
    expect(JSON.stringify(saved)).not.toMatch(/secret|content|output|token|password/i);
  });

  it('updates one descriptor per identifier and can forget it',()=>{
    const registry=new PanelRegistry();
    registry.remember({id:'atlas.observatory',kind:'atlas',title:'Machine Observatory'});
    registry.remember({id:'atlas.observatory',kind:'atlas',title:'Device Atlas'});
    expect(registry.all()).toHaveLength(1);expect(registry.get('atlas.observatory')?.title).toBe('Device Atlas');
    registry.forget('atlas.observatory');expect(registry.get('atlas.observatory')).toBeUndefined();
  });

  it('keeps a dirty buffer reconstructable without persisting its body',()=>{
    const registry=new PanelRegistry();
    registry.remember({id:'buffer:one',kind:'file',title:'Untitled-1 ●',params:{contextId:'local',bufferId:'buffer-1',content:'private draft'}});

    expect(registry.minimize('buffer:one')).toEqual({id:'buffer:one',kind:'file',title:'Untitled-1 ●',params:{contextId:'local',bufferId:'buffer-1'},minimized:true});
    expect(JSON.stringify(registry.persistable())).not.toContain('private draft');
  });
});
