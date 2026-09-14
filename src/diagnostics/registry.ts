import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {redactCommandLine} from '../discovery/redaction.js';

export type DiagnosticKind='live-project'|'fngk-relay'|'dbgate';
export type DiagnosticStatus='starting'|'running'|'failed'|'unknown'|'stopped'|'expired';
export type DiagnosticSession={
  id:string;kind:DiagnosticKind;contextId?:string;status:DiagnosticStatus;createdAt:string;updatedAt:string;
  command?:string;argv?:string[];terminalSessionId?:string;linkedSessionId?:string;stdout:string;stderr:string;events:Array<Record<string,unknown>>;
  errorCode?:string;error?:string;exitCode?:number;metadata:Record<string,unknown>;
};

const redact=(value:string)=>redactCommandLine(value)
  .replace(/(password\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]')
  .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi,'$1[redacted]')
  .replace(/(cookie\s*[:=]\s*)[^\r\n]+/gi,'$1[redacted]');

export class DiagnosticRegistry extends EventEmitter {
  #sessions=new Map<string,DiagnosticSession>();
  readonly outputLimit:number;
  constructor(options:{outputLimit?:number}={}){super();this.outputLimit=options.outputLimit??256*1024}
  create(input:Pick<DiagnosticSession,'kind'|'contextId'|'command'|'argv'|'terminalSessionId'|'linkedSessionId'|'metadata'>):DiagnosticSession{
    const now=new Date().toISOString(),value:DiagnosticSession={id:randomUUID(),kind:input.kind,status:'starting',createdAt:now,updatedAt:now,contextId:input.contextId,command:input.command?redact(input.command):undefined,argv:input.argv?.map(redact),terminalSessionId:input.terminalSessionId,linkedSessionId:input.linkedSessionId,stdout:'',stderr:'',events:[],metadata:input.metadata??{}};
    this.#sessions.set(value.id,value);this.#emit(value);return this.#copy(value);
  }
  get(id:string){const value=this.#sessions.get(id);return value&&this.#copy(value)}
  list(){return [...this.#sessions.values()].map(value=>this.#copy(value))}
  update(id:string,patch:Partial<Pick<DiagnosticSession,'status'|'errorCode'|'error'|'exitCode'|'terminalSessionId'|'linkedSessionId'|'metadata'>>){const value=this.#sessions.get(id);if(!value)return undefined;Object.assign(value,patch,{updatedAt:new Date().toISOString()});this.#emit(value);return this.#copy(value)}
  append(id:string,stream:'stdout'|'stderr',chunk:string){const value=this.#sessions.get(id);if(!value)return undefined;value[stream]=(value[stream]+redact(chunk)).slice(-this.outputLimit);value.updatedAt=new Date().toISOString();this.#emit(value);return this.#copy(value)}
  event(id:string,event:Record<string,unknown>){const value=this.#sessions.get(id);if(!value)return undefined;value.events=[...value.events,JSON.parse(JSON.stringify(event,(key,child)=>key==='body'||key==='bodyBase64'||key==='raw'?'[redacted]':typeof child==='string'?redact(child):child))].slice(-500);value.updatedAt=new Date().toISOString();this.#emit(value);return this.#copy(value)}
  clear(id:string){return this.#sessions.delete(id)}
  #copy(value:DiagnosticSession){return {...value,argv:value.argv&&[...value.argv],events:value.events.map(event=>({...event})),metadata:{...value.metadata}}}
  #emit(value:DiagnosticSession){this.emit('changed',this.#copy(value))}
}
