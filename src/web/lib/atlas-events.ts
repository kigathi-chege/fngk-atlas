/**
 * Local-first operation history. This deliberately persists only presentation-safe
 * fields: payloads, credentials, command text and response bodies remain owned by
 * their feature modules and must never be placed in an AtlasEvent.
 */
export type AtlasEventState='pending'|'success'|'warning'|'error'|'cancelled';
export type AtlasEventSource='local'|'remote';
export type AtlasEvent={
  id:string;type:string;title:string;state:AtlasEventState;createdAt:string;
  updatedAt?:string;message?:string;contextId?:string;panelId?:string;
  diagnosticId?:string;correlationId?:string;source:AtlasEventSource;pinned:boolean;
  metadata?:Record<string,unknown>;
};
export type AtlasEventInput=Partial<Omit<AtlasEvent,'createdAt'|'source'>> & Pick<AtlasEvent,'id'|'type'|'title'>;
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const storageKey='atlas.events.v1';
const states=new Set<AtlasEventState>(['pending','success','warning','error','cancelled']);
const forbidden=/(token|secret|password|authorization|cookie|credential|command|stdout|stderr)/i;
const now=()=>new Date().toISOString();
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function safeMetadata(metadata:unknown){
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))return undefined;
  return Object.fromEntries(Object.entries(metadata as Record<string,unknown>).filter(([key,value])=>!forbidden.test(key)&&['string','number','boolean'].includes(typeof value)));
}
function sanitize(value:unknown):AtlasEvent|null{
  if(!value||typeof value!=='object')return null;const item=value as Partial<AtlasEvent>;
  if(typeof item.id!=='string'||typeof item.type!=='string'||typeof item.title!=='string'||!states.has(item.state as AtlasEventState))return null;
  return {id:item.id,type:item.type,title:item.title,state:item.state as AtlasEventState,createdAt:typeof item.createdAt==='string'?item.createdAt:now(),updatedAt:typeof item.updatedAt==='string'?item.updatedAt:undefined,message:typeof item.message==='string'?item.message:undefined,contextId:typeof item.contextId==='string'?item.contextId:undefined,panelId:typeof item.panelId==='string'?item.panelId:undefined,diagnosticId:typeof item.diagnosticId==='string'?item.diagnosticId:undefined,correlationId:typeof item.correlationId==='string'?item.correlationId:undefined,source:item.source==='remote'?'remote':'local',pinned:item.pinned===true,metadata:safeMetadata(item.metadata)};
}
export class AtlasEventStore {
  #items:AtlasEvent[]=[];#listeners=new Set<(items:AtlasEvent[])=>void>();
  constructor(private storage?:StorageLike,private limit=500){this.#items=this.read()}
  snapshot(){return this.#items.map(clone)}
  subscribe(listener:(items:AtlasEvent[])=>void){this.#listeners.add(listener);listener(this.snapshot());return()=>this.#listeners.delete(listener)}
  begin(input:AtlasEventInput){return this.upsert({...input,state:input.state??'pending',source:'local'})}
  resolve(id:string,patch:Partial<AtlasEvent>={}){return this.transition(id,'success',patch)}
  fail(id:string,patch:Partial<AtlasEvent>={}){return this.transition(id,'error',patch)}
  cancel(id:string,patch:Partial<AtlasEvent>={}){return this.transition(id,'cancelled',patch)}
  upsertRemote(input:AtlasEventInput & {source?:AtlasEventSource}){return this.upsert({...input,source:'remote'})}
  pin(id:string,pinned=true){return this.update(id,{pinned})}
  removeLocal(id:string){this.#items=this.#items.filter(item=>item.id!==id||item.source==='remote');this.publish()}
  clearUnpinned(){this.#items=this.#items.filter(item=>item.pinned||item.source==='remote');this.publish()}
  private transition(id:string,state:AtlasEventState,patch:Partial<AtlasEvent>){return this.update(id,{...patch,state})}
  private update(id:string,patch:Partial<AtlasEvent>){const item=this.#items.find(candidate=>candidate.id===id);if(!item)return undefined;Object.assign(item,this.withoutUndefined(this.sanitizePatch(patch)),{updatedAt:now()});this.publish();return clone(item)}
  private upsert(input:AtlasEventInput & {source?:AtlasEventSource}){const existing=this.#items.find(item=>item.id===input.id);const item:AtlasEvent={id:input.id,type:input.type,title:input.title,state:states.has(input.state as AtlasEventState)?input.state as AtlasEventState:'pending',createdAt:existing?.createdAt??now(),updatedAt:now(),message:typeof input.message==='string'?input.message:existing?.message,contextId:typeof input.contextId==='string'?input.contextId:existing?.contextId,panelId:typeof input.panelId==='string'?input.panelId:existing?.panelId,diagnosticId:typeof input.diagnosticId==='string'?input.diagnosticId:existing?.diagnosticId,correlationId:typeof input.correlationId==='string'?input.correlationId:existing?.correlationId,source:input.source??existing?.source??'local',pinned:existing?.pinned??input.pinned===true,metadata:safeMetadata(input.metadata)};
    if(existing)Object.assign(existing,item);else this.#items.push(item);this.trim();this.publish();return clone(item)}
  private sanitizePatch(patch:Partial<AtlasEvent>){return {message:typeof patch.message==='string'?patch.message:undefined,contextId:typeof patch.contextId==='string'?patch.contextId:undefined,panelId:typeof patch.panelId==='string'?patch.panelId:undefined,diagnosticId:typeof patch.diagnosticId==='string'?patch.diagnosticId:undefined,correlationId:typeof patch.correlationId==='string'?patch.correlationId:undefined,state:states.has(patch.state as AtlasEventState)?patch.state:undefined,pinned:typeof patch.pinned==='boolean'?patch.pinned:undefined,metadata:safeMetadata(patch.metadata)}}
  private trim(){const removable=()=>this.#items.filter(item=>!item.pinned&&item.source==='local').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));while(removable().length>this.limit){const item=removable()[0];if(!item)break;this.#items=this.#items.filter(candidate=>candidate.id!==item.id)}}
  private withoutUndefined<T extends Record<string,unknown>>(value:T){return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined)) as Partial<T>}
  private read(){if(!this.storage)return [];try{const raw=this.storage.getItem(storageKey);if(!raw)return [];const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw new Error('Invalid event storage');return parsed.map(sanitize).filter((item):item is AtlasEvent=>Boolean(item)).slice(-this.limit)}catch{this.storage.removeItem(storageKey);return []}}
  private publish(){if(this.storage)this.storage.setItem(storageKey,JSON.stringify(this.#items.map(({metadata,...item})=>({...item,metadata:safeMetadata(metadata)}))));for(const listener of this.#listeners)listener(this.snapshot())}
}
export function createAtlasEventStore(storage?:StorageLike,limit=500){return new AtlasEventStore(storage,limit)}
const browserStorage=typeof window==='undefined'?undefined:window.localStorage;
export const atlasEvents=createAtlasEventStore(browserStorage);
