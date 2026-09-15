import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { FngkProcessClient } from '../fngk/process-client.js';
import type { TerminalSession } from '../fngk/terminal-session.js';
import { FngkTerminalCommandExecutor } from '../transports/terminal-command.js';
import type {DiagnosticRegistry} from '../diagnostics/registry.js';

export type LiveProjectStatus = 'starting'|'running'|'stopping'|'stopped'|'failed'|'expired';
export type LiveProjectSession = {
  id:string;contextId:string;repositoryPath:string;command:string;port:number;status:LiveProjectStatus;
  createdAt:string;expiresAt:string;terminalSessionId?:string;connectionId?:string;hostname?:string;url?:string;
  output:string;exitCode?:number;error?:string;diagnosticSessionId?:string;processId?:string;runId?:string;pid?:number;
};

type InternalSession = LiveProjectSession & { terminal?:TerminalSession; timer:NodeJS.Timeout; logTimer?:NodeJS.Timeout; lastLogSequence?:number; requestId:string; profile?:string };
const quote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;

export class LiveProjectService extends EventEmitter {
  #sessions=new Map<string,InternalSession>();
  #publishCompatibility=new Map<string,Promise<void>>();
  constructor(readonly fngk:FngkProcessClient,readonly options:{ttlMs?:number;outputLimit?:number;startupMs?:number;diagnostics?:DiagnosticRegistry;commandExecutor?:(contextId:string)=>Promise<import('../transports/terminal-command.js').CommandExecutor>}={}){super()}

