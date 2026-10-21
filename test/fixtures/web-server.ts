import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createApp } from '../../src/server/app.js';
import { FngkProcessClient } from '../../src/fngk/process-client.js';
const root = path.resolve('.');
// ATLAS_FIXTURE_PORT/FNGK_FIXTURE_MODE let a second fixture server (onboarding) run beside the default one.
const port=Number(process.env.ATLAS_FIXTURE_PORT??4318),fixtureMode=process.env.FNGK_FIXTURE_MODE??'session-list',suffix=fixtureMode==='session-list'?'':`-${fixtureMode}-${port}`;
const browserRoot=`${process.env.ATLAS_E2E_ROOT??'/tmp/fngk-atlas-browser-root'}${suffix}`,dbPath=(process.env.ATLAS_E2E_DB??'/tmp/fngk-atlas-browser.db').replace(/(\.db)?$/,`${suffix}$1`),stateRoot=process.env.ATLAS_E2E_STATE??`${browserRoot}-state`;
// File versions and trash belong to this run, never the developer's state directory.
process.env.XDG_STATE_HOME=stateRoot;await rm(stateRoot,{recursive:true,force:true});await rm(browserRoot,{recursive:true,force:true});await rm(dbPath,{force:true});await mkdir(path.join(browserRoot,'src'),{recursive:true});await writeFile(path.join(browserRoot,'package.json'),'\n{\n  "name": "fngk-atlas",\n  "scripts": { "test": "vitest" }\n}\n');
await writeFile(path.join(browserRoot,'src','main.ts'),'export const atlas = true;\n');
await writeFile(path.join(browserRoot,'binary.dat'),Buffer.from([0,1,2,255]));
const app = await createApp({ root, localRoot: browserRoot, dbPath, fngk: new FngkProcessClient({ binary: path.resolve('test/fixtures/fngk.mjs'), env: { FNGK_FIXTURE_MODE: fixtureMode } }) });
await app.listen({ host: '127.0.0.1', port });
const close = async () => { await app.close();await rm(browserRoot,{recursive:true,force:true});await rm(stateRoot,{recursive:true,force:true});await rm(dbPath,{force:true});process.exit(0); };
process.once('SIGTERM', close); process.once('SIGINT', close);
