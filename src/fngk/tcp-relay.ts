import {spawn,type ChildProcess} from 'node:child_process';
import {FngkProcessError} from './process-client.js';

export const TCP_PROTOCOL='fngk.tcp.v1' as const;
export interface TcpRelay {host:string;port:number;target:string;targetPort:number;profile?:string;close():Promise<void>}
export interface TcpRelayProvider {start(target:string,targetPort:number,options?:{profile?:string;signal?:AbortSignal}):Promise<TcpRelay>}

export class FngkTcpRelayProvider implements TcpRelayProvider {
  constructor(readonly options:{binary?:string;env?:NodeJS.ProcessEnv;startupMs?:number}={}){}
  async start(target:string,targetPort:number,options:{profile?:string;signal?:AbortSignal}={}):Promise<TcpRelay>{
    if(!Number.isInteger(targetPort)||targetPort<1||targetPort>65535)throw new FngkProcessError('invalid_port','Database target port is invalid.');
    const args=['tcp',target,String(targetPort),'--listen','127.0.0.1:0','--stdio-json'];if(options.profile)args.push('--profile',options.profile);
    const child=spawn(this.options.binary??process.env.FNGK_BIN??'fngk',args,{env:{...process.env,...this.options.env},stdio:['ignore','pipe','pipe']});
    return await waitForRelay(child,target,targetPort,options.profile,this.options.startupMs??15_000,options.signal);
  }
}

async function waitForRelay(child:ChildProcess,target:string,targetPort:number,profile:string|undefined,timeoutMs:number,signal?:AbortSignal):Promise<TcpRelay>{
  return await new Promise((resolve,reject)=>{
    let stdout='',stderr='',settled=false;
    const finish=(error?:Error,value?:TcpRelay)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);if(error){child.kill('SIGTERM');reject(error)}else resolve(value!)};
    const cancel=()=>finish(new FngkProcessError('cancelled','FNGK TCP relay was cancelled.'));
    const timer=setTimeout(()=>finish(new FngkProcessError('timeout','FNGK TCP relay did not become ready.')),timeoutMs);timer.unref();
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    child.stderr?.on('data',chunk=>stderr=(stderr+chunk.toString('utf8')).slice(-16_384));
    child.stdout?.on('data',chunk=>{stdout+=chunk.toString('utf8');if(stdout.length>65_536)return finish(new FngkProcessError('output_limit','FNGK TCP relay readiness exceeded its output limit.'));const newline=stdout.indexOf('\n');if(newline<0)return;try{const value=JSON.parse(stdout.slice(0,newline));if(value.protocolVersion!==TCP_PROTOCOL||value.type!=='ready'||value.listenHost!=='127.0.0.1'||!Number.isInteger(value.listenPort))throw new Error('invalid readiness');finish(undefined,{host:value.listenHost,port:value.listenPort,target,targetPort,profile,close:async()=>{if(child.exitCode!==null)return;child.kill('SIGTERM');await new Promise<void>(done=>{const timer=setTimeout(done,2_000);timer.unref();child.once('exit',()=>{clearTimeout(timer);done()})})}})}catch{finish(new FngkProcessError('unsupported_protocol','FNGK returned invalid TCP relay readiness.'))}});
    child.once('error',error=>finish(new FngkProcessError((error as NodeJS.ErrnoException).code==='ENOENT'?'binary_missing':'process_error',error.message)));
    child.once('exit',code=>finish(new FngkProcessError('relay_failed',stderr||`FNGK TCP relay exited with code ${code}.`,code)));
  });
}
