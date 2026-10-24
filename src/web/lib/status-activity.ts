import type {AtlasEvent} from './atlas-events.js';

/** What the status bar shows from the operation history. */
export type StatusSummary={running:AtlasEvent[];latest?:AtlasEvent;unseenErrors:AtlasEvent[];roundTripMs?:number};

// Remote reads whose duration is a fair measure of the round trip to a Device.
const roundTripTypes=new Set(['filesystem.list','file.open']);
const stamp=(event:AtlasEvent)=>Date.parse(event.updatedAt??event.createdAt);

export const eventDurationMs=(event:AtlasEvent,now=Date.now())=>Math.max(0,(event.state==='pending'?now:stamp(event))-Date.parse(event.createdAt));

export function formatDuration(ms:number){
  if(ms<1000)return `${Math.round(ms)}ms`;
  if(ms<60_000)return `${(ms/1000).toFixed(1)}s`;
  const seconds=Math.round(ms/1000);return `${Math.floor(seconds/60)}m ${seconds%60}s`;
}

export function summarize(items:AtlasEvent[],options:{contextId?:string;seenAt?:number}={}):StatusSummary{
  const seenAt=options.seenAt??0,byTime=[...items].sort((a,b)=>stamp(b)-stamp(a));
  const running=byTime.filter(event=>event.state==='pending');
  // A failure stops being news once later work in the same context succeeds: a Device that was offline and
  // now answers should not keep saying it is offline.
  const resolved=(failure:AtlasEvent)=>byTime.some(event=>event.state==='success'&&event.contextId===failure.contextId&&stamp(event)>stamp(failure));
  const unseenErrors=byTime.filter(event=>event.state==='error'&&stamp(event)>seenAt&&!resolved(event));
  // The last finished event for the context on screen (or one with no context), never another Device's.
  const latest=byTime.find(event=>event.state!=='pending'&&(!event.contextId||!options.contextId||event.contextId===options.contextId));
  // The median of the last few successful reads on this Device; local contexts have no round trip worth showing.
  const samples=options.contextId?.startsWith('device:')?byTime.filter(event=>event.contextId===options.contextId&&event.state==='success'&&roundTripTypes.has(event.type)).slice(0,8).map(event=>eventDurationMs(event)).sort((a,b)=>a-b):[];
  const roundTripMs=samples.length?samples[Math.floor(samples.length/2)]:undefined;
  return {running,latest,unseenErrors,roundTripMs};
}

/** Plain text for a bug report: presentation-safe fields only, as the event store keeps them. */
export function eventReport(event:AtlasEvent){
  const lines=[`${event.title} — ${event.state}`,`type: ${event.type}`,`started: ${event.createdAt}`,`took: ${formatDuration(eventDurationMs(event))}`];
  if(event.contextId)lines.push(`context: ${event.contextId}`);
  if(event.message)lines.push(`message: ${event.message}`);
  for(const [key,value] of Object.entries(event.metadata??{}))lines.push(`${key}: ${String(value)}`);
  if(event.correlationId)lines.push(`correlation: ${event.correlationId}`);
  return lines.join('\n');
}
