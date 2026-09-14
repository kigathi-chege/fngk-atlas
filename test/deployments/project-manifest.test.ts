import {describe,expect,it} from 'vitest';
import {parseProjectManifest} from '../../src/deployments/project-manifest.js';

describe('FNGK project manifest',()=>{
  it('normalizes a non-secret deployment definition',()=>{
    expect(parseProjectManifest({protocolVersion:'fngk.project.v1',name:'Atlas fixture',commands:{install:'npm ci',build:'npm run build',start:'node dist/server.js'},port:8080,health:{path:'/health',timeoutMs:30_000},artifacts:[{path:'dist',kind:'server'}],restartPolicy:'on-failure',environments:{production:{secretReferences:['DATABASE_URL'],variables:{NODE_ENV:'production'}}},routes:[{name:'web',hostname:'atlas.example.com'}]})).toMatchObject({protocolVersion:'fngk.project.v1',port:8080,health:{protocol:'http',path:'/health',timeoutMs:30000},environments:{production:{secretReferences:['DATABASE_URL']}}});
  });
  it('rejects inline secret values and unsafe artifact paths',()=>{
    expect(()=>parseProjectManifest({protocolVersion:'fngk.project.v1',name:'unsafe',commands:{start:'node server.js'},port:8080,environments:{production:{variables:{DATABASE_URL:'postgres://secret'}}}})).toThrow(/secret reference/i);
    expect(()=>parseProjectManifest({protocolVersion:'fngk.project.v1',name:'unsafe',commands:{start:'node server.js'},port:8080,artifacts:[{path:'../outside',kind:'server'}]})).toThrow(/artifact path/i);
  });
});
