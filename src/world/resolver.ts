import {createHash} from 'node:crypto';
import type {AtlasAssertion,AtlasEntity,InterpreterInput,InterpreterOutput} from './types.js';
import {worldId} from './interpreter.js';

type Candidate={key:string;label:string;inputs:InterpreterInput[];confidence:number};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():undefined;
const attrs=(input:InterpreterInput)=>input.attributes??{};

/** Resolve technical observations into stable logical workloads.
 * Strong operational anchors join observations; weak labels only name a fallback.
 */
export function resolveWorkloads(inputs:InterpreterInput[],clock=()=>new Date().toISOString()):InterpreterOutput{
 const groups=new Map<string,Candidate>();
 for(const input of inputs.slice(0,10_000)){
  if(!['service','process','container','repository','database','port'].includes(input.kind))continue;
  const a=attrs(input), unit=text(a.systemdUnit??a.unit), service=text(a.serviceName), container=text(a.containerId??a.container_id), repo=text(a.repositoryPath??a.root??(input.kind==='repository'?a.path:undefined));
  const endpoint=text(a.endpoint??a.socket??a.address), engine=text(a.engine??a.databaseEngine);
  const anchor=unit?`systemd:${unit}`:service?`service:${service}`:container?`container:${container}`:repo?`repository:${repo}`:engine&&endpoint?`database:${engine}:${endpoint}`:input.kind==='database'?`database:${input.label}`:input.kind==='service'?`service:${input.label}`:undefined;
  if(!anchor)continue;
  const key=`${input.contextId}\0${anchor}`, current=groups.get(key);
  if(current){current.inputs.push(input);continue}
  groups.set(key,{key,label:text(a.displayName??a.name)??input.label,inputs:[input],confidence:unit?.98:container?.95:repo?.9:.82});
 }
 const entities:AtlasEntity[]=[],assertions:AtlasAssertion[]=[],at=clock();
 for(const group of [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key))){
  const contextId=group.inputs[0].contextId,id=worldId(contextId,'atlas.resolver','workload',group.key),first=group.inputs.map(v=>v.observedAt).sort()[0]??at,last=group.inputs.map(v=>v.observedAt).sort().at(-1)??at;
  const aliases=[...new Set(group.inputs.map(v=>v.label).filter(v=>v!==group.label))];
  entities.push({id,contextId,kind:'workload',namespace:'atlas.resolver',label:group.label,aliases,attributes:{anchor:group.key.slice(group.key.indexOf('\0')+1),memberObservationIds:group.inputs.map(v=>v.id),memberKinds:[...new Set(group.inputs.map(v=>v.kind))]},firstObservedAt:first,lastObservedAt:last,stale:group.inputs.some(v=>v.stale)});
  for(const input of group.inputs){
   const aid=worldId(contextId,'atlas.resolver','assertion',`${group.key}:realizes:${input.id}`);
   assertions.push({id:aid,contextId,subjectId:id,predicate:'realizes',objectId:input.id,classification:'derived',confidence:group.confidence,explanation:'A stable operational anchor connects this workload to the observed technical entity.',evidence:[{observationId:input.id,method:input.source}],interpreterId:'atlas.resolver',interpreterVersion:'1.0.0',observedAt:input.observedAt,derivedAt:at,stale:Boolean(input.stale)});
  }
  const labels=`${group.label} ${aliases.join(' ')}`.toLowerCase(),capabilities:string[]=[];
  if(/postgres|postgresql|database|redis|mysql|mariadb/.test(labels)||group.inputs.some(v=>/postgres|redis|mysql/i.test(JSON.stringify(v.attributes))))capabilities.push(/postgres|postgresql/.test(labels)?'relational-storage':'persistent-storage');
  if(group.inputs.some(v=>v.kind==='port'||/http|https|web|svelte|fastify|signal/i.test(JSON.stringify(v.attributes))))capabilities.push('http-serving');
  if(/signal|fngk/.test(labels))capabilities.push('remote-machine-control');
  for(const capability of [...new Set(capabilities)]){
   const objectId=worldId(contextId,'atlas.core','capability',capability), existing=entities.some(v=>v.id===objectId);
   if(!existing)entities.push({id:objectId,contextId,kind:'capability',namespace:'atlas.core',label:capability,aliases:[],attributes:{},firstObservedAt:first,lastObservedAt:last,stale:group.inputs.some(v=>v.stale)});
   assertions.push({id:worldId(contextId,'atlas.resolver','assertion',`${id}:provides:${objectId}`),contextId,subjectId:id,predicate:'provides-capability',objectId,classification:'derived',confidence:Math.min(1,group.confidence+.03),explanation:'The workload identity and its observed metadata support this capability.',evidence:group.inputs.map(v=>({observationId:v.id,method:v.source})),interpreterId:'atlas.resolver',interpreterVersion:'1.0.0',observedAt:last,derivedAt:at,stale:group.inputs.some(v=>v.stale)});
  }
 }
 return {entities,assertions,views:[]};
}

export const resolverInputId=(contextId:string,kind:string,key:string)=>`observation:${createHash('sha256').update(`${contextId}\0${kind}\0${key}`).digest('hex').slice(0,28)}`;
