export type WorkspaceRootKind='pinned'|'workspace';
export interface WorkspaceRoot {contextId:string;path:string;kind:WorkspaceRootKind;label?:string}
type RootInput=Pick<WorkspaceRoot,'contextId'|'path'> & {label?:string};

const valid=(value:unknown):value is WorkspaceRoot=>{
  if(!value||typeof value!=='object')return false;
  const item=value as Record<string,unknown>;
  return typeof item.contextId==='string'&&Boolean(item.contextId.trim())&&typeof item.path==='string'&&item.path.startsWith('/')&&(item.kind==='pinned'||item.kind==='workspace')&&(item.label===undefined||typeof item.label==='string');
};
const normalized=(value:WorkspaceRoot):WorkspaceRoot=>({contextId:value.contextId.trim(),path:value.path==='/'?'/':value.path.replace(/\/+$/,''),kind:value.kind,...(value.label?.trim()?{label:value.label.trim()}: {})});
const key=(value:WorkspaceRoot)=>`${value.contextId}\u0000${value.path}\u0000${value.kind}`;

export class WorkspaceRootsStore {
  #roots:WorkspaceRoot[]=[];
  #listeners=new Set<(roots:WorkspaceRoot[])=>void>();
  constructor(values:unknown=[]){if(Array.isArray(values))for(const value of values)if(valid(value)){const item=normalized(value);if(!this.#roots.some(current=>key(current)===key(item)))this.#roots.push(item)}}
  pin(value:RootInput){return this.#add({...value,kind:'pinned'})}
  unpin(value:RootInput){this.#remove({...value,kind:'pinned'})}
  addWorkspace(value:RootInput){return this.#add({...value,kind:'workspace'})}
  removeWorkspace(value:RootInput){this.#remove({...value,kind:'workspace'})}
  forContext(contextId:string){return this.#roots.filter(value=>value.contextId===contextId).map(value=>({...value}))}
  persistable(){return this.#roots.map(value=>({...value}))}
  subscribe(listener:(roots:WorkspaceRoot[])=>void){this.#listeners.add(listener);listener(this.persistable());return()=>this.#listeners.delete(listener)}
  #add(value:WorkspaceRoot){if(!valid(value))throw Object.assign(new Error('Workspace roots require an absolute path and context.'),{code:'invalid_workspace_root'});const item=normalized(value),existing=this.#roots.find(current=>key(current)===key(item));if(existing)return {...existing};this.#roots.push(item);this.#publish();return {...item}}
  #remove(value:WorkspaceRoot){const item=normalized(value),before=this.#roots.length;this.#roots=this.#roots.filter(current=>key(current)!==key(item));if(before!==this.#roots.length)this.#publish()}
  #publish(){const values=this.persistable();for(const listener of this.#listeners)listener(values)}
}
