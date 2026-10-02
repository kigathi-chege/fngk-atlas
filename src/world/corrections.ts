import { createHash } from 'node:crypto';
import type { AtlasAssertion, AtlasEntity } from './types.js';

export type AtlasCorrectionKind = 'rename' | 'purpose' | 'group' | 'ignore' | 'split' | 'merge';
export interface AtlasCorrection {
  id: string;
  contextId: string;
  subjectId: string;
  kind: AtlasCorrectionKind;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

export const correctionId = (contextId:string,subjectId:string,kind:AtlasCorrectionKind) =>
  `correction:${createHash('sha256').update(`${contextId}\0${subjectId}\0${kind}`).digest('hex').slice(0,24)}`;

export function validateCorrection(contextId:string,subjectId:string,kind:AtlasCorrectionKind,value:unknown,entities:AtlasEntity[]) {
  const byId=new Map(entities.map(entity=>[entity.id,entity])),subject=byId.get(subjectId);
  if(!subject||subject.contextId!==contextId)throw new Error('entity_not_found');
  if(kind==='rename'||kind==='purpose'){
    if(typeof value!=='string'||!value.trim()||value.length>240)throw new Error('invalid_correction');
  }else if(kind==='group'){
    if(!['applications','data','infrastructure','development','system','external'].includes(String(value)))throw new Error('invalid_correction');
  }else if(kind==='ignore'){
    if(value!==true)throw new Error('invalid_correction');
  }else if(kind==='merge'){
    const target=byId.get(String(value));
    if(subject.kind!=='workload'||!target||target.contextId!==contextId||target.kind!=='workload'||target.id===subject.id)throw new Error('invalid_correction');
  }else if(kind==='split'){
    const split=value as {memberIds?:unknown;label?:unknown};
    if(subject.kind!=='workload'||!split||!Array.isArray(split.memberIds)||!split.memberIds.length||split.memberIds.length>100||typeof split.label!=='string'||!split.label.trim()||split.label.length>120)throw new Error('invalid_correction');
    if(split.memberIds.some(id=>typeof id!=='string'||byId.get(id)?.workloadId!==subject.id))throw new Error('invalid_correction');
  }else throw new Error('invalid_correction');
}

export function applyCorrections(entities:AtlasEntity[],assertions:AtlasAssertion[],corrections:AtlasCorrection[]){
  const corrected=new Map(entities.map(entity=>[entity.id,{...entity,attributes:{...entity.attributes}}])),extra:AtlasAssertion[]=[];
  for(const correction of corrections){
    const entity=corrected.get(correction.subjectId);if(!entity)continue;
    const assertion=(predicate:string,value:unknown,objectId?:string):AtlasAssertion=>({
      id:`${correction.id}:assertion`,contextId:correction.contextId,subjectId:correction.subjectId,predicate,objectId,value,
      classification:'user-defined',confidence:1,explanation:`A user explicitly corrected this ${correction.kind}; collected evidence is unchanged.`,
      evidence:[{observationId:correction.id,method:'user-correction',authority:'user'}],interpreterId:'atlas.user-corrections',interpreterVersion:'1.0.0',
      observedAt:correction.updatedAt,derivedAt:correction.updatedAt,stale:false,
    });
    if(correction.kind==='rename'){entity.label=String(correction.value);extra.push(assertion('has-name',correction.value));}
    else if(correction.kind==='purpose')extra.push(assertion('has-purpose',correction.value));
    else if(correction.kind==='group'){entity.attributes.region=correction.value;extra.push(assertion('in-region',correction.value));}
    else if(correction.kind==='ignore'){corrected.delete(entity.id);extra.push(assertion('ignored-by-user',true));}
    else if(correction.kind==='merge'){
      const target=corrected.get(String(correction.value));if(!target)continue;
      for(const child of corrected.values())if(child.workloadId===entity.id)child.workloadId=target.id;
      corrected.delete(entity.id);extra.push(assertion('merged-into',undefined,target.id));
    }else if(correction.kind==='split'){
      const split=correction.value as {memberIds:string[];label:string},id=`workload:split:${correction.id}`;
      const clone:AtlasEntity={...entity,id,label:split.label,aliases:[],attributes:{...entity.attributes,visibility:'primary',memberObservationIds:[],splitFrom:entity.id}};
      corrected.set(id,clone);
      for(const childId of split.memberIds){const child=corrected.get(childId);if(child?.workloadId===entity.id)child.workloadId=id;}
      extra.push(assertion('split-into',undefined,id));
    }
  }
  return{entities:[...corrected.values()],assertions:[...assertions,...extra]};
}
