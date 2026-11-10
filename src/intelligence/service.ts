import type {WorldStore} from '../world/store.js';import type {WorldService} from '../world/service.js';
export interface CalculatorRequest{question:string;context:{contextId:string;selection?:unknown;projection:unknown;entity?:unknown;assertions:unknown[];tools:Array<{id:string;description:string}>}}
export interface CalculatorProvider{id:string;health():Promise<{available:boolean;message?:string;status?:number}>;analyze(request:CalculatorRequest,signal?:AbortSignal):Promise<{answer:string;citations?:Array<{entityId:string;assertionId?:string}>}>}
export const DEFAULT_INTELLIGENCE_URL='https://intelligence.nipate.africa';
export const DEFAULT_INTELLIGENCE_WORKSPACE='atlas';
export type IntelligenceProviderOptions={origin?:string;key:string;workspaceId?:string;timeoutMs?:number};
/**
 * Explanation-only analysis through Nipate Intelligence's service-client API (POST /api/intelligence/exec/analyze, scope
 * agents:execute). The key is a server-side secret: it is sent only as a bearer header from this process and is never
 * part of any response, error message or log line Atlas produces.
 */
export class IntelligenceServiceProvider implements CalculatorProvider{
  readonly id='intelligence-service';
  readonly origin:string;readonly workspaceId:string;readonly #key:string;readonly #timeoutMs:number;
  constructor(options:IntelligenceProviderOptions){
    this.origin=(options.origin||DEFAULT_INTELLIGENCE_URL).replace(/\/+$/,'');
    this.#key=options.key;this.workspaceId=options.workspaceId||DEFAULT_INTELLIGENCE_WORKSPACE;this.#timeoutMs=options.timeoutMs??60_000;
  }
  static fromEnvironment(env:Record<string,string|undefined>=process.env){
    const key=env.ATLAS_INTELLIGENCE_KEY?.trim();
    return key?new IntelligenceServiceProvider({origin:env.ATLAS_INTELLIGENCE_URL?.trim()||undefined,key,workspaceId:env.ATLAS_INTELLIGENCE_WORKSPACE?.trim()||undefined}):undefined;
  }
  #headers(){return{authorization:`Bearer ${this.#key}`}}
  async health(){
    // GET /exec/models needs only a valid service key (any run/bind/manage/inspect scope) and spends no run budget.
    try{
      const response=await fetch(new URL('/api/intelligence/exec/models',this.origin),{headers:this.#headers(),signal:AbortSignal.timeout(3000)});
      return{available:response.ok,status:response.ok?undefined:response.status,message:response.ok?undefined:response.status===401||response.status===403?`Intelligence rejected the Atlas service key (${response.status})`:`Intelligence returned ${response.status}`};
    }catch(error){return{available:false,message:(error as Error).message}}
  }
  async analyze(request:CalculatorRequest,signal?:AbortSignal){
    const response=await fetch(new URL('/api/intelligence/exec/analyze',this.origin),{
      method:'POST',
      headers:{'content-type':'application/json',...this.#headers()},
      body:JSON.stringify({workspaceId:this.workspaceId,question:request.question,context:request.context}),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(this.#timeoutMs)]):AbortSignal.timeout(this.#timeoutMs)
    });
    if(!response.ok){
      const detail=await response.json().then((value:any)=>typeof value?.error?.code==='string'?`: ${value.error.code}`:'').catch(()=>'');
      throw Object.assign(new Error(`Intelligence returned ${response.status}${detail}`),{status:response.status});
    }
    const value=await response.json() as any;
    return{answer:String(value.answer??''),citations:Array.isArray(value.citations)?value.citations.slice(0,50):[]};
  }
}
export class AtlasIntelligenceService{readonly tools=[{id:'atlas.search',description:'Search safe semantic metadata.'},{id:'atlas.inspect',description:'Inspect an entity and its evidence-backed assertions.'},{id:'atlas.neighborhood',description:'Expand a bounded graph neighborhood.'},{id:'atlas.trace',description:'Trace capability and dependency relationships.'},{id:'atlas.compare',description:'Compare two semantic entities or retained states.'},{id:'interpreter.validate',description:'Validate and explain a declarative interpreter specification.'}];constructor(readonly store:WorldStore,readonly world:WorldService,public provider?:CalculatorProvider){}async capabilities(){const health=this.provider?await this.provider.health():{available:false,message:'Intelligence provider is not configured.'};return{provider:this.provider?.id??'none',health,tools:this.tools,authority:'read-only'}}context(contextId:string,selectionId?:string){const projection=this.world.projection(contextId,{rootId:selectionId,lens:'overview',level:selectionId?2:0,budget:80}),detail=selectionId?this.store.entity(selectionId):null;return{contextId,selection:detail?.entity,projection,entity:detail?.entity,assertions:(detail?.assertions??[]).slice(0,50),tools:this.tools}}async analyze(question:string,contextId:string,selectionId?:string,signal?:AbortSignal){if(!this.provider)throw Object.assign(new Error('Intelligence provider is not configured.'),{code:'calculator_unavailable'});const text=question.trim();if(!text||text.length>4000)throw Object.assign(new Error('Question must contain 1 to 4000 characters.'),{code:'invalid_question'});const result=await this.provider.analyze({question:text,context:this.context(contextId,selectionId)},signal);return{...result,provider:this.provider.id,authority:'explanation-only',canonicalWrites:false}}}
