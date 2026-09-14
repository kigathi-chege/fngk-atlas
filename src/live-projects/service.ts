import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { FngkProcessClient } from '../fngk/process-client.js';
import type { TerminalSession } from '../fngk/terminal-session.js';
import type { CommandExecutor } from '../transports/terminal-command.js';

export type LiveProjectStatus = 'starting'|'running'|'stopping'|'stopped'|'failed'|'expired';
export type LiveProjectSession = {
  id:string;contextId:string;repositoryPath:string;command:string;port:number;status:LiveProjectStatus;
  createdAt:string;expiresAt:string;terminalSessionId?:string;connectionId?:string;hostname?:string;url?:string;
  output:string;exitCode?:number;error?:string;
};

type InternalSession = LiveProjectSession & { terminal:TerminalSession; timer:NodeJS.Timeout; requestId:string };
const quote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;

export class LiveProjectService extends EventEmitter {
  #sessions=new Map<string,InternalSession>();
  constructor(readonly fngk:FngkProcessClient,readonly commandExecutor:(contextId:string)=>Promise<CommandExecutor>,readonly options:{ttlMs?:number;outputLimit?:number;startupMs?:number}={}){super()}

  list():LiveProjectSession[]{return [...this.#sessions.values()].map(value=>this.#public(value))}
  get(id:string):LiveProjectSession|undefined{const value=this.#sessions.get(id);return value?this.#public(value):undefined}
  #public(value:InternalSession):LiveProjectSession{const {terminal:_terminal,timer:_timer,requestId:_requestId,...session}=value;return {...session}}
  #changed(value:InternalSession){this.emit('changed',this.#public(value))}

  async start(input:{contextId:string;repositoryPath:string;command:string;port:number;ttlMs?:number}):Promise<LiveProjectSession>{
    if(!input.contextId.startsWith('device:'))throw Object.assign(new Error('Live projects currently require an FNGK Device context.'),{code:'device_context_required'});
    if(!input.repositoryPath.startsWith('/'))throw Object.assign(new Error('An absolute repository path is required.'),{code:'invalid_repository_path'});
    if(!input.command.trim()||input.command.length>4096)throw Object.assign(new Error('A bounded project command is required.'),{code:'invalid_command'});
    if(!Number.isInteger(input.port)||input.port<1||input.port>65535)throw Object.assign(new Error('Project port is invalid.'),{code:'invalid_port'});
    const state=await this.fngk.probe();if(!state.compatible)throw Object.assign(new Error('FNGK is not ready for a live project.'),{code:state.reason??'fngk_unavailable'});
    const terminal=this.fngk.openTerminal(input.contextId,{newSession:true,profile:state.profile});
    await this.#waitReady(terminal);
    const id=randomUUID(),requestId=`project-${id}`,ttl=Math.min(24*60*60_000,Math.max(60_000,input.ttlMs??60*60_000)),createdAt=new Date(),timer=setTimeout(()=>void this.stop(id,'expired'),ttl);timer.unref();
    const session:InternalSession={id,contextId:input.contextId,repositoryPath:input.repositoryPath,command:input.command.trim(),port:input.port,status:'starting',createdAt:createdAt.toISOString(),expiresAt:new Date(createdAt.getTime()+ttl).toISOString(),terminalSessionId:terminal.sessionId,output:'',terminal,timer,requestId};
    this.#sessions.set(id,session);this.#listen(session);
    if(!terminal.setMode('queue',`mode-${id}`)){await this.stop(id);throw Object.assign(new Error('Project terminal rejected queue mode.'),{code:'terminal_unavailable'})}
    await this.#waitMode(terminal,'queue');
    if(!terminal.sendCommand(`cd -- ${quote(input.repositoryPath)} && exec ${input.command.trim()}`,requestId)){await this.stop(id);throw Object.assign(new Error('Project terminal rejected the command.'),{code:'terminal_unavailable'})}
    try{
      await this.#waitRunning(session);
      const result=await (await this.commandExecutor(input.contextId)).execute(`fngk publish ${input.port} --json`,{timeoutMs:30_000});
      if(result.exitCode!==0)throw new Error(result.output.toString('utf8')||'FNGK publish failed.');
      const published=JSON.parse(result.output.toString('utf8').trim());
      if(published.protocolVersion!=='fngk.publish.v1'||published.type!=='published'||!published.hostname)throw new Error('FNGK returned invalid publish metadata.');
      Object.assign(session,{status:'running',connectionId:published.connectionId,hostname:published.hostname,url:published.url||`https://${published.hostname}`});this.#changed(session);return this.#public(session);
    }catch(error){session.status='failed';session.error=(error as Error).message;terminal.stop(`failed-${id}`);clearTimeout(timer);this.#changed(session);throw Object.assign(error as Error,{code:(error as any).code??'project_start_failed'})}
  }

  #listen(session:InternalSession){
    session.terminal.on('event',(event:any)=>{if((event.type==='output'||event.type==='replay')&&event.bodyBase64){const chunk=Buffer.from(event.bodyBase64,'base64').toString('utf8'),limit=this.options.outputLimit??256*1024;session.output=(session.output+chunk).slice(-limit);this.#changed(session)}if(event.type==='command_state'&&event.requestId===session.requestId&&['succeeded','failed'].includes(event.status)){session.exitCode=Number(event.exitCode??(event.status==='succeeded'?0:1));if(session.status==='running'||session.status==='starting')session.status=session.exitCode===0?'stopped':'failed';this.#changed(session)}});
    session.terminal.once('error',(error:Error)=>{session.error=error.message;if(!['stopped','expired'].includes(session.status))session.status='failed';this.#changed(session)});
    session.terminal.once('close',()=>{if(!['stopped','failed','expired'].includes(session.status))session.status='stopped';this.#changed(session)});
  }

  async #waitReady(terminal:TerminalSession):Promise<void>{if(terminal.sessionId)return;await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>done(Object.assign(new Error('Project terminal did not become ready.'),{code:'timeout'})),this.options.startupMs??15_000);timeout.unref();const ready=()=>done(),error=(value:Error)=>done(value),close=()=>done(Object.assign(new Error('Project terminal closed before readiness.'),{code:'terminal_closed'}));const done=(failure?:Error)=>{clearTimeout(timeout);terminal.off('ready',ready);terminal.off('error',error);terminal.off('close',close);failure?reject(failure):resolve()};terminal.once('ready',ready);terminal.once('error',error);terminal.once('close',close)})}
  async #waitMode(terminal:TerminalSession,mode:string):Promise<void>{await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>done(Object.assign(new Error(`Project terminal did not enter ${mode} mode.`),{code:'timeout'})),this.options.startupMs??15_000);timeout.unref();const event=(value:any)=>{if(value.type==='collaboration'&&value.mode===mode)done();if(value.type==='error')done(Object.assign(new Error(value.message??value.error??'Terminal mode failed.'),{code:value.code??value.error??'terminal_mode_failed'}))};const close=()=>done(Object.assign(new Error('Project terminal closed while changing mode.'),{code:'terminal_closed'}));const done=(failure?:Error)=>{clearTimeout(timeout);terminal.off('event',event);terminal.off('close',close);failure?reject(failure):resolve()};terminal.on('event',event);terminal.once('close',close)})}
  async #waitRunning(session:InternalSession):Promise<void>{await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>done(Object.assign(new Error('Project command did not start.'),{code:'timeout'})),this.options.startupMs??15_000);timeout.unref();const event=(value:any)=>{if(value.type!=='command_state'||value.requestId!==session.requestId)return;if(value.status==='running')done();else if(['failed','succeeded'].includes(value.status))done(Object.assign(new Error('Project command exited before its port was published.'),{code:'project_exited'}))};const close=()=>done(Object.assign(new Error('Project terminal closed during startup.'),{code:'terminal_closed'}));const done=(failure?:Error)=>{clearTimeout(timeout);session.terminal.off('event',event);session.terminal.off('close',close);failure?reject(failure):resolve()};session.terminal.on('event',event);session.terminal.once('close',close)})}

  async stop(id:string,reason:'stopped'|'expired'='stopped'):Promise<boolean>{const session=this.#sessions.get(id);if(!session)return false;if(session.status==='stopping')return true;session.status='stopping';this.#changed(session);clearTimeout(session.timer);session.terminal.stop(`stop-${id}`);try{await (await this.commandExecutor(session.contextId)).execute(`fngk unpublish ${session.port} --json`,{timeoutMs:30_000})}catch(error){session.error=`${session.error?`${session.error}; `:''}route release: ${(error as Error).message}`};session.status=reason;this.#changed(session);return true}
  interrupt(id:string):boolean{const session=this.#sessions.get(id);if(!session||!['starting','running'].includes(session.status))return false;return session.terminal.interrupt(`interrupt-${id}`)}
  async restart(id:string):Promise<LiveProjectSession|undefined>{const session=this.#sessions.get(id);if(!session)return;const input={contextId:session.contextId,repositoryPath:session.repositoryPath,command:session.command,port:session.port,ttlMs:Math.max(60_000,Date.parse(session.expiresAt)-Date.parse(session.createdAt))};await this.stop(id);return this.start(input)}
  async close(){await Promise.all([...this.#sessions.keys()].map(id=>this.stop(id)))}
}
