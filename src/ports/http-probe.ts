import type {CommandExecutor} from '../transports/terminal-command.js';
import {posixQuote} from '../transports/posix.js';
import type {HttpPortCandidate,PortShareError,ProbeState} from './types.js';
import {boundedText,normalizeAddress} from './types.js';

export interface ProbeResult {probe:ProbeState;probeStatus?:number;probeTitle?:string;probePath:string}
export interface ProbeOptions {timeoutMs?:number;maxBodyBytes?:number;signal?:AbortSignal}

function probeHost(address:string){const value=normalizeAddress(address);return ['0.0.0.0','::','*'].includes(value)?'127.0.0.1':value}
function urlFor(candidate:Pick<HttpPortCandidate,'address'|'port'>){const host=probeHost(candidate.address),literal=host.includes(':')?`[${host}]`:host;return `http://${literal}:${candidate.port}/`}
function parse(raw:string):ProbeResult{
  const status=raw.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/mi),title=raw.match(/<title[^>]*>([^<]{0,1000})<\/title>/i)?.[1];
  if(!status)return{probe:'not-http',probePath:'/'};
  return{probe:'http',probeStatus:Number(status[1]),probeTitle:boundedText(title?.replace(/\s+/g,' '),200),probePath:'/'};
}
export async function probeHttpPort(executor:CommandExecutor,candidate:Pick<HttpPortCandidate,'address'|'port'>,options:ProbeOptions={}):Promise<ProbeResult>{
  const timeoutMs=Math.min(10_000,Math.max(250,options.timeoutMs??2_000)),max=Math.min(16*1024,Math.max(1024,options.maxBodyBytes??16*1024)),url=urlFor(candidate),seconds=(timeoutMs/1000).toFixed(3);
  const common=`curl -sS --noproxy '*' --connect-timeout ${seconds} --max-time ${seconds} --max-redirs 0`;
  const command=`if command -v curl >/dev/null 2>&1; then out=$(${common} -I ${posixQuote(url)} 2>/dev/null | head -c ${max}); case "$out" in HTTP/*) printf '%s' "$out";; *) ${common} -D - -o - ${posixQuote(url)} 2>/dev/null | head -c ${max}; test "\${PIPESTATUS[0]:-0}" -eq 0;; esac; else (exec 3<>/dev/tcp/${posixQuote(probeHost(candidate.address))}/${candidate.port}) >/dev/null 2>&1 && printf '__ATLAS_TCP_ONLY__'; fi`;
  try{const result=await executor.execute(command,{timeoutMs:timeoutMs+500,signal:options.signal}),raw=result.output.toString('utf8');if(raw.includes('__ATLAS_TCP_ONLY__'))return{probe:'not-http',probePath:'/'};if(result.exitCode!==0&&!raw)return{probe:result.exitCode===28?'timed-out':'unreachable',probePath:'/'};return parse(raw)}catch(error){return{probe:(error as {code?:string}).code==='timeout'?'timed-out':'unreachable',probePath:'/'}}
}
export async function probeHttpPorts(executor:CommandExecutor,candidates:HttpPortCandidate[],options:ProbeOptions&{maxCandidates?:number;deadlineMs?:number}={}):Promise<{results:HttpPortCandidate[];errors:PortShareError[]}>{
  const selected=candidates.slice(0,Math.min(32,Math.max(1,options.maxCandidates??32))),deadline=Date.now()+Math.min(60_000,Math.max(1000,options.deadlineMs??15_000)),results:HttpPortCandidate[]=[],errors:PortShareError[]=[];
  for(const candidate of selected){if(options.signal?.aborted)break;const remaining=deadline-Date.now();if(remaining<=0){errors.push({port:candidate.port,code:'scan_deadline',message:'HTTP port scan deadline reached.'});break}try{results.push({...candidate,...await probeHttpPort(executor,candidate,{...options,timeoutMs:Math.min(options.timeoutMs??2_000,remaining)})})}catch(error){errors.push({port:candidate.port,code:String((error as any)?.code??'probe_failed'),message:String((error as Error).message).slice(0,300)});results.push({...candidate,probe:'unreachable'})}}
  return{results,errors};
}
