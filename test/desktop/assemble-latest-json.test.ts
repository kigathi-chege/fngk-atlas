import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
// @ts-expect-error plain ESM release script without type declarations
import {assembleLatestJson} from '../../scripts/assemble-latest-json.mjs';

const dirs:string[]=[];afterEach(async()=>{while(dirs.length)await rm(dirs.pop()!,{recursive:true,force:true})});
async function release(files:Record<string,string>){const dir=await mkdtemp(path.join(tmpdir(),'atlas-latest-'));dirs.push(dir);for(const [name,body] of Object.entries(files))await writeFile(path.join(dir,name),body);return dir}

describe('Atlas updater manifest',()=>{
  it('maps signed bundles to Tauri platform keys under the versioned URL',async()=>{
    const dir=await release({'Atlas_1.2.0_amd64.AppImage':'a','Atlas_1.2.0_amd64.AppImage.sig':'sig-x64\n','Atlas_1.2.0_aarch64.AppImage':'b','Atlas_1.2.0_aarch64.AppImage.sig':'sig-arm','Atlas_1.2.0_amd64.deb':'deb','Atlas_1.2.0_aarch64.app.tar.gz':'m','Atlas_1.2.0_aarch64.app.tar.gz.sig':'sig-mac'});
    const manifest=assembleLatestJson(dir,'1.2.0','https://downloads.signol.org/atlas',{pubDate:'2026-10-21T00:00:00Z'});
    expect(manifest).toEqual({version:'1.2.0',notes:'',pub_date:'2026-10-21T00:00:00Z',platforms:{
      'linux-x86_64':{signature:'sig-x64',url:'https://downloads.signol.org/atlas/1.2.0/Atlas_1.2.0_amd64.AppImage'},
      'linux-aarch64':{signature:'sig-arm',url:'https://downloads.signol.org/atlas/1.2.0/Atlas_1.2.0_aarch64.AppImage'},
      'darwin-aarch64':{signature:'sig-mac',url:'https://downloads.signol.org/atlas/1.2.0/Atlas_1.2.0_aarch64.app.tar.gz'}}});
  });
  it('requires both Linux bundles, their signatures, and a plain semantic version',async()=>{
    const dir=await release({'Atlas_1.2.0_amd64.AppImage':'a','Atlas_1.2.0_amd64.AppImage.sig':'s'});
    expect(()=>assembleLatestJson(dir,'1.2.0','https://downloads.signol.org/atlas')).toThrow(/linux-aarch64/);
    expect(()=>assembleLatestJson(dir,'v1.2.0','https://downloads.signol.org/atlas',{required:[]})).toThrow(/semantic/);
    const unsigned=await release({'Atlas_1.2.0_amd64.AppImage':'a'});
    expect(()=>assembleLatestJson(unsigned,'1.2.0','https://downloads.signol.org/atlas',{required:[]})).toThrow(/\.sig/);
  });
});
