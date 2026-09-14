import type {FngkProcessClient} from '../fngk/process-client.js';
import {FngkTcpRelayProvider,type TcpRelay,type TcpRelayProvider} from '../fngk/tcp-relay.js';
import type {DatabaseConnection,DatabaseRuntime} from './types.js';
import type {DiagnosticRegistry} from '../diagnostics/registry.js';

export class RoutedDatabaseRuntime implements DatabaseRuntime {
  #relays=new Map<string,{relay:TcpRelay;timer:NodeJS.Timeout}>();#routes=new Map<string,Pick<NonNullable<ReturnType<DatabaseRuntime['list']>[number]>, 'accessRoute'|'target'>>();
  constructor(readonly inner:DatabaseRuntime,readonly fngk:FngkProcessClient,readonly relays:TcpRelayProvider=new FngkTcpRelayProvider({binary:fngk.binary,env:fngk.env}),readonly diagnostics?:DiagnosticRegistry){}
  async start(connection:DatabaseConnection){
    if(connection.contextId==='local'){const value=await this.inner.start(connection);this.#routes.set(value.session.id,{accessRoute:'direct'});value.session.accessRoute='direct';return value}
    if(!connection.port)throw Object.assign(new Error('A remote database port is required.'),{code:'database_port_required'});
    if(!['127.0.0.1','localhost','::1'].includes(connection.host))throw Object.assign(new Error('Remote database relay currently supports Device-local listeners only.'),{code:'database_host_unsupported'});
    const state=await this.fngk.probe();if(!state.compatible)throw Object.assign(new Error('The selected FNGK profile is not ready for TCP relay.'),{code:state.reason??'fngk_unavailable'});
    const relay=await this.relays.start(connection.contextId,connection.port,{profile:state.profile});
    try{const value=await this.inner.start({...connection,host:relay.host,port:relay.port}),route={accessRoute:'fngk-tcp' as const,target:{host:connection.host,port:connection.port}};Object.assign(value.session,route);this.#routes.set(value.session.id,route);const expiresAt=Date.parse(value.session.expiresAt),delay=Number.isFinite(expiresAt)?Math.max(1,expiresAt-Date.now()):30*60_000,timer=setTimeout(()=>void this.#releaseRelay(value.session.id),delay);timer.unref();this.#relays.set(value.session.id,{relay,timer});return value}catch(error){await relay.close();throw error}
  }
  list(){return this.inner.list().map(session=>({...session,...this.#routes.get(session.id)}))}
  get(id:string){const value=this.inner.get(id);return value?{...value,session:{...value.session,...this.#routes.get(id)}}:undefined}
  async #releaseRelay(id:string){const record=this.#relays.get(id);if(!record)return false;this.#relays.delete(id);clearTimeout(record.timer);await record.relay.close();return true}
  async stop(id:string){const stopped=await this.inner.stop(id),released=await this.#releaseRelay(id);this.#routes.delete(id);return stopped||released}
  async close(){await this.inner.close();await Promise.all([...this.#relays].map(([id])=>this.#releaseRelay(id)));this.#routes.clear()}
}
