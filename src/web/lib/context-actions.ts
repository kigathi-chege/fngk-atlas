import type {WorkbenchSnapshot} from './workbench-state.js';

export type ContextAction={id:string;label:string;group:'workflow'|'observe'|'navigate'|'intelligence';placement:'workspace'|'operations'|'sidebar';available:(snapshot:WorkbenchSnapshot)=>boolean;run:(snapshot:WorkbenchSnapshot)=>void};
const emit=(name:string,detail?:Record<string,unknown>)=>window.dispatchEvent(detail?new CustomEvent(name,{detail}):new Event(name));
const repository=(snapshot:WorkbenchSnapshot)=>snapshot.selection?.path?.startsWith('/')?snapshot.selection.path:'/workspace';
export const contextActions:ContextAction[]=[
 {id:'files',label:'Open files',group:'navigate',placement:'sidebar',available:()=>true,run:()=>emit('atlas:focus-files')},
 {id:'intelligence',label:'Open intelligence',group:'intelligence',placement:'sidebar',available:()=>true,run:()=>emit('atlas:open-intelligence')},
 {id:'architecture',label:'Open architecture',group:'workflow',placement:'workspace',available:()=>true,run:()=>emit('atlas:graph-refresh')},
 {id:'database',label:'Open databases',group:'workflow',placement:'workspace',available:()=>true,run:s=>emit('atlas:open-database',{contextId:s.contextId})},
 {id:'terminal',label:'Open terminal',group:'observe',placement:'operations',available:s=>s.contextId.startsWith('device:'),run:s=>emit('atlas:open-terminal',{contextId:s.contextId})},
 {id:'ports',label:'Share HTTP ports',group:'observe',placement:'workspace',available:()=>true,run:s=>emit('atlas:open-ports',{contextId:s.contextId})},
 {id:'handoff',label:'Install FNGK head',group:'workflow',placement:'workspace',available:s=>s.contextId.startsWith('device:'),run:s=>emit('atlas:open-fngk-handoff',{contextId:s.contextId})},
 {id:'live',label:'Start dev run',group:'workflow',placement:'workspace',available:s=>s.contextId.startsWith('device:'),run:s=>emit('atlas:open-live-project',{contextId:s.contextId,repositoryPath:repository(s)})},
 {id:'deploy',label:'Open deployment workbench',group:'workflow',placement:'workspace',available:s=>s.contextId.startsWith('device:'),run:s=>emit('atlas:open-deployment',{contextId:s.contextId,repositoryPath:repository(s)})},
];
