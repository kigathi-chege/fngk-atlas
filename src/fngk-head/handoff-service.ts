import {EventEmitter} from 'node:events';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import type {AddressInfo} from 'node:net';
import type {CommandExecutor} from '../transports/terminal-command.js';
import type {DiagnosticRegistry} from '../diagnostics/registry.js';
import type {PortSharingService} from '../ports/service.js';
import {inspectHeadArtifacts,type HeadArtifact} from './artifacts.js';
import {remoteInstallCommand,rollbackCommand} from './install-command.js';

export interface HandoffSession {
  id:string;status:'preparing'|'ready'|'installing'|'verified'|'failed'|'stopped';createdAt:string;artifact:HeadArtifact;
  candidateId?:string;route?:{url:string;hostname:string;connectionId:string};targetContextId?:string;diagnosticSessionId?:string;
  command?:string;rollback?:string;error?:string;
}

export class FngkHeadHandoffService extends EventEmitter {
  #sessions=new Map<string,HandoffSession>();
  #servers=new Map<string,http.Server>();
  constructor(readonly options:{artifactRoot:string;signalRoot?:string;ports:PortSharingService;executorFor:(contextId:string)=>Promise<CommandExecutor>;diagnostics:DiagnosticRegistry}){super()}
  list(){return[...this.#sessions.values()].map(value=>({...value,artifact:{...value.artifact},route:value.route&&{...value.route}}))}
  get(id:string){return this.list().find(value=>value.id===id)}
  #save(value:HandoffSession){this.#sessions.set(value.id,value);this.emit('changed',this.get(value.id));return this.get(value.id)!}
  async prepare(platform:string=process.platform,architecture:string=process.arch):Promise<HandoffSession>{
    const artifact=await inspectHeadArtifacts(this.options.artifactRoot,platform,architecture,this.options.signalRoot),id=randomUUID(),session:HandoffSession={id,status:'preparing',createdAt:new Date().toISOString(),artifact};
    this.#save(session);
    const manifest=JSON.stringify({protocolVersion:'atlas.fngk-head.v1',commit:artifact.commit,version:artifact.version,platform:artifact.platform,architecture:artifact.architecture,size:artifact.size,checksum:artifact.checksum,archive:artifact.archiveName});
    const server=http.createServer((request,response)=>{
      if(!['GET','HEAD'].includes(request.method??'')){response.statusCode=405;response.end('Method not allowed');return}
      response.setHeader('cache-control','no-store');response.setHeader('x-content-type-options','nosniff');
      const pathname=new URL(request.url??'/','http://127.0.0.1').pathname;
      if(pathname==='/manifest.json'){response.setHeader('content-type','application/json');response.end(manifest);return}
      if(pathname===`/${artifact.archiveName}`){response.setHeader('content-type','application/gzip');response.setHeader('content-length',String(artifact.size));if(request.method==='HEAD'){response.end();return}createReadStream(artifact.archivePath).pipe(response);return}
      response.statusCode=404;response.end('Not found');
    });
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve())});
    this.#servers.set(id,server);
    try{
      const port=(server.address() as AddressInfo).port,scan=await this.options.ports.scan('local'),candidate=scan.candidates.find(value=>value.port===port&&value.probe==='http');
      if(!candidate)throw Object.assign(new Error('The verified artifact listener could not be discovered as HTTP.'),{code:'artifact_listener_unavailable'});
      const route=await this.options.ports.publish(candidate.id,{confirm:true,expiresInMs:86_400_000});
      Object.assign(session,{candidateId:candidate.id,route:{url:route.url,hostname:route.hostname,connectionId:route.connectionId},status:'ready'});
      return this.#save(session);
    }catch(error){await new Promise<void>(resolve=>server.close(()=>resolve()));this.#servers.delete(id);session.status='failed';session.error=(error as Error).message;this.#save(session);throw error}
  }
  async install(id:string,targetContextId:string,input:{confirm?:boolean;profile?:string;systemScope?:boolean}){
    if(input.confirm!==true)throw Object.assign(new Error('Remote FNGK installation requires confirmation.'),{code:'confirmation_required'});
    const session=this.#sessions.get(id);if(!session?.route)throw Object.assign(new Error('Handoff is not ready.'),{code:'handoff_not_ready'});
    const command=remoteInstallCommand({artifact:session.artifact,baseUrl:session.route.url,profile:input.profile??'default',systemScope:input.systemScope}),rollback=rollbackCommand(input.systemScope),diagnostic=this.options.diagnostics.create({kind:'fngk-handoff',contextId:targetContextId,command,metadata:{handoffId:id,commit:session.artifact.commit,systemScope:Boolean(input.systemScope)}});
    Object.assign(session,{status:'installing',targetContextId,diagnosticSessionId:diagnostic.id,command,rollback});this.#save(session);
    try{
      this.options.diagnostics.update(diagnostic.id,{status:'running'});const result=await(await this.options.executorFor(targetContextId)).execute(command,{timeoutMs:300_000});this.options.diagnostics.append(diagnostic.id,'stdout',result.output.toString('utf8'));
      if(result.exitCode!==0||!result.output.toString('utf8').includes(`commit=${session.artifact.commit}`))throw Object.assign(new Error(`Remote installation verification failed with exit code ${result.exitCode}.`),{code:'handoff_verification_failed'});
      session.status='verified';this.options.diagnostics.update(diagnostic.id,{status:'stopped',exitCode:0});return this.#save(session);
    }catch(error){session.status='failed';session.error=String((error as Error).message).slice(0,500);this.options.diagnostics.update(diagnostic.id,{status:'failed',errorCode:String((error as any)?.code??'handoff_failed'),error:session.error});throw Object.assign(error as Error,{diagnosticSessionId:diagnostic.id,handoff:this.#save(session)})}
  }
  async stop(id:string){const session=this.#sessions.get(id);if(!session)return false;if(session.candidateId)await this.options.ports.stop(session.candidateId,{confirm:true}).catch(()=>{});await new Promise<void>(resolve=>this.#servers.get(id)?.close(()=>resolve())??resolve());this.#servers.delete(id);session.status='stopped';this.#save(session);return true}
  async close(){for(const id of [...this.#servers.keys()])await this.stop(id)}
}
