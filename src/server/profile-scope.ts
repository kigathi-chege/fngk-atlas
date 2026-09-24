import {AsyncLocalStorage} from 'node:async_hooks';
import type {FastifyInstance} from 'fastify';

// Profile selection is request-local, never a mutable server-wide credential choice.
export function createProfileScope(){
  const storage=new AsyncLocalStorage<string|undefined>();
  return{
    current:()=>storage.getStore(),
    install(app:FastifyInstance){
      app.addHook('onRequest',(request,reply,done)=>{
        const query=new URL(request.url,'http://atlas.local').searchParams.get('profile');
        const header=request.headers['x-atlas-profile'];
        const profile=query??(typeof header==='string'?header:undefined);
        if(profile&&(profile.length>128||/[\x00-\x1f]/.test(profile))){void reply.code(400).send({error:'profile_invalid',message:'Invalid profile name.'});return}
        storage.run(profile||undefined,done);
      });
    }
  };
}
