import {describe,expect,it} from 'vitest';
import {parseProjectManifest,parseProjectManifestV2,upgradeProjectManifest} from '../../src/deployments/project-manifest.js';

describe('FNGK project manifest',()=>{
  it('normalizes a non-secret deployment definition',()=>{
    expect(parseProjectManifest({protocolVersion:'fngk.project.v1',name:'Atlas fixture',commands:{install:'npm ci',build:'npm run build',start:'node dist/server.js'},port:8080,health:{path:'/health',timeoutMs:30_000},artifacts:[{path:'dist',kind:'server'}],restartPolicy:'on-failure',environments:{production:{secretReferences:['DATABASE_URL'],variables:{NODE_ENV:'production'}}},routes:[{name:'web',hostname:'atlas.example.com'}]})).toMatchObject({protocolVersion:'fngk.project.v1',port:8080,health:{protocol:'http',path:'/health',timeoutMs:30000},environments:{production:{secretReferences:['DATABASE_URL']}}});
  });
  it('rejects inline secret values and unsafe artifact paths',()=>{
    expect(()=>parseProjectManifest({protocolVersion:'fngk.project.v1',name:'unsafe',commands:{start:'node server.js'},port:8080,environments:{production:{variables:{DATABASE_URL:'postgres://secret'}}}})).toThrow(/secret reference/i);
    expect(()=>parseProjectManifest({protocolVersion:'fngk.project.v1',name:'unsafe',commands:{start:'node server.js'},port:8080,artifacts:[{path:'../outside',kind:'server'}]})).toThrow(/artifact path/i);
  });

  it('deterministically upgrades v1 into structured v2 roles and phases without mutating the source',()=>{
    const source={protocolVersion:'fngk.project.v1',name:'Atlas fixture',commands:{install:'npm ci',build:'npm run build',start:'node dist/server.js'},port:8080,health:{protocol:'http',path:'/health',timeoutMs:30_000},artifacts:[{path:'dist',kind:'server'}],restartPolicy:'on-failure',environments:{production:{secretReferences:['DATABASE_URL'],variables:{NODE_ENV:'production'}}},routes:[{name:'web'}]};
    const before=structuredClone(source),first=upgradeProjectManifest(source),second=upgradeProjectManifest(source);
    expect(source).toEqual(before);
    expect(first).toEqual(second);
    expect(first).toMatchObject({protocolVersion:'fngk.project.v2',adapter:{id:'fngk.legacy-project',version:'1'},roles:[{id:'web',kind:'application',command:'node dist/server.js',runtime:{manager:'fngk-native',durability:'ephemeral',restartPolicy:'on-failure'}}],ports:[{name:'web',port:8080,protocol:'http'}],health:{readiness:{protocol:'http',path:'/health',timeoutMs:30000}}});
    expect(first.phases.map(phase=>phase.id)).toEqual(['install','build','activate']);
  });

  it('normalizes a native v2 manifest and rejects paths that escape the release',()=>{
    const manifest={protocolVersion:'fngk.project.v2',name:'worker',adapter:{id:'node.fastify',version:'1.0.0'},roles:[{id:'web',kind:'application',command:'node dist/server.js',cwd:'.',runtime:{manager:'pm2',durability:'supervised',restartPolicy:'always'}}],phases:[{id:'install',kind:'install',command:'npm ci',timeoutMs:120000},{id:'activate',kind:'activate',timeoutMs:30000}],ports:[{name:'web',port:3000,protocol:'http'}],health:{readiness:{protocol:'http',path:'/health',timeoutMs:5000},shutdownSignal:'SIGTERM',drainTimeoutMs:10000},environments:{production:{variables:{NODE_ENV:'production'},secretReferences:['database.url']}},routes:[{name:'web'}],artifacts:[{path:'dist',kind:'server'}],storage:[],resources:[],retention:{successfulReleases:5,failedReleaseDays:7,logDays:7}};
    expect(parseProjectManifestV2(manifest)).toEqual(manifest);
    expect(()=>parseProjectManifestV2({...manifest,roles:[{...manifest.roles[0],cwd:'../outside'}]})).toThrow(/working directory/i);
  });
});
