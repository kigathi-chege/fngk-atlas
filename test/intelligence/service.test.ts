import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {afterEach,describe,expect,it,vi} from 'vitest';import {AtlasIntelligenceService,IntelligenceServiceProvider,type CalculatorProvider} from '../../src/intelligence/service.js';import {WorldService} from '../../src/world/service.js';import {WorldStore} from '../../src/world/store.js';
const cleanups:Array<()=>Promise<void>>=[];afterEach(async()=>{while(cleanups.length)await cleanups.pop()?.()});
describe('Intelligence boundary',()=>{it('sends bounded read-only semantic context and cannot write canonical assertions',async()=>{const directory=await mkdtemp(path.join(tmpdir(),'atlas-calculator-')),store=new WorldStore(path.join(directory,'atlas.db')),world=new WorldService(store);cleanups.push(async()=>{store.close();await rm(directory,{recursive:true,force:true})});world.refresh('local',[{id:'postgres',type:'process',label:'postgres',metadata:{command:'/usr/bin/postgres'}}],[],{name:'machine'});let received:any;const provider:CalculatorProvider={id:'fixture',health:async()=>({available:true}),analyze:async request=>(received=request,{answer:'PostgreSQL provides storage.',citations:[]})},service=new AtlasIntelligenceService(store,world,provider),before=store.assertions('local').length,result=await service.analyze('What provides storage?','local');expect(result).toMatchObject({authority:'explanation-only',canonicalWrites:false});expect(received.context.tools.every((tool:any)=>!tool.id.includes('execute'))).toBe(true);expect(received.context.projection.nodes.length).toBeLessThanOrEqual(80);expect(store.assertions('local')).toHaveLength(before)})});

describe('IntelligenceServiceProvider',()=>{
  const request={question:'Hello',context:{contextId:'local',projection:{},assertions:[],tools:[]}};
  const withFetch=async(fetcher:any,run:()=>Promise<void>)=>{const previous=globalThis.fetch;globalThis.fetch=fetcher as typeof fetch;try{await run()}finally{globalThis.fetch=previous}};

  it('calls Intelligence’s exec analyze route with the server-side service key, a workspace and the same context',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({answer:'ok',citations:[{entityId:'a'}],model:'auto',usage:{}}),{status:200}));
    await withFetch(fetcher,async()=>{
      const provider=new IntelligenceServiceProvider({origin:'https://intelligence.example/',key:'isc_secret'});
      expect(await provider.analyze(request)).toEqual({answer:'ok',citations:[{entityId:'a'}]});
      const [url,init]=fetcher.mock.calls[0] as any;
      expect(url.toString()).toBe('https://intelligence.example/api/intelligence/exec/analyze');
      expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe('Bearer isc_secret');
      expect(JSON.parse(init.body)).toEqual({workspaceId:'atlas',question:'Hello',context:request.context});
      expect(provider.id).toBe('intelligence-service');
    });
  });
  it('checks health with GET /exec/models and the key, and reports a rejected key without leaking it',async()=>{
    const fetcher=vi.fn()
      .mockResolvedValueOnce(new Response('{}',{status:200}))
      .mockResolvedValueOnce(new Response('{}',{status:401}))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await withFetch(fetcher,async()=>{
      const provider=new IntelligenceServiceProvider({key:'isc_secret',workspaceId:'w1'});
      expect(await provider.health()).toEqual({available:true,message:undefined});
      const rejected=await provider.health();
      expect(rejected.available).toBe(false);expect(rejected.message).toContain('401');expect(JSON.stringify(rejected)).not.toContain('isc_secret');
      expect(await provider.health()).toEqual({available:false,message:'connect ECONNREFUSED'});
      expect(fetcher.mock.calls[0][0].toString()).toBe('https://intelligence.nipate.africa/api/intelligence/exec/models');
      expect(fetcher.mock.calls[0][1].headers.authorization).toBe('Bearer isc_secret');
    });
  });
  it('turns an Intelligence error into an error carrying its status and code but never the key',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:'input_too_large',message:'The context is larger than 65536 bytes of JSON.'}}),{status:422}));
    await withFetch(fetcher,async()=>{
      const provider=new IntelligenceServiceProvider({key:'isc_secret'});
      const error:any=await provider.analyze(request).catch(value=>value);
      expect(error.message).toBe('Intelligence returned 422: input_too_large');expect(error.status).toBe(422);expect(error.message).not.toContain('isc_secret');
    });
    await withFetch(vi.fn(async()=>new Response('<html>',{status:502})),async()=>{
      await expect(new IntelligenceServiceProvider({key:'k'}).analyze(request)).rejects.toThrow('Intelligence returned 502');
    });
  });
  it('is configured from the environment only when a key is present, with the production origin by default',()=>{
    expect(IntelligenceServiceProvider.fromEnvironment({})).toBeUndefined();
    expect(IntelligenceServiceProvider.fromEnvironment({ATLAS_INTELLIGENCE_URL:'https://x'})).toBeUndefined();
    const provider=IntelligenceServiceProvider.fromEnvironment({ATLAS_INTELLIGENCE_KEY:' isc_k '})!;
    expect(provider.origin).toBe('https://intelligence.nipate.africa');expect(provider.workspaceId).toBe('atlas');
    const custom=IntelligenceServiceProvider.fromEnvironment({ATLAS_INTELLIGENCE_KEY:'isc_k',ATLAS_INTELLIGENCE_URL:'http://localhost:5173/',ATLAS_INTELLIGENCE_WORKSPACE:'desk-1'})!;
    expect(custom.origin).toBe('http://localhost:5173');expect(custom.workspaceId).toBe('desk-1');
  });
  it('reports an unconfigured service through capabilities and refuses to analyze',async()=>{
    const directory=await mkdtemp(path.join(tmpdir(),'atlas-intel-')),store=new WorldStore(path.join(directory,'atlas.db')),world=new WorldService(store);cleanups.push(async()=>{store.close();await rm(directory,{recursive:true,force:true})});
    const service=new AtlasIntelligenceService(store,world);
    expect(await service.capabilities()).toMatchObject({provider:'none',health:{available:false,message:'Intelligence provider is not configured.'},authority:'read-only'});
    await expect(service.analyze('Q?','local')).rejects.toMatchObject({code:'calculator_unavailable'});
  });
});
