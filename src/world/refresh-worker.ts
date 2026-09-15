import {parentPort,workerData} from 'node:worker_threads';
import {WorldStore} from './store.js';
import {WorldService} from './service.js';
import type {RegisteredInterpreter} from './registry.js';

interface RefreshData{databaseFile:string;contextId:string;nodes:any[];edges:any[];device?:{id?:string;name?:string;online?:boolean};extensions:RegisteredInterpreter[]}
const input=workerData as RefreshData,store=new WorldStore(input.databaseFile);
try{new WorldService(store,input.extensions).refresh(input.contextId,input.nodes,input.edges,input.device);store.close();parentPort?.postMessage({ok:true})}catch(error){try{store.close()}catch{}parentPort?.postMessage({ok:false,message:(error as Error).message,stack:(error as Error).stack})}
