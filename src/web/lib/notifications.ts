import {atlasEvents,type AtlasEvent} from './atlas-events.js';
export type Notice={id:string;message:string;level:'success'|'error'|'info'};
export function noticeFromAtlasEvent(event:AtlasEvent):Notice|undefined{if(event.state==='success')return{id:event.id,message:event.message??event.title,level:'success'};if(event.state==='warning')return{id:event.id,message:event.message??event.title,level:'info'};if(event.state==='error')return{id:event.id,message:event.message??event.title,level:'error'};return undefined}
export class NotificationStore {
  #items:Notice[]=[];#listeners=new Set<(items:Notice[])=>void>();#timers=new Map<string,ReturnType<typeof setTimeout>>();
  snapshot(){return this.#items.map(item=>({...item}))}
  subscribe(listener:(items:Notice[])=>void){this.#listeners.add(listener);listener(this.snapshot());return()=>{this.#listeners.delete(listener)}}
  push(notice:Notice){this.dismiss(notice.id);this.#items=[...this.#items,notice].slice(-5);if(notice.level!=='error')this.#timers.set(notice.id,setTimeout(()=>this.dismiss(notice.id),5000));this.#publish()}
  dismiss(id:string){clearTimeout(this.#timers.get(id));this.#timers.delete(id);this.#items=this.#items.filter(item=>item.id!==id);this.#publish()}
  dispose(){for(const timer of this.#timers.values())clearTimeout(timer);this.#timers.clear();this.#listeners.clear()}
  #publish(){for(const listener of this.#listeners)listener(this.snapshot())}
}
export function notify(message:string,level:Notice['level']='info',id=message){atlasEvents.begin({id,type:'atlas.notice',title:message,message,state:level==='error'?'error':level==='success'?'success':'warning'});window.dispatchEvent(new CustomEvent('atlas:notice',{detail:{id,message,level}}))}
