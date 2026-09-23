import type {FngkProcessClient} from '../fngk/process-client.js';
import type {CommandExecutor} from '../transports/terminal-command.js';
import {parseProjectManifest,type ProjectManifest} from './project-manifest.js';

const quote=(value:string)=>`'${value.replaceAll("'", "'\\''")}'`;
export type DeploymentEnvironment='development'|'staging'|'production';
export interface DeploymentInput {contextId:string;repositoryPath:string;environment:DeploymentEnvironment;commitSha:string;manifest:unknown}
export interface DeploymentExecution {deploymentId:string;releaseId:string;processId:string;runId?:string;pid?:number;connectionId?:string;hostname?:string;url?:string;releasePath:string;artifacts:Array<{path:string}>;status:'healthy'}

export class DeploymentService {
  constructor(readonly fngk:FngkProcessClient,readonly commandExecutor:(contextId:string)=>Promise<CommandExecutor>){}

  plan(input:DeploymentInput){
    const manifest=parseProjectManifest(input.manifest);
    this.#validate(input,manifest);
    return {version:'atlas.deployment-plan.v1',contextId:input.contextId,repositoryPath:input.repositoryPath,environment:input.environment,commitSha:input.commitSha,phases:['verify','extract',...(manifest.commands.install?['install']:[]),...(manifest.commands.build?['build']:[]),'start','health','artifacts','publish'],manifest};
  }

  async execute(input:DeploymentInput):Promise<DeploymentExecution>{
    const plan=this.plan(input),manifest=plan.manifest,state=await this.fngk.probe();
    if(!state.compatible)throw Object.assign(new Error('FNGK is not ready for deployment.'),{code:state.reason??'fngk_unavailable'});
    const options={profile:state.profile},deviceId=input.contextId.slice(7),created:any=await this.fngk.createDeployment(deviceId,{name:manifest.name,repositoryPath:input.repositoryPath,environment:input.environment,commitSha:input.commitSha,manifest},options),deploymentId=String(created.deployment?.id??''),releaseId=String(created.release?.id??''),releasePath=String(created.release?.release_path??'');
    if(!deploymentId||!releaseId||!releasePath)throw Object.assign(new Error('FNGK did not return a retained deployment release.'),{code:'invalid_deployment_response'});
    const executor=await this.commandExecutor(input.contextId);let processId='',run:any;
    const phase=async(event:string,status:string|undefined,command?:string)=>{await this.fngk.deploymentEvent(releaseId,{event,phase:event.split('.')[0],...(status?{status}: {})},options);if(!command)return Buffer.alloc(0);const result=await executor.execute(command,{timeoutMs:Math.max(30_000,manifest.health.timeoutMs)});if(result.exitCode!==0)throw Object.assign(new Error(result.output.toString('utf8')||`${event} failed.`),{code:event==='health.checking'?'deployment_health_failed':`deployment_${event.replace(/\W+/g,'_')}_failed`});await this.fngk.deploymentEvent(releaseId,{event:event.replace(/\.started$/,'.completed').replace(/\.checking$/,'.passed'),phase:event.split('.')[0],detail:{output:result.output.toString('utf8').slice(-64*1024)}},options);return result.output};
    try{
      await phase('verify.started','installing',`test "$(git -C ${quote(input.repositoryPath)} rev-parse ${quote(`${input.commitSha}^{commit}`)})" = ${quote(input.commitSha)}`);
      await phase('extract.started',undefined,`test ! -e ${quote(releasePath)} && mkdir -p ${quote(releasePath)} && git -C ${quote(input.repositoryPath)} archive ${quote(input.commitSha)} | tar -x -C ${quote(releasePath)}`);
      if(manifest.commands.install)await phase('install.started','installing',`cd -- ${quote(releasePath)} && ${manifest.commands.install}`);
      if(manifest.commands.build)await phase('build.started','building',`cd -- ${quote(releasePath)} && ${manifest.commands.build}`);
      await phase('port.checking',undefined,`! bash -c ${quote(`</dev/tcp/127.0.0.1/${manifest.port}`)} 2>/dev/null`);
      const environment=manifest.environments[input.environment]?.variables??{},prefix=Object.entries(environment).map(([key,value])=>`${key}=${quote(value)}`).join(' '),command=`${prefix?`${prefix} `:''}${manifest.commands.start}`;
      await phase('process.starting','starting');const process:any=await this.fngk.createManagedProcess(deviceId,{name:`${manifest.name} · release ${created.release.number??1}`,executable:command,arguments:[],workingDirectory:releasePath,shell:true,restartPolicy:manifest.restartPolicy},options);processId=String(process.id);run=await this.fngk.managedProcessAction(processId,'start',options);
      await phase('health.checking','checking');try{await this.fngk.managedProcessOperation(processId,'probe',{port:manifest.port,protocol:manifest.health.protocol,path:manifest.health.path,timeoutMs:manifest.health.timeoutMs},options)}catch(error){throw Object.assign(new Error((error as Error).message),{code:'deployment_health_failed'})}await this.fngk.deploymentEvent(releaseId,{event:'health.passed',phase:'health',detail:{port:manifest.port,...manifest.health}},options);
      const artifactOutput=manifest.artifacts.length?await phase('artifacts.inventory',undefined,`cd -- ${quote(releasePath)} && find ${manifest.artifacts.map(item=>quote(item.path)).join(' ')} -type f -printf '%P\n' 2>/dev/null | head -1000`):Buffer.alloc(0),artifacts=artifactOutput.toString('utf8').split(/\r?\n/).filter(Boolean).map(path=>({path}));
      await phase('route.publishing',undefined);const route=await this.fngk.managedProcessOperation(processId,'publish',{port:manifest.port},options);if(!route.hostname)throw Object.assign(new Error('FNGK returned invalid publish metadata.'),{code:'invalid_publish_metadata'});
      await this.fngk.deploymentEvent(releaseId,{event:'deployment.healthy',phase:'complete',status:'healthy',detail:{health:manifest.health,url:route.url??`https://${route.hostname}`},processId,connectionId:route.connectionId,artifacts},options);
      return {deploymentId,releaseId,processId,runId:run?.id,pid:run?.pid,connectionId:route.connectionId,hostname:route.hostname,url:route.url??`https://${route.hostname}`,releasePath,artifacts,status:'healthy'};
    }catch(error){if(processId)await this.fngk.managedProcessAction(processId,'stop',options).catch(()=>{});await this.fngk.deploymentEvent(releaseId,{event:'deployment.failed',phase:'failed',status:'failed',detail:{code:(error as any).code??'deployment_failed',message:(error as Error).message.slice(0,2000)},...(processId?{processId}: {})},options).catch(()=>{});throw error}
  }

