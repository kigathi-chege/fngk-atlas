import {describe,expect,it} from 'vitest';
import {AtlasCommandRegistry} from '../../src/web/lib/command-registry.js';
import { registerDocumentationCommands } from '../../src/web/lib/command-registry.js';

describe('Atlas command registry',()=>{
  it('routes every trigger through one canonical command',async()=>{
    const calls:string[]=[],registry=new AtlasCommandRegistry();
    registry.register({id:'workbench.files',label:'Open Filesystem',keywords:['explorer','folder'],run:()=>{calls.push('files')}});
    await registry.execute('workbench.files');
    expect(calls).toEqual(['files']);
    expect(registry.search('folder').map(command=>command.id)).toEqual(['workbench.files']);
  });

  it('rejects duplicate identifiers and reports unavailable commands',async()=>{
    const registry=new AtlasCommandRegistry(),command={id:'workbench.search',label:'Search',run:()=>{}};
    registry.register(command);
    expect(()=>registry.register(command)).toThrow(/already registered/i);
    await expect(registry.execute('missing')).rejects.toMatchObject({code:'command_not_found'});
  });

  it('publishes sorted command snapshots and releases subscribers',()=>{
    const registry=new AtlasCommandRegistry(),snapshots:string[][]=[];
    const unsubscribe=registry.subscribe(commands=>snapshots.push(commands.map(command=>command.label)));
    registry.register({id:'z',label:'Zulu',run:()=>{}});registry.register({id:'a',label:'Alpha',run:()=>{}});
    unsubscribe();registry.register({id:'b',label:'Beta',run:()=>{}});
    expect(snapshots).toEqual([[],['Zulu'],['Alpha','Zulu']]);
  });

  it('registers searchable documentation commands that use one opening callback', async () => {
    const registry = new AtlasCommandRegistry();
    const opened: Array<string | undefined> = [];
    const unregister = registerDocumentationCommands(registry, topicId => opened.push(topicId));
    expect(registry.search('documentation').map(command => command.label)).toContain('Documentation: Open guide');
    expect(registry.search('sessions').map(command => command.label)).toContain('Documentation: Terminals and sessions');
    await registry.execute('documentation.terminals');
    expect(opened).toEqual(['terminals']);
    unregister();
  });
});
