import {describe,expect,it} from 'vitest';
import {interpretNodeProject} from '../../src/deployments/project-interpreter.js';

describe('project interpretation',()=>{
  it.each([
    ['next',{'next':'15.0.0'}],['sveltekit',{'@sveltejs/kit':'2.0.0'}],['nuxt',{'nuxt':'3.0.0'}],['nest',{'@nestjs/core':'11.0.0'}],['express',{'express':'5.0.0'}],['vite',{'vite':'7.0.0'}]
  ])('recognizes %s from package evidence without executing it',(framework,dependencies)=>{
    expect(interpretNodeProject({name:'fixture',scripts:{build:'npm run compile',start:'node server.js'},dependencies},['package.json'])).toMatchObject({runtime:'node',framework,confidence:0.98,evidence:[expect.objectContaining({path:'package.json'})]});
  });
  it('keeps an unknown package as a generic Node project',()=>{expect(interpretNodeProject({name:'worker',scripts:{start:'node index.js'}},['package.json'])).toMatchObject({runtime:'node',framework:'node',startCommand:'npm run start'})});
});
