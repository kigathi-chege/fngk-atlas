import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,20);
const inside=(parent,child)=>child===parent||child.startsWith(`${parent}${path.sep}`);

export async function observeLocalProcesses(index) {
  let entries=[];try{entries=await fs.readdir('/proc',{withFileTypes:true})}catch{return index}
  const modules=index.nodes.filter(n=>n.type==='module');let count=0;
  for(const entry of entries){if(!entry.isDirectory()||!/^\d+$/.test(entry.name))continue;const pid=Number(entry.name);let cwd,cmdline,exe,status;
    try{[cwd,cmdline,exe,status]=await Promise.all([fs.readlink(`/proc/${pid}/cwd`),fs.readFile(`/proc/${pid}/cmdline`,'utf8'),fs.readlink(`/proc/${pid}/exe`),fs.readFile(`/proc/${pid}/status`,'utf8')])}catch{continue}
    cmdline=cmdline.split('\0').filter(Boolean).join(' ');if(!inside(index.root,cwd)&&!cmdline.includes(index.root))continue;
    const processId=`process:${digest(`local:${pid}:${cmdline}`)}`;const memoryKb=Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]??0);
    index.nodes.push({id:processId,type:'process',label:path.basename(exe)||`PID ${pid}`,path:cwd,parent:null,status:'running',metrics:{pid,memoryBytes:memoryKb*1024},executable:exe,evidence:{type:'local /proc observation',observedAt:new Date().toISOString(),confidence:'exact process metadata; command line used transiently and discarded'}});
    index.edges.push({id:`runs:${processId}:${index.id}`,source:processId,target:index.id,type:'runs',confidence:'cwd-or-command-match'});count++;
    for(const module of modules){const absolute=path.join(index.root,module.path);if(cmdline.includes(absolute)||cmdline.includes(module.path))index.edges.push({id:`observed:${processId}:${module.id}`,source:processId,target:module.id,type:'observed_in',confidence:'command-line path match'});}
  }
  index.summary.processes=count;return index;
}
