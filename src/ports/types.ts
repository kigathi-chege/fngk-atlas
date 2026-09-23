import {createHash} from 'node:crypto';

export type PortExposure='loopback'|'lan'|'all-interfaces'|'unknown';
export type ProbeState='pending'|'http'|'not-http'|'unreachable'|'timed-out';
export type PortShareStatus='publishing'|'published'|'stopping'|'stopped'|'stale'|'failed';

export interface HttpPortCandidate {
  id:string;contextId:string;address:string;port:number;protocol:'http';state:'listening';pid?:number;
  processLabel?:string;processCommand?:string;cwd?:string;exposure:PortExposure;probe:ProbeState;
  probeStatus?:number;probeTitle?:string;probePath:string;observedAt:string;stale:boolean;
}
export interface PublishedPort {
  id:string;candidateId:string;contextId:string;port:number;connectionId:string;hostname:string;url:string;
  publishedAt:string;stoppedAt?:string;expiresAt?:string;status:PortShareStatus;diagnosticSessionId?:string;error?:string;
}
export interface PortShareError {port?:number;code:string;message:string}
export interface PortScanResult {contextId:string;scannedAt:string;candidates:HttpPortCandidate[];errors:PortShareError[]}

export function normalizeAddress(value:string):string{
  const address=value.trim().replace(/^\[|\]$/g,'');
  return address==='*'?'0.0.0.0':address;
}
export function exposureFor(address:string):PortExposure{
  const value=normalizeAddress(address).toLowerCase();
  if(['0.0.0.0','::'].includes(value))return'all-interfaces';
  if(value==='localhost'||value==='::1'||value.startsWith('127.'))return'loopback';
  if(/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(value)||value.startsWith('fc')||value.startsWith('fd'))return'lan';
  return'unknown';
}
export function candidateId(contextId:string,address:string,port:number,pid?:number):string{
  return createHash('sha256').update(`${contextId}\0http\0${normalizeAddress(address)}\0${port}\0${pid??''}`).digest('hex').slice(0,32);
}
export function boundedText(value:unknown,limit:number):string|undefined{
  if(typeof value!=='string')return undefined;const result=value.replace(/[\u0000-\u001f]+/g,' ').trim().slice(0,limit);return result||undefined;
}
