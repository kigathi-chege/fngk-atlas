import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

function execute(command,args,options,timeoutMs,outputLimit=262144){return new Promise(resolve=>{const started=Date.now();const child=spawn(command,args,options);let stdout='',stderr='',truncated=false,settled=false;const add=(key,data)=>{if(settled)return;const value=data.toString();if(stdout.length+stderr.length+value.length>outputLimit){truncated=true;return}if(key==='out')stdout+=value;else stderr+=value};child.stdout?.on('data',d=>add('out',d));child.stderr?.on('data',d=>add('err',d));const timer=setTimeout(()=>child.kill('SIGKILL'),timeoutMs);child.on('error',error=>finish(null,error));child.on('close',(code,signal)=>finish({code,signal}));function finish(result,error){if(settled)return;settled=true;clearTimeout(timer);resolve({status:error?'failed':result?.code===0?'completed':result?.signal?'terminated':'failed',exitCode:result?.code??null,signal:result?.signal??null,stdout,stderr:error?`${stderr}${error.message}`:stderr,truncated,durationMs:Date.now()-started});}})}

export async function runFunction(index,symbolId,input={}){
  const fn=index.nodes.find(n=>n.id===symbolId&&n.type==='function');if(!fn)throw new Error('Function was not found in the active index');
  if(fn.execution?.state==='analyzed_only')throw new Error(fn.execution.reason);
  const ext=path.extname(fn.path);const source=path.resolve(index.root,fn.path);const work=await mkdtemp(path.join(tmpdir(),'fngk-atlas-'));const timeoutMs=Math.max(100,Math.min(Number(input.timeoutMs)||5000,30000));let harness,command,args;
  if(['.mjs','.js','.cjs'].includes(ext)){
    harness=path.join(work,'harness.mjs');await writeFile(harness,`import { pathToFileURL } from 'node:url';\nconst mod=await import(pathToFileURL(${JSON.stringify(source)}));\nconst fn=mod[${JSON.stringify(fn.name)}]; if(typeof fn!=='function') throw new Error('Symbol is not an exported function');\nconst args=JSON.parse(process.env.ATLAS_ARGS||'[]'); const value=await fn(...args); console.log(JSON.stringify({returnValue:value},null,2));\n`);command=process.execPath;args=['--permission',`--allow-fs-read=${index.root},${work}`,`--allow-fs-write=${work}`,harness];
    args=['--permission',`--allow-fs-read=${index.root}`,`--allow-fs-read=${work}`,`--allow-fs-write=${work}`,harness];
  }else if(ext==='.py'){
    harness=path.join(work,'harness.py');await writeFile(harness,`import importlib.util,json,os\ns=importlib.util.spec_from_file_location('atlas_target',${JSON.stringify(source)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nf=getattr(m,${JSON.stringify(fn.name)});print(json.dumps({'returnValue':f(*json.loads(os.environ.get('ATLAS_ARGS','[]')))},default=str,indent=2))\n`);throw new Error('Python execution requires a configured disposable container provider; host Python is intentionally not used as a sandbox.');
  } else throw new Error(`No sandbox runner is available for ${ext}`);
  try{return {id:randomUUID(),symbolId,mode:'disposable-node-permission',...(await execute(command,args,{cwd:work,env:{PATH:process.env.PATH??'',ATLAS_ARGS:JSON.stringify(input.args??[])},stdio:['ignore','pipe','pipe']},timeoutMs))};}
  finally{await rm(work,{recursive:true,force:true});}
}
