export interface BufferResource {contextId:string;path:string;fingerprint:string}
export interface AtlasBuffer {id:string;name:string;contextId:string;content:string;dirty:boolean;suggestedDirectory?:string;proposedPath?:string;resource?:BufferResource}
export interface CreateBufferOptions {contextId:string;content?:string;suggestedDirectory?:string;proposedPath?:string}
const copy=(value:AtlasBuffer):AtlasBuffer=>({...value,resource:value.resource?{...value.resource}:undefined});

export class BufferStore {
  #buffers=new Map<string,AtlasBuffer>();#listeners=new Set<(buffers:AtlasBuffer[])=>void>();#counter=0;
  create(options:CreateBufferOptions){const name=options.proposedPath?.split('/').filter(Boolean).at(-1)??`Untitled-${++this.#counter}`,value:AtlasBuffer={id:crypto.randomUUID(),name,contextId:options.contextId,content:options.content??'',dirty:false,...(options.suggestedDirectory?{suggestedDirectory:options.suggestedDirectory}:{}),...(options.proposedPath?{proposedPath:options.proposedPath}:{})};this.#buffers.set(value.id,value);this.#publish();return copy(value)}
  update(id:string,content:string,dirty=true){const value=this.#required(id);value.content=content;value.dirty=dirty;this.#publish();return copy(value)}
  bindResource(id:string,resource:BufferResource){const value=this.#required(id);value.resource={...resource};value.contextId=resource.contextId;value.proposedPath=resource.path;value.name=resource.path.split('/').filter(Boolean).at(-1)??resource.path;value.dirty=false;this.#publish();return copy(value)}
  remove(id:string){const removed=this.#buffers.delete(id);if(removed)this.#publish();return removed}
  get(id:string){const value=this.#buffers.get(id);return value?copy(value):undefined}
  all(){return [...this.#buffers.values()].map(copy)}
  hasDirty(){return [...this.#buffers.values()].some(value=>value.dirty)}
  subscribe(listener:(buffers:AtlasBuffer[])=>void){this.#listeners.add(listener);listener(this.all());return()=>this.#listeners.delete(listener)}
  persistable():never[]{return []}
  #required(id:string){const value=this.#buffers.get(id);if(!value)throw Object.assign(new Error(`Buffer ${id} was not found.`),{code:'buffer_not_found'});return value}
  #publish(){const values=this.all();for(const listener of this.#listeners)listener(values)}
}

export const atlasBuffers=new BufferStore();
