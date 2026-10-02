import { expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrantStore } from '../../src/agent-tools/grants.js';
const scope={profile:'local',teamId:'team',projectId:'project',deviceId:'device'};
test('revoked grants are not returned as executable',()=>{const grants=new GrantStore();const grant=grants.create({scope,toolIds:['atlas.terminal.command'],kind:'durable',actor:'operator'});expect(grants.active(scope)).toHaveLength(1);grants.revoke(grant.id,'operator');expect(grants.active(scope)).toHaveLength(0)});
test('durable scoped grants survive a store restart while conversation grants do not',()=>{const directory=mkdtempSync(join(tmpdir(),'atlas-grants-')),file=join(directory,'atlas.db');try{const first=new GrantStore(file);first.create({scope,toolIds:['atlas.files.read'],kind:'durable',actor:'operator'});first.create({scope,toolIds:['atlas.terminal.command'],kind:'conversation',actor:'operator'});first.close();const restarted=new GrantStore(file);expect(restarted.active(scope)).toMatchObject([{toolIds:['atlas.files.read'],kind:'durable'}]);restarted.close()}finally{rmSync(directory,{recursive:true,force:true})}});
test('one-time grants are atomically consumed by their first tool invocation',()=>{const grants=new GrantStore();const grant=grants.create({scope,toolIds:['atlas.terminal.command'],kind:'once',actor:'operator'});expect(grants.reserve(grant.id)).toBe(true);expect(grants.reserve(grant.id)).toBe(false);expect(grants.active(scope)).toEqual([])});
