import Fastify from 'fastify';
import {expect,it} from 'vitest';
import {createProfileScope} from '../../src/server/profile-scope.js';

it('keeps request profile identity across asynchronous interleaving',async()=>{
  const app=Fastify(),scope=createProfileScope();
  scope.install(app);
  app.get('/identity',async()=>{await new Promise(resolve=>setTimeout(resolve,5));return{profile:scope.current()}});
  const [a,b]=await Promise.all([app.inject({url:'/identity',headers:{'x-atlas-profile':'work'}}),app.inject('/identity?profile=personal')]);
  expect(a.json()).toEqual({profile:'work'});expect(b.json()).toEqual({profile:'personal'});
  expect((await app.inject('/identity')).json()).toEqual({});
  await app.close();
});
