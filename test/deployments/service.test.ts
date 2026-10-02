import {describe,expect,it,vi} from 'vitest';
import {DeploymentService} from '../../src/deployments/service.js';

const manifest={protocolVersion:'fngk.project.v1' as const,name:'web',commands:{install:'npm ci',build:'npm run build',start:'npm start'},port:8080,health:{protocol:'http' as const,path:'/health',timeoutMs:5000},artifacts:[{path:'dist',kind:'web'}],restartPolicy:'on-failure' as const,environments:{production:{variables:{NODE_ENV:'production'},secretReferences:['web.production']}},routes:[{name:'web'}]};

describe('deployment execution',()=>{
  it('publishes only after immutable build, managed start, and Device health pass',async()=>{
    const calls:string[]=[];
    const fngk:any={
      probe:async()=>({compatible:true,profile:'work'}),
      createDeployment:vi.fn(async()=>({deployment:{id:'deployment-1'},release:{id:'release-1',release_path:'/srv/web/.fngk/releases/000001-aaaaaaaaaaaa'}})),
      deploymentEvent:vi.fn(async(_id:string,event:any)=>{calls.push(`event:${event.event}`);return {release:{id:'release-1'}}}),
      createManagedProcess:vi.fn(async()=>{calls.push('process:create');return {id:'process-1'}}),
      managedProcessAction:vi.fn(async()=>{calls.push('process:start');return {id:'run-1',pid:42,status:'running'}}),
      managedProcessOperation:vi.fn(async(_id:string,action:string)=>{calls.push(action==='probe'?'health':'publish');return action==='publish'?{connectionId:'connection-1',hostname:'web.test',url:'https://web.test'}:{ready:true}}),
    };
    const executor={execute:vi.fn(async(command:string)=>{if(command.includes('curl'))calls.push('health');else if(command.includes('fngk publish'))calls.push('publish');else calls.push(command.includes('git archive')?'extract':command.includes('npm ci')?'install':command.includes('npm run build')?'build':'artifacts');return {exitCode:0,output:Buffer.from(command.includes('fngk publish')?JSON.stringify({protocolVersion:'fngk.publish.v1',type:'published',connectionId:'connection-1',hostname:'web.test',url:'https://web.test'}):command.includes('find ')?'dist\n':'')}})};
    const service=new DeploymentService(fngk,async()=>executor as any);
    const result=await service.execute({contextId:'device:device-1',repositoryPath:'/srv/web',environment:'production',commitSha:'a'.repeat(40),manifest});
    expect(result).toMatchObject({deploymentId:'deployment-1',releaseId:'release-1',processId:'process-1',runId:'run-1',url:'https://web.test',status:'healthy'});
    expect(executor.execute.mock.calls.some(([command])=>command.includes("git -C '/srv/web' archive 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"))).toBe(true);
    expect(calls.indexOf('health')).toBeLessThan(calls.indexOf('publish'));
    expect(fngk.deploymentEvent).toHaveBeenLastCalledWith('release-1',expect.objectContaining({event:'deployment.healthy',status:'healthy',processId:'process-1',connectionId:'connection-1'}),expect.anything());
  });

  it('retains failure evidence and never publishes when health fails',async()=>{
    const fngk:any={probe:async()=>({compatible:true,profile:'work'}),createDeployment:async()=>({deployment:{id:'deployment-1'},release:{id:'release-1',release_path:'/release'}}),deploymentEvent:vi.fn(async()=>({})),createManagedProcess:async()=>({id:'process-1'}),managedProcessAction:vi.fn(async()=>({id:'run-1'})),managedProcessOperation:vi.fn(async()=>{throw new Error('connection refused')})};
    const executor={execute:vi.fn(async(command:string)=>({exitCode:command.includes('curl')?1:0,output:Buffer.from('connection refused')}))};
    const service=new DeploymentService(fngk,async()=>executor as any);
    await expect(service.execute({contextId:'device:device-1',repositoryPath:'/srv/web',environment:'production',commitSha:'b'.repeat(40),manifest})).rejects.toMatchObject({code:'deployment_health_failed'});
    expect(fngk.managedProcessOperation).toHaveBeenCalledTimes(1);
    expect(fngk.deploymentEvent).toHaveBeenLastCalledWith('release-1',expect.objectContaining({event:'deployment.failed',status:'failed',detail:expect.objectContaining({message:'connection refused'})}),expect.anything());
  });

  it('health-checks and switches the route before stopping the previous release during rollback',async()=>{
    const calls:string[]=[];
    const fngk:any={probe:async()=>({compatible:true,profile:'work'}),deployment:async()=>({deployment:{id:'deployment-1',device_id:'device-1',current_release_id:'current',manifest},releases:[{id:'current',process_id:'process-current',status:'healthy'}]}),rollbackDeployment:vi.fn(async()=>({target:{id:'target',release_path:'/srv/web/.fngk/releases/000001-old'}})),createManagedProcess:vi.fn(async()=>{calls.push('process:create');return{id:'process-old'}}),managedProcessAction:vi.fn(async(id:string,action:string)=>{calls.push(`${action}:${id}`);return{id:'run-old',pid:77}}),managedProcessOperation:vi.fn(async(_id:string,action:string)=>{calls.push(action==='probe'?'health':'publish');return action==='publish'?{connectionId:'connection-1',hostname:'web.test'}:{ready:true}}),deploymentEvent:vi.fn(async(_id:string,event:any)=>{calls.push(`event:${event.event}`);return{}})};
    const executor={execute:vi.fn(async(command:string)=>{if(command.includes('curl'))calls.push('health');if(command.includes('fngk publish'))calls.push('publish');return{exitCode:0,output:Buffer.from(command.includes('fngk publish')?JSON.stringify({protocolVersion:'fngk.publish.v1',type:'published',connectionId:'connection-1',hostname:'web.test'}):'')}})};
    const result=await new DeploymentService(fngk,async()=>executor as any).rollback('deployment-1','device:device-1');
    expect(result).toMatchObject({releaseId:'target',processId:'process-old',status:'healthy'});expect(calls.indexOf('stop:process-current')).toBeLessThan(calls.indexOf('process:create'));expect(calls.indexOf('health')).toBeLessThan(calls.indexOf('publish'));expect(fngk.deploymentEvent).toHaveBeenCalledWith('target',expect.objectContaining({event:'rollback.completed',status:'healthy'}),expect.anything());
  });
});
