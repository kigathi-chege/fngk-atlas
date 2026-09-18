import {describe,expect,it} from 'vitest';
import {interpretDeploymentProject} from '../../src/deployments/adapters.js';

const node=(dependencies:Record<string,string>,scripts:Record<string,string>={build:'vite build',start:'node server.js'})=>JSON.stringify({name:'fixture',dependencies,scripts});

describe('deployment adapter registry',()=>{
  it.each([
    ['SvelteKit',{'package.json':node({'@sveltejs/kit':'2','@sveltejs/adapter-node':'5'}),'svelte.config.js':`import adapter from '@sveltejs/adapter-node'`},'sveltekit','node',['build']],
    ['Fastify',{'package.json':node({fastify:'5'})},'fastify','npm',['run','start']],
    ['Next',{'package.json':node({next:'15'}, {build:'next build',start:'next start'})},'next','npm',['run','start']],
    ['Nuxt',{'package.json':node({nuxt:'4'}, {build:'nuxt build',start:'node .output/server/index.mjs'})},'nuxt','node',['.output/server/index.mjs']],
  ])('proposes one generic journey for %s',(name,files,adapter,command,args)=>{
    const proposal=interpretDeploymentProject({files,environment:'production'});
    expect(proposal.protocolVersion).toBe('atlas.deployment-proposal.v1');
    expect(proposal.matches).toEqual(expect.arrayContaining([expect.objectContaining({id:adapter})]));
    expect(proposal.manifest.roles[0]).toMatchObject({kind:'application',command,arguments:args,runtime:{durability:'supervised'}});
    expect(proposal.runtimeRoles[0]).toMatchObject({protocolVersion:'fngk.runtime.v1',environmentRevision:1,user:'device-agent'});
  });

  it('models Laravel web, queue, scheduler, writable storage, and migrations',()=>{
    const proposal=interpretDeploymentProject({files:{'composer.json':JSON.stringify({name:'fixture/laravel',require:{'laravel/framework':'^12'}}),'artisan':'','package.json':node({vite:'7'})},environment:'production'});
    expect(proposal.matches[0].id).toBe('laravel');
    expect(proposal.manifest.roles.map(role=>role.kind)).toEqual(expect.arrayContaining(['application','worker','scheduler']));
    expect(proposal.manifest.phases).toEqual(expect.arrayContaining([expect.objectContaining({kind:'migrate',command:'php artisan migrate --force'})]));
    expect(proposal.schedules).toEqual([expect.objectContaining({manager:'systemd-timer',roleId:'scheduler'})]);
    expect(proposal.storageResources).toEqual(expect.arrayContaining([expect.objectContaining({name:'storage',durable:true,deletionProtection:true})]));
  });

  it('lets Docker own Signal services while retaining PostgreSQL, Redis, volumes, and health evidence',()=>{
    const proposal=interpretDeploymentProject({files:{'Dockerfile':'FROM node:24-alpine\nHEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/api/health','docker-compose.yml':'services:\n  postgres:\n    image: postgres:18\n  redis:\n    image: redis:8\nvolumes:\n  postgres_data:' ,'package.json':node({fastify:'5','pg':'8','redis':'5'})},environment:'production'});
    expect(proposal.matches.map(item=>item.id)).toEqual(expect.arrayContaining(['docker','fastify','postgres']));
    expect(proposal.manifest.roles[0].runtime).toMatchObject({manager:'docker',durability:'supervised'});
    expect(proposal.manifest.phases).toEqual(expect.arrayContaining([expect.objectContaining({kind:'build',command:'docker compose build'}),expect.objectContaining({kind:'activate',command:'docker compose up -d --remove-orphans'})]));
    expect(proposal.storageResources).toEqual(expect.arrayContaining([expect.objectContaining({kind:'volume',name:'postgres-data'})]));
    expect(proposal.resources.map(item=>item.kind)).toEqual(expect.arrayContaining(['postgres.database','redis.instance']));
  });

  it('adopts PM2 or Supervisor without inventing an FNGK supervisor and identifies cron',()=>{
    const pm2=interpretDeploymentProject({files:{'package.json':node({fastify:'5'}),'ecosystem.config.js':'module.exports={apps:[{name:"api"}]}'},environment:'production'});
    expect(pm2.manifest.roles[0].runtime.manager).toBe('pm2');
    const supervisor=interpretDeploymentProject({files:{'composer.json':JSON.stringify({require:{'laravel/framework':'12'}}),'artisan':'','supervisor.conf':'[program:queue]\ncommand=php artisan queue:work','crontab':'* * * * * php artisan schedule:run'},environment:'production'});
    expect(supervisor.manifest.roles.every(role=>role.runtime.manager==='supervisor')).toBe(true);
    expect(supervisor.matches.map(item=>item.id)).toEqual(expect.arrayContaining(['supervisor','cron']));
  });
});