  list():LiveProjectSession[]{return [...this.#sessions.values()].map(value=>this.#public(value))}
  get(id:string):LiveProjectSession|undefined{const value=this.#sessions.get(id);return value?this.#public(value):undefined}
  #public(value:InternalSession):LiveProjectSession{const {terminal:_terminal,timer:_timer,logTimer:_logTimer,lastLogSequence:_lastLogSequence,requestId:_requestId,profile:_profile,...session}=value;return {...session}}
  #changed(value:InternalSession){this.emit('changed',this.#public(value))}

  async start(input:{contextId:string;repositoryPath:string;command:string;port:number;ttlMs?:number}):Promise<LiveProjectSession>{
    if(!input.contextId.startsWith('device:'))throw Object.assign(new Error('Live projects currently require an FNGK Device context.'),{code:'device_context_required'});
    if(!input.repositoryPath.startsWith('/'))throw Object.assign(new Error('An absolute repository path is required.'),{code:'invalid_repository_path'});
    if(!input.command.trim()||input.command.length>4096)throw Object.assign(new Error('A bounded project command is required.'),{code:'invalid_command'});
    if(!Number.isInteger(input.port)||input.port<1||input.port>65535)throw Object.assign(new Error('Project port is invalid.'),{code:'invalid_port'});
    const diagnostic=this.options.diagnostics?.create({kind:'live-project',contextId:input.contextId,command:input.command,metadata:{repositoryPath:input.repositoryPath,port:input.port}});
    const state=await this.fngk.probe();if(!state.compatible){this.options.diagnostics?.update(diagnostic?.id??'',{status:'failed',errorCode:state.reason??'fngk_unavailable',error:'FNGK is not ready for a live project.'});throw Object.assign(new Error('FNGK is not ready for a live project.'),{code:state.reason??'fngk_unavailable',diagnosticSessionId:diagnostic?.id})}
    const managed=typeof (this.fngk as any).createManagedProcess==='function';
    if(!managed)try{await this.#ensurePublishCompatible(input.contextId,state.profile)}catch(error){this.options.diagnostics?.update(diagnostic?.id??'',{status:'failed',errorCode:(error as any).code??'incompatible_cli',error:(error as Error).message});throw Object.assign(error as Error,{diagnosticSessionId:diagnostic?.id})}
    const terminal=managed?undefined:this.fngk.openTerminal(input.contextId,{newSession:true,profile:state.profile});
    const id=randomUUID(),requestId=`project-${id}`,ttl=Math.min(24*60*60_000,Math.max(60_000,input.ttlMs??60*60_000)),createdAt=new Date(),timer=setTimeout(()=>void this.stop(id,'expired'),ttl);timer.unref();
    const session:InternalSession={id,contextId:input.contextId,repositoryPath:input.repositoryPath,command:input.command.trim(),port:input.port,status:'starting',createdAt:createdAt.toISOString(),expiresAt:new Date(createdAt.getTime()+ttl).toISOString(),terminalSessionId:terminal?.sessionId,output:'',terminal,timer,requestId,diagnosticSessionId:diagnostic?.id,profile:state.profile};
    this.#sessions.set(id,session);if(terminal)this.#listen(session);
    try{
      if(managed){
        const process=await this.fngk.createManagedProcess(input.contextId.slice(7),{name:`Atlas live project · ${input.port} · ${id.slice(0,8)}`,executable:input.command.trim(),arguments:[],workingDirectory:input.repositoryPath,shell:true,restartPolicy:'never'},{profile:state.profile});
        const run:any=await this.fngk.managedProcessAction(process.id,'start',{profile:state.profile});Object.assign(session,{processId:process.id,runId:run?.id,pid:run?.pid});
        await this.#refreshManagedLogs(session).catch(()=>{});
      }else if(terminal){
        await this.#waitReady(terminal);session.terminalSessionId=terminal.sessionId;this.options.diagnostics?.update(diagnostic?.id??'',{status:'running',terminalSessionId:terminal.sessionId});
        const modeReady=this.#waitMode(terminal,'queue');
        if(!terminal.setMode('queue',`mode-${id}`)){terminal.stop(`stop-${id}`);await modeReady.catch(()=>{});throw Object.assign(new Error('Project terminal rejected queue mode.'),{code:'terminal_unavailable'})}
        await modeReady;
        const commandRunning=this.#waitRunning(session);
        if(!terminal.sendCommand(`cd -- ${quote(input.repositoryPath)} && exec ${input.command.trim()}`,requestId)){terminal.stop(`stop-${id}`);await commandRunning.catch(()=>{});throw Object.assign(new Error('Project terminal rejected the command.'),{code:'terminal_unavailable'})}
        await commandRunning;
      }
      let published:any;
      if(managed&&session.processId){
        await this.fngk.managedProcessOperation(session.processId,'probe',{port:input.port,protocol:'http',path:'/',timeoutMs:this.options.startupMs??15_000},{profile:state.profile});
        published=await this.fngk.managedProcessOperation(session.processId,'publish',{port:input.port},{profile:state.profile});
      }else{
        const attempts=Math.max(1,Math.ceil((this.options.startupMs??15_000)/250)),health=await this.#executeManagement(input.contextId,state.profile,`for atlas_attempt in $(seq 1 ${attempts}); do if (command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 -o /dev/null ${quote(`http://127.0.0.1:${input.port}/`)}) || (command -v bash >/dev/null 2>&1 && bash -c ${quote(`</dev/tcp/127.0.0.1/${input.port}`)} 2>/dev/null); then exit 0; fi; sleep .25; done; exit 1`);
        this.options.diagnostics?.append(diagnostic?.id??'','stdout',health.output.toString('utf8'));if(health.exitCode!==0)throw Object.assign(new Error(health.output.toString('utf8')||`Project did not listen on port ${input.port} before the readiness deadline.`),{code:'project_port_unavailable'});
        const result=await this.#executeManagement(input.contextId,state.profile,`fngk publish ${input.port} --json`);this.options.diagnostics?.append(diagnostic?.id??'','stdout',result.output.toString('utf8'));if(result.exitCode!==0)throw new Error(result.output.toString('utf8')||'FNGK publish failed.');published=JSON.parse(result.output.toString('utf8').trim());if(published.protocolVersion!=='fngk.publish.v1'||published.type!=='published'||!published.hostname)throw new Error('FNGK returned invalid publish metadata.');
      }
      Object.assign(session,{status:'running',connectionId:published.connectionId,hostname:published.hostname,url:published.url||`https://${published.hostname}`});if(session.processId){session.logTimer=setInterval(()=>void this.#refreshManagedLogs(session).catch(()=>{}),1000);session.logTimer.unref()}this.#changed(session);return this.#public(session);
    }catch(error){clearTimeout(session.timer);session.terminal?.stop(`failed-${id}`);if(session.processId){await this.fngk.managedProcessAction(session.processId,'stop',{profile:state.profile}).catch(()=>{});await this.fngk.managedProcessOperation(session.processId,'unpublish',{port:input.port},{profile:state.profile}).catch(()=>{})}else await this.#executeManagement(input.contextId,state.profile,`fngk unpublish ${input.port} --json`).catch(()=>{});session.status='failed';session.error=(error as Error).message;this.options.diagnostics?.update(diagnostic?.id??'',{status:'failed',errorCode:(error as any).code??'project_start_failed',error:session.error});this.#changed(session);throw Object.assign(error as Error,{code:(error as any).code??'project_start_failed',liveProjectSession:this.#public(session),diagnosticSessionId:diagnostic?.id})}
  }

  async #refreshManagedLogs(session:InternalSession){if(!session.processId)return;const value=await this.fngk.managedProcessLogs(session.processId,{profile:session.profile,runId:session.runId,after:session.lastLogSequence??-1,limit:500});if(value.run){session.runId=String(value.run.id);if(Number.isInteger(value.run.pid))session.pid=Number(value.run.pid);if(['failed','exited'].includes(String(value.run.status))){session.status=String(value.run.status)==='failed'?'failed':'stopped';session.exitCode=Number(value.run.exit_code??0);session.error=value.run.error?String(value.run.error):session.error}}for(const item of value.items??[]){const sequence=Number(item.sequence);if(sequence<=(session.lastLogSequence??-1))continue;session.lastLogSequence=sequence;const chunk=Buffer.from(String(item.body_base64??''),'base64').toString('utf8'),limit=this.options.outputLimit??256*1024;session.output=(session.output+chunk).slice(-limit);this.options.diagnostics?.append(session.diagnosticSessionId??'',item.stream==='stderr'?'stderr':'stdout',chunk)}this.#changed(session)}

  #listen(session:InternalSession){
    const terminal=session.terminal;if(!terminal)return;
    terminal.on('event',(event:any)=>{this.options.diagnostics?.event(session.diagnosticSessionId??'',event);if((event.type==='output'||event.type==='replay')&&event.bodyBase64){const chunk=Buffer.from(event.bodyBase64,'base64').toString('utf8'),limit=this.options.outputLimit??256*1024;session.output=(session.output+chunk).slice(-limit);this.options.diagnostics?.append(session.diagnosticSessionId??'','stdout',chunk);this.#changed(session)}if(event.type==='command_state'&&event.requestId===session.requestId&&['succeeded','failed'].includes(event.status)){session.exitCode=Number(event.exitCode??(event.status==='succeeded'?0:1));if(session.status==='running'||session.status==='starting')session.status=session.exitCode===0?'stopped':'failed';this.#changed(session)}});
    terminal.once('error',(error:Error)=>{session.error=error.message;if(!['stopped','expired'].includes(session.status))session.status='failed';this.options.diagnostics?.update(session.diagnosticSessionId??'',{status:'failed',errorCode:(error as any).code,error:error.message});this.#changed(session)});
    terminal.once('close',()=>{if(!['stopped','failed','expired'].includes(session.status))session.status='stopped';this.#changed(session)});
  }

  async #waitReady(terminal:TerminalSession):Promise<void>{if(terminal.sessionId)return;await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>done(Object.assign(new Error('Project terminal did not become ready.'),{code:'timeout'})),this.options.startupMs??15_000);timeout.unref();const ready=()=>done(),error=(value:Error)=>done(value),close=()=>done(Object.assign(new Error('Project terminal closed before readiness.'),{code:'terminal_closed'}));const done=(failure?:Error)=>{clearTimeout(timeout);terminal.off('ready',ready);terminal.off('error',error);terminal.off('close',close);failure?reject(failure):resolve()};terminal.once('ready',ready);terminal.once('error',error);terminal.once('close',close)})}
  async #waitMode(terminal:TerminalSession,mode:string):Promise<void>{await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>done(Object.assign(new Error(`Project terminal did not enter ${mode} mode.`),{code:'timeout'})),this.options.startupMs??15_000);timeout.unref();const event=(value:any)=>{if(value.type==='collaboration'&&value.mode===mode)done();if(value.type==='error')done(Object.assign(new Error(value.message??value.error??'Terminal mode failed.'),{code:value.code??value.error??'terminal_mode_failed'}))};const close=()=>done(Object.assign(new Error('Project terminal closed while changing mode.'),{code:'terminal_closed'}));const done=(failure?:Error)=>{clearTimeout(timeout);terminal.off('event',event);terminal.off('close',close);failure?reject(failure):resolve()};terminal.on('event',event);terminal.once('close',close)})}
  async #waitRunning(session:InternalSession):Promise<void>{const terminal=session.terminal;if(!terminal)throw new Error('Project terminal is unavailable.');await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>done(Object.assign(new Error('Project command did not start.'),{code:'timeout'})),this.options.startupMs??15_000);timeout.unref();const event=(value:any)=>{if(value.type==='output'||value.type==='replay'){if(typeof value.bodyBase64==='string'&&value.bodyBase64.length>0)done();return}if(value.type!=='command_state'||value.requestId!==session.requestId)return;if(value.status==='running')done();else if(['failed','succeeded'].includes(value.status))done(Object.assign(new Error('Project command exited before its port was published.'),{code:'project_exited'}))};const close=()=>done(Object.assign(new Error('Project terminal closed during startup.'),{code:'terminal_closed'}));const done=(failure?:Error)=>{clearTimeout(timeout);terminal.off('event',event);terminal.off('close',close);failure?reject(failure):resolve()};terminal.on('event',event);terminal.once('close',close)})}

  async #executeManagement(contextId:string,profile:string|undefined,command:string){
    if(this.options.commandExecutor){try{return await (await this.options.commandExecutor(contextId)).execute(command,{timeoutMs:30_000})}catch(error){if((error as any)?.code!=='terminal_closed')throw error;await new Promise(resolve=>setImmediate(resolve));return (await this.options.commandExecutor(contextId)).execute(command,{timeoutMs:30_000})}}
    const terminal=this.fngk.openTerminal(contextId,{newSession:true,profile});
    try{
      await this.#waitReady(terminal);
      const modeReady=this.#waitMode(terminal,'queue');
      if(!terminal.setMode('queue',`management-mode-${randomUUID()}`)){terminal.stop('management-rejected');await modeReady.catch(()=>{});throw Object.assign(new Error('Management terminal rejected queue mode.'),{code:'terminal_unavailable'})}
      await modeReady;
      return await new FngkTerminalCommandExecutor(terminal).execute(command,{timeoutMs:30_000});
    }finally{terminal.stop(`management-complete-${randomUUID()}`)}
  }

  async #ensurePublishCompatible(contextId:string,profile:string|undefined){
    const key=`${profile??''}:${contextId}`;let pending=this.#publishCompatibility.get(key);if(!pending){pending=(async()=>{const result=await this.#executeManagement(contextId,profile,'fngk help');const help=result.output.toString('utf8');if(result.exitCode!==0||!/^\s*fngk publish <port> \[--json\]/m.test(help))throw Object.assign(new Error('This Device has an outdated FNGK CLI. Install the exact-head FNGK build and restart its daemon before starting a live project.'),{code:'incompatible_cli'})})();this.#publishCompatibility.set(key,pending);void pending.catch(()=>{if(this.#publishCompatibility.get(key)===pending)this.#publishCompatibility.delete(key)})}return pending;
  }

  async stop(id:string,reason:'stopped'|'expired'='stopped'):Promise<boolean>{const session=this.#sessions.get(id);if(!session)return false;if(['stopping','stopped','expired'].includes(session.status))return true;session.status='stopping';this.#changed(session);clearTimeout(session.timer);if(session.logTimer)clearInterval(session.logTimer);session.terminal?.stop(`stop-${id}`);if(session.processId)await this.fngk.managedProcessAction(session.processId,'stop',{profile:session.profile}).catch(error=>{session.error=(error as Error).message});try{if(session.processId)await this.fngk.managedProcessOperation(session.processId,'unpublish',{port:session.port},{profile:session.profile});else await this.#executeManagement(session.contextId,session.profile,`fngk unpublish ${session.port} --json`)}catch(error){session.error=`${session.error?`${session.error}; `:''}route release: ${(error as Error).message}`};session.status=reason;this.#changed(session);return true}
  async interrupt(id:string):Promise<boolean>{const session=this.#sessions.get(id);if(!session||!['starting','running'].includes(session.status))return false;if(session.processId){await this.fngk.managedProcessAction(session.processId,'stop',{profile:session.profile});return true}return session.terminal?.interrupt(`interrupt-${id}`)??false}
  async restart(id:string):Promise<LiveProjectSession|undefined>{const session=this.#sessions.get(id);if(!session)return;const input={contextId:session.contextId,repositoryPath:session.repositoryPath,command:session.command,port:session.port,ttlMs:Math.max(60_000,Date.parse(session.expiresAt)-Date.parse(session.createdAt))};await this.stop(id);return this.start(input)}
  async close(){await Promise.all([...this.#sessions.keys()].map(id=>this.stop(id)))}
}