  async rollback(deploymentId:string,contextId:string):Promise<DeploymentExecution>{
    if(!contextId.startsWith('device:'))throw Object.assign(new Error('Rollbacks require an FNGK Device context.'),{code:'device_context_required'});
    const state=await this.fngk.probe();if(!state.compatible)throw Object.assign(new Error('FNGK is not ready for rollback.'),{code:state.reason??'fngk_unavailable'});
    const options={profile:state.profile},detail:any=await this.fngk.deployment(deploymentId,options),deviceId=contextId.slice(7);
    if(String(detail.deployment?.device_id??'')!==deviceId)throw Object.assign(new Error('The deployment does not belong to the selected Device.'),{code:'deployment_context_mismatch'});
    const manifest=parseProjectManifest(detail.deployment.manifest),previous=detail.releases?.find((item:any)=>item.id===detail.deployment.current_release_id),selected:any=await this.fngk.rollbackDeployment(deploymentId,options),target=selected.target;
    if(!target?.id||!target?.release_path)throw Object.assign(new Error('FNGK did not return a retained rollback release.'),{code:'invalid_rollback_response'});
    const environment=manifest.environments[detail.deployment.environment as DeploymentEnvironment]?.variables??{},prefix=Object.entries(environment).map(([key,value])=>`${key}=${quote(value)}`).join(' '),command=`${prefix?`${prefix} `:''}${manifest.commands.start}`;
    let processId='',run:any,previousStopped=false;try{
      if(previous?.process_id){await this.fngk.managedProcessAction(previous.process_id,'stop',options);previousStopped=true}
      const process:any=await this.fngk.createManagedProcess(deviceId,{name:`${manifest.name} · rollback ${target.number} · ${String(target.id).slice(0,8)} · ${Date.now()}`,executable:command,arguments:[],workingDirectory:target.release_path,shell:true,restartPolicy:manifest.restartPolicy},options);processId=String(process.id);run=await this.fngk.managedProcessAction(processId,'start',options);
      try{await this.fngk.managedProcessOperation(processId,'probe',{port:manifest.port,protocol:manifest.health.protocol,path:manifest.health.path,timeoutMs:manifest.health.timeoutMs},options)}catch(error){throw Object.assign(new Error((error as Error).message),{code:'rollback_health_failed'})}
      const route=await this.fngk.managedProcessOperation(processId,'publish',{port:manifest.port},options);if(!route.hostname)throw Object.assign(new Error('FNGK returned invalid publish metadata during rollback.'),{code:'invalid_publish_metadata'});
      await this.fngk.deploymentEvent(target.id,{event:'rollback.completed',phase:'rollback',status:'healthy',detail:{health:manifest.health,url:route.url??`https://${route.hostname}`,fromReleaseId:previous?.id},processId,connectionId:route.connectionId},options);
      return{deploymentId,releaseId:target.id,processId,runId:run?.id,pid:run?.pid,connectionId:route.connectionId,hostname:route.hostname,url:route.url??`https://${route.hostname}`,releasePath:target.release_path,artifacts:target.artifacts??[],status:'healthy'};
    }catch(error){if(processId)await this.fngk.managedProcessAction(processId,'stop',options).catch(()=>{});if(previousStopped&&previous?.process_id)await this.fngk.managedProcessAction(previous.process_id,'start',options).catch(()=>{});await this.fngk.deploymentEvent(target.id,{event:'rollback.failed',phase:'rollback',status:'failed',detail:{code:(error as any).code??'rollback_failed',message:(error as Error).message.slice(0,2000)},...(processId?{processId}:{})},options).catch(()=>{});throw error}
  }

  #validate(input:DeploymentInput,manifest:ProjectManifest){if(!input.contextId.startsWith('device:'))throw Object.assign(new Error('Deployments require an FNGK Device context.'),{code:'device_context_required'});if(!input.repositoryPath.startsWith('/'))throw Object.assign(new Error('An absolute repository path is required.'),{code:'invalid_repository_path'});if(!/^[a-f0-9]{7,64}$/i.test(input.commitSha)||input.environment==='production'&&!/^[a-f0-9]{40}$/i.test(input.commitSha))throw Object.assign(new Error('Production deployments require a full 40-character commit SHA.'),{code:'invalid_commit'});for(const key of Object.keys(manifest.environments[input.environment]?.variables??{}))if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))throw Object.assign(new Error(`Invalid environment variable name: ${key}`),{code:'invalid_environment'})}
}
