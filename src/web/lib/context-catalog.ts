import {api} from './api.js';

let cached:{expiresAt:number;value:any}|undefined;
let pending:Promise<any>|undefined;

export function loadContextCatalog(force=false):Promise<any>{
  if(!force&&cached&&cached.expiresAt>Date.now())return Promise.resolve(cached.value);
  if(pending)return pending;
  const request=api<any>(`/api/contexts${force?'?refresh=1':''}`).then(value=>{cached={value,expiresAt:Date.now()+10_000};return value}).finally(()=>{if(pending===request)pending=undefined});
  pending=request;return request;
}

export function clearContextCatalog(){cached=undefined;}
