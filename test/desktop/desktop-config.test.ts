import {readFile} from 'node:fs/promises';
import {describe,expect,it} from 'vitest';
// @ts-expect-error plain ESM build script without type declarations
import {desktopConfig,resolveVersion} from '../../scripts/desktop-config.mjs';

describe('desktop build configuration',()=>{
  it('takes the version from ATLAS_VERSION, then the git tag, then package.json',()=>{
    expect(resolveVersion({ATLAS_VERSION:'v1.4.2'},'v9.9.9','0.1.0')).toBe('1.4.2');
    expect(resolveVersion({},'v0.3.0-rc.1','0.1.0')).toBe('0.3.0-rc.1');
    expect(resolveVersion({},'','0.1.0')).toBe('0.1.0-dev');
    expect(()=>resolveVersion({ATLAS_VERSION:'latest'},'','0.1.0')).toThrow(/semantic/);
  });
  it('signs updater artifacts only with a signing key and refuses dev overrides in releases',()=>{
    expect(desktopConfig({},'1.0.0')).toEqual({version:'1.0.0',bundle:{createUpdaterArtifacts:false}});
    expect(desktopConfig({TAURI_SIGNING_PRIVATE_KEY:'k',ATLAS_UPDATER_PUBKEY:'dev',ATLAS_UPDATER_ALLOW_INSECURE:'1'},'1.0.0')).toEqual({version:'1.0.0',bundle:{createUpdaterArtifacts:true},plugins:{updater:{pubkey:'dev',dangerousInsecureTransportProtocol:true}}});
    expect(()=>desktopConfig({ATLAS_RELEASE:'1',ATLAS_UPDATER_PUBKEY:'dev'},'1.0.0')).toThrow(/pinned updater key/);
  });
  it('pins the production updater key, endpoint and deep-link scheme',async()=>{
    const config=JSON.parse(await readFile(new URL('../../desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'));
    expect(config.version).toBe('../../package.json');
    expect(config.plugins.updater.endpoints).toEqual(['https://downloads.signol.org/atlas/latest.json']);
    expect(Buffer.from(config.plugins.updater.pubkey,'base64').toString()).toContain('minisign public key: E2643428051530BC');
    expect(config.plugins['deep-link'].desktop.schemes).toEqual(['fngk-atlas']);
  });
});
