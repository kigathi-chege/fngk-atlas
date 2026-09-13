export type UnifiedSearchScope='context'|'all';
export interface UnifiedSearchRequest {query:string;contextId:string;scope:UnifiedSearchScope;limit?:number}
export interface UnifiedSearchItem {id:string;type:string;label:string;contextId?:string;path?:string;line?:number;detail?:string;provenance:string;score?:number;action?:string}
export type UnifiedSearchProvider=(request:UnifiedSearchRequest,signal:AbortSignal)=>Promise<UnifiedSearchItem[]>;
export interface UnifiedSearchResult {items:UnifiedSearchItem[];stale:boolean;errors:string[]}

export class UnifiedSearchCollection {
  #generation=0;
  #controller:AbortController|undefined;

  constructor(private readonly providers:UnifiedSearchProvider[]){}

  async search(request:UnifiedSearchRequest):Promise<UnifiedSearchResult>{
    const generation=++this.#generation;
    this.#controller?.abort();
    const controller=new AbortController();this.#controller=controller;
    const settled=await Promise.allSettled(this.providers.map(provider=>provider(request,controller.signal)));
    if(generation!==this.#generation)return {items:[],stale:true,errors:[]};
    const errors=settled.flatMap(value=>value.status==='rejected'&&((value.reason as {name?:string}).name!=='AbortError')?[String((value.reason as Error).message??value.reason)]:[]);
    const candidates=settled.flatMap(value=>value.status==='fulfilled'?value.value:[]).filter(item=>request.scope==='all'||!item.contextId||item.contextId===request.contextId);
    const merged=new Map<string,UnifiedSearchItem>();
    for(const item of candidates){const current=merged.get(item.id);if(!current||(item.score??0)>(current.score??0))merged.set(item.id,item)}
    const limit=Math.min(250,Math.max(1,request.limit??80));
    const items=[...merged.values()].sort((left,right)=>(right.score??0)-(left.score??0)||left.label.localeCompare(right.label)||left.id.localeCompare(right.id)).slice(0,limit);
    return {items,stale:false,errors};
  }

  cancel(){this.#generation++;this.#controller?.abort();this.#controller=undefined}
}
