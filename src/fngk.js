import { randomUUID } from 'node:crypto';

export class FngkConnections {
  constructor(store){this.store=store;this.active=null;this.secrets=new Map();}
  configure({name,baseUrl,teamId,session,credential}){
    const url=new URL(baseUrl);if(!['http:','https:'].includes(url.protocol))throw new Error('FNGK URL must use HTTP or HTTPS');
    const id=randomUUID();const authKind=credential?'operator':'session';
    this.active={id,name:name||url.host,baseUrl:url.origin,teamId,authKind};
    this.secrets.set(id,credential?{authorization:`Bearer ${credential}`}:{cookie:`__Host-signal_session=${session}`});
    this.store.saveDeployment(this.active);return this.active;
  }
  async request(pathname,{method='GET',body}={}){
    if(!this.active)throw new Error('No active FNGK deployment');const secret=this.secrets.get(this.active.id);if(!secret)throw new Error('This deployment needs an ephemeral credential for this Atlas session');
    const headers={accept:'application/json',...(secret.authorization?{authorization:secret.authorization}:{cookie:secret.cookie})};if(body)headers['content-type']='application/json';
    const response=await fetch(new URL(pathname,this.active.baseUrl),{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const text=await response.text();let value;try{value=JSON.parse(text)}catch{value={raw:text}}if(!response.ok)throw Object.assign(new Error(value.error??`FNGK returned ${response.status}`),{statusCode:response.status,detail:value});return value;
  }
  async bootstrap(cursor){const q=new URLSearchParams({teamId:this.active.teamId,mode:'graph',limit:'100'});if(cursor)q.set('cursor',cursor);const graph=await this.request(`/api/workspace/bootstrap?${q}`);if(cursor)return graph;const summaryQuery=new URLSearchParams({teamId:this.active.teamId,mode:'summary'});const summary=await this.request(`/api/workspace/bootstrap?${summaryQuery}`);return {...summary,...graph};}
  async bootstrapAll(maxPages=5){let value=await this.bootstrap(),cursor=value.nextCursor,pages=1;while(value.hasMore&&cursor&&pages<maxPages){const next=await this.bootstrap(cursor);value={...value,resources:[...(value.resources||[]),...(next.resources||[])],adapters:[...(value.adapters||[]),...(next.adapters||[])],events:[...(value.events||[]),...(next.events||[])],nextCursor:next.nextCursor,hasMore:next.hasMore};cursor=next.nextCursor;pages++;}value.adapters=[...new Map((value.adapters||[]).map(a=>[`${a.device_id}:${a.adapter_id}`,a])).values()];value.events=[...new Map((value.events||[]).map(e=>[e.id,e])).values()];return {...value,pagesLoaded:pages};}
}
