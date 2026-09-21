import {Worker} from 'node:worker_threads';
import type {RegisteredInterpreter} from './registry.js';

export interface BackgroundRefreshInput{databaseFile:string;contextId:string;nodes:any[];edges:any[];device?:{id?:string;name?:string;online?:boolean};extensions:RegisteredInterpreter[]}

export function backgroundRefresh(input:BackgroundRefreshInput,options:{signal?:AbortSignal;workerUrl?:URL}={}):Promise<void>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(options.workerUrl??new URL('./refresh-worker.js',import.meta.url),{
      workerData:input,
      execArgv:process.execArgv.filter(value=>!value.startsWith('--input-type')),
      resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:64,stackSizeMb:8},
    });let settled=false;
    const abort=()=>{void worker.terminate();finish(new Error('Semantic refresh cancelled.'))};
    const finish=(error?:Error)=>{if(settled)return;settled=true;options.signal?.removeEventListener('abort',abort);error?reject(error):resolve()};
    if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',(message:{ok?:boolean;message?:string;stack?:string})=>message.ok?finish():finish(Object.assign(new Error(message.message??'Semantic refresh worker failed.'),{stack:message.stack})));
    worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Semantic refresh worker exited without a committed success message (code ${code}).`)));
  });
}
