import path from 'node:path';
import {redactCommandLine,redactSensitiveText} from '../discovery/redaction.js';

const clean=(value:string)=>redactSensitiveText(redactCommandLine(value)).slice(0,400).trim();

// An index may outlive the source file. Retain only the fields interpretation needs,
// never a copy of the document body or arbitrary manifest properties.
export function summarizeLocalDocument(documentPath:string,text:string):string|undefined{
  if(!text||text.includes('\0')||text.includes('\uFFFD'))return;
  const bounded=Buffer.from(text,'utf8').subarray(0,64*1024).toString('utf8'),name=path.posix.basename(documentPath);
  if(/^README(?:\.|$)/i.test(name)){
    const paragraph:string[]=[];
    for(const raw of bounded.split(/\r?\n/)){
      const line=raw.trim();
      if(!line||line.startsWith('#')||/^[-=*]{3,}$/.test(line)){if(paragraph.length)break;continue}
      paragraph.push(line);if(paragraph.join(' ').length>=240)break;
    }
    return clean(paragraph.join(' ')).slice(0,240)||undefined;
  }
  if(name==='package.json'){
    try{
      const value=JSON.parse(bounded),scripts:Record<string,string>={};
      for(const [script,command] of Object.entries(value.scripts??{}).slice(0,20)){
        if(!/^[\w:.-]{1,64}$/.test(script)||typeof command!=='string')continue;
        const port=command.match(/(?:--port(?:=|\s+)|\bPORT=)(\d{2,5})\b/i)?.[1];
        scripts[script]=port?`PORT=${port}`:'';
      }
      const description=typeof value.description==='string'?clean(value.description):undefined;
      return JSON.stringify({description,scripts});
    }catch{return}
  }
  if(/^(?:fngk\.project|atlas\.deployment|deployment)\.json$/i.test(name)){
    try{
      const value=JSON.parse(bounded),purpose=value.purpose??value.description;
      return typeof purpose==='string'?JSON.stringify({purpose:clean(purpose)}):undefined;
    }catch{return}
  }
}
