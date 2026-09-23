import {RuntimeDiscovery} from '../discovery/runtime-discovery.js';
import type {CommandExecutor} from '../transports/terminal-command.js';
import {redactCommandLine} from '../discovery/redaction.js';
import {candidateId,exposureFor,normalizeAddress,type HttpPortCandidate,type PortScanResult} from './types.js';
import {probeHttpPorts} from './http-probe.js';

function splitAddress(value:string):{address:string;port:number}|undefined{const match=value.match(/^(.+):(\d+)$/);if(!match)return;const port=Number(match[2]);if(!Number.isInteger(port)||port<1||port>65535)return;return{address:normalizeAddress(match[1]),port}}
export class PortDiscoveryService{
  constructor(readonly executorFor:(contextId:string)=>Promise<CommandExecutor>){}
  async scan(contextId:string,signal?:AbortSignal):Promise<PortScanResult>{
    const executor=await this.executorFor(contextId),entities=await new RuntimeDiscovery(executor).scan(contextId,'ports',signal),processes=new Map<number,any>();
    for(const entity of entities)if(entity.type==='process'&&Number.isInteger(entity.metadata?.pid))processes.set(Number(entity.metadata!.pid),entity);
    const observedAt=new Date().toISOString(),raw:HttpPortCandidate[]=[];
    for(const entity of entities){if(entity.type!=='port'||String(entity.metadata?.protocol??'').toLowerCase()!=='tcp')continue;const value=splitAddress(String(entity.metadata?.address??entity.name));if(!value)continue;const pid=Number.isInteger(entity.metadata?.pid)?Number(entity.metadata!.pid):undefined,process=pid?processes.get(pid):undefined;raw.push({id:candidateId(contextId,value.address,value.port,pid),contextId,address:value.address,port:value.port,protocol:'http',state:'listening',pid,processLabel:process?.name,processCommand:process?.metadata?.command?redactCommandLine(String(process.metadata.command)).slice(0,500):undefined,cwd:typeof process?.metadata?.cwd==='string'?process.metadata.cwd.slice(0,2000):undefined,exposure:exposureFor(value.address),probe:'pending',probePath:'/',observedAt,stale:false})}
    const unique=[...new Map(raw.map(value=>[value.id,value])).values()].slice(0,32),probed=await probeHttpPorts(executor,unique,{signal});return{contextId,scannedAt:observedAt,candidates:probed.results,errors:probed.errors};
  }
}
