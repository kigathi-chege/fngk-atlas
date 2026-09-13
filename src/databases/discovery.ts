import {createHash} from 'node:crypto';
import type {CommandExecutor} from '../transports/terminal-command.js';
import type {DatabaseEngine,DatabaseResource} from './types.js';

const ports:Record<number,DatabaseEngine>={5432:'postgres',3306:'mysql',6379:'redis',27017:'mongodb',1433:'mssql',1521:'oracle'};
const names:Array<[RegExp,DatabaseEngine]>=[[/\bpostgres(?:ql)?\b/i,'postgres'],[/\bmysqld\b/i,'mysql'],[/\bmariadbd\b/i,'mariadb'],[/\bredis-server\b/i,'redis'],[/\bmongod\b/i,'mongodb'],[/\bsqlservr\b/i,'mssql'],[/\boracle\b/i,'oracle']];
type NativeResource={id:string;deviceId?:string;name?:string;kind?:string;status?:string;availability?:string;provenance?:string;capabilities?:string[];attributes?:Record<string,unknown>;lastObservedAt?:string};

export async function discoverDatabases(contextId:string,executor?:CommandExecutor,nativeResources:NativeResource[]=[]):Promise<{items:DatabaseResource[];errors:Array<{probe:string;message:string}>}>{
  const errors:Array<{probe:string;message:string}>=[];let output='';
  if(executor)try{output=(await executor.execute("(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || true); printf '\\n__ATLAS_PS__\\n'; ps -eo comm=,args= 2>/dev/null | head -2000",{timeoutMs:15_000})).output.toString('utf8')}catch(error){errors.push({probe:'database-census',message:(error as Error).message});}
  else errors.push({probe:'database-census',message:'No terminal command route was available.'});
  const items=new Map<string,DatabaseResource>(),observedAt=new Date().toISOString();
  for(const line of output.split(/\r?\n/)){
    const portMatches=[...line.matchAll(/(?:\*|\[[^\]]+\]|[\d.:]+):(\d{2,5})\b/g)];let engine:DatabaseEngine|undefined;
    for(const [pattern,value] of names)if(pattern.test(line)){engine=value;break}
    for(const match of portMatches){const port=Number(match[1]),resolved=engine??ports[port];if(!resolved)continue;const key=`${resolved}:127.0.0.1:${port}`;items.set(key,{id:createHash('sha256').update(`${contextId}:${key}`).digest('hex').slice(0,24),contextId,engine:resolved,host:'127.0.0.1',port,source:'terminal',evidence:{kind:'listening_socket',line:line.slice(0,300),terminal:true},observedAt});}
  }
  for(const resource of nativeResources){
    const engine=String(resource.kind??'').split('.')[0] as DatabaseEngine;if(!names.some(([,value])=>value===engine))continue;
    const host=String(resource.attributes?.host??'127.0.0.1'),port=Number(resource.attributes?.port)||undefined,key=`${engine}:${host}:${port??''}`,prior=items.get(key);
    const native={nativeResourceId:resource.id,nativeStatus:resource.status,nativeAvailability:resource.availability,nativeCapabilities:resource.capabilities??[]};
    if(prior){prior.evidence={...prior.evidence,...native};continue}
    items.set(key,{id:createHash('sha256').update(`${contextId}:${key}`).digest('hex').slice(0,24),contextId,engine,host,port,source:'adapter',evidence:native,observedAt:resource.lastObservedAt??observedAt,stale:resource.availability==='unavailable'});
  }
  return {items:[...items.values()],errors};
}
