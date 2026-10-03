import { once } from 'node:events';
import { FngkProcessClient } from '../fngk/process-client.js';
import type { NamespaceDevice, TerminalEvent } from '../fngk/protocol.js';
import { FileService } from '../files/file-service.js';
import { DirectTransport } from '../transports/direct.js';
import type { FileTransport } from '../transports/file-transport.js';
import { FngkTerminalCommandExecutor } from '../transports/terminal-command.js';
import type { CommandExecutor } from '../transports/terminal-command.js';
import { TerminalFileTransport } from '../transports/terminal-file.js';
import { DirectCommandExecutor } from '../transports/direct-command.js';
import { nativeFileTransport } from '../transports/fngk-adapter-file.js';
import { AdapterFileTransport } from '../transports/adapter-file.js';

function deviceTarget(device: NamespaceDevice): string { return typeof device.ref === 'string' ? device.ref : `device:${device.id}`; }
async function matchingEvent(emitter: NodeJS.EventEmitter, predicate: (event: TerminalEvent) => boolean, timeoutMs = 5_000): Promise<TerminalEvent> {
  return await new Promise((resolve, reject) => {
    const receive = (event: TerminalEvent) => { if (predicate(event)) finish(undefined, event); };
    const close = () => finish(Object.assign(new Error('FNGK terminal closed while preparing the context.'), { code: 'terminal_closed' }));
    const finish = (error?: Error, event?: TerminalEvent) => { clearTimeout(timer); emitter.removeListener('event', receive); emitter.removeListener('close', close); error ? reject(error) : resolve(event!); };
    const timer = setTimeout(() => finish(Object.assign(new Error('FNGK terminal context timed out.'), { code: 'timeout' })), timeoutMs); timer.unref();
    emitter.on('event', receive); emitter.once('close', close);
  });
}

