export interface AtlasPanelDescriptor {
  id:string;
  kind:string;
  title:string;
  params?:Record<string,unknown>;
  placement?:'left'|'right'|'bottom'|'center';
  minimized?:boolean;
}

const safeKeys=new Set(['contextId','path','line','sessionId','target','profile','bufferId','root','lens','indexId']);
const safeParams=(params:Record<string,unknown>|undefined)=>{
  if(!params)return undefined;
  const safe=Object.fromEntries(Object.entries(params).filter(([key,value])=>safeKeys.has(key)&&['string','number','boolean'].includes(typeof value)));
  return Object.keys(safe).length?safe:undefined;
};
const copy=(value:AtlasPanelDescriptor):AtlasPanelDescriptor=>({...value,params:safeParams(value.params),minimized:Boolean(value.minimized)});

export class PanelRegistry {
  #panels=new Map<string,AtlasPanelDescriptor>();
  remember(descriptor:AtlasPanelDescriptor){const value=copy(descriptor);this.#panels.set(value.id,value);return copy(value)}
  get(id:string){const value=this.#panels.get(id);return value?copy(value):undefined}
  all(){return [...this.#panels.values()].map(copy)}
  minimize(id:string){const value=this.#panels.get(id);if(!value)return undefined;value.minimized=true;return copy(value)}
  restore(id:string){const value=this.#panels.get(id);if(!value)return undefined;value.minimized=false;return copy(value)}
  forget(id:string){this.#panels.delete(id)}
  persistable(){return this.all()}
}
