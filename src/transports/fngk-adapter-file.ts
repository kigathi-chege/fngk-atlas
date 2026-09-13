import path from 'node:path';
import type { FngkProcessClient } from '../fngk/process-client.js';
import type { NativeFileBinding } from '../fngk/protocol.js';
import { AdapterFileTransport, type AdapterFileOperations } from './adapter-file.js';
import type { TransportEntry } from './direct.js';
import type { FileSearchMatch, FileSearchOptions, FileStat } from './file-transport.js';

function mode(value:unknown){return Number.parseInt(String(value??'0').replace(/^0o/,''),8)||0;}

export function nativeFileTransport(client:FngkProcessClient,binding:NativeFileBinding,profile?:string):AdapterFileTransport {
  const root=path.posix.resolve('/',binding.root||'/');
  const granted=(capability:string)=>binding.capabilities.includes(capability)||binding.capabilities.includes('filesystem.*')||binding.capabilities.includes('*');
  const relative=(value:string)=>{const normalized=path.posix.resolve('/',value);if(normalized!==root&&!normalized.startsWith(`${root.replace(/\/$/,'')}/`))throw Object.assign(new Error('Path is outside the Files binding.'),{code:'binding_denied'});const result=path.posix.relative(root,normalized);return result||'.'};
  const absolute=(value:unknown)=>{const item=String(value??'.'),joined=path.posix.resolve(root,item);if(joined!==root&&!joined.startsWith(`${root.replace(/\/$/,'')}/`))throw Object.assign(new Error('Adapter returned a path outside its binding.'),{code:'path_escape'});return joined;};
  const invoke=async(capability:string,input:Record<string,unknown>,confirm=false)=>(await client.invokeFileBinding(binding.id,capability,input,{profile,confirm})).output??{};
  const operations:AdapterFileOperations={
    async list(value){const entries:TransportEntry[]=[],seen=new Set<string>();let cursor='';do{const output=await invoke('filesystem.list',{path:relative(value),limit:500,...(cursor?{cursor}:{})});for(const item of output.entries??[]){const target=absolute(item.path);if(seen.has(target))continue;seen.add(target);entries.push({name:String(item.name??path.posix.basename(target)),path:target,type:item.kind==='directory'?'directory':item.kind==='file'?'file':item.kind==='symlink'?'symlink':'other',bytes:Number(item.size??0),modifiedAt:String(item.modifiedAt??new Date(0).toISOString()),mode:mode(item.mode)});}cursor=String(output.nextCursor??'');}while(cursor&&entries.length<20_000);return entries;},
    async stat(value):Promise<FileStat>{const output=await invoke('filesystem.stat',{path:relative(value)}),entry=output.entry??{};return {size:Number(entry.size??0),mode:mode(entry.mode)};},
    async read(value){let offset=0,size=0;const chunks:Buffer[]=[];do{const output=await invoke('filesystem.read',{path:relative(value),offset,limit:262144}),chunk=Buffer.from(String(output.bodyBase64??''),'base64');chunks.push(chunk);offset=Number(output.nextOffset??offset+chunk.length);size=Number(output.size??offset);if(output.eof===true)break;if(!chunk.length)throw Object.assign(new Error('Files adapter read made no progress.'),{code:'adapter_protocol_error'});}while(offset<size&&offset<=2*1024*1024);return Buffer.concat(chunks);},
  };
  const write=async(value:string,content:Buffer)=>{const begin=await invoke('filesystem.write.begin',{path:relative(value)}),transferId=String(begin.transferId??'');if(!transferId)throw Object.assign(new Error('Files adapter returned no transfer ID.'),{code:'adapter_protocol_error'});try{for(let offset=0;offset<content.length;offset+=262144)await invoke('filesystem.write.chunk',{transferId,offset,bodyBase64:content.subarray(offset,offset+262144).toString('base64')});await invoke('filesystem.write.commit',{transferId});}catch(error){await invoke('filesystem.write.abort',{transferId}).catch(()=>{});throw error;}};
  if(!binding.readOnly&&granted('filesystem.write'))operations.write=write;
  if(granted('filesystem.search'))operations.search=async(value,query,options:FileSearchOptions={})=>{if(options.mode==='content')throw Object.assign(new Error('The native Files adapter provides name search only.'),{code:'unsupported_operation'});const output=await invoke('filesystem.search',{path:relative(value),query,limit:options.limit??200});return (output.entries??[]).map((item:any):FileSearchMatch=>({path:absolute(item.path),type:item.kind==='directory'?'directory':'file'}));};
  if(!binding.readOnly&&granted('filesystem.write'))operations.createFile=async(value,content=Buffer.alloc(0))=>write(value,content);
  if(!binding.readOnly&&granted('filesystem.mkdir'))operations.createDirectory=async value=>{await invoke('filesystem.mkdir',{path:relative(value)});};
  if(!binding.readOnly&&granted('filesystem.move'))operations.move=async(value,destination)=>{await invoke('filesystem.move',{path:relative(value),destination:relative(destination)});};
  if(!binding.readOnly&&granted('filesystem.trash'))operations.trash=async value=>{const output=await invoke('filesystem.trash',{path:relative(value)});return {restorePath:`/.atlas-trash/${String(output.trashId??'')}`};};
  if(!binding.readOnly&&granted('filesystem.restore'))operations.restore=async value=>{const id=value.match(/^\/\.atlas-trash\/(.+)$/)?.[1];if(!id)throw Object.assign(new Error('Restore requires a native trash ID.'),{code:'invalid_trash_record'});await invoke('filesystem.restore',{trashId:id});};
  if(!binding.readOnly&&granted('filesystem.delete'))operations.remove=async value=>{await invoke('filesystem.delete',{path:relative(value)},true);};
  return new AdapterFileTransport(`adapter:${binding.id}`,`device:${binding.deviceId}`,binding.deviceId,'fngk-operator','unknown',operations,root);
}
