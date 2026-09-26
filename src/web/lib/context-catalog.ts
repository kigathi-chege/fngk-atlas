import {api} from './api.js';

const cached=new Map<string,{expiresAt:number;value:any}>();
const pending=new Map<string,Promise<any>>();

export function loadContextCatalog(force=false,profile?:string):Promise<any>{
  const selected=profile??'',cachedValue=cached.get(selected);if(!force&&cachedValue&&cachedValue.expiresAt>Date.now())return Promise.resolve(cachedValue.value);
  const active=pending.get(selected);if(active)return active;
  const params=new URLSearchParams();if(force)params.set('refresh','1');if(profile)params.set('profile',profile);
  const request=api<any>(`/api/contexts${params.size?`?${params}`:''}`).then(value=>{cached.set(selected,{value,expiresAt:Date.now()+10_000});return value}).finally(()=>{if(pending.get(selected)===request)pending.delete(selected)});
  pending.set(selected,request);return request;
}

export function clearContextCatalog(){cached.clear();}
