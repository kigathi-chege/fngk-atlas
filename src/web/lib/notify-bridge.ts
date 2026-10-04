import type {AtlasEvent, AtlasEventStore} from './atlas-events.js';

export type NotifyPublishEvent={event_name:string;event_version:1;idempotency_key:string;occurred_at:string;payload:Record<string,string>};
export type NotifyBridgeConfig={publish?:(event:NotifyPublishEvent)=>Promise<void>};
export type NotifyBridgeState={mode:'local'|'bridge';connected:boolean;queued:number};
const eventNames:Record<string,string>={
  'filesystem.list':'atlas.filesystem.listed',
  'filesystem.read':'atlas.filesystem.read',
  'terminal.command':'atlas.terminal.completed',
  'device.connect':'atlas.device.connected',
  'device.disconnect':'atlas.device.disconnected',
};

/**
 * Optional transport only. Credentials and HMAC signing stay in a trusted Atlas
 * server/service; the renderer receives an injected publish function and stores
 * neither credentials nor raw terminal/file content.
 */
export class NotifyBridge {
  #queue=new Map<string,AtlasEvent>();#unsubscribe?:()=>void;#started=false;#connected=false;
  constructor(private events:AtlasEventStore,private config:NotifyBridgeConfig={}){}
  async start(){if(this.#started)return;this.#started=true;for(const event of this.events.snapshot())this.enqueue(event);this.#unsubscribe=this.events.subscribe(items=>items.forEach(event=>this.enqueue(event)));}
  stop(){this.#unsubscribe?.();this.#unsubscribe=undefined;this.#started=false;this.#connected=false;}
  connectionState():NotifyBridgeState{return{mode:this.config.publish?'bridge':'local',connected:this.#connected,queued:this.#queue.size}}
  async flush(){if(!this.config.publish)return;for(const event of [...this.#queue.values()]){try{await this.config.publish(this.serialize(event));this.#queue.delete(event.id);this.#connected=true;}catch{this.#connected=false;this.events.upsertRemote({...event,state:'warning',message:'Notify bridge is offline; the local event is retained.'});}}}
  private enqueue(event:AtlasEvent){if(event.source==='remote'||event.state!=='pending')return;if(!eventNames[event.type]){this.events.upsertRemote({...event,state:'warning',message:'This event is retained locally and is not registered for Notify.'});return;}this.#queue.set(event.id,event)}
  private serialize(event:AtlasEvent):NotifyPublishEvent{return{event_name:eventNames[event.type],event_version:1,idempotency_key:`atlas-${event.id}`,occurred_at:event.updatedAt??event.createdAt,payload:{event_id:event.id,type:event.type,state:event.state,context_id:event.contextId??'',correlation_id:event.correlationId??''}}}
}