export class EffectiveContextService {
  readonly direct: DirectTransport;
  #remote = new Map<string, TerminalFileTransport>();
  #adapters = new Map<string, AdapterFileTransport[]>();
  #contextSnapshots = new Map<string,{expiresAt:number;value:any}>();
  #contextPromises = new Map<string,Promise<any>>();
  readonly contextCacheMs:number;
  readonly selectedProfile:()=>string|undefined;
  constructor(readonly fngk:FngkProcessClient,options:{localRoot?:string;contextCacheMs?:number;profile?:()=>string|undefined}={}){
    this.direct=new DirectTransport({id:'direct:local',contextId:'local',root:options.localRoot??'/'});
    this.contextCacheMs=Math.max(0,options.contextCacheMs??10_000);
    this.selectedProfile=options.profile??(()=>undefined);
  }
  #key(contextId:string,profile?:string){return JSON.stringify([profile??'',contextId])}
  async contexts(options:{force?:boolean;profile?:string}={}){
    const profile=options.profile??this.selectedProfile(),key=profile??'',cached=this.#contextSnapshots.get(key);
    if(!options.force&&cached&&cached.expiresAt>Date.now())return cached.value;
    const existing=this.#contextPromises.get(key);if(existing)return existing;
    const pending=(async()=>{
      const state=await this.fngk.probe(profile);
      if(state.compatible)await this.#refreshAdapters(profile).catch(()=>{});
      const local={id:'local',name:'Atlas process host',kind:'local',online:true,root:this.direct.root,workspaceRoot:process.cwd(),routes:[this.#evidence(this.direct)]};
      const devices=(state.namespace?.devices??[]).map(device=>{
        const id=`device:${device.id}`,routeKey=this.#key(id,profile),remote=this.#remote.get(routeKey);
        const routes=[...(remote?[remote]:[]),...(this.#adapters.get(routeKey)??[])];
        return{id,name:device.name,kind:'fngk-device',online:device.online??false,device,routes:routes.map(route=>this.#evidence(route))};
      });
      const value={state,contexts:[local,...devices]};this.#contextSnapshots.set(key,{value,expiresAt:Date.now()+this.contextCacheMs});return value;
    })();
    this.#contextPromises.set(key,pending);
    try{return await pending}finally{if(this.#contextPromises.get(key)===pending)this.#contextPromises.delete(key)}
  }
  #evidence(route: FileTransport) { return { id: route.id, kind: route.kind, deviceId: route.deviceId, effectiveIdentity: route.effectiveIdentity, privilege: route.privilege, observedAt: route.observedAt, available: route.available, operations: route.operations }; }
  async #refreshAdapters(profile?:string){
    const bindings=await this.fngk.fileBindings(profile),next=new Map<string,AdapterFileTransport[]>();
    for(const binding of bindings.bindings){const key=this.#key(`device:${binding.deviceId}`,profile),values=next.get(key)??[];values.push(nativeFileTransport(this.fngk,binding,bindings.profile.name));next.set(key,values)}
    for(const key of this.#adapters.keys())if(JSON.parse(key)[0]===(profile??''))this.#adapters.delete(key);
    for(const [key,value] of next)this.#adapters.set(key,value);
  }
  async route(contextId: string, profile=this.selectedProfile()): Promise<FileTransport> {
    if (contextId === 'local') return this.direct;
    const key=this.#key(contextId,profile);
    const existing = this.#remote.get(key); if (existing) return existing;
    const namespace = await this.fngk.namespace(profile), deviceId = contextId.startsWith('device:') ? contextId.slice(7) : contextId;
    const device = namespace.devices.find(value => value.id === deviceId); if (!device) throw Object.assign(new Error('FNGK Device is not in the current namespace.'), { code: 'context_not_found' });
    if (device.online === false) throw Object.assign(new Error('FNGK Device is offline.'), { code: 'device_offline' });
    const terminal = this.fngk.openTerminal(deviceTarget(device), { newSession: true, profile, owner:'atlas-internal', purpose:'filesystem' });
    await Promise.race([once(terminal, 'ready'), once(terminal, 'error').then(([error]) => Promise.reject(error))]);
    const modeChanged = matchingEvent(terminal, event => event.type === 'collaboration' && event.eventType === 'mode' && event.mode === 'queue');
    terminal.setMode('queue', 'atlas-context-mode'); await modeChanged;
    const executor = new FngkTerminalCommandExecutor(terminal);
    let identity = 'remote-shell', privilege: FileTransport['privilege'] = 'unknown';
    try { const result = await executor.execute('id -u'); const uid = result.output.toString('utf8').trim(); if (/^\d+$/.test(uid)) { identity = `uid:${uid}`; privilege = uid === '0' ? 'root' : 'user'; } } catch {}
    let route!:TerminalFileTransport;const invalidate=()=>{if(this.#remote.get(key)===route)this.#remote.delete(key);};
    route = new TerminalFileTransport({ id: `terminal:${device.id}`, contextId, deviceId: device.id, identity, privilege, executor,onUnavailable:invalidate });
    terminal.once('close',invalidate);
    terminal.once('error',invalidate);
    this.#remote.set(key, route); return route;
  }
  async files(contextId:string,profile=this.selectedProfile()):Promise<FileService>{
    if(contextId==='local')return new FileService([this.direct]);
    const key=this.#key(contextId,profile);
    if(!this.#adapters.has(key))await this.#refreshAdapters(profile).catch(()=>{});
    const routes:FileTransport[]=[];
    try{routes.push(await this.route(contextId,profile))}catch(error){if(!this.#adapters.get(key)?.length)throw error}
    routes.push(...(this.#adapters.get(key)??[]));return new FileService(routes);
  }
  async commandExecutor(contextId:string,profile=this.selectedProfile()):Promise<CommandExecutor>{
    const route=await this.route(contextId,profile);
    if(route instanceof TerminalFileTransport)return route.executor;
    if(route instanceof DirectTransport)return new DirectCommandExecutor();
    throw Object.assign(new Error('This context has no command route.'),{code:'route_unavailable'});
  }
  async commandPath(contextId:string,logicalPath:string,profile=this.selectedProfile()):Promise<string>{const route=await this.route(contextId,profile);return route instanceof DirectTransport?route.resolve(logicalPath):logicalPath}
  activeTerminals(){const profile=this.selectedProfile()??'';return [...this.#remote.entries()].filter(([key])=>JSON.parse(key)[0]===profile).map(([key,route])=>({contextId:JSON.parse(key)[1],route:this.#evidence(route),sessionId:route.executor instanceof FngkTerminalCommandExecutor?route.executor.session.sessionId:undefined}))}
  release(contextId:string,stop=false,profile=this.selectedProfile()):boolean{
    const key=this.#key(contextId,profile),route=this.#remote.get(key);if(!route)return false;
    if(route.executor instanceof FngkTerminalCommandExecutor)stop?route.executor.session.stop('atlas-release'):route.executor.session.detach('atlas-release');
    this.#remote.delete(key);return true;
  }
  close():void{for(const route of this.#remote.values())if(route.executor instanceof FngkTerminalCommandExecutor)route.executor.session.detach('atlas-shutdown');this.#remote.clear();this.#adapters.clear();this.#contextSnapshots.clear()}
}
